/**
 * Area attacks on the grid: Shotgun Shells, launchers, thrown grenades and
 * Suppressive Fire. rules-core resolves the dice; this module decides who is
 * in the area from the map.
 *
 * Rulings (see docs/rules-verification.md):
 *   - Explosive blast = 10 × 10 m/yds = 5 × 5 squares centered on the target square
 *     (which may be a cover square). A token in the blast is shielded by a wall; behind
 *     cover it's protected only if that cover survives the blast (the toughest intact
 *     cover on the line counts). Every cover square the blast reaches takes its damage,
 *     and destroyed cover becomes open ground. Interpretation.
 *   - Shotgun Shells hit every token within 3 squares (6 m/yds) in a 90° cone
 *     toward the aimed square, with line of sight from the shooter. Interpretation.
 *   - Everyone caught who can dodge (REF 8+) chooses whether to, before damage is
 *     rolled (an `awaitingAreaDodge` step). The GM can resolve the rest as "dodge".
 *   - Suppressive Fire covers opposing tokens within 25 m/yds (12 squares) and the
 *     weapon's Autofire range, in the shooter's line of sight.
 *   - A missed explosive scatters: the GM places it (Core gives no scatter table).
 */
import {
  applyAreaDamage, AUTOFIRE_DV, bearing, gridDistance, hasLineOfSight, inBounds, inCone, metersBetween,
  profileOf, RANGE_BANDS, raySteps, resolveAreaAttack, resolveSuppressiveFire, spendAmmo, terrainAt,
  type AreaKind, type Cell, type CombatEvent, type Dice,
} from '@cprc/rules-core';
import { checkAttackAction, getActor, getWeapon, requireMap, SessionError } from './helpers.js';
import { coverBetween, damageCoverSquare, setAreaFinisher, startAreaDodge } from './systems.js';
import { factionOf, withSpotted } from './tactical.js';
import type { Actor, Intent, Pending, SessionState, StatePatch, TacticalMap, Viewer } from './types.js';

type Result = { events: CombatEvent[]; patch: StatePatch };
type AreaIntent = Extract<Intent, { type: 'areaAttack' }>;

export const BLAST_RADIUS = 2; // squares from the center: 5 × 5
export const SHELL_RANGE = 3; // squares (6 m/yds)
export const SHELL_ARC = 90; // degrees
export const SUPPRESS_RANGE = 12; // squares (25 m/yds, rounded down)
const DEFAULT_GRENADE_DICE = 6;

const able = (a: Actor | undefined) => !!a && !a.combatant.conditions.dead;

/** Tokens caught by an explosive centered on `at`, with the cover HP protecting each (if any). */
export function blastTargetsWithCover(state: SessionState, at: Cell): { id: string; coverHp?: number }[] {
  const map = requireMap(state);
  const out: { id: string; coverHp?: number }[] = [];
  for (const [id, c] of Object.entries(map.tokens)) {
    if (!able(state.actors[id]) || Math.abs(c.x - at.x) > BLAST_RADIUS || Math.abs(c.y - at.y) > BLAST_RADIUS) continue;
    const cover = coverBetween(map, at, c, raySteps);
    if (cover === 'wall') continue;
    out.push(cover === undefined ? { id } : { id, coverHp: cover });
  }
  return out;
}

/** Tokens caught by an explosive centered on `at` (ignoring whether cover survives). */
export function blastTargets(state: SessionState, at: Cell): string[] {
  return blastTargetsWithCover(state, at).map((t) => t.id);
}

/** Cover squares the blast reaches: in the 5 × 5 area with line of sight from the center. */
export function blastCoverSquares(map: TacticalMap, at: Cell): Cell[] {
  const out: Cell[] = [];
  for (let y = at.y - BLAST_RADIUS; y <= at.y + BLAST_RADIUS; y++) {
    for (let x = at.x - BLAST_RADIUS; x <= at.x + BLAST_RADIUS; x++) {
      const c = { x, y };
      if (inBounds(map, c) && terrainAt(map, c) === 'c' && hasLineOfSight(map, at, c)) out.push(c);
    }
  }
  return out;
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

export function doAreaAttack(state: SessionState, intent: AreaIntent, by: Viewer, dice: Dice, newId: () => string = () => globalThis.crypto.randomUUID()): Result {
  const map = requireMap(state);
  const attacker = getActor(state, intent.attackerId);
  const weapon = getWeapon(attacker, intent.weaponId);
  const from = map.tokens[attacker.id];
  if (!from) throw new SessionError('INVALID', `${attacker.combatant.name} isn’t on the map.`);
  const at = intent.at;
  if (!at || !Number.isInteger(at.x) || !Number.isInteger(at.y) || !inBounds(map, at) || terrainAt(map, at) === '#') {
    throw new SessionError('INVALID', 'Aim at an open or cover square.');
  }
  if (!hasLineOfSight(map, from, at)) throw new SessionError('NO_LINE_OF_SIGHT', 'That square is out of sight.');
  const distance = Math.max(1, metersBetween(from, at));

  // Round 3 D: a Thrown Grenade weapon is always thrown (DEX + Athletics), whatever kind the client sent.
  const kind: AreaIntent['kind'] = weapon.type === 'grenade' ? 'thrownGrenade' : intent.kind;
  if (weapon.type === 'grenade' && intent.kind === 'shotgunShell') throw new SessionError('INVALID', `${weapon.name} is thrown, not fired as a shell.`);
  let area: AreaKind;
  if (kind === 'shotgunShell') area = { kind: 'shotgunShell', weapon };
  else if (kind === 'launcher') area = { kind: 'launcher', weapon, distance };
  else if (kind === 'thrownGrenade') {
    if (weapon.ammo && weapon.ammo.loaded < 1) throw new SessionError('INVALID', `No ${weapon.name} left.`);
    area = { kind: 'thrownGrenade', distance, damageDice: weapon.damageDiceOverride ?? DEFAULT_GRENADE_DICE };
  } else throw new SessionError('INVALID', 'Unknown area attack.');

  // Full Action. Checked before any die is rolled; RulesErrors also come first.
  const encounter = checkAttackAction(state, by, attacker, weapon.id, 1);
  const out = resolveAreaAttack(attacker.combatant, area, dice);
  const spent = kind === 'thrownGrenade' ? (weapon.ammo ? 1 : 0) : out.ammoSpent;

  const label = kind === 'shotgunShell' ? 'Shotgun Shell' : kind === 'launcher' ? `${weapon.name} Blast` : weapon.type === 'grenade' ? weapon.name : 'Thrown Grenade';
  const events: CombatEvent[] = [
    { type: 'checkRolled', visibility: 'public', by: attacker.controller, combatantId: attacker.id, label, check: out.attack, dv: out.dv, success: out.hit },
  ];
  if (spent) events.push({ type: 'ammoSpent', visibility: 'public', combatantId: attacker.id, weaponId: weapon.id, rounds: spent });

  const actors: Record<string, Actor> = { [attacker.id]: { ...attacker, weapons: attacker.weapons.map((w) => (w.id === weapon.id ? spendAmmo(w, spent) : w)) } };
  const patch: StatePatch = { actors };
  if (encounter) patch.encounter = encounter;
  if (out.scattered) {
    events.push({ type: 'gmRulingRequired', visibility: 'public', reason: 'The explosive missed and scatters. The GM places it within the blast area around the target square.' });
    events.push({ type: 'areaResolved', visibility: 'public', attackerId: attacker.id, kind, at, targetIds: [] });
    return { events, patch };
  }
  if (!out.hit) {
    events.push({ type: 'areaResolved', visibility: 'public', attackerId: attacker.id, kind, at, targetIds: [] });
    return { events, patch };
  }
  const targets = kind === 'shotgunShell' ? shellTargets(state, attacker.id, at).map((id) => ({ id })) : blastTargetsWithCover(state, at);
  const base: Omit<AreaPendingT, 'kind' | 'decisions'> = {
    id: newId(), attackerId: attacker.id, areaKind: kind, at, attack: out.attack, damageDice: out.damageDice, source: out.source, targets,
  };
  const afterAttack: SessionState = { ...state, actors: { ...state.actors, ...actors } };
  const ask = startAreaDodge(base, afterAttack);
  if (ask) {
    events.push(...ask.events);
    return { events, patch: { ...patch, pending: ask.pending } };
  }
  const done = finishArea(afterAttack, { ...base, kind: 'awaitingAreaDodge', decisions: {} }, dice);
  return { events: [...events, ...done.events], patch: { ...patch, ...done.patch, actors: { ...actors, ...done.patch.actors } } };
}

type AreaPendingT = Extract<Pending, { kind: 'awaitingAreaDodge' }>;

/** Roll the area damage once and apply it: dodges as decided, cover as computed, cover squares damaged. */
export function finishArea(state: SessionState, p: AreaPendingT, dice: Dice): { events: CombatEvent[]; patch: StatePatch } {
  const events: CombatEvent[] = [];
  const actors: Record<string, Actor> = {};
  const live = p.targets.filter((t) => able(state.actors[t.id]));
  const { roll, results } = applyAreaDamage(
    { attack: p.attack, damageDice: p.damageDice, source: p.source },
    live.map((t) => ({ combatant: state.actors[t.id]!.combatant, dodges: p.decisions[t.id] === true, ...(t.coverHp !== undefined ? { coverHp: t.coverHp } : {}) })),
    dice,
  );
  events.push({ type: 'damageRolled', visibility: 'public', dice: roll.dice, multiplier: roll.multiplier, total: roll.total, critTriggered: roll.critTriggered });
  for (const r of results) {
    const base = state.actors[r.targetId]!;
    if (r.dodge) {
      events.push({ type: 'checkRolled', visibility: 'public', by: base.controller, combatantId: r.targetId, label: 'Dodge', check: r.dodge, dv: p.attack.total, success: r.avoided });
    }
    events.push(...r.events);
    actors[r.targetId] = { ...base, combatant: r.target };
  }
  const patch: StatePatch = { actors, pending: null };
  if (p.source === 'explosive' && state.map) {
    let map = state.map;
    for (const c of blastCoverSquares(map, p.at)) {
      const d = damageCoverSquare(map, c, roll.total);
      map = d.map;
      events.push(d.event);
    }
    if (map !== state.map) patch.map = withSpotted(map, { ...state.actors, ...actors });
  }
  events.push({ type: 'areaResolved', visibility: 'public', attackerId: p.attackerId, kind: p.areaKind, at: p.at, targetIds: live.map((t) => t.id) });
  return { events, patch };
}

setAreaFinisher(finishArea);

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
