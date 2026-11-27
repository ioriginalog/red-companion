/**
 * Wire protocol between clients and the relay (JSON over WebSocket).
 *
 *   GM:     hello(gm) → append(entries) / truncate / replaceLog / fetchLog / reject(to player)
 *   Player: hello(player) → intent
 *   Relay → GM:     welcome, intent (from a player), playerJoined/Left, log, error
 *   Relay → Player: welcome (with projected snapshot, the player directory and recent history),
 *                   entries (projected), snapshot, rejected, queued, playerJoined/Left, gmStatus, error
 *   While the GM is offline the relay holds player intents (bounded) and hands
 *   them over, in order, once the GM is back and has fetched the log.
 */
import type { Cell } from '@cprc/rules-core';
import type { Intent, LogEntry, ProjectedEntry, ViewState } from './types.js';

/**
 * Ephemeral table signals: relayed to everyone in the session, never logged.
 * The relay rate-limits them (about 10 per second per connection).
 */
export type Signal =
  | { kind: 'ping'; at: Cell }
  | { kind: 'cursor'; at: Cell | null }
  | { kind: 'measure'; from: Cell; to: Cell | null };

export const PROTOCOL_VERSION = 1;

export type ClientMessage =
  | { t: 'hello'; v: number; role: 'gm'; sessionId: string; gmKey: string }
  | { t: 'hello'; v: number; role: 'player'; joinCode: string; name: string; playerToken?: string }
  | { t: 'append'; entries: LogEntry[] }
  | { t: 'truncate'; toSeq: number }
  | { t: 'replaceLog'; entries: LogEntry[] }
  | { t: 'fetchLog'; fromSeq: number }
  | { t: 'reject'; playerId: string; clientMsgId: string; code: string; message: string }
  | { t: 'intent'; clientMsgId: string; intent: Intent }
  | { t: 'signal'; signal: Signal }
  /** GM only: manage player identities (see RosterOp). */
  | { t: 'roster'; op: RosterOp }
  | { t: 'ping' };

/**
 * GM roster management (relay commands; the relay answers with a `players` broadcast or an error).
 *   rename:  change a player's display name (same rules as joining: 1–40 characters, not a GM name, not taken).
 *   remove:  forget the identity; its devices are disconnected and must join again as someone new.
 *   merge:   two identities are one person: `dropId`'s devices and tokens become `keepId`.
 *   reclaim: answer a seat request (a returning player on a new device asked for their old seat by name).
 * Character assignments live in the session log, so the GM client moves them with the
 * `reassignPlayer` intent alongside remove, merge and an approved reclaim.
 */
export type RosterOp =
  | { op: 'rename'; playerId: string; name: string }
  | { op: 'remove'; playerId: string }
  | { op: 'merge'; keepId: string; dropId: string }
  | { op: 'reclaim'; requestId: string; approve: boolean };

/** `lastSeen`: epoch ms the player was last connected (absent while online, or if never recorded). */
export interface PlayerInfo { playerId: string; name: string; online: boolean; lastSeen?: number }

/** A new device asking for an existing player's seat (by matching name). The GM approves or denies. */
export interface ReclaimRequest { requestId: string; playerId: string; seatId: string; name: string; at: number }

/** One past log entry as a player saw it (events only), for the welcome history. `by`/`intentType` are absent when its content is hidden. */
export interface HistoryItem { seq: number; by?: string; intentType?: string; events: ProjectedEntry['events'] }

export type ServerMessage =
  | { t: 'welcome'; role: 'gm'; sessionId: string; headSeq: number; players: PlayerInfo[]; reclaims?: ReclaimRequest[] }
  | {
    t: 'welcome'; role: 'player'; sessionId: string; playerId: string; playerToken: string; view: ViewState; players: PlayerInfo[]; history?: HistoryItem[];
    /** This player's intents the relay still holds for the GM. */
    queued?: string[];
    /** This player's recently held intents that were delivered to the GM or dropped with notice. Anything held that's in neither list was lost. */
    settled?: string[];
  }
  | { t: 'entries'; entries: ProjectedEntry[] }
  | { t: 'snapshot'; view: ViewState }
  /** The GM undid entries or replaced the log: the player's view and history, rebuilt up to `toSeq`. */
  | { t: 'rewind'; toSeq: number; view: ViewState; history: HistoryItem[] }
  | { t: 'log'; entries: LogEntry[] }
  | { t: 'intent'; from: string; clientMsgId: string; intent: Intent }
  | { t: 'rejected'; clientMsgId: string; code: string; message: string }
  /** A player intent is being held at the relay until the GM is back. */
  | { t: 'queued'; clientMsgId: string }
  /** A held intent will never reach the GM (expired, or lost). */
  | { t: 'queueDropped'; clientMsgId: string; reason: 'expired' | 'lost'; message: string }
  | { t: 'playerJoined'; player: PlayerInfo }
  /** The whole player directory, after a roster change (rename, remove, merge, reclaim). */
  | { t: 'players'; players: PlayerInfo[] }
  /** GM: a seat request to approve or deny. */
  | { t: 'reclaimRequest'; request: ReclaimRequest }
  /** GM: a seat request was answered or withdrawn. */
  | { t: 'reclaimClosed'; requestId: string }
  /** Player: the GM has been asked to give this device the seat named `seatName` (pending), or said no (denied). Approval arrives as a fresh welcome. */
  | { t: 'reclaim'; status: 'pending' | 'denied'; seatName: string }
  | { t: 'playerLeft'; playerId: string }
  | { t: 'gmStatus'; online: boolean }
  /** `from` = 'gm' or a playerId. */
  | { t: 'signal'; from: string; signal: Signal }
  /** `retryAfter` (seconds) accompanies LOCKED. */
  | { t: 'error'; code: string; message: string; retryAfter?: number }
  | { t: 'pong' };

const isCell = (x: unknown): x is Cell =>
  typeof x === 'object' && x !== null && Number.isInteger((x as Cell).x) && Number.isInteger((x as Cell).y)
  && (x as Cell).x >= 0 && (x as Cell).y >= 0 && (x as Cell).x < 10_000 && (x as Cell).y < 10_000;

/** Strict validation of an ephemeral signal; returns a clean copy (no extra fields) or null. */
export function parseSignal(x: unknown): Signal | null {
  if (typeof x !== 'object' || x === null) return null;
  const m = x as Record<string, unknown>;
  switch (m.kind) {
    case 'ping': return isCell(m.at) ? { kind: 'ping', at: { x: m.at.x, y: m.at.y } } : null;
    case 'cursor': return m.at === null ? { kind: 'cursor', at: null } : isCell(m.at) ? { kind: 'cursor', at: { x: m.at.x, y: m.at.y } } : null;
    case 'measure':
      if (!isCell(m.from) || !(m.to === null || isCell(m.to))) return null;
      return { kind: 'measure', from: { x: m.from.x, y: m.from.y }, to: m.to === null ? null : { x: (m.to as Cell).x, y: (m.to as Cell).y } };
    default: return null;
  }
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown, max = 200): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;

/**
 * Structural validation of untrusted input. Deep validation of entries is
 * done by applying them (the reducer rejects gaps); intents are validated by
 * the authority. This guards shape and size only.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  let m: unknown;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!isObj(m) || typeof m.t !== 'string') return null;
  switch (m.t) {
    case 'hello':
      if (m.v !== PROTOCOL_VERSION) return null;
      if (m.role === 'gm' && isStr(m.sessionId, 64) && isStr(m.gmKey, 128)) return m as ClientMessage;
      if (m.role === 'player' && isStr(m.joinCode, 16) && isStr(m.name, 40) && (m.playerToken === undefined || isStr(m.playerToken, 128))) return m as ClientMessage;
      return null;
    case 'append':
    case 'replaceLog':
      return Array.isArray(m.entries) && m.entries.every(isObj) ? (m as ClientMessage) : null;
    case 'truncate':
      return Number.isInteger(m.toSeq) && (m.toSeq as number) >= 0 ? (m as ClientMessage) : null;
    case 'fetchLog':
      return Number.isInteger(m.fromSeq) && (m.fromSeq as number) >= 1 ? (m as ClientMessage) : null;
    case 'reject':
      return isStr(m.playerId, 64) && isStr(m.clientMsgId, 64) && isStr(m.code, 40) && isStr(m.message, 500) ? (m as ClientMessage) : null;
    case 'intent':
      return isStr(m.clientMsgId, 64) && isObj(m.intent) && typeof m.intent.type === 'string' ? (m as ClientMessage) : null;
    case 'signal': {
      const signal = parseSignal(m.signal);
      return signal ? { t: 'signal', signal } : null;
    }
    case 'roster': {
      const op = isObj(m.op) ? m.op : null;
      if (!op) return null;
      if (op.op === 'rename' && isStr(op.playerId, 64) && typeof op.name === 'string' && op.name.length <= 80) return { t: 'roster', op: { op: 'rename', playerId: op.playerId, name: op.name } };
      if (op.op === 'remove' && isStr(op.playerId, 64)) return { t: 'roster', op: { op: 'remove', playerId: op.playerId } };
      if (op.op === 'merge' && isStr(op.keepId, 64) && isStr(op.dropId, 64)) return { t: 'roster', op: { op: 'merge', keepId: op.keepId, dropId: op.dropId } };
      if (op.op === 'reclaim' && isStr(op.requestId, 64) && typeof op.approve === 'boolean') return { t: 'roster', op: { op: 'reclaim', requestId: op.requestId, approve: op.approve } };
      return null;
    }
    case 'ping':
      return { t: 'ping' };
    default:
      return null;
  }
}

// ----- Player names ------------------------------------------------------------------

/** Look-alike characters folded before comparing names (digits and symbols used as letters, Cyrillic and Greek twins). */
const LOOKALIKE: Record<string, string> = {
  '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '6': 'g', '9': 'g', '7': 't', '8': 'b',
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'м': 'm', 'г': 'r', 'к': 'k', 'т': 't', 'н': 'h', 'х': 'x', 'ѕ': 's', 'і': 'i', 'ј': 'j',
  'α': 'a', 'ε': 'e', 'ο': 'o', 'ρ': 'p', 'μ': 'm', 'γ': 'y', 'κ': 'k', 'τ': 't', 'ν': 'v', 'ι': 'i',
};

const stripMarks = (name: string) => name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Latin words of a name, lowercased, accents stripped and look-alikes folded (for spotting GM names). */
function nameWords(name: string): string[] {
  return stripMarks(name).split('').map((ch) => LOOKALIKE[ch] ?? ch).join('').split(/[^a-z]+/).filter(Boolean);
}

/** Folded form used to compare names: case, accents, spacing and punctuation ignored. */
export function nameKey(name: string): string {
  return stripMarks(name).replace(/[^\p{L}\p{N}]+/gu, '');
}

const RESERVED = new Set([
  'gm', 'thegm', 'gamemaster', 'gamesmaster', 'thegamemaster', 'gamemistress', 'gamemaestro', 'gmaster', 'gamem', 'gmm',
  'dm', 'dungeonmaster', 'referee', 'admin', 'moderator', 'narrator', 'storyteller',
]);

/**
 * Names a player may not take, because chat would show them as the GM:
 * "GM", "G M", "g.m.", "GameMaster", "Game Master", "Bob (GM)", "GM Bob", "6M" and the like.
 */
export function isReservedName(name: string): boolean {
  const words = nameWords(name);
  const key = words.join('');
  if (!key) return false;
  if (RESERVED.has(key)) return true;
  // "GM" as a word anywhere ("GM Bob", "Bob [GM]"), or spelled out in single letters ("G M Bob").
  if (words.includes('gm') || words.some((w, i) => w === 'g' && words[i + 1] === 'm')) return true;
  return /game?s?(master|mistress)/.test(key);
}

/** A player name as entered: trimmed, inner whitespace collapsed. Returns an error message for a bad one. */
export function checkPlayerName(raw: string): { ok: true; name: string } | { ok: false; message: string } {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name || name.length > 40) return { ok: false, message: 'Names are 1–40 characters.' };
  if (!nameKey(name)) return { ok: false, message: 'Use at least one letter in your name.' };
  if (isReservedName(name)) return { ok: false, message: 'That name is reserved for the GM. Pick another name.' };
  return { ok: true, name };
}
