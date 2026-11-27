/**
 * GM player management: the roster rows and the checks behind Rename, Merge
 * and Remove. Pure; the Players card (RosterCard.tsx) draws it.
 *
 * The relay does the work. `playerAdmin` finds the client's player-management
 * shows the roster with the controls off.
 */
import type { PlayerInfo, ProjectedActor } from '@cprc/session';

/** What the Players card needs from the client. Wire to net.ts's player-management calls. */
export interface PlayerAdmin {
  removePlayer(playerId: string): void;
  renamePlayer(playerId: string, name: string): void;
  /** Move `fromId`'s characters and seat to `intoId`, then remove `fromId`. */
  mergePlayers(fromId: string, intoId: string): void;
}

/** Feature-detect the calls on the client (method names as planned for net.ts). */
export function playerAdmin(client: unknown): PlayerAdmin | null {
  const c = client as Partial<Record<keyof PlayerAdmin, unknown>> | null;
  if (!c || typeof c.removePlayer !== 'function' || typeof c.renamePlayer !== 'function' || typeof c.mergePlayers !== 'function') return null;
  return {
    removePlayer: (id) => (c.removePlayer as PlayerAdmin['removePlayer']).call(client, id),
    renamePlayer: (id, name) => (c.renamePlayer as PlayerAdmin['renamePlayer']).call(client, id, name),
    // net.ts takes (keepId, dropId): the seat merged *into* is kept, the one merged *from* is dropped.
    mergePlayers: (from, into) => (c.mergePlayers as (keepId: string, dropId: string) => void).call(client, into, from),
  };
}

export interface RosterRow {
  playerId: string;
  name: string;
  online: boolean;
  /** Names of the characters this player controls. */
  characters: string[];
  /** Offline and playing nobody: a likely duplicate seat from a rejoin under another name. */
  idle: boolean;
}

export function rosterRows(players: readonly PlayerInfo[], actors: Record<string, ProjectedActor>): RosterRow[] {
  const rows = players.map((p) => {
    const characters = Object.values(actors).filter((a) => a.controller === p.playerId && !a.placeholder).map((a) => a.public.name).sort();
    return { playerId: p.playerId, name: p.name, online: p.online, characters, idle: !p.online && characters.length === 0 };
  });
  // Online first, then by name.
  return rows.sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
}

/** Names nobody may take: the GM's own label and look-alikes (the relay has the final say). */
const RESERVED = /^(the)?(gm|gamemaster)\d*$/i;

/** Problem with a new player name, or null. */
export function renameProblem(name: string, playerId: string, players: readonly PlayerInfo[]): string | null {
  const n = name.trim().replace(/\s+/g, ' ');
  if (!n) return 'Enter a name.';
  if (n.length > 32) return 'Keep it to 32 characters.';
  if (RESERVED.test(n.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, ''))) return 'That name is reserved for the GM.';
  if (players.some((p) => p.playerId !== playerId && p.name.trim().toLowerCase() === n.toLowerCase())) return 'Another player already has that name.';
  return null;
}

/** Players `fromId` can be merged into (everyone else). */
export function mergeTargets(rows: readonly RosterRow[], fromId: string): RosterRow[] {
  return rows.filter((r) => r.playerId !== fromId);
}

/** Confirmation copy for Remove. */
export function removeWarning(row: RosterRow): string {
  return row.characters.length
    ? `Remove ${row.name}? ${row.characters.join(', ')} go${row.characters.length === 1 ? 'es' : ''} back to the GM, and ${row.name} would join as a new player.`
    : `Remove ${row.name}? They would join as a new player.`;
}
