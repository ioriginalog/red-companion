/**
 * The relay: a dumb pipe with two smart jobs.
 *   1. Keep the canonical copy of each session's log (the GM device is the
 *      authority; the relay checks only that entries chain without gaps).
 *   2. Redact everything per player before it leaves the server.
 *
 * It never runs game rules and never rolls dice.
 */
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import {
  applyEntry, LogGapError, parseClientMessage, partyVision, projectEntry, projectState, PROTOCOL_VERSION, replay,
  type ClientMessage, type HistoryItem, type Intent, type LogEntry, type PlayerInfo, type ServerMessage, type SessionState, type Signal, type Viewer,
} from '@cprc/session';
import type { Cell } from '@cprc/rules-core';

/** Every square a signal points at (none for clears). */
function signalCells(s: Signal): Cell[] {
  switch (s.kind) {
    case 'ping': return [s.at];
    case 'cursor': return s.at ? [s.at] : [];
    case 'measure': return s.to ? [s.from, s.to] : [];
    default: return [];
  }
}
import { ASSET_NAME, type QueuedIntent, type SessionMeta, type Store } from './store.js';

export interface RelayOptions {
  store: Store;
  maxPayloadBytes?: number;
  maxPlayersPerSession?: number;
  maxLogEntries?: number;
  /** Session creations allowed per IP per hour. */
  createPerHour?: number;
  /**
   * Which browser origins may create sessions and open sockets.
   * 'same-origin' (default): the Origin's host must equal the Host header.
   * '*': any. A list: exact origins.
   */
  allowedOrigins?: string[] | '*' | 'same-origin';
  /**
   * How many reverse proxies sit in front of the relay. 0 (default) = use the
   * socket address and ignore X-Forwarded-For. N = trust the Nth
   * X-Forwarded-For entry from the right (1 for a single edge proxy).
   */
  trustProxyHops?: number;
  /** Largest session export accepted by POST /api/sessions/import. Default 25 MB. */
  maxImportBytes?: number;
  /** Per-session image storage cap. Default 200 MB. */
  assetQuotaBytes?: number;
  /** Built web client to serve from the same origin (SPA fallback to index.html). */
  webDir?: string;
  /** Player intents held while the GM is offline. Defaults: 50 per session, 10 per player, 10 minutes. */
  offlineQueue?: { perSession?: number; perPlayer?: number; maxAgeMs?: number };
  /** Projected entries in a player's welcome history. Default 300. */
  historyEntries?: number;
  /**
   * Failed-hello tarpit (per IP). The first `free` failures cost nothing; after
   * that each unauthenticated hello waits `msPerFailure` per extra failure, up to
   * `maxMs`. Failures decay one per `decayMs`. Nothing is ever hard-blocked.
   */
  helloTarpit?: { free?: number; msPerFailure?: number; maxMs?: number; decayMs?: number };
  /** Unauthenticated sockets allowed per IP at once. Default 8. */
  maxPendingPerIp?: number;
  /** Player intent limits (per player): sustained rate/s, burst, and chat-like intents per minute. */
  playerRate?: { perSecond?: number; burst?: number; chatPerMinute?: number };
  /** Clock for tests. */
  now?: () => number;
  log?: (msg: string) => void;
}

/** Largest hello frame; anything bigger before authentication closes the socket. */
const MAX_HELLO_BYTES = 4096;
/** Intents that only add chatter; refused first when the log nears its cap. */
const CHATTY: ReadonlySet<string> = new Set(['chat', 'rollDice', 'rollCheck']);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "font-src 'self'", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'",
].join('; ');

interface Room {
  meta: SessionMeta;
  log: LogEntry[] | null; // lazily loaded
  state: SessionState | null;
  gm: WebSocket | null;
  players: Map<WebSocket, string>; // socket → playerId
  /** Player intents waiting for the GM (in arrival order). */
  queue: QueuedIntent[];
  /** Deliver the queue after the reconnecting GM has fetched the log. */
  flushOnFetch: boolean;
  /** Per-player intent limiter. */
  rates: Map<string, PlayerRate>;
  /** Recently delivered or dropped held intents per player (bounded), so a reconnecting client can tell what was lost. */
  settled?: Map<string, string[]>;
  /** Party vision cached per state object, for filtering GM signals. */
  visionCache?: { state: SessionState; cells: Set<string> | null };
}

interface PlayerRate { tokens: number; at: number; chat: number[] }


type Conn = {
  ws: WebSocket; room?: Room; role?: 'gm' | 'player'; playerId?: string; alive: boolean; ip: string;
  /** Token bucket for signals. */
  signalTokens: number; signalAt: number;
};

export const ASSET_MAX_BYTES = 8 * 1024 * 1024;
export const ASSET_QUOTA_BYTES = 200 * 1024 * 1024;
const SIGNAL_RATE = 10; // per second
const SIGNAL_BURST = 20;
const ASSET_TYPES: Record<string, { ext: 'webp' | 'png' | 'jpg'; magic: (b: Buffer) => boolean }> = {
  'image/webp': { ext: 'webp', magic: (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
  'image/png': { ext: 'png', magic: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: 'jpg', magic: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
};
const ASSET_MIME: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' };

const JOIN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createRelay(opts: RelayOptions): { server: Server; close: () => Promise<void> } {
  const store = opts.store;
  const maxPlayers = opts.maxPlayersPerSession ?? 12;
  const maxLog = opts.maxLogEntries ?? 20_000;
  const createPerHour = opts.createPerHour ?? 20;
  const log = opts.log ?? (() => {});
  const VERSION = '0.1.0';
  const now = opts.now ?? Date.now;
  const qPerSession = opts.offlineQueue?.perSession ?? 50;
  const qPerPlayer = opts.offlineQueue?.perPlayer ?? 10;
  const qMaxAge = opts.offlineQueue?.maxAgeMs ?? 600_000;
  const historyN = opts.historyEntries ?? 300;
  const tarpit = { free: 5, msPerFailure: 1000, maxMs: 5000, decayMs: 30_000, ...opts.helloTarpit };
  const maxPending = opts.maxPendingPerIp ?? 8;
  const rate = { perSecond: 5, burst: 20, chatPerMinute: 30, ...opts.playerRate };
  /** Headroom kept for the GM: chat and free rolls stop this many entries short of the cap. */
  const chatReserve = Math.max(50, Math.floor(maxLog * 0.02));

  const rooms = new Map<string, Room>();
  const byJoinCode = new Map<string, Room>();
  for (const meta of store.listMeta()) {
    indexRoom({ meta, log: null, state: null, gm: null, players: new Map(), queue: store.loadQueue(meta.sessionId), flushOnFetch: false, rates: new Map() });
  }
  const saveQueue = (r: Room) => { try { store.saveQueue(r.meta.sessionId, r.queue); } catch (e) { log(`queue save failed: ${(e as Error).message}`); } };

  function indexRoom(r: Room) {
    rooms.set(r.meta.sessionId, r);
    byJoinCode.set(r.meta.joinCode, r);
  }
  function ensureLoaded(r: Room): asserts r is Room & { log: LogEntry[]; state: SessionState } {
    if (!r.log) {
      r.log = store.loadLog(r.meta.sessionId);
      r.state = replay(r.meta.sessionId, r.log);
    }
  }

  // ----- HTTP ----------------------------------------------------------------
  const createHits = new Map<string, number[]>();
  function rateOk(ip: string) {
    const now = Date.now();
    const hits = (createHits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
    if (hits.length >= createPerHour) return false;
    hits.push(now);
    createHits.set(ip, hits);
    return true;
  }

  const hops = opts.trustProxyHops ?? 0;
  const ipOf = (req: IncomingMessage) => clientIp(req, hops);

  /** Browsers always send Origin cross-site; native clients may omit it. */
  function originOk(req: IncomingMessage) {
    const allowed = opts.allowedOrigins ?? 'same-origin';
    const origin = req.headers.origin;
    if (allowed === '*' || !origin) return true;
    if (allowed === 'same-origin') {
      let host: string;
      try { host = new URL(origin).host; } catch { return false; }
      const fwdHost = hops > 0 ? String(req.headers['x-forwarded-host'] ?? '').split(',')[0]?.trim() : '';
      return host === req.headers.host || (!!fwdHost && host === fwdHost);
    }
    return allowed.includes(origin);
  }

  const webRoot = opts.webDir && existsSync(join(opts.webDir, 'index.html')) ? resolve(opts.webDir) : null;
  function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
    if (!webRoot || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
    let rel: string;
    try { rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, ''); } catch { return false; }
    let file = resolve(webRoot, rel || 'index.html');
    if (file !== webRoot && !file.startsWith(webRoot + sep)) return false;
    let isFile = false;
    try { isFile = statSync(file).isFile(); } catch { /* missing */ }
    // SPA fallback for routes; real 404s for missing assets.
    if (!isFile) {
      if (extname(rel)) return false;
      file = join(webRoot, 'index.html');
    }
    const ext = extname(file);
    const immutable = rel.startsWith('assets/') && /-[A-Za-z0-9_-]{8}\./.test(rel);
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': ext === '.html' || rel === 'sw.js' || ext === '.webmanifest' ? 'no-cache' : immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...(ext === '.html' ? { 'Content-Security-Policy': CSP } : {}),
    });
    if (req.method === 'HEAD') res.end();
    else res.end(readFileSync(file));
    return true;
  }

  function cors(req: IncomingMessage, res: ServerResponse) {
    const origin = req.headers.origin;
    const allowed = opts.allowedOrigins ?? 'same-origin';
    if (allowed === '*') res.setHeader('Access-Control-Allow-Origin', '*');
    else if (origin && allowed !== 'same-origin' && allowed.includes(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  const json = (res: ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  /** GM auth for HTTP: `Authorization: Bearer <gmKey>` against the session's stored hash. */
  function gmAuthorized(req: IncomingMessage, r: Room): boolean {
    const h = req.headers.authorization;
    const m = typeof h === 'string' ? /^Bearer (\S{1,128})$/.exec(h) : null;
    return !!m && sameHash(sha256(m[1]!), r.meta.gmKeyHash);
  }

  function readBody(req: IncomingMessage, max: number): Promise<Buffer | 'too_large'> {
    return new Promise((resolveBody, reject) => {
      const chunks: Buffer[] = [];
      let n = 0;
      let over = false;
      req.on('data', (c: Buffer) => {
        if (over) return;
        n += c.length;
        if (n > max) { over = true; chunks.length = 0; return; }
        chunks.push(c);
      });
      req.on('end', () => resolveBody(over ? 'too_large' : Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  async function uploadAsset(req: IncomingMessage, res: ServerResponse, r: Room) {
    if (!originOk(req)) return json(res, 403, { error: 'Origin not allowed.' });
    if (!gmAuthorized(req, r)) return json(res, 401, { error: 'GM key required.' });
    const type = ASSET_TYPES[(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()];
    if (!type) return json(res, 415, { error: 'Upload a WebP, PNG or JPEG image.' });
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > ASSET_MAX_BYTES) { req.resume(); return json(res, 413, { error: 'Images are limited to 8 MB.' }); }
    const body = await readBody(req, ASSET_MAX_BYTES);
    if (body === 'too_large') return json(res, 413, { error: 'Images are limited to 8 MB.' });
    if (!type.magic(body)) return json(res, 415, { error: 'The file doesn’t match its image type.' });
    const id = r.meta.sessionId;
    const name = `${createHash('sha256').update(body).digest('hex')}.${type.ext}`;
    if (!store.hasAsset(id, name)) {
      if (store.assetBytes(id) + body.length > (opts.assetQuotaBytes ?? ASSET_QUOTA_BYTES)) return json(res, 413, { error: 'This session has used its 200 MB of image storage.' });
      store.putAsset(id, name, body);
      log(`asset stored ${id}/${name} (${body.length} bytes)`);
    }
    json(res, 201, { url: `/u/${id}/${name}` });
  }

  function serveAsset(req: IncomingMessage, res: ServerResponse, sessionId: string, name: string) {
    const data = rooms.has(sessionId) && ASSET_NAME.test(name) ? store.getAsset(sessionId, name) : null;
    if (!data) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, {
      'Content-Type': ASSET_MIME[name.split('.').pop()!]!,
      'Content-Length': data.length,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  function exportLog(req: IncomingMessage, res: ServerResponse, r: Room) {
    if (!gmAuthorized(req, r)) return json(res, 401, { error: 'GM key required.' });
    ensureLoaded(r);
    const { sessionId, joinCode, createdAt, players } = r.meta;
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="session-${sessionId}.json"`,
    });
    res.end(JSON.stringify({
      format: 'nsc-session-export', version: 1, exportedAt: new Date().toISOString(),
      meta: { sessionId, joinCode, createdAt, players: players.map((p) => ({ playerId: p.playerId, name: p.name })) },
      log: r.log,
    }));
  }

  function createSession(entries: LogEntry[]) {
    const sessionId = randomUUID();
    const gmKey = randomBytes(32).toString('base64url');
    let joinCode: string;
    do { joinCode = Array.from({ length: 6 }, () => JOIN_ALPHABET[randomInt(JOIN_ALPHABET.length)]).join(''); } while (byJoinCode.has(joinCode));
    const meta: SessionMeta = { sessionId, gmKeyHash: sha256(gmKey), joinCode, createdAt: new Date().toISOString(), players: [] };
    store.saveMeta(meta);
    if (entries.length) store.appendLog(sessionId, entries);
    indexRoom({ meta, log: entries, state: replay(sessionId, entries), gm: null, players: new Map(), queue: [], flushOnFetch: false, rates: new Map() });
    log(`session ${entries.length ? `imported (${entries.length} entries)` : 'created'} ${sessionId}`);
    return { sessionId, gmKey, joinCode };
  }

  /**
   * GM restore: a session export becomes a NEW session (fresh GM key and join
   * code; players rejoin and are reassigned). Every entry must chain from 1,
   * and the result must replay and project, or nothing is created.
   */
  async function importSession(req: IncomingMessage, res: ServerResponse) {
    const body = await readBody(req, opts.maxImportBytes ?? 25 * 1024 * 1024).catch(() => null);
    if (body === null) return json(res, 400, { error: 'Could not read the upload.' });
    if (body === 'too_large') return json(res, 413, { error: 'That export is too large.' });
    let parsed: unknown;
    try { parsed = JSON.parse(body.toString('utf8')); } catch { return json(res, 400, { error: 'That file isn’t valid JSON.' }); }
    const p = parsed as { format?: unknown; version?: unknown; log?: unknown };
    if (!p || p.format !== 'nsc-session-export' || p.version !== 1 || !Array.isArray(p.log)) {
      return json(res, 400, { error: 'That isn’t a session export from this app.' });
    }
    const entries = p.log as LogEntry[];
    if (entries.length > maxLog) return json(res, 400, { error: `Sessions are capped at ${maxLog} entries.` });
    try {
      let s = replay('import-check', []);
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i]!;
        if (!e || typeof e !== 'object' || e.seq !== i + 1 || typeof e.patch !== 'object' || !Array.isArray(e.events)) throw new Error(`Entry ${i + 1} is malformed.`);
        s = applyEntry(s, e);
      }
      // Must be presentable to players too, or a client would choke later.
      projectState(s, { role: 'player', playerId: 'import-check' });
    } catch (e) {
      return json(res, 400, { error: e instanceof Error && /^Entry \d+/.test(e.message) ? e.message : 'The export’s log doesn’t replay cleanly.' });
    }
    json(res, 201, createSession(entries));
  }

  const server = createServer((req, res) => {
    cors(req, res);
    const url = new URL(req.url ?? '/', 'http://x');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method === 'GET' && url.pathname === '/health') {
      json(res, 200, { ok: true, version: VERSION, protocol: PROTOCOL_VERSION, sessions: rooms.size });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/sessions') {
      if (!originOk(req)) { json(res, 403, { error: 'Origin not allowed.' }); return; }
      if (!rateOk(ipOf(req))) { json(res, 429, { error: 'Too many sessions created. Try again later.' }); return; }
      json(res, 201, createSession([]));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/sessions/import') {
      if (!originOk(req)) { json(res, 403, { error: 'Origin not allowed.' }); return; }
      if (!rateOk(ipOf(req))) { json(res, 429, { error: 'Too many sessions created. Try again later.' }); return; }
      void importSession(req, res);
      return;
    }
    const asset = /^\/u\/([a-f0-9-]{36})\/([^/]+)$/.exec(url.pathname);
    if (asset && (req.method === 'GET' || req.method === 'HEAD')) { serveAsset(req, res, asset[1]!, asset[2]!); return; }
    const api = /^\/api\/sessions\/([a-f0-9-]{36})\/(assets|export)$/.exec(url.pathname);
    if (api) {
      const r = rooms.get(api[1]!);
      if (!r) { json(res, 404, { error: 'Unknown session.' }); return; }
      if (api[2] === 'assets' && req.method === 'POST') {
        uploadAsset(req, res, r).catch((e: Error) => { log(`upload failed: ${e.message}`); if (!res.headersSent) json(res, 500, { error: 'Upload failed.' }); });
        return;
      }
      if (api[2] === 'export' && req.method === 'GET') { exportLog(req, res, r); return; }
      json(res, 405, { error: 'Method not allowed.' });
      return;
    }
    if (!url.pathname.startsWith('/api/') && serveStatic(req, res, url.pathname)) return;
    json(res, 404, { error: 'Not found' });
  });

  // ----- WebSocket ------------------------------------------------------------
  const wss = new WebSocketServer({
    server, path: '/ws', maxPayload: opts.maxPayloadBytes ?? 512 * 1024,
    verifyClient: (info: { req: IncomingMessage }, cb: (ok: boolean, code?: number, message?: string) => void) => {
      if (originOk(info.req)) cb(true);
      else cb(false, 403, 'Origin not allowed');
    },
  });
  // ws re-emits the HTTP server's errors; the server's own listener handles them.
  wss.on('error', (e) => log(`wss error: ${e.message}`));
  /** Failed-hello score per IP (decays over time). */
  const helloFails = new Map<string, { score: number; at: number }>();
  /** Unauthenticated sockets per IP. */
  const pendingByIp = new Map<string, number>();

  const send = (ws: WebSocket, m: ServerMessage) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
  const fail = (c: Conn, code: string, message: string, close = false) => {
    send(c.ws, { t: 'error', code, message });
    if (close) c.ws.close(4000, code);
  };

  function playersOf(r: Room): PlayerInfo[] {
    const online = new Set(r.players.values());
    return r.meta.players.map((p) => ({ playerId: p.playerId, name: p.name, online: online.has(p.playerId) }));
  }

  function broadcastEntries(r: Room & { state: SessionState }, entries: LogEntry[], statesAfter: SessionState[], start: SessionState) {
    for (const [ws, playerId] of r.players) {
      const viewer: Viewer = { role: 'player', playerId };
      send(ws, { t: 'entries', entries: entries.map((e, i) => projectEntry(e, viewer, statesAfter[i]!, undefined, i === 0 ? start : statesAfter[i - 1])) });
    }
  }
  /** After undo or a log replacement: each player's view and history, rebuilt, so undone lines disappear. */
  function broadcastRewind(r: Room & { state: SessionState; log: LogEntry[] }) {
    for (const [ws, playerId] of r.players) {
      const viewer: Viewer = { role: 'player', playerId };
      send(ws, { t: 'rewind', toSeq: r.state.seq, view: projectState(r.state, viewer), history: historyFor(r, viewer) });
    }
  }

  wss.on('connection', (ws, req) => {
    const c: Conn = { ws, alive: true, ip: ipOf(req), signalTokens: SIGNAL_BURST, signalAt: Date.now() };
    // Bound parallel guessing: only a few unauthenticated sockets per address.
    const pending = (pendingByIp.get(c.ip) ?? 0) + 1;
    pendingByIp.set(c.ip, pending);
    let counted = true;
    const unpend = () => {
      if (!counted) return;
      counted = false;
      const n = (pendingByIp.get(c.ip) ?? 1) - 1;
      if (n > 0) pendingByIp.set(c.ip, n); else pendingByIp.delete(c.ip);
    };
    ws.on('pong', () => { c.alive = true; });
    // Oversized or malformed frames raise here; without a listener ws would
    // rethrow and take down the whole process (every session).
    ws.on('error', (err) => {
      log(`ws error: ${(err as Error).message}`);
      try { ws.terminate(); } catch { /* already closed */ }
    });
    (ws as WebSocket & { conn?: Conn }).conn = c;
    if (pending > maxPending) {
      send(ws, { t: 'error', code: 'TOO_MANY', message: 'Too many connections from this network. Try again in a moment.' });
      ws.close(4000, 'TOO_MANY');
      unpend();
      return;
    }
    const helloTimer = setTimeout(() => { if (!c.room) ws.close(4000, 'HELLO_TIMEOUT'); }, 10_000);
    let helloSeen = false;

    ws.on('message', (data, isBinary) => {
      if (!c.room) {
        // Before authentication: exactly one small, well-formed hello, or the socket goes.
        const size = Array.isArray(data) ? data.reduce((n, b) => n + b.length, 0) : (data as Buffer | ArrayBuffer).byteLength;
        if (isBinary || size > MAX_HELLO_BYTES) { ws.close(4000, 'BAD_HELLO'); return; }
        if (helloSeen) return; // a hello is being checked (tarpit); ignore anything else
        const msg = parseClientMessage(data.toString());
        if (!msg || msg.t !== 'hello') return fail(c, msg ? 'HELLO_FIRST' : 'BAD_MESSAGE', msg ? 'Send hello first.' : 'Malformed message.', true);
        helloSeen = true;
        clearTimeout(helloTimer);
        return beginHello(c, msg, () => { helloSeen = false; }, unpend);
      }
      if (isBinary) return fail(c, 'BAD_MESSAGE', 'Text frames only.');
      const msg = parseClientMessage(data.toString());
      if (!msg) return fail(c, 'BAD_MESSAGE', 'Malformed message.');
      if (msg.t === 'ping') return send(ws, { t: 'pong' });
      if (msg.t === 'hello') return fail(c, 'BAD_MESSAGE', 'Already connected.');
      if (msg.t === 'signal') return onSignal(c, c.room, msg.signal);
      if (c.role === 'gm') onGm(c, c.room, msg);
      else onPlayer(c, c.room, msg);
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      unpend();
      const r = c.room;
      if (!r) return;
      if (c.role === 'gm' && r.gm === ws) {
        r.gm = null;
        for (const p of r.players.keys()) send(p, { t: 'gmStatus', online: false });
      } else if (c.role === 'player' && c.playerId) {
        r.players.delete(ws);
        if (![...r.players.values()].includes(c.playerId)) {
          if (r.gm) send(r.gm, { t: 'playerLeft', playerId: c.playerId });
          for (const p of r.players.keys()) send(p, { t: 'playerLeft', playerId: c.playerId });
        }
      }
    });
  });

  // ----- Hello tarpit -------------------------------------------------------------
  //
  // Secrets always get straight through: a correct GM key or player token can't
  // be guessed, so it's never delayed. Everything else from an address that has
  // been failing waits a little: nothing for the first few failures, then about
  // a second per extra failure, capped at a few seconds. Join codes are 6 of 31
  // characters (~887 million); with at most a handful of sockets per address and
  // a few seconds per try, guessing is hopeless, while a household that mistypes
  // a code (or shares an address with someone who does) is only ever slowed,
  // never locked out.
  function failScore(ip: string) {
    const t = now();
    const f = helloFails.get(ip) ?? { score: 0, at: t };
    f.score = Math.max(0, f.score - (t - f.at) / tarpit.decayMs);
    f.at = t;
    if (f.score > 0) helloFails.set(ip, f); else helloFails.delete(ip);
    return f;
  }
  const tarpitMs = (ip: string) => Math.min(tarpit.maxMs, Math.max(0, Math.ceil(failScore(ip).score - tarpit.free)) * tarpit.msPerFailure);
  function helloFailed(c: Conn, message: string) {
    const f = failScore(c.ip);
    f.score += 1;
    helloFails.set(c.ip, f);
    fail(c, 'AUTH_FAILED', message, true);
  }

  /** True when the hello carries a secret that checks out (never tarpitted). */
  function hasValidSecret(msg: Extract<ClientMessage, { t: 'hello' }>): boolean {
    if (msg.role === 'gm') {
      const r = rooms.get(msg.sessionId);
      return !!r && sameHash(sha256(msg.gmKey), r.meta.gmKeyHash);
    }
    const r = byJoinCode.get(msg.joinCode.toUpperCase());
    return !!r && !!msg.playerToken && r.meta.players.some((p) => sameHash(p.tokenHash, sha256(msg.playerToken!)));
  }

  function beginHello(c: Conn, msg: Extract<ClientMessage, { t: 'hello' }>, reset: () => void, unpend: () => void) {
    const delay = hasValidSecret(msg) ? 0 : tarpitMs(c.ip);
    const go = () => {
      if (c.ws.readyState !== WebSocket.OPEN) return;
      onHello(c, msg);
      if (c.room) unpend(); else reset();
    };
    if (delay > 0) setTimeout(go, delay); else go();
  }

  function onHello(c: Conn, msg: Extract<ClientMessage, { t: 'hello' }>) {
    if (msg.role === 'gm') {
      const r = rooms.get(msg.sessionId);
      if (!r || !sameHash(sha256(msg.gmKey), r.meta.gmKeyHash)) return helloFailed(c, 'Unknown session or wrong GM key.');
      ensureLoaded(r);
      if (r.gm) { send(r.gm, { t: 'error', code: 'REPLACED', message: 'GM connected from another device.' }); r.gm.close(4002, 'REPLACED'); }
      r.gm = c.ws;
      Object.assign(c, { room: r, role: 'gm' });
      send(c.ws, { t: 'welcome', role: 'gm', sessionId: r.meta.sessionId, headSeq: r.state.seq, players: playersOf(r) });
      for (const p of r.players.keys()) send(p, { t: 'gmStatus', online: true });
      // Queued player intents go out once the GM has the log (it fetches one
      // whenever the relay holds entries); an empty session can take them now.
      if (r.state.seq === 0) flushQueue(r); else r.flushOnFetch = true;
      return;
    }
    const r = byJoinCode.get(msg.joinCode.toUpperCase());
    let rec = r && msg.playerToken ? r.meta.players.find((p) => sameHash(p.tokenHash, sha256(msg.playerToken!))) : undefined;
    if (!r) return helloFailed(c, 'Unknown join code.');
    ensureLoaded(r);
    let token = msg.playerToken;
    if (!rec) {
      if (r.meta.players.length >= maxPlayers) return fail(c, 'SESSION_FULL', 'This session is full.', true);
      token = randomBytes(24).toString('base64url');
      rec = { playerId: randomUUID().slice(0, 8), name: msg.name, tokenHash: sha256(token) };
      r.meta.players.push(rec);
      store.saveMeta(r.meta);
    }
    // Others in the room learn about the newcomer (names only, never tokens).
    const joined = { playerId: rec.playerId, name: rec.name, online: true };
    for (const [p, pid] of r.players) if (pid !== rec.playerId) send(p, { t: 'playerJoined', player: joined });
    r.players.set(c.ws, rec.playerId);
    Object.assign(c, { room: r, role: 'player', playerId: rec.playerId });
    const viewer: Viewer = { role: 'player', playerId: rec.playerId };
    send(c.ws, {
      t: 'welcome', role: 'player', sessionId: r.meta.sessionId, playerId: rec.playerId, playerToken: token!,
      view: projectState(r.state, viewer), players: playersOf(r), history: historyFor(r, viewer),
      queued: r.queue.filter((i) => i.playerId === rec.playerId).map((i) => i.clientMsgId),
      settled: r.settled?.get(rec.playerId) ?? [],
    });
    if (r.gm) {
      send(r.gm, { t: 'playerJoined', player: joined });
      send(c.ws, { t: 'gmStatus', online: true });
    } else send(c.ws, { t: 'gmStatus', online: false });
  }

  /**
   * The player's recent log, projected exactly as it was sent live (each entry
   * against its own before/after state), events only. Replays from the start,
   * so it costs one pass over the log per join.
   */
  function historyFor(r: Room & { log: LogEntry[] }, viewer: Viewer): HistoryItem[] {
    if (historyN <= 0 || r.log.length === 0) return [];
    const from = Math.max(0, r.log.length - historyN);
    let s = replay(r.meta.sessionId, r.log.slice(0, from));
    const out: HistoryItem[] = [];
    for (const e of r.log.slice(from)) {
      const before = s;
      s = applyEntry(s, e);
      const p = projectEntry(e, viewer, s, undefined, before);
      if (p.events.length) out.push({ seq: p.seq, by: p.by, intentType: p.intentType, events: p.events });
    }
    return out;
  }

  /** Hand queued player intents to the GM in arrival order; expired ones are refused. */
  function flushQueue(r: Room) {
    r.flushOnFetch = false;
    const q = r.queue;
    r.queue = [];
    if (!r.gm) { r.queue = q; return; }
    const t = now();
    for (const i of q) {
      if (t - i.at > qMaxAge) { dropQueued(r, i, 'expired'); continue; }
      send(r.gm, { t: 'intent', from: i.playerId, clientMsgId: i.clientMsgId, intent: i.intent });
      settle(r, i);
    }
    saveQueue(r);
  }
  function settle(r: Room, i: QueuedIntent) {
    r.settled ??= new Map();
    const ids = [...(r.settled.get(i.playerId) ?? []), i.clientMsgId].slice(-50);
    r.settled.set(i.playerId, ids);
  }
  function dropQueued(r: Room, i: QueuedIntent, reason: 'expired' | 'lost') {
    settle(r, i);
    const message = reason === 'expired'
      ? 'The GM was away too long, so that action was dropped. Try it again.'
      : 'That action was lost before the GM got it. Try it again.';
    for (const [ws, pid] of r.players) if (pid === i.playerId) send(ws, { t: 'queueDropped', clientMsgId: i.clientMsgId, reason, message });
  }
  /** Drop held intents past their age, telling their players. */
  function expireQueue(r: Room) {
    const t = now();
    const keep = r.queue.filter((i) => t - i.at <= qMaxAge);
    if (keep.length === r.queue.length) return;
    for (const i of r.queue) if (t - i.at > qMaxAge) dropQueued(r, i, 'expired');
    r.queue = keep;
    saveQueue(r);
  }
  function rejectTo(r: Room, playerId: string, clientMsgId: string, code: string, message: string) {
    for (const [ws, pid] of r.players) if (pid === playerId) send(ws, { t: 'rejected', clientMsgId, code, message });
  }

  function onGm(c: Conn, r: Room, msg: ClientMessage) {
    ensureLoaded(r);
    switch (msg.t) {
      case 'append': {
        if (r.log.length + msg.entries.length > maxLog) return fail(c, 'LOG_FULL', `Session log is capped at ${maxLog} entries.`);
        let s = r.state;
        const after: SessionState[] = [];
        try {
          for (const e of msg.entries) { s = applyEntry(s, e); after.push(s); }
        } catch (e) {
          if (e instanceof LogGapError) return send(c.ws, { t: 'error', code: 'GAP', message: `${e.message}. Relay head is ${r.state.seq}.` });
          return fail(c, 'BAD_ENTRY', 'Entry could not be applied.');
        }
        store.appendLog(r.meta.sessionId, msg.entries);
        r.log.push(...msg.entries);
        const start = r.state;
        r.state = s;
        broadcastEntries(r, msg.entries, after, start);
        return;
      }
      case 'truncate': {
        if (msg.toSeq > r.state.seq) return fail(c, 'BAD_SEQ', `Head is ${r.state.seq}.`);
        r.log = r.log.slice(0, msg.toSeq);
        r.state = replay(r.meta.sessionId, r.log);
        store.replaceLog(r.meta.sessionId, r.log);
        broadcastRewind(r);
        return;
      }
      case 'replaceLog': {
        if (msg.entries.length > maxLog) return fail(c, 'LOG_FULL', `Session log is capped at ${maxLog} entries.`);
        let state: SessionState;
        try { state = replay(r.meta.sessionId, msg.entries); } catch { return fail(c, 'BAD_ENTRY', 'Log does not replay.'); }
        r.log = msg.entries;
        r.state = state;
        store.replaceLog(r.meta.sessionId, r.log);
        broadcastRewind(r);
        return;
      }
      case 'fetchLog':
        send(c.ws, { t: 'log', entries: r.log.slice(msg.fromSeq - 1) });
        if (r.flushOnFetch) flushQueue(r);
        return;
      case 'reject':
        return rejectTo(r, msg.playerId, msg.clientMsgId, msg.code, msg.message);
      default:
        return fail(c, 'NOT_ALLOWED', `GM can't send ${msg.t}.`);
    }
  }

  /** Ephemeral: relayed to everyone else in the room, never logged. Excess is dropped silently. */
  function onSignal(c: Conn, r: Room, signal: Extract<ClientMessage, { t: 'signal' }>['signal']) {
    const now = Date.now();
    c.signalTokens = Math.min(SIGNAL_BURST, c.signalTokens + ((now - c.signalAt) / 1000) * SIGNAL_RATE);
    c.signalAt = now;
    if (c.signalTokens < 1) return;
    c.signalTokens -= 1;
    const out: ServerMessage = { t: 'signal', from: c.role === 'gm' ? 'gm' : c.playerId!, signal };
    if (r.gm && r.gm !== c.ws) send(r.gm, out);
    // The GM's pointer, pings and ruler must not point into the fog: players
    // only get GM signals whose squares the party can see right now.
    if (c.role === 'gm' && !gmSignalVisible(r, signal)) return;
    for (const p of r.players.keys()) if (p !== c.ws) send(p, out);
  }

  /** Squares the party sees now (null = no map, nothing to hide). Cached per state. */
  function partyCells(r: Room): Set<string> | null {
    ensureLoaded(r);
    if (r.visionCache?.state === r.state) return r.visionCache.cells;
    const cells = r.state.map ? partyVision(r.state.map, r.state.actors) : null;
    r.visionCache = { state: r.state, cells };
    return cells;
  }
  function gmSignalVisible(r: Room, signal: Signal): boolean {
    const cells = signalCells(signal);
    if (!cells.length) return true; // clears (cursor/ruler off) carry no position
    const seen = partyCells(r);
    if (!seen) return true;
    return cells.every((x) => seen.has(`${x.x},${x.y}`));
  }

  /** Per-player limiter: a token bucket for all intents, plus a per-minute cap on chatter. */
  function rateCheck(r: Room, playerId: string, intent: Intent): string | null {
    const t = now();
    const b = r.rates.get(playerId) ?? { tokens: rate.burst, at: t, chat: [] };
    b.tokens = Math.min(rate.burst, b.tokens + ((t - b.at) / 1000) * rate.perSecond);
    b.at = t;
    r.rates.set(playerId, b);
    if (b.tokens < 1) return 'Slow down: too many actions at once.';
    if (CHATTY.has(intent.type)) {
      b.chat = b.chat.filter((x) => t - x < 60_000);
      if (b.chat.length >= rate.chatPerMinute) return 'Slow down: too many messages and rolls this minute.';
      b.chat.push(t);
    }
    b.tokens -= 1;
    return null;
  }

  function onPlayer(c: Conn, r: Room, msg: ClientMessage) {
    if (msg.t !== 'intent') return fail(c, 'NOT_ALLOWED', `Players can't send ${msg.t}.`);
    ensureLoaded(r);
    // Keep headroom for the GM: chatter stops before the log fills up.
    if (CHATTY.has(msg.intent.type) && r.log.length >= maxLog - chatReserve) {
      return send(c.ws, { t: 'rejected', clientMsgId: msg.clientMsgId, code: 'LOG_NEARLY_FULL', message: 'This session’s log is nearly full, so chat and free rolls are paused. The GM can export it and start a fresh session.' });
    }
    const limited = rateCheck(r, c.playerId!, msg.intent);
    if (limited) return send(c.ws, { t: 'rejected', clientMsgId: msg.clientMsgId, code: 'RATE_LIMITED', message: limited });
    const t = now();
    // While the GM is away (or still catching up), hold the intent; bounded and short-lived.
    if (!r.gm || r.flushOnFetch) {
      expireQueue(r);
      const mine = r.queue.filter((i) => i.playerId === c.playerId).length;
      if (r.queue.length >= qPerSession || mine >= qPerPlayer) {
        return send(c.ws, { t: 'rejected', clientMsgId: msg.clientMsgId, code: 'QUEUE_FULL', message: 'Too many actions are waiting for the GM. Try again when the GM is back.' });
      }
      r.queue.push({ playerId: c.playerId!, clientMsgId: msg.clientMsgId, intent: msg.intent, at: t });
      saveQueue(r);
      return send(c.ws, { t: 'queued', clientMsgId: msg.clientMsgId });
    }
    send(r.gm, { t: 'intent', from: c.playerId!, clientMsgId: msg.clientMsgId, intent: msg.intent });
  }

  // Heartbeat: drop dead connections and expired held intents every 30 s.
  const beat = setInterval(() => {
    for (const r of rooms.values()) if (r.queue.length) expireQueue(r);
    for (const ip of [...helloFails.keys()]) failScore(ip);
    for (const ws of wss.clients) {
      const c = (ws as WebSocket & { conn?: Conn }).conn;
      if (!c) continue;
      if (!c.alive) { ws.terminate(); continue; }
      c.alive = false;
      ws.ping();
    }
  }, 30_000);

  return {
    server,
    close: () => new Promise<void>((resolve) => {
      clearInterval(beat);
      for (const ws of wss.clients) ws.terminate();
      wss.close(() => server.close(() => resolve()));
    }),
  };
}

/**
 * The client's address for rate limits and lockouts. X-Forwarded-For is
 * client-controlled, so it's only read when proxies are configured, and then
 * from the right: each trusted proxy appends the address it saw.
 */
export function clientIp(req: IncomingMessage, trustHops = 0): string {
  const sock = req.socket.remoteAddress || 'unknown';
  if (trustHops <= 0) return sock;
  const raw = req.headers['x-forwarded-for'];
  const list = (Array.isArray(raw) ? raw.join(',') : raw ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  return list[list.length - trustHops] ?? list[0] ?? sock;
}
