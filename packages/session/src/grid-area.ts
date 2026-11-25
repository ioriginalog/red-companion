/**
 * Area attacks on the grid: Shotgun Shells, launchers, thrown grenades and
 * Suppressive Fire. rules-core resolves the dice; this module decides who is
 * in the area from the map.
 *
 * Rulings (see docs/rules-verification.md):
 *   - Explosive blast = 10 × 10 m/yds = 5 × 5 squares centered on the target square.
 *     A token is caught if it's in the blast and has line of sight to the center
 *     square; anything opaque in between is cover that protects (the map has no
 *     cover HP, so cover is treated as surviving the blast). Interpretation.
 *   - Shotgun Shells hit every token within 3 squares (6 m/yds) in a 90° cone
 *     toward the aimed square, with line of sight from the shooter. Interpretation.
 *   - Everyone in an area who can dodge (REF 8+) does: dodging an area attack has
 *     no downside in the engine. Interpretation.
 *   - Suppressive Fire covers opposing tokens within 25 m/yds (12 squares) and the
 *     weapon's Autofire range, in the shooter's line of sight.
 *   - A missed explosive scatters: the GM places it (Core gives no scatter table).
 */
import {
  applyAreaDamage, AUTOFIRE_DV, bearing, canDodgeRanged, gridDistance, hasLineOfSight, inBounds, inCone, isPassable, metersBetween,
  profileOf, RANGE_BANDS, resolveAreaAttack, resolveSuppressiveFire, spendAmmo,
  type AreaKind, type Cell, type CombatEvent, type Dice,
} from '@cprc/rules-core';
import { checkAttackAction, getActor, getWeapon, requireMap, SessionError } from './helpers.js';
import { factionOf } from './tactical.js';
import type { Actor, Intent, SessionState, StatePatch, Viewer } from './types.js';

type Result = { events: CombatEvent[]; patch: StatePatch };
type AreaIntent = Extract<Intent, { type: 'areaAttack' }>;

export const BLAST_RADIUS = 2; // squares from the center: 5 × 5
export const SHELL_RANGE = 3; // squares (6 m/yds)
export const SHELL_ARC = 90; // degrees
export const SUPPRESS_RANGE = 12; // squares (25 m/yds, rounded down)
const DEFAULT_GRENADE_DICE = 6;

const able = (a: Actor | undefined) => !!a && !a.combatant.conditions.dead;

/** Tokens caught by an explosive centered on `at`. */
export function blastTargets(state: SessionState, at: Cell): string[] {
  const map = requireMap(state);
  return Object.entries(map.tokens)
    .filter(([id, c]) => able(state.actors[id]) && Math.abs(c.x - at.x) <= BLAST_RADIUS && Math.abs(c.y - at.y) <= BLAST_RADIUS && hasLineOfSight(map, at, c))
    .map(([id]) => id);
}

/** Tokens caught by a Shotgun Shell fired from `from` toward `at`. */
export function shellTargets(state: SessionState, attackerId: string, at: Cell): string[] {
  const map = requireMap(state);
  const from = map.tokens[attackerId]!;
  const facing = bearing(from, at);
  return Object.entries(map.tokens)
    .filter(([id, c]) => id !== attackerId && able(state.actors[id]) && gridDistance(from, c) <= SHELL_RANGE
      && inCone(from, facing, SHELL_ARC, c) && hasLineOfSight(map, from, c))
    .map(([id]) => id);
}

/** Opposing tokens Suppressive Fire would affect. */
export function suppressTargets(state: SessionState, attackerId: string): string[] {
  const map = requireMap(state);
  const attacker = getActor(state, attackerId);
  const from = map.tokens[attackerId];
  if (!from) return [];
  const mine = factionOf(attacker);
  const weapon = attacker.weapons.find((w) => profileOf(w).autofire);
  const row = weapon ? profileOf(weapon).autofire?.row : undefined;
  let lastBand = -1;
  if (row) AUTOFIRE_DV[row].forEach((dv, i) => { if (dv != null) lastBand = i; });
  const maxSquares = Math.min(SUPPRESS_RANGE, lastBand < 0 ? 0 : Math.floor(RANGE_BANDS[lastBand]! / 2));
  return Object.entries(map.tokens)
    .filter(([id, c]) => {
      const a = state.actors[id];
      if (id === attackerId || !a || a.combatant.conditions.dead || a.combatant.conditions.unconscious) return false;
      const f = factionOf(a);
      const opposing = mine === 'neutral' ? f !== 'neutral' : f !== mine && f !== 'neutral';
      return opposing && gridDistance(from, c) <= maxSquares && hasLineOfSight(map, from, c);
    })
    .map(([id]) => id);
}

export function doAreaAttack(state: SessionState, intent: AreaIntent, by: Viewer, dice: Dice): Result {
  const map = requireMap(state);
  const attacker = getActor(state, intent.attackerId);
  const weapon = getWeapon(attacker, intent.weaponId);
  const from = map.tokens[attacker.id];
  if (!from) throw new SessionError('INVALID', `${attacker.combatant.name} isn’t on the map.`);
  const at = intent.at;
  if (!at || !inBounds(map, at) || !isPassable(map, at)) throw new SessionError('INVALID', 'Aim at an open square.');
  if (!hasLineOfSight(map, from, at)) throw new SessionError('NO_LINE_OF_SIGHT', 'That square is out of sight.');
  const distance = Math.max(1, metersBetween(from, at));

  let area: AreaKind;
  if (intent.kind === 'shotgunShell') area = { kind: 'shotgunShell', weapon };
  else if (intent.kind === 'launcher') area = { kind: 'launcher', weapon, distance };
  else if (intent.kind === 'thrownGrenade') {
    if (weapon.ammo && weapon.ammo.loaded < 1) throw new SessionError('INVALID', `No ${weapon.name} left.`);
    area = { kind: 'thrownGrenade', distance, damageDice: weapon.damageDiceOverride ?? DEFAULT_GRENADE_DICE };
  } else throw new SessionError('INVALID', 'Unknown area attack.');

  // Full Action. Checked before any die is rolled; RulesErrors also come first.
  const encounter = checkAttackAction(state, by, attacker, weapon.id, 1);
  const out = resolveAreaAttack(attacker.combatant, area, dice);
  const spent = intent.kind === 'thrownGrenade' ? (weapon.ammo ? 1 : 0) : out.ammoSpent;

  const label = intent.kind === 'shotgunShell' ? 'Shotgun Shell' : intent.kind === 'launcher' ? `${weapon.name} Blast` : 'Thrown Grenade';
  const events: CombatEvent[] = [
    { type: 'checkRolled', visibility: 'public', by: attacker.controller, combatantId: attacker.id, label, check: out.attack, dv: out.dv, success: out.hit },
  ];
  if (spent) events.push({ type: 'ammoSpent', visibility: 'public', combatantId: attacker.id, weaponId: weapon.id, rounds: spent });

  const actors: Record<string, Actor> = { [attacker.id]: { ...attacker, weapons: attacker.weapons.map((w) => (w.id === weapon.id ? spendAmmo(w, spent) : w)) } };
  let targetIds: string[] = [];
  if (out.scattered) {
    events.push({ type: 'gmRulingRequired', visibility: 'public', reason: 'The explosive missed and scatters. The GM places it within the blast area around the target square.' });
  } else if (out.hit) {
    targetIds = intent.kind === 'shotgunShell' ? shellTargets(state, attacker.id, at) : blastTargets(state, at);
    const targets = targetIds.map((id) => {
      const c = id === attacker.id ? actors[id]!.combatant : getActor(state, id).combatant;
      return { combatant: c, dodges: canDodgeRanged(c) };
    });
    const { roll, results } = applyAreaDamage(out, targets, dice);
    events.push({ type: 'damageRolled', visibility: 'public', dice: roll.dice, multiplier: roll.multiplier, total: roll.total, critTriggered: roll.critTriggered });
    for (const r of results) {
      const base = actors[r.targetId] ?? getActor(state, r.targetId);
      if (r.dodge) {
        events.push({ type: 'checkRolled', visibility: 'public', by: base.controller, combatantId: r.targetId, label: 'Dodge', check: r.dodge, dv: out.attack.total, success: r.avoided });
      }
      events.push(...r.events);
      actors[r.targetId] = { ...base, combatant: r.target };
    }
  }
  events.push({ type: 'areaResolved', visibility: 'public', attackerId: attacker.id, kind: intent.kind, at, targetIds });
  const patch: StatePatch = { actors };
  if (encounter) patch.encounter = encounter;
  return { events, patch };
}

export function doSuppressiveFire(state: SessionState, intent: Extract<Intent, { type: 'suppressiveFire' }>, by: Viewer, dice: Dice): Result {
  requireMap(state);
  const attacker = getActor(state, intent.attackerId);
  const weapon = getWeapon(attacker, intent.weaponId);
  if (!state.map!.tokens[attacker.id]) throw new SessionError('INVALID', `${attacker.combatant.name} isn’t on the map.`);
  if (!profileOf(weapon).autofire) throw new SessionError('INVALID', `${weapon.name} can’t lay down Suppressive Fire.`);
  const targetIds = suppressTargets({ ...state, actors: { ...state.actors, [attacker.id]: { ...attacker, weapons: [weapon] } } }, attacker.id);
  if (!targetIds.length) throw new SessionError('INVALID', 'No one opposing is in the line of fire within 25 m/yds.');
  const encounter = checkAttackAction(state, by, attacker, weapon.id, 1);
  const out = resolveSuppressiveFire(attacker.combatant, weapon, targetIds.map((id) => getActor(state, id).combatant), dice);
  const patch: StatePatch = { actors: { [attacker.id]: { ...attacker, weapons: attacker.weapons.map((w) => (w.id === weapon.id ? spendAmmo(w, out.ammoSpent) : w)) } } };
  if (encounter) patch.encounter = encounter;
  return { events: out.events, patch };
}
