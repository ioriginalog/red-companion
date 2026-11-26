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
  type Actor, type HistoryItem, type Intent, type LogEntry, type PlayerInfo, type ServerMessage, type SessionState, type Signal, type ViewState,
} from '@cprc/session';
import { cacheKey, idbKV, restoreFromCache, type GmCache, type KV } from './persist.js';

export interface FeedItem { seq: number; by: string; intentType: string; events: CombatEvent[] }

/** Ephemeral table signals (never logged). `from` = 'me', 'gm' or a player id. */
export interface Ping { id: number; from: string; at: Cell; t: number }
export interface Signals {
  pings: Ping[];
  measures: Record<string, { from: Cell; to: Cell }>;
  cursors: Record<string, { at: Cell; t: number }>;
}
export const PING_MS = 2600;
/**
 * Feed items kept in memory (and handed to the log panel). The GM rebuilds
 * the feed from the whole log on reload and players get their recent history
 * in the welcome; renderers should window long feeds rather than draw them all.
 */
export const FEED_CAP = 1000;

const toFeed = (e: { seq: number; by: string; intentType: string; events: CombatEvent[] }): FeedItem =>
  ({ seq: e.seq, by: e.by, intentType: e.intentType, events: e.events });

/** Feed items from the GM's full log (events only, newest FEED_CAP). */
export function feedFromLog(log: LogEntry[]): FeedItem[] {
  return log.filter((e) => e.events.length).slice(-FEED_CAP).map((e) => toFeed({ ...e, intentType: e.intent.type }));
}
/** Feed items from a player's welcome history. */
export function feedFromHistory(history: HistoryItem[] | undefined): FeedItem[] {
  return (history ?? []).filter((h) => h.events.length).slice(-FEED_CAP).map(toFeed);
}

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
  /** GM: entries made while disconnected, waiting to reach the relay. */
  unsynced: number;
  /** Player intents held at the relay until the GM returns. */
  queued: number;
  /** Epoch ms when a hello lockout lifts (the client retries then). */
  lockedUntil: number | null;
  /** The session menu (GM key, backup, export, leave) is open. */
  sessionMenu: boolean;
}

export interface GmCreds { sessionId: string; gmKey: string; joinCode: string }
/** A GM session saved on this device. */
export interface SavedGm extends GmCreds { name?: string; lastUsed: number }
/** Legacy single-slot key (migrated into GM_SESSIONS on first read). */
const GM_KEY = 'nsc.gm';
const GM_SESSIONS = 'nsc.gmSessions';
const LAST_JOIN = 'nsc.lastJoin';
const playerKey = (code: string) => `nsc.player.${code}`;

/**
 * GM offline reconciliation: given the relay's log and the GM's local log,
 * decide what to do. `append` = local entries the relay is missing (the relay
 * is a prefix of local); `adopt` = the relay diverged or moved ahead, so its
 * log wins and `dropped` local entries are lost.
 */
export function reconcileLogs(relay: LogEntry[], local: LogEntry[]):
  | { kind: 'append'; tail: LogEntry[] }
  | { kind: 'adopt'; dropped: number } {
  const isPrefix = relay.length <= local.length && relay.every((e, i) => e.id === local[i]!.id);
  if (isPrefix) return { kind: 'append', tail: local.slice(relay.length) };
  const shared = local.findIndex((e, i) => relay[i]?.id !== e.id);
  return { kind: 'adopt', dropped: shared === -1 ? 0 : local.length - shared };
}

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
    signals: { pings: [], measures: {}, cursors: {} }, unsynced: 0, queued: 0, lockedUntil: null, sessionMenu: false,
  };
  /** GM log cache (IndexedDB, localStorage fallback). Replaceable for tests. */
  kv: KV = idbKV();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private queuedIds = new Set<string>();
  /** GM: number of local log entries the relay is known to hold. */
  private synced = 0;
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
  /** Latest state; a GM view marked stale is rebuilt here, once, however many entries arrived. */
  getState = () => {
    if (this.viewDirty && this.full) {
      this.viewDirty = false;
      this.state = { ...this.state, view: projectState(this.full, { role: 'gm' }) };
    }
    return this.state;
  };
  private viewDirty = false;
  private notifyScheduled = false;
  /**
   * State changes apply at once, but listeners (React) hear about them at most
   * once per frame. A burst of entries (a player flooding chat, a long log
   * replay) used to re-render per message and trip React's update-depth limit.
   */
  private set(patch: Partial<ClientState>) {
    this.state = { ...this.state, ...patch };
    this.scheduleNotify();
  }
  private scheduleNotify() {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      this.notifyScheduled = false;
      for (const l of this.listeners) l();
    };
    // rAF pauses in background tabs; the timer keeps a hidden GM tab current.
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    setTimeout(run, 50);
  }
  toast(text: string) { this.set({ toast: { text, at: Date.now() } }); }

  /** GM sessions saved on this device, most recent first (migrates the old single slot). */
  savedGmSessions(): SavedGm[] {
    const list = store.get<SavedGm[]>(GM_SESSIONS) ?? [];
    const legacy = store.get<GmCreds>(GM_KEY);
    if (legacy && !list.some((x) => x.sessionId === legacy.sessionId)) {
      list.push({ ...legacy, lastUsed: 0 });
      store.set(GM_SESSIONS, list);
    }
    if (legacy) store.del(GM_KEY);
    return [...list].sort((a, b) => b.lastUsed - a.lastUsed);
  }
  /** The most recently used GM session, if any. */
  savedGm(): SavedGm | null { return this.savedGmSessions()[0] ?? null; }
  private rememberGm(creds: GmCreds) {
    const list = this.savedGmSessions().filter((x) => x.sessionId !== creds.sessionId);
    const prev = this.savedGmSessions().find((x) => x.sessionId === creds.sessionId);
    store.set(GM_SESSIONS, [{ ...prev, ...creds, lastUsed: Date.now() }, ...list]);
  }
  /** Remove a GM session (key and cached log) from this device. The session itself lives on at the relay. */
  forgetGm(sessionId: string) {
    store.set(GM_SESSIONS, this.savedGmSessions().filter((x) => x.sessionId !== sessionId));
    void this.kv.del(cacheKey(sessionId)).catch(() => {});
    this.set({});
  }
  /** The open session's GM credentials (for Show GM Key / backup). */
  currentGm(): GmCreds | null { return this.gmCreds; }
  /** GM backup file contents: everything needed to resume this session on another device. */
  gmBackup(): string | null {
    const c = this.gmCreds;
    if (!c) return null;
    return JSON.stringify({ format: 'nsc-gm-backup', version: 1, sessionId: c.sessionId, gmKey: c.gmKey, joinCode: c.joinCode, savedAt: new Date().toISOString() }, null, 2);
  }
  /** GM: download the session export (meta without secrets, full log) from the relay. */
  async exportSession(): Promise<Blob | null> {
    const c = this.gmCreds;
    if (!c) return null;
    const res = await fetch(`/api/sessions/${encodeURIComponent(c.sessionId)}/export`, { headers: { Authorization: `Bearer ${c.gmKey}` } });
    if (!res.ok) { this.toast('Couldn’t export the session. Try again when you’re online.'); return null; }
    return res.blob();
  }
  openSessionMenu() { this.set({ sessionMenu: true }); }
  closeSessionMenu() { this.set({ sessionMenu: false }); }

  async createSession() {
    this.set({ status: 'connecting' });
    const res = await fetch('/api/sessions', { method: 'POST' });
    if (!res.ok) { this.set({ status: 'error' }); this.toast((await res.json().catch(() => ({}))).error ?? 'Could not create a session.'); return; }
    const creds = (await res.json()) as GmCreds;
    this.rememberGm(creds);
    void this.resumeGm(creds);
  }

  /**
   * GM: open a session. Restores this device's cached log first (it may hold
   * actions made offline before the tab closed); the welcome then reconciles
   * it with the relay.
   */
  async resumeGm(creds: GmCreds) {
    this.gmCreds = creds;
    this.rememberGm(creds);
    this.full = emptySession(creds.sessionId);
    this.log = [];
    this.synced = 0;
    this.set({ role: 'gm', sessionId: creds.sessionId, joinCode: creds.joinCode, view: projectState(this.full, { role: 'gm' }), feed: [], lockedUntil: null });
    const cached = restoreFromCache(await this.kv.get(cacheKey(creds.sessionId)).catch(() => null), creds.sessionId);
    if (cached && this.gmCreds === creds) {
      this.log = cached.log;
      this.full = cached.state;
      this.synced = cached.synced;
      this.set({ view: projectState(this.full, { role: 'gm' }), feed: feedFromLog(this.log), unsynced: this.log.length - this.synced });
    }
    if (this.gmCreds !== creds) return; // left or switched while loading
    this.connect({ t: 'hello', v: PROTOCOL_VERSION, role: 'gm', sessionId: creds.sessionId, gmKey: creds.gmKey });
  }

  /** GM: save the log to this device soon (debounced). */
  private scheduleSave() {
    if (this.state.role !== 'gm' || !this.full) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.state.role !== 'gm' || !this.full) return;
      const cache: GmCache = { sessionId: this.full.sessionId, log: this.log, synced: this.synced, savedAt: Date.now() };
      void this.kv.set(cacheKey(this.full.sessionId), cache).catch(() => {});
    }, 400);
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

  /**
   * On page load: rejoin as a player without the form. An invite link's code
   * wins if this device has already joined it; otherwise the last session.
   */
  autoResume(linkCode?: string | null): boolean {
    if (this.state.role) return false;
    const link = linkCode?.trim().toUpperCase();
    const code = link ? link : store.get<{ code: string }>(LAST_JOIN)?.code;
    if (!code || !store.get(playerKey(code))) return false;
    this.join(code, '');
    return true;
  }

  /**
   * GM: open a file from Import. A GM backup (from Download GM Backup) resumes
   * that session on this device; a session export becomes a new session
   * (fresh key and join code).
   */
  async importSession(file: Blob) {
    let parsed: unknown = null;
    try { parsed = JSON.parse(await file.text()); } catch { this.toast('That file isn’t a session export or a GM backup.'); return; }
    const b = parsed as Partial<GmCreds> & { format?: string };
    if (b && b.format === 'nsc-gm-backup') {
      if (typeof b.sessionId !== 'string' || typeof b.gmKey !== 'string' || typeof b.joinCode !== 'string') { this.toast('That GM backup is incomplete.'); return; }
      void this.resumeGm({ sessionId: b.sessionId, gmKey: b.gmKey, joinCode: b.joinCode });
      return;
    }
    this.set({ status: 'connecting' });
    const res = await fetch('/api/sessions/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) });
    if (!res.ok) {
      this.set({ status: 'idle' });
      this.toast(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Could not import that session.');
      return;
    }
    const creds = (await res.json()) as GmCreds;
    this.rememberGm(creds);
    void this.resumeGm(creds);
    this.toast('Session imported. Players rejoin with the new join code; reassign their characters in the roster.');
  }

  join(joinCode: string, name: string) {
    const code = joinCode.trim().toUpperCase();
    const saved = store.get<{ token: string; name: string }>(playerKey(code));
    this.set({ role: 'player', joinCode: code, feed: [], lockedUntil: null });
    this.connect({ t: 'hello', v: PROTOCOL_VERSION, role: 'player', joinCode: code, name: name.trim() || saved?.name || 'Player', ...(saved ? { playerToken: saved.token } : {}) });
  }

  /**
   * Leave the table. The GM key (and cached log) stay on this device unless
   * `forget` is set; players keep their token, so they can rejoin as themselves.
   */
  leave(opts: { forget?: boolean } = {}) {
    this.hello = null;
    this.ws?.close();
    if (this.state.role === 'gm') {
      if (opts.forget && this.gmCreds) this.forgetGm(this.gmCreds.sessionId);
    } else {
      store.del(LAST_JOIN);
      if (opts.forget && this.state.joinCode) store.del(playerKey(this.state.joinCode));
    }
    this.gmCreds = null;
    this.full = null;
    this.viewDirty = false;
    this.queuedIds.clear();
    this.set({ status: 'idle', role: null, view: null, sessionId: null, joinCode: null, feed: [], queued: 0, lockedUntil: null, sessionMenu: false });
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
      // While we're cut off we can't vouch for anyone's presence.
      this.set({ status: 'offline', gmOnline: false, players: this.state.players.map((p) => ({ ...p, online: false })) });
      if (this.state.role === 'gm' && ev.code < 4000) this.toast('Offline: Actions Will Sync');
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

  private get online() { return this.ws?.readyState === WebSocket.OPEN && this.state.status === 'online'; }
  private send(m: object): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(m));
    return true;
  }

  private pushFeed(items: FeedItem[]) {
    const feed = [...this.state.feed, ...items.filter((i) => i.events.length)].slice(-FEED_CAP);
    this.set({ feed });
  }

  private onMessage(m: ServerMessage) {
    switch (m.t) {
      case 'welcome':
        this.retry = 0;
        if (m.role === 'gm') {
          this.set({ status: 'online', players: m.players, lockedUntil: null });
          // Always reconcile against the relay's log: it may be missing entries
          // made while we were offline, or (another device) be ahead of us.
          if (m.headSeq > 0 || this.log.length > 0) this.send({ t: 'fetchLog', fromSeq: 1 });
          else { this.full = emptySession(m.sessionId); this.log = []; this.synced = 0; this.refreshGmView(); }
        } else {
          const prev = store.get<{ token: string; name: string }>(playerKey(this.state.joinCode!));
          store.set(playerKey(this.state.joinCode!), { token: m.playerToken, name: (this.hello as { name?: string })?.name || prev?.name || 'Player' });
          store.set(LAST_JOIN, { code: this.state.joinCode });
          // Reconnects reuse this.hello: carry the token so the relay restores this
          // player instead of creating a new, unassigned one.
          if (this.hello) this.hello = { ...this.hello, playerToken: m.playerToken };
          this.queuedIds.clear();
          this.set({ status: 'online', sessionId: m.sessionId, playerId: m.playerId, view: m.view, players: m.players ?? [], feed: feedFromHistory(m.history), queued: 0, lockedUntil: null });
        }
        return;
      case 'log': {
        const r = reconcileLogs(m.entries, this.log);
        if (r.kind === 'append' && this.log.length > 0) {
          this.synced = m.entries.length;
          if (r.tail.length) {
            // Stay under the relay's frame limit.
            for (let i = 0; i < r.tail.length; i += 25) this.send({ t: 'append', entries: r.tail.slice(i, i + 25) });
            this.synced = this.log.length;
            this.toast(`Back online. Synced ${r.tail.length} offline ${r.tail.length === 1 ? 'action' : 'actions'}.`);
          }
          this.set({ unsynced: 0 });
          this.scheduleSave();
          return;
        }
        if (r.kind === 'adopt' && r.dropped > 0) {
          this.toast(`Couldn’t sync ${r.dropped} offline ${r.dropped === 1 ? 'action' : 'actions'}: the session changed elsewhere. They were discarded.`);
        }
        this.log = m.entries;
        this.synced = m.entries.length;
        this.full = replay(this.state.sessionId!, m.entries);
        this.refreshGmView();
        this.set({ unsynced: 0, feed: feedFromLog(m.entries) });
        this.scheduleSave();
        return;
      }
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
      case 'rewind':
        // The GM undid entries: take the rebuilt view and history, so undone lines vanish.
        this.set({ view: m.view, feed: feedFromHistory(m.history) });
        return;
      case 'intent':
        this.runIntent(m.intent, { role: 'player', playerId: m.from }, m.clientMsgId);
        return;
      case 'rejected':
        if (this.queuedIds.delete(m.clientMsgId)) this.set({ queued: this.queuedIds.size });
        this.toast(m.message);
        return;
      case 'queued':
        this.queuedIds.add(m.clientMsgId);
        this.set({ queued: this.queuedIds.size });
        this.toast('Queued: Will Send When the GM Returns');
        return;
      case 'playerJoined': {
        const known = this.state.players.some((p) => p.playerId === m.player.playerId);
        this.set({ players: known ? this.state.players.map((p) => (p.playerId === m.player.playerId ? m.player : p)) : [...this.state.players, m.player] });
        return;
      }
      case 'playerLeft':
        this.set({ players: this.state.players.map((p) => (p.playerId === m.playerId ? { ...p, online: false } : p)) });
        return;
      case 'gmStatus':
        // Once the GM is back, held intents are delivered (or refused) by the relay.
        if (m.online) this.queuedIds.clear();
        this.set({ gmOnline: m.online, ...(m.online ? { queued: 0 } : {}) });
        return;
      case 'error':
        if (m.code === 'GAP') { this.send({ t: 'fetchLog', fromSeq: 1 }); return; }
        if (m.code === 'LOCKED') {
          // Keep the saved join and token: a lockout is temporary. Retry when it lifts.
          const secs = Math.max(1, m.retryAfter ?? 30);
          const hello = this.hello;
          this.set({ status: 'error', lockedUntil: Date.now() + secs * 1000 });
          this.toast(m.message);
          setTimeout(() => {
            if (hello && this.hello === hello) { this.set({ lockedUntil: null }); this.connect(hello); }
          }, secs * 1000 + 250);
          return;
        }
        if (m.code === 'TOO_MANY') {
          // Too many sockets from this network at once: back off and retry.
          const hello = this.hello;
          setTimeout(() => { if (hello && this.hello === hello) this.connect(hello); }, 3000);
          return;
        }
        // A refused GM key is kept (Forget removes it): the relay may be restoring data.
        this.toast(m.message);
        if (m.code === 'AUTH_FAILED') {
          this.hello = null;
          // A stale auto-resume shouldn't leave the player stuck on a dead session.
          if (this.state.role === 'player') { store.del(LAST_JOIN); this.set({ status: 'error', role: null, view: null }); }
          else this.set({ status: 'error' });
        }
        return;
      case 'signal':
        this.applySignal(m.from, m.signal);
        return;
      case 'pong':
        return;
    }
  }

  /** GM: mark the projected view stale; it's rebuilt lazily by getState (once per batch). */
  private refreshGmView() {
    if (!this.full) return;
    this.viewDirty = true;
    this.scheduleNotify();
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
    // In order, never past a gap: while offline (or with older entries still
    // unsent) the entry waits; the next welcome reconciles and flushes it.
    if (this.online && this.synced === this.log.length - 1 && this.send({ t: 'append', entries: [r.entry] })) this.synced = this.log.length;
    else this.set({ unsynced: this.log.length - this.synced });
    this.refreshGmView();
    this.pushFeed([{ seq: r.entry.seq, by: r.entry.by, intentType: intent.type, events: r.entry.events }]);
    this.scheduleSave();
    return true;
  }

  act(intent: Intent) {
    if (this.state.role === 'gm') {
      const ok = this.runIntent(intent, { role: 'gm' });
      if (ok && this.state.unsynced > 0) this.toast('Offline: Actions Will Sync');
      return ok;
    }
    if (!this.online || !this.send({ t: 'intent', clientMsgId: `m${++this.msgN}`, intent })) {
      this.toast('You’re offline. Reconnecting; try again in a moment.');
      return false;
    }
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
    if (!this.online || this.state.unsynced > 0) { this.toast('Undo needs a connection. Wait for the table to sync.'); return; }
    this.log = this.log.slice(0, -1);
    this.synced = this.log.length;
    this.full = replay(this.full.sessionId, this.log);
    this.send({ t: 'truncate', toSeq: this.log.length });
    this.refreshGmView();
    this.scheduleSave();
    this.set({ feed: this.state.feed.filter((f) => f.seq <= this.log.length) });
  }
}

export const client = new Client();
