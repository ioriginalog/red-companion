/**
 * Client connection and state.
 *
 * GM device: the authority. Replays the full log from the relay, runs every
 * intent (its own and players') through `handleIntent` with real dice, and
 * appends the resulting entries. Players only ever see projected state.
 */
import { cryptoDice, type Cell, type CombatEvent } from '@cprc/rules-core';
import {
  applyEntry, applyProjectedEntry, emptySession, handleIntent, projectState, PROTOCOL_VERSION, replay,
  type Actor, type Intent, type LogEntry, type PlayerInfo, type ServerMessage, type SessionState, type Signal, type ViewState,
} from '@cprc/session';

export interface FeedItem { seq: number; by: string; intentType: string; events: CombatEvent[] }

/** Ephemeral table signals (never logged). `from` = 'me', 'gm' or a player id. */
export interface Ping { id: number; from: string; at: Cell; t: number }
export interface Signals {
  pings: Ping[];
  measures: Record<string, { from: Cell; to: Cell }>;
  cursors: Record<string, { at: Cell; t: number }>;
}
export const PING_MS = 2600;

export interface ClientState {
  status: 'idle' | 'connecting' | 'online' | 'offline' | 'error';
  role: 'gm' | 'player' | null;
  sessionId: string | null;
  joinCode: string | null;
  playerId: string | null;
  /** What this device shows. For the GM, the full projection. */
  view: ViewState | null;
  players: PlayerInfo[];
  gmOnline: boolean;
  feed: FeedItem[];
  toast: { text: string; at: number } | null;
  signals: Signals;
}

interface GmCreds { sessionId: string; gmKey: string; joinCode: string }
const GM_KEY = 'nsc.gm';
const playerKey = (code: string) => `nsc.player.${code}`;

const store = {
  get<T>(k: string): T | null {
    try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
  },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

type Listener = () => void;

export class Client {
  state: ClientState = {
    status: 'idle', role: null, sessionId: null, joinCode: null, playerId: null, view: null, players: [], gmOnline: false, feed: [], toast: null,
    signals: { pings: [], measures: {}, cursors: {} },
  };
  private pingN = 0;
  private lastSignalAt: Record<string, number> = {};
  private trailing: Record<string, { timer: number; sig: Signal }> = {};
  private listeners = new Set<Listener>();
  private ws: WebSocket | null = null;
  private full: SessionState | null = null;
  private log: LogEntry[] = [];
  private hello: object | null = null;
  private retry = 0;
  private dice = cryptoDice();
  private msgN = 0;
  private gmCreds: GmCreds | null = null;

  subscribe = (l: Listener) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  getState = () => this.state;
  private set(patch: Partial<ClientState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
  toast(text: string) { this.set({ toast: { text, at: Date.now() } }); }

  savedGm(): GmCreds | null { return store.get<GmCreds>(GM_KEY); }

  async createSession() {
    this.set({ status: 'connecting' });
    const res = await fetch('/api/sessions', { method: 'POST' });
    if (!res.ok) { this.set({ status: 'error' }); this.toast((await res.json().catch(() => ({}))).error ?? 'Could not create a session.'); return; }
    const creds = (await res.json()) as GmCreds;
    store.set(GM_KEY, creds);
    this.resumeGm(creds);
  }

  resumeGm(creds: GmCreds) {
    this.gmCreds = creds;
    this.full = emptySession(creds.sessionId);
    this.log = [];
    this.set({ role: 'gm', sessionId: creds.sessionId, joinCode: creds.joinCode, view: projectState(this.full, { role: 'gm' }), feed: [] });
    this.connect({ t: 'hello', v: PROTOCOL_VERSION, role: 'gm', sessionId: creds.sessionId, gmKey: creds.gmKey });
  }

  /**
   * GM: upload an image to the session's Assets API. Returns the served URL,
   * or null when the relay has no Assets API (callers fall back to inline/local URLs).
   */
  async uploadAsset(blob: Blob, contentType: string): Promise<string | null> {
    const c = this.gmCreds;
    if (!c) return null;
    const res = await fetch(`/api/sessions/${encodeURIComponent(c.sessionId)}/assets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.gmKey}`, 'Content-Type': contentType },
      body: blob,
    });
    if (res.status === 404 || res.status === 405) return null;
    if (!res.ok) {
      const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      throw new Error(msg ?? `Upload failed (${res.status}).`);
    }
    return ((await res.json()) as { url: string }).url;
  }

  /** GM: the authoritative actor record (projections drop extras like notes). */
  gmActor(id: string): Actor | null {
    return this.full?.actors[id] ?? null;
  }

  join(joinCode: string, name: string) {
    const code = joinCode.trim().toUpperCase();
    const saved = store.get<{ token: string; name: string }>(playerKey(code));
    this.set({ role: 'player', joinCode: code, feed: [] });
    this.connect({ t: 'hello', v: PROTOCOL_VERSION, role: 'player', joinCode: code, name: name.trim() || saved?.name || 'Player', ...(saved ? { playerToken: saved.token } : {}) });
  }

  leave() {
    this.hello = null;
    this.ws?.close();
    if (this.state.role === 'gm') store.del(GM_KEY);
    this.gmCreds = null;
    this.full = null;
    this.set({ status: 'idle', role: null, view: null, sessionId: null, joinCode: null, feed: [] });
  }

  private connect(hello: object) {
    this.hello = hello;
    this.ws?.close();
    this.set({ status: 'connecting' });
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify(hello));
    ws.onmessage = (ev) => this.onMessage(JSON.parse(String(ev.data)) as ServerMessage);
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.set({ status: 'offline' });
      // 4000-range codes are deliberate refusals (auth, replaced): don't hammer.
      if (this.hello && ev.code < 4000) {
        const delay = Math.min(10_000, 500 * 2 ** this.retry++);
        setTimeout(() => { if (this.hello && this.ws === ws) this.connect(this.hello); }, delay);
      }
    };
  }

  /** Send a table signal; rendered locally right away as 'me'. Cursor and measure updates are throttled. */
  signal(sig: Signal) {
    const now = Date.now();
    const final = sig.kind === 'ping' || (sig.kind === 'measure' && sig.to === null) || (sig.kind === 'cursor' && sig.at === null);
    const wait = 120 - (now - (this.lastSignalAt[sig.kind] ?? 0));
    this.applySignal('me', sig);
    const pending = this.trailing[sig.kind];
    if (!final && wait > 0) {
      // Throttled: keep only the newest and send it when the window ends.
      if (pending) pending.sig = sig;
      else this.trailing[sig.kind] = { sig, timer: window.setTimeout(() => this.flushSignal(sig.kind), wait) };
      return;
    }
    if (pending) { window.clearTimeout(pending.timer); delete this.trailing[sig.kind]; }
    this.lastSignalAt[sig.kind] = now;
    this.send({ t: 'signal', signal: sig });
  }

  private flushSignal(kind: string) {
    const p = this.trailing[kind];
    if (!p) return;
    delete this.trailing[kind];
    this.lastSignalAt[kind] = Date.now();
    this.send({ t: 'signal', signal: p.sig });
  }

  private applySignal(from: string, sig: Signal) {
    const now = Date.now();
    const s = this.state.signals;
    if (sig.kind === 'ping') {
      const pings = [...s.pings.filter((p) => now - p.t < PING_MS), { id: ++this.pingN, from, at: sig.at, t: now }].slice(-12);
      this.set({ signals: { ...s, pings } });
    } else if (sig.kind === 'measure') {
      const measures = { ...s.measures };
      if (sig.to) measures[from] = { from: sig.from, to: sig.to }; else delete measures[from];
      this.set({ signals: { ...s, measures } });
    } else if (sig.kind === 'cursor') {
      const cursors = { ...s.cursors };
      if (sig.at) cursors[from] = { at: sig.at, t: now }; else delete cursors[from];
      this.set({ signals: { ...s, cursors } });
    }
  }

  /** Display name for a signal source or chat author. */
  nameOf(from: string): string {
    if (from === 'me') return 'You';
    if (from === 'gm') return 'GM';
    if (from === this.state.playerId) return 'You';
    const p = this.state.players.find((x) => x.playerId === from);
    if (p) return p.name;
    const a = Object.values(this.state.view?.actors ?? {}).find((x) => x.controller === from);
    return a ? a.public.name : 'Player';
  }

  private send(m: object) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }

  private pushFeed(items: FeedItem[]) {
    const feed = [...this.state.feed, ...items.filter((i) => i.events.length)].slice(-150);
    this.set({ feed });
  }

  private onMessage(m: ServerMessage) {
    switch (m.t) {
      case 'welcome':
        this.retry = 0;
        if (m.role === 'gm') {
          this.set({ status: 'online', players: m.players });
          if (m.headSeq > 0) this.send({ t: 'fetchLog', fromSeq: 1 });
          else { this.full = emptySession(m.sessionId); this.log = []; this.refreshGmView(); }
        } else {
          store.set(playerKey(this.state.joinCode!), { token: m.playerToken, name: (this.hello as { name?: string })?.name ?? 'Player' });
          this.set({ status: 'online', sessionId: m.sessionId, playerId: m.playerId, view: m.view });
        }
        return;
      case 'log':
        this.log = m.entries;
        this.full = replay(this.state.sessionId!, m.entries);
        this.refreshGmView();
        this.set({ feed: m.entries.slice(-60).filter((e) => e.events.length).map((e) => ({ seq: e.seq, by: e.by, intentType: e.intent.type, events: e.events })) });
        return;
      case 'entries': {
        let v = this.state.view;
        try {
          for (const e of m.entries) v = applyProjectedEntry(v!, e);
        } catch {
          // Missed an entry: reconnecting gets a fresh snapshot.
          if (this.hello) this.connect(this.hello);
          return;
        }
        this.set({ view: v });
        this.pushFeed(m.entries.map((e) => ({ seq: e.seq, by: e.by, intentType: e.intentType, events: e.events })));
        return;
      }
      case 'snapshot':
        this.set({ view: m.view });
        return;
      case 'intent':
        this.runIntent(m.intent, { role: 'player', playerId: m.from }, m.clientMsgId);
        return;
      case 'rejected':
        this.toast(m.message);
        return;
      case 'playerJoined':
        this.set({ players: [...this.state.players.filter((p) => p.playerId !== m.player.playerId), m.player] });
        return;
      case 'playerLeft':
        this.set({ players: this.state.players.map((p) => (p.playerId === m.playerId ? { ...p, online: false } : p)) });
        return;
      case 'gmStatus':
        this.set({ gmOnline: m.online });
        return;
      case 'error':
        if (m.code === 'GAP') { this.send({ t: 'fetchLog', fromSeq: 1 }); return; }
        if (m.code === 'AUTH_FAILED' && this.state.role === 'gm') store.del(GM_KEY);
        this.toast(m.message);
        if (m.code === 'AUTH_FAILED' || m.code === 'LOCKED') { this.hello = null; this.set({ status: 'error' }); }
        return;
      case 'signal':
        this.applySignal(m.from, m.signal);
        return;
      case 'pong':
        return;
    }
  }

  private refreshGmView() {
    if (this.full) this.set({ view: projectState(this.full, { role: 'gm' }) });
  }

  /** GM device: run an intent through the authority. */
  private runIntent(intent: Intent, by: { role: 'gm' } | { role: 'player'; playerId: string }, clientMsgId?: string): boolean {
    if (!this.full) return false;
    const r = handleIntent(this.full, intent, by, { dice: this.dice });
    if (!r.ok) {
      if (by.role === 'player' && clientMsgId) this.send({ t: 'reject', playerId: by.playerId, clientMsgId, code: r.code, message: r.message });
      else this.toast(r.message);
      return false;
    }
    this.full = applyEntry(this.full, r.entry);
    this.log.push(r.entry);
    this.send({ t: 'append', entries: [r.entry] });
    this.refreshGmView();
    this.pushFeed([{ seq: r.entry.seq, by: r.entry.by, intentType: intent.type, events: r.entry.events }]);
    return true;
  }

  act(intent: Intent) {
    if (this.state.role === 'gm') return this.runIntent(intent, { role: 'gm' });
    this.send({ t: 'intent', clientMsgId: `m${++this.msgN}`, intent });
    return true;
  }

  /** GM: run a batch (e.g. the demo setup), stopping at the first refusal. */
  actAll(intents: Intent[]) {
    for (const i of intents) if (!this.act(i)) return false;
    return true;
  }

  /** GM: step back one log entry. */
  undo() {
    if (this.state.role !== 'gm' || !this.full || this.log.length === 0) return;
    this.log = this.log.slice(0, -1);
    this.full = replay(this.full.sessionId, this.log);
    this.send({ t: 'truncate', toSeq: this.log.length });
    this.refreshGmView();
    this.set({ feed: this.state.feed.filter((f) => f.seq <= this.log.length) });
  }
}

export const client = new Client();
