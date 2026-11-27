/**
 * Session persistence. FileStore writes to DATA_DIR (a Railway volume):
 *   <DATA_DIR>/sessions/<id>/meta.json
 *   <DATA_DIR>/sessions/<id>/log.jsonl   (one LogEntry per line, append-only except undo)
 *   <DATA_DIR>/sessions/<id>/queue.json  (player intents waiting for an absent GM, and what became of recent ones)
 *   <DATA_DIR>/assets/<id>/<sha256>.<ext> (uploaded images, content-addressed)
 * MemoryStore is for tests and for running without a volume (data lost on restart).
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Intent, LogEntry } from '@cprc/session';

/** A player intent held for an absent GM. */
export interface QueuedIntent { playerId: string; clientMsgId: string; intent: Intent; at: number }

/** A held intent that will never reach the GM. */
export interface DropNotice { clientMsgId: string; reason: 'expired' | 'lost'; message: string }

/** Everything the relay keeps about held intents for one session. */
export interface QueueState {
  /** Waiting for the GM, in arrival order. */
  queue: QueuedIntent[];
  /** Per player: recent held intents that were delivered or dropped (bounded). */
  settled: Record<string, string[]>;
  /** Per player: drops made while that player had no open socket, told on their next join. */
  unseen: Record<string, DropNotice[]>;
}

export const emptyQueueState = (): QueueState => ({ queue: [], settled: {}, unseen: {} });
const isEmptyQueueState = (q: QueueState) => !q.queue.length && !Object.keys(q.settled).length && !Object.keys(q.unseen).length;

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Reads a queue file defensively: anything malformed is dropped, never thrown. Accepts the older bare-array format. */
export function parseQueueState(raw: unknown): QueueState {
  const out = emptyQueueState();
  const q = Array.isArray(raw) ? raw : isRec(raw) ? raw.queue : [];
  if (Array.isArray(q)) {
    out.queue = q.filter((i): i is QueuedIntent => isRec(i) && typeof i.playerId === 'string' && typeof i.clientMsgId === 'string'
      && typeof i.at === 'number' && isRec(i.intent) && typeof i.intent.type === 'string');
  }
  if (isRec(raw) && isRec(raw.settled)) {
    for (const [pid, ids] of Object.entries(raw.settled)) {
      if (Array.isArray(ids)) out.settled[pid] = ids.filter((x): x is string => typeof x === 'string');
    }
  }
  if (isRec(raw) && isRec(raw.unseen)) {
    for (const [pid, ns] of Object.entries(raw.unseen)) {
      if (!Array.isArray(ns)) continue;
      out.unseen[pid] = ns.filter((n): n is DropNotice => isRec(n) && typeof n.clientMsgId === 'string'
        && (n.reason === 'expired' || n.reason === 'lost') && typeof n.message === 'string');
    }
  }
  return out;
}

export interface PlayerRecord {
  playerId: string;
  name: string;
  tokenHash: string;
  /** More devices' tokens for the same player (after a merge or an approved seat reclaim). */
  tokenHashes?: string[];
  /** Epoch ms this player was last connected. */
  lastSeen?: number;
}
export interface SessionMeta {
  sessionId: string;
  gmKeyHash: string;
  joinCode: string;
  createdAt: string;
  players: PlayerRecord[];
}

export interface Store {
  listMeta(): SessionMeta[];
  saveMeta(meta: SessionMeta): void;
  loadLog(sessionId: string): LogEntry[];
  appendLog(sessionId: string, entries: LogEntry[]): void;
  replaceLog(sessionId: string, entries: LogEntry[]): void;
  /** `name` is already validated: `<sha256>.<webp|png|jpg>`. */
  putAsset(sessionId: string, name: string, data: Buffer): void;
  getAsset(sessionId: string, name: string): Buffer | null;
  hasAsset(sessionId: string, name: string): boolean;
  /** Total bytes stored for a session. */
  assetBytes(sessionId: string): number;
  /** Player intents held for the GM and their recent outcomes; written atomically after every change. */
  loadQueue(sessionId: string): QueueState;
  saveQueue(sessionId: string, queue: QueueState): void;
}

export const ASSET_NAME = /^[a-f0-9]{64}\.(webp|png|jpg)$/;

export class MemoryStore implements Store {
  private metas = new Map<string, SessionMeta>();
  private logs = new Map<string, LogEntry[]>();
  listMeta() { return [...this.metas.values()]; }
  saveMeta(m: SessionMeta) { this.metas.set(m.sessionId, structuredClone(m)); }
  loadLog(id: string) { return structuredClone(this.logs.get(id) ?? []); }
  appendLog(id: string, e: LogEntry[]) { this.logs.set(id, [...(this.logs.get(id) ?? []), ...structuredClone(e)]); }
  replaceLog(id: string, e: LogEntry[]) { this.logs.set(id, structuredClone(e)); }
  private assets = new Map<string, Map<string, Buffer>>();
  putAsset(id: string, name: string, data: Buffer) {
    const m = this.assets.get(id) ?? new Map<string, Buffer>();
    m.set(name, Buffer.from(data));
    this.assets.set(id, m);
  }
  getAsset(id: string, name: string) { return this.assets.get(id)?.get(name) ?? null; }
  hasAsset(id: string, name: string) { return !!this.assets.get(id)?.has(name); }
  assetBytes(id: string) { let n = 0; for (const b of this.assets.get(id)?.values() ?? []) n += b.length; return n; }
  private queues = new Map<string, QueueState>();
  loadQueue(id: string) { return structuredClone(this.queues.get(id) ?? emptyQueueState()); }
  saveQueue(id: string, q: QueueState) { if (isEmptyQueueState(q)) this.queues.delete(id); else this.queues.set(id, structuredClone(q)); }
}

const SAFE_ID = /^[a-f0-9-]{36}$/;

export class FileStore implements Store {
  private root: string;
  private assetRoot: string;
  constructor(dataDir: string) {
    this.root = join(dataDir, 'sessions');
    this.assetRoot = join(dataDir, 'assets');
    mkdirSync(this.root, { recursive: true });
    mkdirSync(this.assetRoot, { recursive: true });
  }
  private assetPath(id: string, name?: string) {
    if (!SAFE_ID.test(id)) throw new Error('Bad session id');
    if (name !== undefined && !ASSET_NAME.test(name)) throw new Error('Bad asset name');
    return name === undefined ? join(this.assetRoot, id) : join(this.assetRoot, id, name);
  }
  putAsset(id: string, name: string, data: Buffer) {
    mkdirSync(this.assetPath(id), { recursive: true });
    const f = this.assetPath(id, name);
    const tmp = `${f}.tmp`;
    writeFileSync(tmp, data);
    renameSync(tmp, f);
  }
  getAsset(id: string, name: string) {
    const f = this.assetPath(id, name);
    return existsSync(f) ? readFileSync(f) : null;
  }
  hasAsset(id: string, name: string) { return existsSync(this.assetPath(id, name)); }
  assetBytes(id: string) {
    const d = this.assetPath(id);
    if (!existsSync(d)) return 0;
    return readdirSync(d).filter((n) => ASSET_NAME.test(n)).reduce((s, n) => s + statSync(join(d, n)).size, 0);
  }
  private dir(id: string) {
    if (!SAFE_ID.test(id)) throw new Error('Bad session id');
    return join(this.root, id);
  }
  listMeta(): SessionMeta[] {
    return readdirSync(this.root)
      .filter((d) => SAFE_ID.test(d) && existsSync(join(this.root, d, 'meta.json')))
      .map((d) => JSON.parse(readFileSync(join(this.root, d, 'meta.json'), 'utf8')) as SessionMeta);
  }
  saveMeta(m: SessionMeta) {
    const d = this.dir(m.sessionId);
    mkdirSync(d, { recursive: true });
    atomicWrite(join(d, 'meta.json'), JSON.stringify(m));
  }
  loadLog(id: string): LogEntry[] {
    const f = join(this.dir(id), 'log.jsonl');
    if (!existsSync(f)) return [];
    return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as LogEntry);
  }
  appendLog(id: string, entries: LogEntry[]) {
    if (entries.length) appendFileSync(join(this.dir(id), 'log.jsonl'), entries.map((e) => JSON.stringify(e) + '\n').join(''));
  }
  replaceLog(id: string, entries: LogEntry[]) {
    atomicWrite(join(this.dir(id), 'log.jsonl'), entries.map((e) => JSON.stringify(e) + '\n').join(''));
  }
  loadQueue(id: string): QueueState {
    const f = join(this.dir(id), 'queue.json');
    if (!existsSync(f)) return emptyQueueState();
    try { return parseQueueState(JSON.parse(readFileSync(f, 'utf8'))); } catch { return emptyQueueState(); }
  }
  saveQueue(id: string, q: QueueState) {
    const d = this.dir(id);
    const f = join(d, 'queue.json');
    if (isEmptyQueueState(q)) { if (existsSync(f)) rmSync(f, { force: true }); return; }
    mkdirSync(d, { recursive: true });
    atomicWrite(f, JSON.stringify(q));
  }
}

function atomicWrite(path: string, data: string) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}
