/**
 * Client-side tactical math on the viewer's projection: vision, movement
 * rings and the chance-to-hit readout. Display only. The GM device's
 * authority re-checks everything when the intent arrives.
 */
import {
  attacksPerAction, cellKey, effectiveStat, gridDistance, hasLineOfSight, inCone, metersBetween, previewRangedAttack,
  profileOf, reachableCells, RulesError, skillLevel, standingModifiers, visibleCells, AIMED_SHOT_PENALTY,
  type AimTarget, type Cell, type Combatant, type Modifier, type Weapon,
} from '@cprc/rules-core';
import type { ProjectedActor, TacticalMap, ViewState, Watch } from '@cprc/session';
import { chanceToBeat, chanceToWinContest } from './odds.js';

export const isFriendly = (a?: ProjectedActor) => !!a && (a.public.allegiance === 'party' || a.public.allegiance === 'ally');
const canSee = (a: ProjectedActor) => !a.public.conditions.dead && !a.public.conditions.unconscious;

export function partyVision(view: ViewState): Set<string> {
  const out = new Set<string>();
  const map = view.map;
  if (!map) return out;
  for (const [id, at] of Object.entries(map.tokens)) {
    const a = view.actors[id];
    if (!a || !isFriendly(a) || !canSee(a)) continue;
    for (const k of visibleCells(map, at, map.sightRange)) out.add(k);
  }
  return out;
}

export function occupancy(view: ViewState, moverId: string) {
  const map = view.map!;
  const mover = view.actors[moverId];
  const blocked = new Set<string>();
  const occupied = new Set<string>();
  for (const [id, at] of Object.entries(map.tokens)) {
    const a = view.actors[id];
    if (id === moverId || !a) continue;
    const same = mover && (isFriendly(a) === isFriendly(mover)) && a.public.allegiance !== 'neutral';
    if (a.public.conditions.dead || same) occupied.add(cellKey(at));
    else blocked.add(cellKey(at));
  }
  return { blocked, occupied };
}

export interface MoveRings { move: Map<string, number>; run: Map<string, number>; moveLeft: number; canRun: boolean }

/** Squares reachable this Turn (cyan) and with a Run (yellow). Null when free movement applies. */
export function moveRings(view: ViewState, actorId: string): MoveRings | null {
  const map = view.map;
  const a = view.actors[actorId];
  const at = map?.tokens[actorId];
  if (!map || !a?.combatant || !at) return null;
  const enc = view.encounter;
  if (!enc.active || enc.order[enc.turnIndex] !== actorId) return null;
  const u = enc.usage?.actorId === actorId ? enc.usage : { moveUsed: 0, actionUsed: false, ran: false };
  const move = effectiveStat(a.combatant, 'MOVE');
  const occ = occupancy(view, actorId);
  const cap = u.ran ? 2 * move : move;
  const moveLeft = Math.max(0, cap - u.moveUsed);
  const near = reachableCells(map, at, moveLeft, occ);
  const canRun = !u.actionUsed && !u.ran;
  const far = canRun ? reachableCells(map, at, 2 * move - u.moveUsed, occ) : new Map<string, number>();
  for (const k of near.keys()) far.delete(k);
  near.delete(cellKey(at));
  return { move: near, run: far, moveLeft, canRun };
}

/** Squares a watch would trigger on: in the cone, in range, in sight. */
export function watchCells(map: TacticalMap, apex: Cell, w: Watch): Set<string> {
  const out = new Set<string>();
  for (const k of visibleCells(map, apex, w.range)) {
    const [x, y] = k.split(',').map(Number);
    if (inCone(apex, w.facing, w.arc, { x: x!, y: y! })) out.add(k);
  }
  return out;
}

export type AttackMode = 'single' | 'autofire' | 'aimHead' | 'aimLeg' | 'aimHeld';
export const aimOf = (m: AttackMode): AimTarget | undefined =>
  m === 'aimHead' ? 'head' : m === 'aimLeg' ? 'leg' : m === 'aimHeld' ? 'heldItem' : undefined;

export type Attack =
  | {
    ok: true; melee: boolean; distanceM: number; base: number; modifiers: Modifier[]; baseLabel: string; skill: string;
    dv: number | null; chance: number | null; dodgeChance: number | null; perAction: number; ammo: number;
  }
  | { ok: false; reason: string; distanceM: number | null };

/** Stand-in for a defender whose sheet the viewer can't see: no dodge, no evasion shown. */
const UNKNOWN: Combatant = {
  id: '?', name: '?', side: 'npc', stats: { INT: 0, REF: 0, DEX: 0, TECH: 0, COOL: 0, WILL: 0, LUCK: 0, MOVE: 0, BODY: 0, EMP: 0 },
  skills: {}, hp: { max: 1, current: 1 }, armor: [], criticalInjuries: [], deathSave: { accumulatedPenalty: 0 },
  conditions: { prone: false, unconscious: false, dead: false, stabilized: false },
};

export function previewAttack(view: ViewState, attackerId: string, targetId: string, w: Weapon | 'brawling', mode: AttackMode): Attack {
  const map = view.map;
  const a = view.actors[attackerId];
  const d = view.actors[targetId];
  if (!a?.combatant || !d) return { ok: false, reason: 'Pick a target.', distanceM: null };
  const from = map?.tokens[attackerId];
  const to = map?.tokens[targetId];
  if (!map || !from || !to) return { ok: false, reason: 'Both need to be on the map.', distanceM: null };
  const distanceM = Math.max(1, metersBetween(from, to));
  if (!hasLineOfSight(map, from, to)) return { ok: false, reason: 'No line of sight. The target is behind cover.', distanceM };
  const defender = d.combatant ?? UNKNOWN;
  const aim = aimOf(mode);
  const melee = w === 'brawling' || profileOf(w).melee;
  if (melee) {
    if (gridDistance(from, to) > 1) return { ok: false, reason: 'Melee needs an adjacent square.', distanceM };
    if (mode === 'autofire') return { ok: false, reason: 'Melee can’t Autofire.', distanceM };
    const skill = w === 'brawling' ? 'Brawling' : 'Melee Weapon';
    const base = effectiveStat(a.combatant, 'DEX') + skillLevel(a.combatant, skill);
    const modifiers = [...standingModifiers(a.combatant, 'meleeAttack'), ...(aim ? [{ label: 'Aimed Shot', value: AIMED_SHOT_PENALTY }] : [])];
    const total = base + modifiers.reduce((s, m) => s + m.value, 0);
    const evade = d.combatant
      ? effectiveStat(d.combatant, 'DEX') + skillLevel(d.combatant, 'Evasion') + standingModifiers(d.combatant, 'other').reduce((s, m) => s + m.value, 0)
      : null;
    return {
      ok: true, melee: true, distanceM, base, modifiers, baseLabel: 'DEX', skill, dv: null,
      chance: evade === null ? null : chanceToWinContest(total, evade), dodgeChance: null,
      perAction: attacksPerAction(w === 'brawling' ? 'brawling' : w, { aimed: !!aim }), ammo: 0,
    };
  }
  try {
    const pv = previewRangedAttack({ attacker: a.combatant, defender, weapon: w, distance: distanceM, mode: mode === 'autofire' ? 'autofire' : 'single', aimTarget: aim });
    const total = pv.base + pv.modifiers.reduce((s, m) => s + m.value, 0);
    return {
      ok: true, melee: false, distanceM, base: pv.base, modifiers: pv.modifiers, baseLabel: 'REF',
      skill: mode === 'autofire' ? 'Autofire' : profileOf(w).skill, dv: pv.dv,
      chance: chanceToBeat(total, pv.dv),
      dodgeChance: pv.dodgeBase === null ? null : chanceToWinContest(total, pv.dodgeBase),
      perAction: attacksPerAction(w, { aimed: !!aim, autofire: mode === 'autofire' }), ammo: pv.ammo,
    };
  } catch (e) {
    if (e instanceof RulesError) return { ok: false, reason: e.message, distanceM };
    throw e;
  }
}

/** Cone polygon (SVG points) from apex toward bearing, in pixel space. */
export function wedgePath(cx: number, cy: number, facingDeg: number, arcDeg: number, radius: number): string {
  const a0 = ((facingDeg - arcDeg / 2) * Math.PI) / 180;
  const a1 = ((facingDeg + arcDeg / 2) * Math.PI) / 180;
  const x0 = cx + radius * Math.cos(a0), y0 = cy + radius * Math.sin(a0);
  const x1 = cx + radius * Math.cos(a1), y1 = cy + radius * Math.sin(a1);
  return `M${cx},${cy} L${x0},${y0} A${radius},${radius} 0 ${arcDeg > 180 ? 1 : 0} 1 ${x1},${y1} Z`;
}
