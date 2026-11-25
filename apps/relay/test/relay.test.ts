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
    expect(e2.entries[0]!.patch.actors!.ganger!.combatant).toBeUndefined(); // NPC redacted

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
