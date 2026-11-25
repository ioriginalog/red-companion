import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { maxHP, scriptedDice } from '@cprc/rules-core';
import {
  applyEntry, emptySession, handleIntent, PROTOCOL_VERSION,
  type Actor, type ClientMessage, type Intent, type LogEntry, type ServerMessage, type SessionState, type Viewer,
} from '@cprc/session';
import { createRelay } from '../src/relay.js';
import { FileStore, MemoryStore, type Store } from '../src/store.js';

function npc(id: string, controller = 'gm', side: 'pc' | 'npc' = 'npc'): Actor {
  const stats = { INT: 6, REF: 6, DEX: 6, TECH: 6, COOL: 6, WILL: 6, LUCK: 6, MOVE: 6, BODY: 6, EMP: 6 };
  return {
    id, controller, weapons: [{ id: 'pistol', name: 'Heavy Pistol', type: 'heavyPistol' }],
    combatant: { id, name: id, side, stats, skills: { Handgun: 6 }, hp: { max: maxHP(6, 6), current: 40 }, armor: [], criticalInjuries: [], deathSave: { accumulatedPenalty: 0 }, conditions: { prone: false, unconscious: false, dead: false, stabilized: false } },
  };
}

/** WebSocket client that queues messages so tests can await them in order. */
class Client {
  ws: WebSocket;
  private queue: ServerMessage[] = [];
  private waiters: ((m: ServerMessage) => void)[] = [];
  closed: Promise<number>;
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMessage;
      const w = this.waiters.shift();
      if (w) w(m); else this.queue.push(m);
    });
    this.closed = new Promise((r) => this.ws.on('close', (code) => r(code)));
  }
  open() { return new Promise<void>((r) => this.ws.once('open', () => r())); }
  send(m: ClientMessage) { this.ws.send(JSON.stringify(m)); }
  next(): Promise<ServerMessage> {
    const m = this.queue.shift();
    if (m) return Promise.resolve(m);
    return new Promise((r, rej) => {
      const t = setTimeout(() => rej(new Error('timeout')), 2000);
      this.waiters.push((x) => { clearTimeout(t); r(x); });
    });
  }
  async nextOf<T extends ServerMessage['t']>(t: T): Promise<Extract<ServerMessage, { t: T }>> {
    for (;;) { const m = await this.next(); if (m.t === t) return m as Extract<ServerMessage, { t: T }>; }
  }
}

let relay: ReturnType<typeof createRelay>;
let base: string;
let store: Store;
let tmp: string | undefined;

async function start(s: Store) {
  store = s;
  relay = createRelay({ store, createPerHour: 100 });
  await new Promise<void>((r) => relay.server.listen(0, '127.0.0.1', () => r()));
  const { port } = relay.server.address() as AddressInfo;
  base = `127.0.0.1:${port}`;
}
async function createSession() {
  const res = await fetch(`http://${base}/api/sessions`, { method: 'POST' });
  expect(res.status).toBe(201);
  return (await res.json()) as { sessionId: string; gmKey: string; joinCode: string };
}

/** GM device stand-in: authority + local log, appends to relay. */
function gmAuthority(gm: Client, sessionId: string) {
  let state: SessionState = emptySession(sessionId);
  const log: LogEntry[] = [];
  return {
    get state() { return state; },
    log,
    act(intent: Intent, by: Viewer = { role: 'gm' }, dice = scriptedDice({})) {
      const r = handleIntent(state, intent, by, { dice });
      if (!r.ok) return r;
      state = applyEntry(state, r.entry);
      log.push(r.entry);
      gm.send({ t: 'append', entries: [r.entry] });
      return r;
    },
  };
}

beforeEach(async () => { await start(new MemoryStore()); });
afterEach(async () => {
  await relay.close();
  if (tmp) { rmSync(tmp, { recursive: true, force: true }); tmp = undefined; }
});

describe('relay', () => {
  it('health endpoint', async () => {
    const r = await (await fetch(`http://${base}/health`)).json();
    expect(r).toMatchObject({ ok: true, protocol: PROTOCOL_VERSION });
  });

  it('rejects a wrong GM key and closes the socket', async () => {
    const { sessionId } = await createSession();
    const c = new Client(`ws://${base}/ws`);
    await c.open();
    c.send({ t: 'hello', v: PROTOCOL_VERSION, role: 'gm', sessionId, gmKey: 'nope' });
    expect(await c.next()).toMatchObject({ t: 'error', code: 'AUTH_FAILED' });
    expect(await c.closed).toBe(4000);
  });

  it('full round trip: player intent → GM authority → projected entries back to player', async () => {
    const { sessionId, gmKey, joinCode } = await createSession();
    const gm = new Client(`ws://${base}/ws`);
    await gm.open();
    gm.send({ t: 'hello', v: PROTOCOL_VERSION, role: 'gm', sessionId, gmKey });
    expect(await gm.next()).toMatchObject({ t: 'welcome', role: 'gm', headSeq: 0 });
    const auth = gmAuthority(gm, sessionId);

    const p = new Client(`ws://${base}/ws`);
    await p.open();
    p.send({ t: 'hello', v: PROTOCOL_VERSION, role: 'player', joinCode: joinCode.toLowerCase(), name: 'Nix' });
    const welcome = await p.nextOf('welcome');
    if (welcome.role !== 'player') throw new Error('expected player welcome');
    const joined = await gm.nextOf('playerJoined');
    expect(joined.player.name).toBe('Nix');
    const pid = welcome.playerId;

    auth.act({ type: 'addActor', actor: npc('solo', pid, 'pc') });
    auth.act({ type: 'addActor', actor: npc('ganger') });
    const e1 = await p.nextOf('entries');
    const e2 = await p.nextOf('entries');
    expect(e1.entries[0]!.patch.actors!.solo!.combatant).toBeDefined();
    // An unseen hostile (no map, no encounter) isn't sent to players at all.
    expect(JSON.stringify(e2)).not.toContain('ganger');

    // Player shoots; relay forwards to GM; GM authority decides.
    p.send({ t: 'intent', clientMsgId: 'm1', intent: { type: 'rangedAttack', attackerId: 'solo', defenderId: 'ganger', weaponId: 'pistol', distance: 5 } });
    const fwd = await gm.nextOf('intent');
    expect(fwd.from).toBe(pid);
    const r = auth.act(fwd.intent, { role: 'player', playerId: fwd.from }, scriptedDice({ d10: [5] }));
    expect(r.ok).toBe(true);
    const e3 = await p.nextOf('entries');
    expect(e3.entries[0]!.events.some((e) => e.type === 'attackResolved')).toBe(true);

    // A rejected intent is forwarded back to the player.
    p.send({ t: 'intent', clientMsgId: 'm2', intent: { type: 'addActor', actor: npc('x') } });
    const bad = await gm.nextOf('intent');
    const rej = auth.act(bad.intent, { role: 'player', playerId: bad.from });
    expect(rej.ok).toBe(false);
    if (!rej.ok) gm.send({ t: 'reject', playerId: bad.from, clientMsgId: bad.clientMsgId, code: rej.code, message: rej.message });
    expect(await p.nextOf('rejected')).toMatchObject({ clientMsgId: 'm2', code: 'FORBIDDEN' });

    // Gaps are refused.
    gm.send({ t: 'append', entries: [{ ...auth.log[0]!, seq: 99 }] });
    expect(await gm.nextOf('error')).toMatchObject({ code: 'GAP' });

    // Undo → snapshot to players.
    gm.send({ t: 'truncate', toSeq: 2 });
    const snap = await p.nextOf('snapshot');
    expect(snap.view.seq).toBe(2);
    expect(snap.view.pending).toBeNull();

    // Player can't append.
    p.send({ t: 'append', entries: [] });
    expect(await p.nextOf('error')).toMatchObject({ code: 'NOT_ALLOWED' });
  });

  it('players reconnect with their token and keep their identity', async () => {
    const { joinCode } = await createSession();
    const a = new Client(`ws://${base}/ws`);
    await a.open();
    a.send({ t: 'hello', v: PROTOCOL_VERSION, role: 'player', joinCode, name: 'Nix' });
    const w1 = await a.nextOf('welcome');
    a.ws.close();
    const b = new Client(`ws://${base}/ws`);
    await b.open();
    if (w1.role !== 'player') throw new Error();
    b.send({ t: 'hello', v: PROTOCOL_VERSION, role: 'player', joinCode, name: 'Nix', playerToken: w1.playerToken });
    const w2 = await b.nextOf('welcome');
    expect(w2.role === 'player' && w2.playerId).toBe(w1.playerId);
    b.send({ t: 'intent', clientMsgId: 'z', intent: { type: 'endTurn' } });
    expect(await b.nextOf('rejected')).toMatchObject({ code: 'GM_OFFLINE' });
  });

  it('FileStore persists sessions and logs across restarts', async () => {
    await relay.close();
    tmp = mkdtempSync(join(tmpdir(), 'relay-'));
    await start(new FileStore(tmp));
    const { sessionId, gmKey } = await createSession();
    const gm = new Client(`ws://${base}/ws`);
    await gm.open();
    gm.send({ t: 'hello', v: PROTOCOL_VERSION, role: 'gm', sessionId, gmKey });
    await gm.nextOf('welcome');
    const auth = gmAuthority(gm, sessionId);
    auth.act({ type: 'addActor', actor: npc('ganger') });
    auth.act({ type: 'addActor', actor: npc('boss') });
    await new Promise((r) => setTimeout(r, 100));
    await relay.close();

    await start(new FileStore(tmp));
    const gm2 = new Client(`ws://${base}/ws`);
    await gm2.open();
    gm2.send({ t: 'hello', v: PROTOCOL_VERSION, role: 'gm', sessionId, gmKey });
    expect(await gm2.nextOf('welcome')).toMatchObject({ headSeq: 2 });
    gm2.send({ t: 'fetchLog', fromSeq: 1 });
    const l = await gm2.nextOf('log');
    expect(l.entries).toEqual(auth.log);
  });
});

describe('static web client and origin policy', () => {
  let dir: string;
  let relay: ReturnType<typeof createRelay>;
  let base: string;
  beforeEach(async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    dir = mkdtempSync(join(tmpdir(), 'web-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>t</title>');
    writeFileSync(join(dir, 'assets', 'app-abcd1234.js'), 'console.log(1)');
    relay = createRelay({ store: new MemoryStore(), webDir: dir, allowedOrigins: ['https://good.example'] });
    await new Promise<void>((r) => relay.server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(relay.server.address() as AddressInfo).port}`;
  });
  afterEach(async () => { await relay.close(); rmSync(dir, { recursive: true, force: true }); });

  it('serves index with a CSP, hashed assets as immutable, and falls back for routes', async () => {
    const idx = await fetch(`${base}/`);
    expect(idx.status).toBe(200);
    expect(idx.headers.get('content-security-policy')).toContain("default-src 'self'");
    const js = await fetch(`${base}/assets/app-abcd1234.js`);
    expect(js.headers.get('cache-control')).toContain('immutable');
    expect((await fetch(`${base}/table/xyz`)).status).toBe(200);
    expect((await fetch(`${base}/missing.png`)).status).toBe(404);
  });
  it('refuses path traversal', async () => {
    // Normalizes to a path inside the web root, so it gets the SPA shell, never the file.
    const r = await fetch(`${base}/..%2f..%2fetc%2fpasswd`);
    expect(await r.text()).toBe('<!doctype html><title>t</title>');
    expect((await fetch(`${base}/..%2f..%2fetc%2fhosts.txt`)).status).toBe(404);
  });
  it('rejects session creation and sockets from other origins', async () => {
    expect((await fetch(`${base}/api/sessions`, { method: 'POST', headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    expect((await fetch(`${base}/api/sessions`, { method: 'POST', headers: { Origin: 'https://good.example' } })).status).toBe(201);
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { Origin: 'https://evil.example' } });
    const code = await new Promise<string>((r) => { ws.on('unexpected-response', (_q, res) => r(String(res.statusCode))); ws.on('open', () => r('open')); });
    expect(code).toBe('401');
  });
});

describe('signals', () => {
  async function room() {
    const { sessionId, gmKey, joinCode } = await createSession();
    const gm = new Client(`ws://${base}/ws`);
    await gm.open();
    gm.send({ t: 'hello', v: PROTOCOL_VERSION, role: 'gm', sessionId, gmKey });
    await gm.nextOf('welcome');
    const players: Client[] = [];
    for (const name of ['A', 'B']) {
      const p = new Client(`ws://${base}/ws`);
      await p.open();
      p.send({ t: 'hello', v: PROTOCOL_VERSION, role: 'player', joinCode, name });
      await p.nextOf('welcome');
      await gm.nextOf('playerJoined');
      players.push(p);
    }
    return { gm, a: players[0]!, b: players[1]! };
  }

  it('relays a ping to everyone else in the room, with its sender', async () => {
    const { gm, a, b } = await room();
    a.send({ t: 'signal', signal: { kind: 'ping', at: { x: 3, y: 4 } } });
    const toGm = await gm.nextOf('signal');
    const toB = await b.nextOf('signal');
    expect(toGm.signal).toEqual({ kind: 'ping', at: { x: 3, y: 4 } });
    expect(toB.from).toBe(toGm.from);
    expect(toGm.from).not.toBe('gm');
    gm.send({ t: 'signal', signal: { kind: 'measure', from: { x: 0, y: 0 }, to: null } });
    expect((await a.nextOf('signal')).from).toBe('gm');
  });

  it('drops malformed signals and strips extra fields', async () => {
    const { gm, a } = await room();
    a.ws.send(JSON.stringify({ t: 'signal', signal: { kind: 'ping', at: { x: -1, y: 2 } } }));
    expect(await a.nextOf('error')).toMatchObject({ code: 'BAD_MESSAGE' });
    a.ws.send(JSON.stringify({ t: 'signal', signal: { kind: 'ping', at: { x: 1, y: 2, evil: '<script>' }, extra: 1 } }));
    const s = await gm.nextOf('signal');
    expect(s.signal).toEqual({ kind: 'ping', at: { x: 1, y: 2 } });
  });

  it('rate-limits a flood and never logs signals', async () => {
    const { gm, a } = await room();
    let got = 0;
    gm.ws.on('message', (d) => { if ((JSON.parse(d.toString()) as ServerMessage).t === 'signal') got++; });
    for (let i = 0; i < 60; i++) a.send({ t: 'signal', signal: { kind: 'cursor', at: { x: i, y: 0 } } });
    await new Promise((r) => setTimeout(r, 500));
    expect(got).toBeGreaterThanOrEqual(15);
    expect(got).toBeLessThanOrEqual(26);
    gm.send({ t: 'fetchLog', fromSeq: 1 });
    expect((await gm.nextOf('log')).entries).toEqual([]);
  }, 10_000);
});

describe('assets API', () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake png body')]);
  const upload = (id: string, key: string | null, body: Buffer, type = 'image/png', extra: Record<string, string> = {}) =>
    fetch(`http://${base}/api/sessions/${id}/assets`, {
      method: 'POST', body: new Uint8Array(body), headers: { 'Content-Type': type, ...(key ? { Authorization: `Bearer ${key}` } : {}), ...extra },
    });

  it('stores content-addressed images and serves them immutably', async () => {
    const { sessionId, gmKey } = await createSession();
    const r = await upload(sessionId, gmKey, PNG);
    expect(r.status).toBe(201);
    const { url } = (await r.json()) as { url: string };
    expect(url).toMatch(new RegExp(`^/u/${sessionId}/[a-f0-9]{64}\\.png$`));
    const again = (await (await upload(sessionId, gmKey, PNG)).json()) as { url: string };
    expect(again.url).toBe(url);
    const g = await fetch(`http://${base}${url}`);
    expect(g.status).toBe(200);
    expect(g.headers.get('content-type')).toBe('image/png');
    expect(g.headers.get('cache-control')).toContain('immutable');
    expect(g.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await g.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it('requires the GM key', async () => {
    const { sessionId } = await createSession();
    expect((await upload(sessionId, null, PNG)).status).toBe(401);
    expect((await upload(sessionId, 'wrong-key', PNG)).status).toBe(401);
  });

  it('rejects other types, spoofed types and oversized files', async () => {
    const { sessionId, gmKey } = await createSession();
    expect((await upload(sessionId, gmKey, Buffer.from('<svg/>'), 'image/svg+xml')).status).toBe(415);
    expect((await upload(sessionId, gmKey, Buffer.from('not really a png'), 'image/png')).status).toBe(415);
    expect((await upload(sessionId, gmKey, Buffer.concat([PNG, Buffer.alloc(8 * 1024 * 1024)]))).status).toBe(413);
  });

  it('enforces the per-session quota', async () => {
    await relay.close();
    relay = createRelay({ store: new MemoryStore(), assetQuotaBytes: 100 });
    await new Promise<void>((r) => relay.server.listen(0, '127.0.0.1', () => r()));
    base = `127.0.0.1:${(relay.server.address() as AddressInfo).port}`;
    const { sessionId, gmKey } = await createSession();
    const img = (n: number) => Buffer.concat([PNG, Buffer.alloc(40, n)]); // 61 bytes each
    expect((await upload(sessionId, gmKey, img(1))).status).toBe(201);
    expect((await upload(sessionId, gmKey, img(1))).status).toBe(201); // same bytes: no new storage
    const r = await upload(sessionId, gmKey, img(2));
    expect(r.status).toBe(413);
    expect(((await r.json()) as { error: string }).error).toContain('200 MB');
  });

  it('serves nothing for bad names or unknown sessions', async () => {
    const { sessionId } = await createSession();
    expect((await fetch(`http://${base}/u/${sessionId}/${'a'.repeat(64)}.png`)).status).toBe(404);
    expect((await fetch(`http://${base}/u/${sessionId}/..%2f..%2fmeta.json`)).status).toBe(404);
    expect((await fetch(`http://${base}/u/00000000-0000-0000-0000-000000000000/${'a'.repeat(64)}.png`)).status).toBe(404);
  });
});

describe('log export', () => {
  it('returns meta without secrets and the full log, GM only', async () => {
    const { sessionId, gmKey, joinCode } = await createSession();
    const gm = new Client(`ws://${base}/ws`);
    await gm.open();
    gm.send({ t: 'hello', v: PROTOCOL_VERSION, role: 'gm', sessionId, gmKey });
    await gm.nextOf('welcome');
    const auth = gmAuthority(gm, sessionId);
    auth.act({ type: 'addActor', actor: npc('ganger') });
    await new Promise((r) => setTimeout(r, 100));
    expect((await fetch(`http://${base}/api/sessions/${sessionId}/export`)).status).toBe(401);
    const res = await fetch(`http://${base}/api/sessions/${sessionId}/export`, { headers: { Authorization: `Bearer ${gmKey}` } });
    expect(res.status).toBe(200);
    const body = await res.text();
    const j = JSON.parse(body) as { meta: { joinCode: string }; log: unknown[] };
    expect(j.meta.joinCode).toBe(joinCode);
    expect(j.log).toHaveLength(1);
    expect(body).not.toContain('gmKeyHash');
    expect(body).not.toContain('tokenHash');
  });
});

describe('FileStore assets', () => {
  it('writes content-addressed files, totals usage and refuses bad names', () => {
    tmp = mkdtempSync(join(tmpdir(), 'assets-'));
    const fs = new FileStore(tmp);
    const id = '11111111-2222-3333-4444-555555555555';
    const name = `${'b'.repeat(64)}.webp`;
    expect(fs.hasAsset(id, name)).toBe(false);
    fs.putAsset(id, name, Buffer.from('RIFF0000WEBPdata'));
    expect(fs.hasAsset(id, name)).toBe(true);
    expect(fs.getAsset(id, name)!.toString()).toBe('RIFF0000WEBPdata');
    expect(fs.assetBytes(id)).toBe(16);
    expect(() => fs.putAsset(id, '../../evil.webp', Buffer.from('x'))).toThrow();
    expect(() => fs.getAsset('../etc', name)).toThrow();
    // Survives a restart (new store on the same directory).
    expect(new FileStore(tmp).getAsset(id, name)).not.toBeNull();
  });
});

describe('round 2 hardening', () => {
  it('ignores X-Forwarded-For unless proxies are configured, then reads from the right (critic #5)', async () => {
    const { clientIp } = await import('../src/relay.js');
    const req = (xff: string) => ({ headers: { 'x-forwarded-for': xff }, socket: { remoteAddress: '10.0.0.9' } }) as never;
    expect(clientIp(req('1.1.1.1'), 0)).toBe('10.0.0.9');
    expect(clientIp(req('6.6.6.6, 2.2.2.2'), 1)).toBe('2.2.2.2'); // spoofed left entry ignored
    expect(clientIp(req('6.6.6.6, 2.2.2.2, 3.3.3.3'), 2)).toBe('2.2.2.2');
    // Spoofed headers no longer dodge the creation limit.
    await relay.close();
    relay = createRelay({ store: new MemoryStore(), createPerHour: 3 });
    await new Promise<void>((r) => relay.server.listen(0, '127.0.0.1', () => r()));
    base = `127.0.0.1:${(relay.server.address() as AddressInfo).port}`;
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await fetch(`http://${base}/api/sessions`, { method: 'POST', headers: { 'X-Forwarded-For': `9.9.9.${i}` } })).status);
    expect(codes).toEqual([201, 201, 201, 429, 429]);
  });

  it('defaults to same-origin when no origin list is configured', async () => {
    const ok = await fetch(`http://${base}/api/sessions`, { method: 'POST', headers: { Origin: `http://${base}` } });
    expect(ok.status).toBe(201);
    const evil = await fetch(`http://${base}/api/sessions`, { method: 'POST', headers: { Origin: 'https://evil.example' } });
    expect(evil.status).toBe(403);
    const ws = new WebSocket(`ws://${base}/ws`, { headers: { Origin: 'https://evil.example' } });
    const code = await new Promise<string>((r) => { ws.on('unexpected-response', (_q, res) => r(String(res.statusCode))); ws.on('open', () => r('open')); });
    expect(code).toBe('401');
  });

  it('gives players a player directory and tells them when others join or leave (critic #10)', async () => {
    const { sessionId, gmKey, joinCode } = await createSession();
    const gm = new Client(`ws://${base}/ws`); await gm.open();
    gm.send({ t: 'hello', v: PROTOCOL_VERSION, role: 'gm', sessionId, gmKey });
    await gm.nextOf('welcome');
    const a = new Client(`ws://${base}/ws`); await a.open();
    a.send({ t: 'hello', v: PROTOCOL_VERSION, role: 'player', joinCode, name: 'Alice' });
    const wa = await a.nextOf('welcome');
    if (wa.role !== 'player') throw new Error('player');
    expect(wa.players.map((p) => p.name)).toEqual(['Alice']);
    const b = new Client(`ws://${base}/ws`); await b.open();
    b.send({ t: 'hello', v: PROTOCOL_VERSION, role: 'player', joinCode, name: 'Bob' });
    const wb = await b.nextOf('welcome');
    if (wb.role !== 'player') throw new Error('player');
    expect(wb.players.map((p) => p.name).sort()).toEqual(['Alice', 'Bob']);
    expect(JSON.stringify(wb.players)).not.toContain('token');
    expect((await a.nextOf('playerJoined')).player.name).toBe('Bob');
    b.ws.close();
    expect((await a.nextOf('playerLeft')).playerId).toBe(wb.playerId);
    a.ws.close(); gm.ws.close();
  });

  it('imports a session export as a new session, and refuses broken logs', async () => {
    const { sessionId, gmKey } = await createSession();
    const gm = new Client(`ws://${base}/ws`); await gm.open();
    gm.send({ t: 'hello', v: PROTOCOL_VERSION, role: 'gm', sessionId, gmKey });
    await gm.nextOf('welcome');
    const auth = gmAuthority(gm, sessionId);
    auth.act({ type: 'addActor', actor: npc('solo', 'gm', 'pc') });
    auth.act({ type: 'addActor', actor: npc('ganger') });
    await new Promise((r) => setTimeout(r, 100));
    const exp = await (await fetch(`http://${base}/api/sessions/${sessionId}/export`, { headers: { Authorization: `Bearer ${gmKey}` } })).json();
    const post = (body: unknown) => fetch(`http://${base}/api/sessions/import`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
    const res = await post(exp);
    expect(res.status).toBe(201);
    const made = (await res.json()) as { sessionId: string; gmKey: string; joinCode: string };
    expect(made.sessionId).not.toBe(sessionId);
    const gm2 = new Client(`ws://${base}/ws`); await gm2.open();
    gm2.send({ t: 'hello', v: PROTOCOL_VERSION, role: 'gm', sessionId: made.sessionId, gmKey: made.gmKey });
    expect(await gm2.nextOf('welcome')).toMatchObject({ headSeq: 2 });
    // Broken chains, wrong formats and garbage are refused.
    expect((await post({ ...exp, log: [{ ...exp.log[0], patch: 'x' }] })).status).toBe(400);
    expect((await post({ ...exp, log: [exp.log[1]] })).status).toBe(400);
    expect((await post({ format: 'other', version: 1, log: [] })).status).toBe(400);
    expect((await fetch(`http://${base}/api/sessions/import`, { method: 'POST', body: '{nope' })).status).toBe(400);
    gm.ws.close(); gm2.ws.close();
  });
});

describe('oversized frames', () => {
  it('drops the connection without crashing the relay', async () => {
    const relay = createRelay({ store: new MemoryStore(), maxPayloadBytes: 1024 });
    await new Promise<void>((r) => relay.server.listen(0, '127.0.0.1', () => r()));
    const port = (relay.server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((r) => ws.on('open', r));
    const closed = new Promise((r) => ws.on('close', r));
    ws.send('x'.repeat(4096));
    await closed;
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    await relay.close();
  });
});
