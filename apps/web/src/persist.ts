/**
 * GM device cache: the last known full log for a session, saved to IndexedDB
 * (localStorage as a fallback). A GM tab closed while offline reopens with
 * its unsent actions intact; the next welcome reconciles them with the relay
 * (`reconcileLogs` in net.ts) and syncs or discards them.
 */
import { replay, type LogEntry, type SessionState } from '@cprc/session';

export interface GmCache {
  sessionId: string;
  log: LogEntry[];
  /** How many leading entries the relay was known to hold when saved. */
  synced: number;
  savedAt: number;
}

export interface KV {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

export const cacheKey = (sessionId: string) => `nsc.gmlog.${sessionId}`;

/**
 * What to restore from a cache entry: the cached log and the state it
 * replays to, or null if the cache is missing, belongs to another session or
 * no longer replays (corrupt or from an incompatible build).
 */
export function restoreFromCache(cache: unknown, sessionId: string): { log: LogEntry[]; state: SessionState; synced: number } | null {
  if (!cache || typeof cache !== 'object') return null;
  const c = cache as Partial<GmCache>;
  if (c.sessionId !== sessionId || !Array.isArray(c.log) || c.log.length === 0) return null;
  try {
    const synced = Number.isInteger(c.synced) ? Math.max(0, Math.min(c.log.length, c.synced!)) : 0;
    return { log: c.log, state: replay(sessionId, c.log), synced };
  } catch {
    return null;
  }
}

/** localStorage-backed KV (small sessions, private-mode fallbacks). */
export function localKV(): KV {
  return {
    async get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
    async set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota or private mode */ } },
    async del(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
  };
}

/** In-memory KV for tests and environments without storage. */
export function memoryKV(): KV {
  const m = new Map<string, unknown>();
  return {
    async get(k) { return m.has(k) ? structuredClone(m.get(k)) : null; },
    async set(k, v) { m.set(k, structuredClone(v)); },
    async del(k) { m.delete(k); },
  };
}

/** IndexedDB-backed KV; falls back to localStorage when IndexedDB is unavailable or fails. */
export function idbKV(): KV {
  const fallback = localKV();
  if (typeof indexedDB === 'undefined') return fallback;
  let dbp: Promise<IDBDatabase> | null = null;
  const db = () => (dbp ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('night-shift', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('kv'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const run = <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) => db().then((d) => new Promise<T>((resolve, reject) => {
    const tx = d.transaction('kv', mode);
    const r = f(tx.objectStore('kv'));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
  return {
    get: (k) => run('readonly', (s) => s.get(k)).catch(() => fallback.get(k)),
    set: (k, v) => run('readwrite', (s) => s.put(v, k)).then(() => undefined).catch(() => fallback.set(k, v)),
    del: (k) => run('readwrite', (s) => s.delete(k)).then(() => fallback.del(k)).catch(() => fallback.del(k)),
  };
}
