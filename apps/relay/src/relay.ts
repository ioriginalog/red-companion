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
  applyEntry, LogGapError, parseClientMessage, projectEntry, projectState, PROTOCOL_VERSION, replay,
  type ClientMessage, type LogEntry, type PlayerInfo, type ServerMessage, type SessionState, type Viewer,
} from '@cprc/session';
import { ASSET_NAME, type SessionMeta, type Store } from './store.js';

export interface RelayOptions {
  store: Store;
  maxPayloadBytes?: number;
  maxPlayersPerSession?: number;
  maxLogEntries?: number;
  /** Session creations allowed per IP per hour. */
  createPerHour?: number;
  allowedOrigins?: string[] | '*';
  /** Per-session image storage cap. Default 200 MB. */
  assetQuotaBytes?: number;
  /** Built web client to serve from the same origin (SPA fallback to index.html). */
  webDir?: string;
  log?: (msg: string) => void;
}

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
}

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

  const rooms = new Map<string, Room>();
  const byJoinCode = new Map<string, Room>();
  for (const meta of store.listMeta()) indexRoom({ meta, log: null, state: null, gm: null, players: new Map() });

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

  /** Browsers always send Origin cross-site; native clients may omit it. */
  function originOk(req: IncomingMessage) {
    const allowed = opts.allowedOrigins ?? '*';
    const origin = req.headers.origin;
    return allowed === '*' || !origin || allowed.includes(origin);
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
      'Cache-Control': ext === '.html' ? 'no-cache' : immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
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
    const allowed = opts.allowedOrigins ?? '*';
    if (allowed === '*') res.setHeader('Access-Control-Allow-Origin', '*');
    else if (origin && allowed.includes(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
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
      const ip = clientIp(req);
      if (!rateOk(ip)) { json(res, 429, { error: 'Too many sessions created. Try again later.' }); return; }
      const sessionId = randomUUID();
      const gmKey = randomBytes(32).toString('base64url');
      let joinCode: string;
      do { joinCode = Array.from({ length: 6 }, () => JOIN_ALPHABET[randomInt(JOIN_ALPHABET.length)]).join(''); } while (byJoinCode.has(joinCode));
      const meta: SessionMeta = { sessionId, gmKeyHash: sha256(gmKey), joinCode, createdAt: new Date().toISOString(), players: [] };
      store.saveMeta(meta);
      indexRoom({ meta, log: [], state: replay(sessionId, []), gm: null, players: new Map() });
      log(`session created ${sessionId}`);
      json(res, 201, { sessionId, gmKey, joinCode });
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
    verifyClient: (info: { req: IncomingMessage }) => originOk(info.req),
  });
  // ws re-emits the HTTP server's errors; the server's own listener handles them.
  wss.on('error', (e) => log(`wss error: ${e.message}`));
  const failedHellos = new Map<string, { n: number; since: number }>();

  const send = (ws: WebSocket, m: ServerMessage) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
  const fail = (c: Conn, code: string, message: string, close = false) => {
    send(c.ws, { t: 'error', code, message });
    if (close) c.ws.close(4000, code);
  };

  function playersOf(r: Room): PlayerInfo[] {
    const online = new Set(r.players.values());
    return r.meta.players.map((p) => ({ playerId: p.playerId, name: p.name, online: online.has(p.playerId) }));
  }

  function broadcastEntries(r: Room & { state: SessionState }, entries: LogEntry[], statesAfter: SessionState[]) {
    for (const [ws, playerId] of r.players) {
      const viewer: Viewer = { role: 'player', playerId };
      send(ws, { t: 'entries', entries: entries.map((e, i) => projectEntry(e, viewer, statesAfter[i]!)) });
    }
  }
  function broadcastSnapshot(r: Room & { state: SessionState }) {
    for (const [ws, playerId] of r.players) send(ws, { t: 'snapshot', view: projectState(r.state, { role: 'player', playerId }) });
  }

  wss.on('connection', (ws, req) => {
    const c: Conn = { ws, alive: true, ip: clientIp(req), signalTokens: SIGNAL_BURST, signalAt: Date.now() };
    const helloTimer = setTimeout(() => { if (!c.room) ws.close(4000, 'HELLO_TIMEOUT'); }, 10_000);
    ws.on('pong', () => { c.alive = true; });
    (ws as WebSocket & { conn?: Conn }).conn = c;

    ws.on('message', (data, isBinary) => {
      if (isBinary) return fail(c, 'BAD_MESSAGE', 'Text frames only.');
      const msg = parseClientMessage(data.toString());
      if (!msg) return fail(c, 'BAD_MESSAGE', 'Malformed message.');
      if (msg.t === 'ping') return send(ws, { t: 'pong' });
      if (!c.room) {
        if (msg.t !== 'hello') return fail(c, 'HELLO_FIRST', 'Send hello first.', true);
        clearTimeout(helloTimer);
        return onHello(c, msg);
      }
      if (msg.t === 'signal') return onSignal(c, c.room, msg.signal);
      if (c.role === 'gm') onGm(c, c.room, msg);
      else onPlayer(c, c.room, msg);
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      const r = c.room;
      if (!r) return;
      if (c.role === 'gm' && r.gm === ws) {
        r.gm = null;
        for (const p of r.players.keys()) send(p, { t: 'gmStatus', online: false });
      } else if (c.role === 'player' && c.playerId) {
        r.players.delete(ws);
        if (![...r.players.values()].includes(c.playerId) && r.gm) send(r.gm, { t: 'playerLeft', playerId: c.playerId });
      }
    });
  });

  function helloFailed(c: Conn, message: string) {
    const f = failedHellos.get(c.ip);
    const now = Date.now();
    const rec = f && now - f.since < 300_000 ? { n: f.n + 1, since: f.since } : { n: 1, since: now };
    failedHellos.set(c.ip, rec);
    fail(c, 'AUTH_FAILED', message, true);
  }
  function locked(c: Conn) {
    const f = failedHellos.get(c.ip);
    return !!f && Date.now() - f.since < 300_000 && f.n >= 10;
  }

  function onHello(c: Conn, msg: Extract<ClientMessage, { t: 'hello' }>) {
    if (locked(c)) return fail(c, 'LOCKED', 'Too many failed attempts. Wait a few minutes.', true);
    if (msg.role === 'gm') {
      const r = rooms.get(msg.sessionId);
      if (!r || !sameHash(sha256(msg.gmKey), r.meta.gmKeyHash)) return helloFailed(c, 'Unknown session or wrong GM key.');
      ensureLoaded(r);
      if (r.gm) { send(r.gm, { t: 'error', code: 'REPLACED', message: 'GM connected from another device.' }); r.gm.close(4002, 'REPLACED'); }
      r.gm = c.ws;
      Object.assign(c, { room: r, role: 'gm' });
      send(c.ws, { t: 'welcome', role: 'gm', sessionId: r.meta.sessionId, headSeq: r.state.seq, players: playersOf(r) });
      for (const p of r.players.keys()) send(p, { t: 'gmStatus', online: true });
      return;
    }
    const r = byJoinCode.get(msg.joinCode.toUpperCase());
    if (!r) return helloFailed(c, 'Unknown join code.');
    ensureLoaded(r);
    let rec = msg.playerToken ? r.meta.players.find((p) => sameHash(p.tokenHash, sha256(msg.playerToken!))) : undefined;
    let token = msg.playerToken;
    if (!rec) {
      if (r.meta.players.length >= maxPlayers) return fail(c, 'SESSION_FULL', 'This session is full.', true);
      token = randomBytes(24).toString('base64url');
      rec = { playerId: randomUUID().slice(0, 8), name: msg.name, tokenHash: sha256(token) };
      r.meta.players.push(rec);
      store.saveMeta(r.meta);
    }
    r.players.set(c.ws, rec.playerId);
    Object.assign(c, { room: r, role: 'player', playerId: rec.playerId });
    send(c.ws, { t: 'welcome', role: 'player', sessionId: r.meta.sessionId, playerId: rec.playerId, playerToken: token!, view: projectState(r.state, { role: 'player', playerId: rec.playerId }) });
    if (r.gm) {
      send(r.gm, { t: 'playerJoined', player: { playerId: rec.playerId, name: rec.name, online: true } });
      send(c.ws, { t: 'gmStatus', online: true });
    } else send(c.ws, { t: 'gmStatus', online: false });
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
        r.state = s;
        broadcastEntries(r, msg.entries, after);
        return;
      }
      case 'truncate': {
        if (msg.toSeq > r.state.seq) return fail(c, 'BAD_SEQ', `Head is ${r.state.seq}.`);
        r.log = r.log.slice(0, msg.toSeq);
        r.state = replay(r.meta.sessionId, r.log);
        store.replaceLog(r.meta.sessionId, r.log);
        broadcastSnapshot(r);
        return;
      }
      case 'replaceLog': {
        if (msg.entries.length > maxLog) return fail(c, 'LOG_FULL', `Session log is capped at ${maxLog} entries.`);
        let state: SessionState;
        try { state = replay(r.meta.sessionId, msg.entries); } catch { return fail(c, 'BAD_ENTRY', 'Log does not replay.'); }
        r.log = msg.entries;
        r.state = state;
        store.replaceLog(r.meta.sessionId, r.log);
        broadcastSnapshot(r);
        return;
      }
      case 'fetchLog':
        return send(c.ws, { t: 'log', entries: r.log.slice(msg.fromSeq - 1) });
      case 'reject':
        for (const [ws, pid] of r.players) if (pid === msg.playerId) send(ws, { t: 'rejected', clientMsgId: msg.clientMsgId, code: msg.code, message: msg.message });
        return;
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
    for (const p of r.players.keys()) if (p !== c.ws) send(p, out);
  }

  function onPlayer(c: Conn, r: Room, msg: ClientMessage) {
    if (msg.t !== 'intent') return fail(c, 'NOT_ALLOWED', `Players can't send ${msg.t}.`);
    if (!r.gm) return send(c.ws, { t: 'rejected', clientMsgId: msg.clientMsgId, code: 'GM_OFFLINE', message: 'The GM is offline.' });
    send(r.gm, { t: 'intent', from: c.playerId!, clientMsgId: msg.clientMsgId, intent: msg.intent });
  }

  // Heartbeat: drop dead connections every 30 s.
  const beat = setInterval(() => {
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

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}
