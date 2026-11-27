/**
 * Client connection behavior with a fake WebSocket: reconnect identity (round 3
 * #1), undo rewinds (round 4 #16), batched notifications (round 4 #5), and GM
 * key safety (round 4 #6).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage, ViewState } from '@cprc/session';

class FakeWS {
  static OPEN = 1;
  static all: FakeWS[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  constructor(public url: string) { FakeWS.all.push(this); }
  send(s: string) { this.sent.push(JSON.parse(s)); }
  close() { this.drop(1000); }
  open() { this.readyState = 1; this.onopen?.(); }
  recv(m: ServerMessage) { this.onmessage?.({ data: JSON.stringify(m) }); }
  drop(code = 1006) { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code }); }
}

const mem = new Map<string, string>();
beforeEach(() => {
  FakeWS.all = [];
  mem.clear();
  vi.stubGlobal('WebSocket', FakeWS);
  vi.stubGlobal('location', { protocol: 'http:', host: 'test' });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k),
  });
  vi.useFakeTimers();
});

async function freshClient() {
  vi.resetModules();
  const { Client } = await import('../src/net.js');
  const { memoryKV } = await import('../src/persist.js');
  const c = new Client();
  c.kv = memoryKV();
  return c;
}

function emptyView(seq = 0): ViewState {
  return { sessionId: 's1', seq, actors: {}, encounter: { active: false, round: 0, order: [], turnIndex: 0, deathSaveRequiredFor: null }, pending: null, map: null } as unknown as ViewState;
}
const welcome = (seq = 0, history: { seq: number; by: string; intentType: string; events: never[] }[] = []): ServerMessage =>
  ({ t: 'welcome', role: 'player', sessionId: 's1', playerId: 'p1', playerToken: 'tok-1', view: emptyView(seq), players: [], history } as unknown as ServerMessage);

describe('player reconnect keeps identity (round 3 #1)', () => {
  it('sends the token it was given on every later hello', async () => {
    const c = await freshClient();
    c.join('ABCDEF', 'Ana');
    let ws = FakeWS.all.at(-1)!;
    ws.open();
    expect(ws.sent[0]).toMatchObject({ t: 'hello', role: 'player', name: 'Ana' });
    expect(ws.sent[0]).not.toHaveProperty('playerToken');
    ws.recv(welcome());
    ws.drop();
    vi.advanceTimersByTime(1000);
    ws = FakeWS.all.at(-1)!;
    ws.open();
    expect(ws.sent[0]).toMatchObject({ t: 'hello', role: 'player', joinCode: 'ABCDEF', playerToken: 'tok-1' });
    // A second drop still carries it (no regression to the original hello).
    ws.recv(welcome());
    ws.drop();
    vi.advanceTimersByTime(2000);
    ws = FakeWS.all.at(-1)!;
    ws.open();
    expect(ws.sent[0]).toMatchObject({ playerToken: 'tok-1' });
  });
});

describe('undo rewinds the player log (round 4 #16)', () => {
  it('replaces view and feed from the rewind', async () => {
    const c = await freshClient();
    c.join('ABCDEF', 'Ana');
    const ws = FakeWS.all.at(-1)!;
    ws.open();
    const ev = (seq: number) => ({ seq, by: 'gm', intentType: 'chat', events: [{ type: 'chatMessage', visibility: 'public', by: 'gm', text: `l${seq}` }] as never[] });
    ws.recv(welcome(3, [ev(1), ev(2), ev(3)]));
    expect(c.getState().feed.map((f) => f.seq)).toEqual([1, 2, 3]);
    ws.recv({ t: 'rewind', toSeq: 1, view: emptyView(1), history: [ev(1)] } as ServerMessage);
    expect(c.getState().feed.map((f) => f.seq)).toEqual([1]);
    expect(c.getState().view?.seq).toBe(1);
  });
});

describe('batched notifications (round 4 #5)', () => {
  it('notifies listeners at most once per frame however many updates arrive', async () => {
    const c = await freshClient();
    let calls = 0;
    c.subscribe(() => { calls++; });
    c.join('ABCDEF', 'Ana');
    const ws = FakeWS.all.at(-1)!;
    ws.open();
    ws.recv(welcome());
    for (let i = 0; i < 500; i++) ws.recv({ t: 'queued', clientMsgId: `m${i}` });
    expect(c.getState().queued).toBe(500); // state is current immediately
    vi.advanceTimersByTime(60);
    expect(calls).toBeLessThanOrEqual(2);
  });
});

describe('GM key safety (round 4 #6)', () => {
  it('keeps several GM sessions, migrates the old slot, and only forgets on request', async () => {
    mem.set('nsc.gm', JSON.stringify({ sessionId: 'old', gmKey: 'k-old', joinCode: 'OLD111' }));
    const c = await freshClient();
    expect(c.savedGmSessions().map((g) => g.sessionId)).toEqual(['old']);
    expect(mem.has('nsc.gm')).toBe(false);
    await c.resumeGm({ sessionId: 's2', gmKey: 'k2', joinCode: 'NEW222' });
    expect(c.savedGmSessions().map((g) => g.sessionId)).toEqual(['s2', 'old']);
    // Backup carries everything needed to resume elsewhere.
    expect(JSON.parse(c.gmBackup()!)).toMatchObject({ format: 'nsc-gm-backup', sessionId: 's2', gmKey: 'k2', joinCode: 'NEW222' });
    c.leave();
    expect(c.savedGmSessions().map((g) => g.sessionId)).toEqual(['s2', 'old']);
    await c.resumeGm({ sessionId: 's2', gmKey: 'k2', joinCode: 'NEW222' });
    c.leave({ forget: true });
    expect(c.savedGmSessions().map((g) => g.sessionId)).toEqual(['old']);
  });

  it('opens a GM backup file as a resume, not an import', async () => {
    const c = await freshClient();
    const file = { text: async () => JSON.stringify({ format: 'nsc-gm-backup', version: 1, sessionId: 's9', gmKey: 'k9', joinCode: 'BAK999' }) } as unknown as Blob;
    await c.importSession(file);
    await vi.runAllTimersAsync();
    const ws = FakeWS.all.at(-1)!;
    ws.open();
    expect(ws.sent[0]).toMatchObject({ t: 'hello', role: 'gm', sessionId: 's9', gmKey: 'k9' });
    expect(c.savedGmSessions()[0]).toMatchObject({ sessionId: 's9' });
  });

  it('keeps a GM key the relay refuses (the GM can forget it explicitly)', async () => {
    const c = await freshClient();
    await c.resumeGm({ sessionId: 's3', gmKey: 'k3', joinCode: 'KEY333' });
    const ws = FakeWS.all.at(-1)!;
    ws.open();
    ws.recv({ t: 'error', code: 'AUTH_FAILED', message: 'Unknown session or wrong GM key.' });
    expect(c.savedGmSessions().map((g) => g.sessionId)).toContain('s3');
  });
});

describe('held actions while the GM is away (round 5 #4)', () => {
  it('clears the count and says so when the relay drops or loses a held action', async () => {
    const c = await freshClient();
    c.join('ABCDEF', 'Ana');
    let ws = FakeWS.all.at(-1)!;
    ws.open();
    ws.recv(welcome());
    ws.recv({ t: 'queued', clientMsgId: 'a' } as ServerMessage);
    ws.recv({ t: 'queued', clientMsgId: 'b' } as ServerMessage);
    ws.recv({ t: 'queued', clientMsgId: 'c' } as ServerMessage);
    expect(c.getState().queued).toBe(3);
    ws.recv({ t: 'queueDropped', clientMsgId: 'a', reason: 'expired', message: 'The GM was away too long, so that action was dropped. Try it again.' } as ServerMessage);
    expect(c.getState().queued).toBe(2);
    expect(c.getState().toast?.text).toContain('dropped');
    // Relay restart: it still holds b, delivered nothing, and lost c.
    ws.drop();
    vi.advanceTimersByTime(1000);
    ws = FakeWS.all.at(-1)!;
    ws.open();
    ws.recv({ ...(welcome() as object), queued: ['b'], settled: [] } as unknown as ServerMessage);
    expect(c.getState().queued).toBe(1);
    expect(c.getState().toast?.text).toBe('A queued action was lost before the GM got it. Try again.');
  });

  it('treats settled actions as delivered, not lost', async () => {
    const c = await freshClient();
    c.join('ABCDEF', 'Ana');
    let ws = FakeWS.all.at(-1)!;
    ws.open();
    ws.recv(welcome());
    ws.recv({ t: 'queued', clientMsgId: 'a' } as ServerMessage);
    ws.drop();
    vi.advanceTimersByTime(1000);
    ws = FakeWS.all.at(-1)!;
    ws.open();
    ws.recv({ ...(welcome() as object), queued: [], settled: ['a'] } as unknown as ServerMessage);
    expect(c.getState().queued).toBe(0);
    expect(c.getState().toast).toBeNull();
  });

  it('clears a stale Queued toast when the GM comes back, but keeps other notices', async () => {
    const c = await freshClient();
    c.join('ABCDEF', 'Ana');
    const ws = FakeWS.all.at(-1)!;
    ws.open();
    ws.recv(welcome());
    ws.recv({ t: 'queued', clientMsgId: 'a' } as ServerMessage);
    expect(c.getState().toast?.text).toBe('Queued: Will Send When the GM Returns');
    ws.recv({ t: 'gmStatus', online: true } as ServerMessage);
    expect(c.getState().queued).toBe(0);
    expect(c.getState().toast).toBeNull();
    ws.recv({ t: 'gmStatus', online: false } as ServerMessage);
    ws.recv({ t: 'queueDropped', clientMsgId: 'z', reason: 'expired', message: 'The GM was away too long, so that action was dropped. Try it again.' } as ServerMessage);
    ws.recv({ t: 'gmStatus', online: true } as ServerMessage);
    expect(c.getState().toast?.text).toContain('dropped');
  });
});

describe('GM pings and ruler toggle (round 5 #3)', () => {
  it('stops sending pings and ruler lines when off, and clears the ruler players may see', async () => {
    const c = await freshClient();
    await c.resumeGm({ sessionId: 's1', gmKey: 'k', joinCode: 'ABCDEF' });
    await vi.runAllTimersAsync();
    const ws = FakeWS.all.at(-1)!;
    ws.readyState = 1;
    ws.open();
    const before = ws.sent.length;
    c.setGmSignals(false);
    expect(ws.sent.slice(before)).toEqual([{ t: 'signal', signal: { kind: 'measure', from: { x: 0, y: 0 }, to: null } }]);
    c.signal({ kind: 'ping', at: { x: 1, y: 1 } });
    expect(ws.sent.filter((m) => m.t === 'signal')).toHaveLength(1);
    expect(c.getState().signals.pings).toHaveLength(1); // still shown locally
    c.setGmSignals(true);
    c.signal({ kind: 'ping', at: { x: 2, y: 1 } });
    expect(ws.sent.filter((m) => m.t === 'signal')).toHaveLength(2);
  });
});
