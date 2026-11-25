/**
 * Wire protocol between clients and the relay (JSON over WebSocket).
 *
 *   GM:     hello(gm) → append(entries) / truncate / replaceLog / fetchLog / reject(to player)
 *   Player: hello(player) → intent
 *   Relay → GM:     welcome, intent (from a player), playerJoined/Left, log, error
 *   Relay → Player: welcome (with projected snapshot and the player directory), entries (projected),
 *                   snapshot, rejected, playerJoined/Left, error
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
  | { t: 'ping' };

export interface PlayerInfo { playerId: string; name: string; online: boolean }

export type ServerMessage =
  | { t: 'welcome'; role: 'gm'; sessionId: string; headSeq: number; players: PlayerInfo[] }
  | { t: 'welcome'; role: 'player'; sessionId: string; playerId: string; playerToken: string; view: ViewState; players: PlayerInfo[] }
  | { t: 'entries'; entries: ProjectedEntry[] }
  | { t: 'snapshot'; view: ViewState }
  | { t: 'log'; entries: LogEntry[] }
  | { t: 'intent'; from: string; clientMsgId: string; intent: Intent }
  | { t: 'rejected'; clientMsgId: string; code: string; message: string }
  | { t: 'playerJoined'; player: PlayerInfo }
  | { t: 'playerLeft'; playerId: string }
  | { t: 'gmStatus'; online: boolean }
  /** `from` = 'gm' or a playerId. */
  | { t: 'signal'; from: string; signal: Signal }
  | { t: 'error'; code: string; message: string }
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
    case 'ping':
      return { t: 'ping' };
    default:
      return null;
  }
}
