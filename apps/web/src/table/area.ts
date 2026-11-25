/**
 * Area-attack templates on the grid (display only; the authority decides).
 * Blast: 10 × 10 m/yds = 5 × 5 squares centered on the aim square; cover
 * between the blast center and a square protects it.
 * Shotgun shell: squares within 3 (6 m/yds) in a 90° cone toward the aim
 * square, in the shooter's line of sight. The 90° width is an interpretation.
 */
import {
  AUTOFIRE_DV, cellKey, gridDistance, hasLineOfSight, inBounds, inCone, isOpaque, metersBetween, profileOf, RANGE_BANDS, bearing,
  type Cell, type GridMap, type Weapon,
} from '@cprc/rules-core';
import type { ViewState } from '@cprc/session';
import { isFriendly } from '../tactics.js';

export const SHELL_RANGE_SQUARES = 3;
export const SHELL_ARC = 90;

export function blastCells(map: GridMap, center: Cell): { all: Cell[]; hit: Set<string> } {
  const all: Cell[] = [];
  const hit = new Set<string>();
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const c = { x: center.x + dx, y: center.y + dy };
    if (!inBounds(map, c)) continue;
    all.push(c);
    if (!isOpaque(map, c) && hasLineOfSight(map, center, c)) hit.add(cellKey(c));
  }
  return { all, hit };
}

export function shellCells(map: GridMap, from: Cell, toward: Cell): Set<string> {
  const out = new Set<string>();
  if (from.x === toward.x && from.y === toward.y) return out;
  const facing = bearing(from, toward);
  for (let dy = -SHELL_RANGE_SQUARES; dy <= SHELL_RANGE_SQUARES; dy++) for (let dx = -SHELL_RANGE_SQUARES; dx <= SHELL_RANGE_SQUARES; dx++) {
    const c = { x: from.x + dx, y: from.y + dy };
    if (!inBounds(map, c) || gridDistance(from, c) > SHELL_RANGE_SQUARES) continue;
    if (!isOpaque(map, c) && inCone(from, facing, SHELL_ARC, c) && hasLineOfSight(map, from, c)) out.add(cellKey(c));
  }
  return out;
}

export function tokensIn(tokens: Record<string, Cell>, cells: Set<string>, except?: string): string[] {
  return Object.entries(tokens).filter(([id, c]) => id !== except && cells.has(cellKey(c))).map(([id]) => id);
}

export type AreaKind = 'blast' | 'shell';

/** Which template a weapon can use, if any. */
export function areaKindFor(w: Weapon | undefined): AreaKind | null {
  if (!w) return null;
  if (w.type === 'grenadeLauncher' || w.type === 'rocketLauncher') return 'blast';
  if (w.type === 'shotgun') return 'shell';
  return null;
}

/** Farthest Autofire range in m/yds, or null if the weapon can't Autofire. */
export function autofireMaxMeters(w: Weapon): number | null {
  const af = profileOf(w).autofire;
  if (!af) return null;
  const row = AUTOFIRE_DV[af.row];
  let max: number | null = null;
  row.forEach((dv, i) => { if (dv != null) max = RANGE_BANDS[i]!; });
  return max;
}

/** Opposing tokens Suppressive Fire would affect: within Autofire range and in the shooter's sight. */
export function suppressiveTargets(view: ViewState, attackerId: string, w: Weapon): string[] {
  const map = view.map;
  const at = map?.tokens[attackerId];
  const me = view.actors[attackerId];
  const range = autofireMaxMeters(w);
  if (!map || !at || !me || range === null) return [];
  return Object.entries(map.tokens).filter(([id, c]) => {
    const a = view.actors[id];
    if (!a || id === attackerId || a.public.conditions.dead) return false;
    if (isFriendly(a) === isFriendly(me)) return false;
    return metersBetween(at, c) <= range && hasLineOfSight(map, at, c);
  }).map(([id]) => id);
}

export function canSuppress(w: Weapon | undefined): boolean {
  return !!w && autofireMaxMeters(w) !== null && (!w.ammo || w.ammo.loaded >= 10);
}
