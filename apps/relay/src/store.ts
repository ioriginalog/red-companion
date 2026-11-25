/**
 * Session persistence. FileStore writes to DATA_DIR (a Railway volume):
 *   <DATA_DIR>/sessions/<id>/meta.json
 *   <DATA_DIR>/sessions/<id>/log.jsonl   (one LogEntry per line, append-only except undo)
 * MemoryStore is for tests and for running without a volume (data lost on restart).
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LogEntry } from '@cprc/session';

export interface PlayerRecord { playerId: string; name: string; tokenHash: string }
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
}

export class MemoryStore implements Store {
  private metas = new Map<string, SessionMeta>();
  private logs = new Map<string, LogEntry[]>();
  listMeta() { return [...this.metas.values()]; }
  saveMeta(m: SessionMeta) { this.metas.set(m.sessionId, structuredClone(m)); }
  loadLog(id: string) { return structuredClone(this.logs.get(id) ?? []); }
  appendLog(id: string, e: LogEntry[]) { this.logs.set(id, [...(this.logs.get(id) ?? []), ...structuredClone(e)]); }
  replaceLog(id: string, e: LogEntry[]) { this.logs.set(id, structuredClone(e)); }
}

const SAFE_ID = /^[a-f0-9-]{36}$/;

export class FileStore implements Store {
  private root: string;
  constructor(dataDir: string) {
    this.root = join(dataDir, 'sessions');
    mkdirSync(this.root, { recursive: true });
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
}

function atomicWrite(path: string, data: string) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}
