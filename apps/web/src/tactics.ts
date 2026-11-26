/**
 * Client-side tactical math on the viewer's projection: vision, movement
 * rings and the chance-to-hit readout. Display only. The GM device's
 * authority re-checks everything when the intent arrives.
 */
import {
  AUTOFIRE_DV, RANGE_DV, rangeBandIndex,
  attacksPerAction, cellKey, effectiveStat, gridDistance, hasLineOfSight, inCone, metersBetween, previewRangedAttack,
  profileOf, reachableCells, RulesError, skillLevel, standingModifiers, visibleCells, AIMED_SHOT_PENALTY,
  type AimTarget, type Cell, type Combatant, type Modifier, type Weapon, WEAPON_TYPES,
} from '@cprc/rules-core';
import {
  extrasGate, extrasPenalties, SessionError, visionFor,
  type Intent, type ProjectedActor, type SessionState, type TacticalMap, type ViewState, type Watch,
} from '@cprc/session';
import { chanceToBeat, chanceToWinContest } from './odds.js';

export const isFriendly = (a?: ProjectedActor) => !!a && (a.public.allegiance === 'party' || a.public.allegiance === 'ally');
export const canSeeActor = (a: ProjectedActor) => !a.public.conditions.dead && !a.public.conditions.unconscious;

/** What the party sees: shared sight of conscious friendly tokens, plus GM lighting overrides (same rule as the relay). */
export function partyVision(view: ViewState): Set<string> {
  const map = view.map;
  if (!map) return new Set();
  const seers = Object.entries(map.tokens)
    .filter(([id]) => { const a = view.actors[id]; return !!a && isFriendly(a) && canSeeActor(a); })
    .map(([, at]) => at);
  return visionFor(map, seers);
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
  // Grapple and Facedown rules: the very functions the authority runs, so the preview can't drift.
  const extra = extrasPreview(view, attackerId, targetId, w, melee);
  if (typeof extra === 'string') return { ok: false, reason: extra, distanceM };
  if (melee) {
    if (gridDistance(from, to) > 1) return { ok: false, reason: 'Melee needs an adjacent square.', distanceM };
    if (mode === 'autofire') return { ok: false, reason: 'Melee can’t Autofire.', distanceM };
    const skill = w === 'brawling' ? 'Brawling' : 'Melee Weapon';
    const base = effectiveStat(a.combatant, 'DEX') + skillLevel(a.combatant, skill);
    const modifiers = [...standingModifiers(a.combatant, 'meleeAttack'), ...(aim ? [{ label: 'Aimed Shot', value: AIMED_SHOT_PENALTY }] : []), ...extra];
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
    const pv0 = previewRangedAttack({ attacker: a.combatant, defender, weapon: w, distance: distanceM, mode: mode === 'autofire' ? 'autofire' : 'single', aimTarget: aim });
    const pv = { ...pv0, modifiers: [...pv0.modifiers, ...extra] };
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

/**
 * Grapple/Facedown effects on an attack, using the session's own extrasGate and
 * extrasPenalties on the viewer's projection: a reason string if the attack is
 * forbidden, else the extra modifiers the authority will add.
 */
export function extrasPreview(view: ViewState, attackerId: string, targetId: string, w: Weapon | 'brawling', melee: boolean): Modifier[] | string {
  if (!view.extras) return [];
  const asState = { extras: view.extras, actors: view.actors } as unknown as SessionState;
  const intent: Intent = melee
    ? { type: 'meleeAttack', attackerId, defenderId: targetId, with: w === 'brawling' ? { kind: 'brawling' } : { kind: 'weapon', weaponId: w.id } }
    : { type: 'rangedAttack', attackerId, defenderId: targetId, weaponId: (w as Weapon).id, distance: 1 };
  try {
    extrasGate(asState, intent);
  } catch (e) {
    if (e instanceof SessionError) return e.message;
    throw e;
  }
  return extrasPenalties(asState, attackerId, targetId);
}

/** Cone polygon (SVG points) from apex toward bearing, in pixel space. */
export function wedgePath(cx: number, cy: number, facingDeg: number, arcDeg: number, radius: number): string {
  const a0 = ((facingDeg - arcDeg / 2) * Math.PI) / 180;
  const a1 = ((facingDeg + arcDeg / 2) * Math.PI) / 180;
  const x0 = cx + radius * Math.cos(a0), y0 = cy + radius * Math.sin(a0);
  const x1 = cx + radius * Math.cos(a1), y1 = cy + radius * Math.sin(a1);
  return `M${cx},${cy} L${x0},${y0} A${radius},${radius} 0 ${arcDeg > 180 ? 1 : 0} 1 ${x1},${y1} Z`;
}

/** Nearest opposing token this actor can actually shoot (own line of sight), for the quick-target button. */
export function nearestTarget(view: ViewState, actorId: string): string | null {
  const map = view.map;
  const me = view.actors[actorId];
  const at = map?.tokens[actorId];
  if (!map || !me || !at) return null;
  let best: string | null = null;
  let bestD = Infinity;
  for (const [id, c] of Object.entries(map.tokens)) {
    const a = view.actors[id];
    if (!a || id === actorId || a.public.conditions.dead || isFriendly(a) === isFriendly(me)) continue;
    const d = gridDistance(at, c);
    if (d < bestD && hasLineOfSight(map, at, c)) { best = id; bestD = d; }
  }
  return best;
}


// ----- Dodge prompt context -------------------------------------------------------

export interface DodgeContext {
  distanceM: number;
  /** Exact range DV when the attacker's weapon is visible; otherwise the span across weapon types at this range (no guess). */
  dv: { exact: number } | { min: number; max: number } | null;
  /** The attacker's weapon type is known to this viewer. */
  weaponKnown: boolean;
  /** Defender's DEX + Evasion (+ standing modifiers), from their own sheet. */
  dodgeBase: number | null;
  /** Chance the dodge total is at least the DV, or (weapon unknown) at least the span's low and high ends. */
  dodgeBeatsDv: { exact: number } | { atMin: number; atMax: number } | null;
}

/**
 * For the defender's prompt: what they face if they take the DV, and how
 * their dodge compares. Uses only what this viewer can see.
 */
export function dodgeContext(view: ViewState, attack: { attackerId: string; defenderId: string; weaponId: string; distance: number; mode?: 'single' | 'autofire'; weaponType?: Weapon['type'] }): DodgeContext {
  const band = rangeBandIndex(attack.distance);
  const auto = attack.mode === 'autofire';
  // The defender can see the gun pointed at them: use the attacker's sheet when visible,
  // else a weapon type the projection shares (if it does).
  const own = view.actors[attack.attackerId]?.weapons?.find((w) => w.id === attack.weaponId);
  const weapon: Weapon | undefined = own ?? (attack.weaponType && attack.weaponType in WEAPON_TYPES ? { id: attack.weaponId, name: '', type: attack.weaponType } : undefined);
  let dv: DodgeContext['dv'] = null;
  if (band >= 0) {
    if (weapon) {
      const p = profileOf(weapon);
      const v = auto ? (p.autofire ? AUTOFIRE_DV[p.autofire.row][band] : null) : p.rangeRow ? RANGE_DV[p.rangeRow][band] : null;
      if (v != null) dv = { exact: v };
    } else {
      const rows = auto ? Object.values(AUTOFIRE_DV) : Object.values(RANGE_DV);
      const vals = rows.map((r) => r[band]).filter((v): v is number => v != null);
      vals.sort((a, b) => a - b);
      if (vals.length) dv = { min: vals[0]!, max: vals[vals.length - 1]! };
    }
  }
  const d = view.actors[attack.defenderId]?.combatant;
  const dodgeBase = d
    ? effectiveStat(d, 'DEX') + skillLevel(d, 'Evasion') + standingModifiers(d, 'other').reduce((s, m) => s + m.value, 0)
    : null;
  // "At least the DV": the dodge total replaces the DV, so matching it is as good as the DV.
  const atLeast = (v: number) => (dodgeBase === null ? 0 : chanceToBeat(dodgeBase, v - 1));
  const dodgeBeatsDv = dodgeBase === null || !dv ? null : 'exact' in dv ? { exact: atLeast(dv.exact) } : { atMin: atLeast(dv.min), atMax: atLeast(dv.max) };
  return { distanceM: attack.distance, dv, dodgeBase, dodgeBeatsDv, weaponKnown: !!weapon };
}
