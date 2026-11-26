/**
 * Tactical-map helpers shared by the authority (GM device), the relay's
 * projection, and the clients. All pure.
 *
 * Vision: the party (PCs and 'ally' NPCs) shares one field of view, the
 * union of what each conscious friendly token can see. Hostile and neutral
 * tokens outside it are hidden from players; their names stay hidden until
 * the party has seen them once.
 */
import { cellKey, findPath, inCone, hasLineOfSight, gridDistance, visibleCells, type Cell } from '@cprc/rules-core';
import type { Actor, Allegiance, TacticalMap } from './types.js';

export type Faction = 'friendly' | 'hostile' | 'neutral';

export function allegianceOf(a: Actor): Allegiance {
  return a.allegiance ?? (a.combatant.side === 'pc' ? 'party' : 'hostile');
}

export function factionOf(a: Actor): Faction {
  const al = allegianceOf(a);
  return al === 'party' || al === 'ally' ? 'friendly' : al;
}

const canSee = (a: Actor) => !a.combatant.conditions.dead && !a.combatant.conditions.unconscious;

/**
 * Squares visible from `seers` (token squares), honoring the GM's lighting:
 * `revealAll` shows everything; `revealed` squares are always visible.
 * Pure; the web client uses it with its own idea of who can see.
 */
export function visionFor(map: TacticalMap, seers: Cell[]): Set<string> {
  const out = new Set<string>();
  if (map.lighting?.revealAll) {
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) out.add(`${x},${y}`);
    return out;
  }
  for (const at of seers) for (const k of visibleCells(map, at, map.sightRange)) out.add(k);
  for (const k of map.lighting?.revealed ?? []) out.add(k);
  return out;
}

/** Squares the party can see right now. */
export function partyVision(map: TacticalMap, actors: Record<string, Actor>): Set<string> {
  const seers = Object.entries(map.tokens)
    .filter(([id]) => { const a = actors[id]; return !!a && factionOf(a) === 'friendly' && canSee(a); })
    .map(([, at]) => at);
  return visionFor(map, seers);
}

/** Returns `map` itself when nothing new was spotted, so callers can skip a patch. */
export function withSpotted(map: TacticalMap, actors: Record<string, Actor>): TacticalMap {
  const vision = partyVision(map, actors);
  const known = new Set(map.spotted);
  const added = Object.entries(map.tokens)
    .filter(([id, at]) => {
      const a = actors[id];
      return a && factionOf(a) !== 'friendly' && !known.has(id) && vision.has(cellKey(at));
    })
    .map(([id]) => id);
  // --- Round 4 U4: exploration fog ---
  // Squares the party has ever seen, as a w×h string of '0'/'1' (compact enough to ride in every map patch).
  const explored = mergeExplored(map, vision);
  if (!added.length && explored === map.explored) return map;
  return { ...map, ...(added.length ? { spotted: [...map.spotted, ...added] } : {}), ...(explored !== undefined ? { explored } : {}) };
  // --- end Round 4 U4 ---
}

/** Adds `vision` to the map's explored bitmap; returns the same string when nothing new was seen. Round 4 U4. */
export function mergeExplored(map: TacticalMap, vision: Set<string>): string | undefined {
  const n = map.width * map.height;
  const prev = map.explored && map.explored.length === n ? map.explored : null;
  if (!prev && vision.size === 0) return map.explored;
  const out = (prev ?? '0'.repeat(n)).split('');
  let changed = !prev;
  for (const k of vision) {
    const [x, y] = k.split(',').map(Number);
    const i = y! * map.width + x!;
    if (i >= 0 && i < n && out[i] !== '1') { out[i] = '1'; changed = true; }
  }
  return changed ? out.join('') : prev!;
}

/** Movement blockers for `mover`: other factions block, own faction can be passed but not ended on. */
export function occupancy(map: TacticalMap, actors: Record<string, Actor>, moverId: string) {
  const mover = actors[moverId];
  const blocked = new Set<string>();
  const occupied = new Set<string>();
  for (const [id, at] of Object.entries(map.tokens)) {
    const a = actors[id];
    if (id === moverId || !a) continue;
    // Bodies don't block, but you can't stop on one.
    if (a.combatant.conditions.dead || (mover && factionOf(a) === factionOf(mover))) occupied.add(cellKey(at));
    else blocked.add(cellKey(at));
  }
  return { blocked, occupied };
}

export function planMove(map: TacticalMap, actors: Record<string, Actor>, moverId: string, to: Cell, budget: number) {
  const from = map.tokens[moverId];
  if (!from) return null;
  return findPath(map, from, to, budget, occupancy(map, actors, moverId));
}

/** First opposing watch the path walks into, if any. */
export function watchTrigger(map: TacticalMap, actors: Record<string, Actor>, moverId: string, path: Cell[]): { watcherId: string; at: Cell } | null {
  const mover = actors[moverId];
  if (!mover) return null;
  for (const at of path) {
    for (const [watcherId, w] of Object.entries(map.watches)) {
      const watcher = actors[watcherId];
      const apex = map.tokens[watcherId];
      if (!watcher || !apex || !canSee(watcher)) continue;
      const fw = factionOf(watcher);
      if (fw === 'neutral' || fw === factionOf(mover)) continue;
      if (gridDistance(apex, at) <= w.range && inCone(apex, w.facing, w.arc, at) && hasLineOfSight(map, apex, at)) return { watcherId, at };
    }
  }
  return null;
}

/** Player-facing copy of the map: hidden tokens and enemy watches removed. */
export function projectMap(map: TacticalMap, actors: Record<string, Actor>): TacticalMap {
  const vision = partyVision(map, actors);
  const tokens: Record<string, Cell> = {};
  for (const [id, at] of Object.entries(map.tokens)) {
    const a = actors[id];
    if (!a) continue;
    if (factionOf(a) === 'friendly' || vision.has(cellKey(at))) tokens[id] = at;
  }
  const watches = Object.fromEntries(Object.entries(map.watches).filter(([id]) => {
    const a = actors[id];
    return a && factionOf(a) === 'friendly';
  }));
  return { ...map, tokens, watches };
}
