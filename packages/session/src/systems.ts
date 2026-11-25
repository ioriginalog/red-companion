/**
 * Track K systems: cyberware and Humanity, Role Abilities, healing and
 * treatment, cover with HP, ammunition, On Fire, and the area-dodge decision.
 *
 * Every intent here validates its own payload (types, whole numbers, bounds)
 * before touching state; the authority delegates to `authorizeSystems` and
 * `executeSystems`.
 */
import {
  AMMO_TYPES, ammoProblem, applySystems, attacksPerAction, awarenessProblem, beats, cellKey, coverMaterial, COVER_MATERIALS,
  cyberwareProblem, DEFAULT_COVER_MATERIAL, effectiveStat, empFromHumanity, gridDistance, hasLineOfSight, inBounds, makeCheck,
  metersBetween, naturalHealing, profileOf, RANGE_DV, rangeBandIndex, rollDamage, skillLevel, spendAmmo, standingModifiers,
  terrainAt, THERAPY, THERAPY_DICE, treatInjury, treatmentDv, wieldProblem, woundState,
  type Cell, type CombatEvent, type Combatant, type CoverMaterialId, type Dice, type Weapon,
} from '@cprc/rules-core';
import {
  checkAttackAction, checkOtherAction, controls, currentActorId, getActor, getWeapon, requireMap, SessionError, visibilityFor,
} from './helpers.js';
import { factionOf, projectMap, withSpotted } from './tactical.js';
import type { Actor, Encounter, Intent, IntentType, Pending, SessionState, StatePatch, TacticalMap, Viewer } from './types.js';

type Result = { events: CombatEvent[]; patch: StatePatch };
type SystemsIntent = Extract<Intent, { type: (typeof SYSTEMS_INTENTS)[number] }>;
type AreaPending = Extract<Pending, { kind: 'awaitingAreaDodge' }>;
type DamagePending = Extract<Pending, { kind: 'awaitingDamage' }>;

export const SYSTEMS_INTENTS = [
  'respondAreaDodge', 'resolveAreaDodges', 'attackCover', 'setCover', 'setAmmoType', 'extinguish', 'setAwareness',
  'installCyberware', 'removeCyberware', 'therapy', 'treatInjury', 'rest',
] as const;
const ALL: ReadonlySet<string> = new Set(SYSTEMS_INTENTS);
export const SYSTEMS_GM_ONLY: ReadonlySet<IntentType> = new Set(['resolveAreaDodges', 'setCover', 'installCyberware', 'removeCyberware', 'therapy', 'rest']);
/** Allowed while a dodge/damage/watch step is pending: the area-dodge answers and GM bookkeeping. */
export const SYSTEMS_WHILE_PENDING: ReadonlySet<IntentType> = new Set(['respondAreaDodge', 'resolveAreaDodges', 'setCover', 'installCyberware', 'removeCyberware', 'therapy']);

export const isSystemsIntent = (i: Intent): i is SystemsIntent => ALL.has(i.type);

// ----- Validation helpers -------------------------------------------------------------------

const isInt = (n: unknown, lo: number, hi: number): n is number => Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi;
const isId = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 64;
function need(ok: boolean, message: string): asserts ok {
  if (!ok) throw new SessionError('INVALID', message);
}
function needCell(map: TacticalMap, c: unknown): Cell {
  const cell = c as Cell;
  need(!!cell && isInt(cell.x, 0, map.width - 1) && isInt(cell.y, 0, map.height - 1), 'Pick a square on the map.');
  return { x: cell.x, y: cell.y };
}

/** Same rules as the authority's requireActing: control, Turn, Death Save first. */
function requireActing(state: SessionState, by: Viewer, actorId: string) {
  need(isId(actorId), 'Missing character.');
  const a = getActor(state, actorId);
  if (!controls(by, a)) throw new SessionError('FORBIDDEN', `You don’t control ${a.combatant.name}.`);
  if (by.role === 'gm') return a;
  if (state.encounter.active && currentActorId(state) !== actorId) throw new SessionError('NOT_YOUR_TURN', `It isn’t ${a.combatant.name}’s Turn.`);
  if (state.encounter.deathSaveRequiredFor === actorId) throw new SessionError('DEATH_SAVE_FIRST', `${a.combatant.name} must roll a Death Save first.`);
  return a;
}

const withCombatant = (a: Actor, c: Combatant): Actor => ({ ...a, combatant: c });

// ----- Authorization ------------------------------------------------------------------------

export function authorizeSystems(state: SessionState, intent: Intent, by: Viewer): void {
  if (!isSystemsIntent(intent)) return;
  if (SYSTEMS_GM_ONLY.has(intent.type) && by.role !== 'gm') throw new SessionError('FORBIDDEN', 'Only the GM can do that.');
  switch (intent.type) {
    case 'respondAreaDodge': {
      const p = state.pending;
      if (!p || p.kind !== 'awaitingAreaDodge' || p.id !== intent.pendingId) throw new SessionError('NO_PENDING', 'No dodge decision is waiting.');
      need(isId(intent.actorId) && intent.actorId in p.decisions, 'That character isn’t deciding a dodge.');
      need(typeof intent.dodge === 'boolean', 'Dodge must be yes or no.');
      if (p.decisions[intent.actorId] !== null) throw new SessionError('INVALID', 'That decision is already made.');
      const a = getActor(state, intent.actorId);
      if (!controls(by, a)) throw new SessionError('FORBIDDEN', `Only ${a.combatant.name}’s player decides.`);
      return;
    }
    case 'resolveAreaDodges': {
      const p = state.pending;
      if (!p || p.kind !== 'awaitingAreaDodge' || p.id !== intent.pendingId) throw new SessionError('NO_PENDING', 'No dodge decision is waiting.');
      return;
    }
    case 'attackCover':
      requireActing(state, by, intent.attackerId);
      return;
    case 'setAmmoType':
    case 'extinguish':
      requireActing(state, by, intent.actorId);
      return;
    case 'setAwareness': {
      need(isId(intent.actorId), 'Missing character.');
      const a = getActor(state, intent.actorId);
      if (!controls(by, a)) throw new SessionError('FORBIDDEN', `You don’t control ${a.combatant.name}.`);
      // Re-allocating mid-fight costs an Action on your own Turn.
      if (state.encounter.active) requireActing(state, by, intent.actorId);
      return;
    }
    case 'treatInjury':
      requireActing(state, by, intent.medicId);
      need(isId(intent.targetId), 'Missing patient.');
      getActor(state, intent.targetId);
      return;
    default:
      return;
  }
}

/** Refuse attacks with weapons the attacker can't hold (arm injuries). Called before any intent is executed. */
export function wieldCheck(state: SessionState, intent: Intent): void {
  let actorId: string | undefined;
  let weapon: Weapon | 'brawling' | undefined;
  const find = (id: string, wid: string) => {
    const a = state.actors[id];
    return a?.weapons.find((w) => w.id === wid);
  };
  switch (intent.type) {
    case 'rangedAttack': case 'suppressiveFire': case 'attackCover':
      actorId = intent.attackerId; weapon = find(intent.attackerId, intent.weaponId); break;
    case 'areaAttack':
      actorId = intent.attackerId;
      weapon = intent.kind === 'thrownGrenade' ? 'brawling' : find(intent.attackerId, intent.weaponId); break;
    case 'meleeAttack':
      actorId = intent.attackerId;
      weapon = intent.with?.kind === 'weapon' ? find(intent.attackerId, intent.with.weaponId) : 'brawling'; break;
    default:
      return;
  }
  const a = actorId ? state.actors[actorId] : undefined;
  if (!a || !weapon) return; // the authority reports missing actors/weapons itself
  const problem = wieldProblem(a.combatant, weapon);
  if (problem) throw new SessionError('INVALID', problem);
}

// ----- Execution ----------------------------------------------------------------------------

export function executeSystems(state: SessionState, intent: SystemsIntent, by: Viewer, dice: Dice, newId: () => string): Result {
  switch (intent.type) {
    case 'respondAreaDodge': {
      const p = state.pending as AreaPending;
      const decisions = { ...p.decisions, [intent.actorId]: intent.dodge };
      const next: AreaPending = { ...p, decisions };
      if (Object.values(decisions).some((d) => d === null)) return { events: [], patch: { pending: next } };
      return finishAreaAttack(state, next, dice);
    }
    case 'resolveAreaDodges': {
      const p = state.pending as AreaPending;
      const decisions = Object.fromEntries(Object.entries(p.decisions).map(([k, v]) => [k, v ?? true]));
      return finishAreaAttack(state, { ...p, decisions }, dice);
    }
    case 'attackCover': return doAttackCover(state, intent, by, dice);
    case 'setCover': {
      const map = requireMap(state);
      const at = needCell(map, intent.at);
      need(terrainAt(map, at) === 'c', 'That square isn’t cover.');
      need(intent.material === null || COVER_MATERIALS.some((m) => m.id === intent.material), 'Unknown cover material.');
      const cover = { ...(map.cover ?? {}) };
      if (intent.material === null) delete cover[cellKey(at)];
      else cover[cellKey(at)] = { material: intent.material, hp: coverMaterial(intent.material).hp };
      return { events: [], patch: { map: { ...map, cover } } };
    }
    case 'setAmmoType': {
      const a = getActor(state, intent.actorId);
      const w = getWeapon(a, intent.weaponId);
      need(typeof intent.ammoType === 'string', 'Pick an ammunition type.');
      const problem = ammoProblem(w, intent.ammoType);
      need(!problem, problem ?? '');
      // Changing ammunition means reloading: an Action in combat.
      const encounter = checkOtherAction(state, by, a);
      const loaded: Weapon = { ...w, ammoType: intent.ammoType, ...(w.ammo ? { ammo: { ...w.ammo, loaded: w.ammo.capacity } } : {}) };
      const patch: StatePatch = { actors: { [a.id]: { ...a, weapons: a.weapons.map((x) => (x.id === w.id ? loaded : x)) } } };
      if (encounter) patch.encounter = encounter;
      return { events: [{ type: 'ammoLoaded', visibility: visibilityFor(a), combatantId: a.id, weaponId: w.id, ammoType: intent.ammoType }], patch };
    }
    case 'extinguish': {
      const a = getActor(state, intent.actorId);
      need(!!a.combatant.onFire, `${a.combatant.name} isn’t on fire.`);
      const encounter = checkOtherAction(state, by, a);
      const { onFire: _out, ...c } = a.combatant;
      const patch: StatePatch = { actors: { [a.id]: withCombatant(a, c) } };
      if (encounter) patch.encounter = encounter;
      return { events: [{ type: 'extinguished', visibility: 'public', targetId: a.id }], patch };
    }
    case 'setAwareness': {
      const a = getActor(state, intent.actorId);
      const role = a.combatant.role;
      need(role?.id === 'solo', `${a.combatant.name} isn’t a Solo.`);
      const alloc = intent.allocation;
      const problem = awarenessProblem(alloc, role.rank);
      need(!problem, problem ?? '');
      const encounter = state.encounter.active ? checkOtherAction(state, by, a) : undefined;
      const c = applySystems({ ...a.combatant, role: { ...role, awareness: { ...alloc } } });
      const patch: StatePatch = { actors: { [a.id]: withCombatant(a, c) } };
      if (encounter) patch.encounter = encounter;
      return { events: [{ type: 'awarenessSet', visibility: visibilityFor(a), combatantId: a.id, allocation: { ...alloc } }], patch };
    }
    case 'installCyberware': return doInstall(state, intent, dice);
    case 'removeCyberware': {
      const a = getActor(state, intent.actorId);
      const item = (a.combatant.cyberware ?? []).find((i) => i.id === intent.itemId);
      need(!!item, 'No such cyberware.');
      const restore = Math.floor(item.humanityLoss / 2);
      let c: Combatant = { ...a.combatant, cyberware: (a.combatant.cyberware ?? []).filter((i) => i.id !== item.id) };
      const events: CombatEvent[] = [{ type: 'cyberwareRemoved', visibility: visibilityFor(a), combatantId: a.id, itemId: item.id, name: item.name, humanityRestored: restore }];
      if (c.humanity) {
        const from = c.humanity.current;
        c = { ...c, humanity: { ...c.humanity, current: Math.min(c.humanity.max, from + restore) } };
        events.push(humanityEvent(a, from, c.humanity!.current, 'removal'));
      }
      return { events, patch: { actors: { [a.id]: withCombatant(a, applySystems(c)) } } };
    }
    case 'therapy': {
      const a = getActor(state, intent.actorId);
      const h = a.combatant.humanity;
      need(!!h, `${a.combatant.name} has no Humanity track.`);
      need(intent.kind === 'standard' || intent.kind === 'extreme', 'Pick Standard or Extreme therapy.');
      need(isInt(intent.therapistBase, 0, 40), 'Therapist total must be a whole number from 0 to 40.');
      if (intent.kind === 'standard') need(h.current >= THERAPY.standard.minHumanity, 'Standard therapy needs Humanity 40 or more; use Extreme.');
      else need(h.current < THERAPY.extreme.maxHumanityBelow, 'Extreme therapy is for Humanity below 40.');
      const dv = THERAPY[intent.kind].dv;
      const check = makeCheck([{ label: 'Therapist', value: intent.therapistBase }], [], dice);
      const success = beats(check.total, dv);
      const rolled = success ? Array.from({ length: THERAPY_DICE }, () => dice.d6()) : [];
      const recovered = Math.max(0, Math.min(h.max - h.current, rolled.reduce((s, d) => s + d, 0)));
      const c = applySystems({ ...a.combatant, humanity: { ...h, current: h.current + recovered } });
      const events: CombatEvent[] = [{ type: 'therapyResolved', visibility: visibilityFor(a), combatantId: a.id, kind: intent.kind, check, dv, success, recovered, rolled }];
      if (recovered) events.push(humanityEvent(a, h.current, h.current + recovered, 'therapy'));
      return { events, patch: { actors: { [a.id]: withCombatant(a, c) } } };
    }
    case 'treatInjury': {
      const medic = getActor(state, intent.medicId);
      const target = getActor(state, intent.targetId);
      need(isInt(intent.injuryIndex, 0, target.combatant.criticalInjuries.length - 1), 'Pick one of their Critical Injuries.');
      need(intent.kind === 'quickFix' || intent.kind === 'treatment', 'Pick Quick Fix or Treatment.');
      need(typeof intent.skill === 'string' && intent.skill.length <= 40, 'Pick a skill.');
      const inst = target.combatant.criticalInjuries[intent.injuryIndex]!;
      need(!(intent.kind === 'quickFix' && inst.quickFixed), 'That injury is already Quick-Fixed.');
      const dv = treatmentDv(inst.injuryId, intent.kind, intent.skill);
      need('dv' in dv, 'problem' in dv ? dv.problem : '');
      const md = state.map?.tokens[medic.id];
      const td = state.map?.tokens[target.id];
      if (state.encounter.active && md && td && gridDistance(md, td) > 1) throw new SessionError('OUT_OF_REACH', `${target.combatant.name} isn’t in an adjacent square.`);
      const encounter = checkOtherAction(state, by, medic);
      const r = treatInjury(medic.combatant, target.combatant, intent.injuryIndex, intent.kind, intent.skill, dv.dv, dice);
      const patch: StatePatch = { actors: { [target.id]: withCombatant(target, r.target) } };
      if (encounter) patch.encounter = encounter;
      return { events: r.events, patch };
    }
    case 'rest': {
      need(isInt(intent.days, 1, 60), 'Rest 1–60 days.');
      need(intent.care === 'street' || intent.care === 'home' || intent.care === 'hospital', 'Pick where they rest.');
      need(!state.encounter.active, 'End the encounter before resting.');
      const ids = intent.actorIds ?? Object.keys(state.actors);
      need(Array.isArray(ids) && ids.length <= 200, 'Too many characters.');
      const actors: Record<string, Actor> = {};
      const events: CombatEvent[] = [];
      for (const id of ids) {
        need(isId(id), 'Bad character id.');
        const a = getActor(state, id);
        if (a.combatant.conditions.dead) continue;
        const r = naturalHealing(a.combatant, intent.days, intent.care);
        actors[id] = withCombatant(a, r.combatant);
        events.push({
          type: 'rested', visibility: 'gm', targetId: id, days: intent.days, care: intent.care, healed: r.healed, hpAfter: r.combatant.hp.current,
          ...(r.blocked ? { blocked: r.blocked } : {}),
        });
        const before = woundState(a.combatant.hp);
        const after = woundState(r.combatant.hp);
        if (before !== after) events.push({ type: 'woundStateChanged', visibility: 'public', targetId: id, from: before, to: after });
      }
      return { events, patch: { actors } };
    }
  }
}

// ----- Humanity ---------------------------------------------------------------------------

function humanityEvent(a: Actor, from: number, to: number, reason: 'cyberware' | 'removal' | 'therapy'): CombatEvent {
  return { type: 'humanityChanged', visibility: visibilityFor(a), combatantId: a.id, from, to, empFrom: empFromHumanity(from), empTo: empFromHumanity(to), reason };
}

function doInstall(state: SessionState, intent: Extract<Intent, { type: 'installCyberware' }>, dice: Dice): Result {
  const a = getActor(state, intent.actorId);
  const problem = cyberwareProblem(intent.item);
  need(!problem, problem ?? '');
  need(!(a.combatant.cyberware ?? []).some((i) => i.id === intent.item.id), 'That cyberware id is already installed.');
  need((a.combatant.cyberware ?? []).length < 60, 'Too much cyberware.');
  let loss = intent.item.humanityLoss;
  let rolled: number[] | undefined;
  if (intent.rollLoss !== undefined) {
    need(isInt(intent.rollLoss?.count, 0, 10) && isInt(intent.rollLoss?.bonus, 0, 30), 'Humanity Loss dice: 0–10 d6 plus 0–30.');
    rolled = Array.from({ length: intent.rollLoss.count }, () => dice.d6());
    loss = rolled.reduce((s, d) => s + d, 0) + intent.rollLoss.bonus;
  }
  const item = { ...intent.item, humanityLoss: loss, effects: intent.item.effects.map((e) => ({ ...e })) };
  let c: Combatant = { ...a.combatant, cyberware: [...(a.combatant.cyberware ?? []), item] };
  const events: CombatEvent[] = [{ type: 'cyberwareInstalled', visibility: visibilityFor(a), combatantId: a.id, itemId: item.id, name: item.name, humanityLoss: loss, ...(rolled ? { rolled } : {}) }];
  if (c.humanity) {
    const from = c.humanity.current;
    c = { ...c, humanity: { ...c.humanity, current: from - loss } };
    events.push(humanityEvent(a, from, from - loss, 'cyberware'));
    if (from > 0 && from - loss <= 0) {
      events.push({ type: 'gmRulingRequired', visibility: 'gm', reason: `${a.combatant.name} has reached 0 Humanity: cyberpsychosis. The character becomes the GM’s.` });
    }
  }
  return { events, patch: { actors: { [a.id]: withCombatant(a, applySystems(c)) } } };
}

// ----- Damage hooks -----------------------------------------------------------------------

/**
 * Before a single-target damage roll: stamp the Round (for Damage Deflection) and
 * add Spot Weakness on the attacker's first hit this Round.
 */
export function beforeDamage(state: SessionState, p: DamagePending): { spec: DamagePending['spec']; actors: Record<string, Actor>; events: CombatEvent[] } {
  if (!state.encounter.active) return { spec: p.spec, actors: {}, events: [] };
  const round = state.encounter.round;
  const spec = { ...p.spec, round };
  const attacker = state.actors[p.attackerId];
  const sw = attacker?.combatant.mods?.spotWeakness ?? 0;
  const pr = attacker?.combatant.perRound;
  if (!attacker || sw <= 0 || (pr?.round === round && pr.spotWeakness)) return { spec, actors: {}, events: [] };
  const perRound = { ...(pr?.round === round ? pr : { round }), spotWeakness: true };
  return {
    spec: { ...spec, bonusDamage: (spec.bonusDamage ?? 0) + sw },
    actors: { [attacker.id]: withCombatant(attacker, { ...attacker.combatant, perRound }) },
    events: [{ type: 'spotWeakness', visibility: visibilityFor(attacker), combatantId: attacker.id, bonus: sw }],
  };
}

/**
 * Start of a character's Turn: On Fire burns them.
 * @interpretation Fire damage goes straight to HP (armor doesn't stop flames) and repeats until put out.
 */
export function onTurnStart(state: SessionState, encounter: Encounter): { events: CombatEvent[]; actors: Record<string, Actor> } {
  const id = encounter.active ? encounter.order[encounter.turnIndex] : undefined;
  const a = id ? state.actors[id] : undefined;
  const burn = a?.combatant.onFire ?? 0;
  if (!a || burn <= 0 || a.combatant.conditions.dead) return { events: [], actors: {} };
  const before = woundState(a.combatant.hp);
  const c: Combatant = { ...a.combatant, hp: { ...a.combatant.hp, current: a.combatant.hp.current - burn } };
  const events: CombatEvent[] = [{ type: 'burning', visibility: 'public', targetId: a.id, damage: burn, hpAfter: c.hp.current }];
  const after = woundState(c.hp);
  if (before !== after) events.push({ type: 'woundStateChanged', visibility: 'public', targetId: a.id, from: before, to: after });
  return { events, actors: { [a.id]: withCombatant(a, c) } };
}

// ----- Cover -----------------------------------------------------------------------------

export function coverAt(map: TacticalMap, c: Cell): { material: CoverMaterialId; hp: number } {
  return map.cover?.[cellKey(c)] ?? { material: DEFAULT_COVER_MATERIAL, hp: coverMaterial(DEFAULT_COVER_MATERIAL).hp };
}

/** Damage one cover square. Destroyed cover becomes open ground. */
export function damageCoverSquare(map: TacticalMap, at: Cell, damage: number, byId?: string): { map: TacticalMap; event: CombatEvent } {
  const cur = coverAt(map, at);
  const hpAfter = Math.max(0, cur.hp - damage);
  const destroyed = hpAfter === 0;
  const cover = { ...(map.cover ?? {}) };
  let cells = map.cells;
  if (destroyed) {
    delete cover[cellKey(at)];
    const i = at.y * map.width + at.x;
    cells = cells.slice(0, i) + '.' + cells.slice(i + 1);
  } else cover[cellKey(at)] = { material: cur.material, hp: hpAfter };
  return {
    map: { ...map, cells, cover },
    event: { type: 'coverDamaged', visibility: 'public', at, material: coverMaterial(cur.material).name, hpBefore: cur.hp, hpAfter, destroyed, ...(byId ? { byId } : {}) },
  };
}

/**
 * Shoot or hit a square of cover (RED: cover can be attacked like a character).
 * Ranged: REF + skill + 1d10 vs the range DV. @interpretation Melee automatically
 * hits a stationary object. Damage dice go straight to the cover's HP; excess is lost.
 */
function doAttackCover(state: SessionState, intent: Extract<Intent, { type: 'attackCover' }>, by: Viewer, dice: Dice): Result {
  const map = requireMap(state);
  const attacker = getActor(state, intent.attackerId);
  const weapon = getWeapon(attacker, intent.weaponId);
  const from = map.tokens[attacker.id];
  need(!!from, `${attacker.combatant.name} isn’t on the map.`);
  const at = needCell(map, intent.at);
  need(terrainAt(map, at) === 'c', 'That square isn’t cover.');
  const p = profileOf(weapon);
  need(p.rangeRow !== 'grenadeLauncher' && p.rangeRow !== 'rocketLauncher', `Fire ${weapon.name} as an area attack.`);
  const events: CombatEvent[] = [];
  let hit = true;
  let spent = 0;
  if (p.melee) {
    if (gridDistance(from, at) > 1) throw new SessionError('OUT_OF_REACH', 'That cover isn’t in an adjacent square.');
  } else {
    if (!hasLineOfSight(map, from, at)) throw new SessionError('NO_LINE_OF_SIGHT', 'That square is out of sight.');
    const band = rangeBandIndex(Math.max(1, metersBetween(from, at)));
    const dv = band < 0 ? null : RANGE_DV[p.rangeRow!][band];
    need(dv != null, `${weapon.name} can’t reach that far.`);
    need(!weapon.ammo || weapon.ammo.loaded >= 1, `${weapon.name} is empty.`);
    spent = weapon.ammo ? 1 : 0;
    const check = makeCheck([{ label: 'REF', value: effectiveStat(attacker.combatant, 'REF') }, { label: p.skill, value: skillLevel(attacker.combatant, p.skill) }], standingModifiers(attacker.combatant, 'rangedAttack'), dice);
    hit = beats(check.total, dv!);
    events.push({ type: 'checkRolled', visibility: visibilityFor(attacker), by: attacker.controller, combatantId: attacker.id, label: 'Shoot Cover', check, dv: dv!, success: hit });
    if (spent) events.push({ type: 'ammoSpent', visibility: visibilityFor(attacker), combatantId: attacker.id, weaponId: weapon.id, rounds: spent });
  }
  const encounter = checkAttackAction(state, by, attacker, weapon.id, attacksPerAction(weapon));
  const patch: StatePatch = {};
  if (spent) patch.actors = { [attacker.id]: { ...attacker, weapons: attacker.weapons.map((w) => (w.id === weapon.id ? spendAmmo(w, spent) : w)) } };
  if (encounter) patch.encounter = encounter;
  if (hit) {
    const roll = rollDamage({ diceCount: weapon.damageDiceOverride ?? p.damageDice, multiplier: 1 }, dice);
    events.push({ type: 'damageRolled', visibility: 'public', dice: roll.dice, multiplier: 1, total: roll.total, critTriggered: false });
    const r = damageCoverSquare(map, at, roll.total, attacker.id);
    events.push(r.event);
    patch.map = withSpotted(r.map, state.actors);
  }
  return { events, patch };
}

// ----- Area attacks: cover and the dodge decision ------------------------------------------

/** HP of the toughest intact cover between two squares, or 'wall' if a wall blocks, or undefined if clear. */
export function coverBetween(map: TacticalMap, a: Cell, b: Cell, raySteps: (a: Cell, b: Cell) => ({ cell: Cell } | { pair: [Cell, Cell] })[]): number | 'wall' | undefined {
  let best: number | undefined;
  for (const step of raySteps(a, b)) {
    if ('cell' in step) {
      const t = terrainAt(map, step.cell);
      if (t === '#') return 'wall';
      if (t === 'c') best = Math.max(best ?? 0, coverAt(map, step.cell).hp);
    } else {
      const [p, q] = step.pair;
      const tp = terrainAt(map, p), tq = terrainAt(map, q);
      const opaque = (t: string) => t === '#' || t === 'c';
      if (!opaque(tp) || !opaque(tq)) continue;
      if (tp === '#' && tq === '#') return 'wall';
      // The blast slips through the weaker side once it breaks.
      const hps = [p, q].filter((c) => terrainAt(map, c) === 'c').map((c) => coverAt(map, c).hp);
      best = Math.max(best ?? 0, Math.min(...hps));
    }
  }
  return best;
}

export function startAreaDodge(p: Omit<AreaPending, 'kind' | 'decisions'>, state: SessionState): { pending: AreaPending; events: CombatEvent[] } | null {
  const eligible = p.targets.filter(({ id }) => {
    const c = state.actors[id]?.combatant;
    return !!c && !c.conditions.unconscious && effectiveStat(c, 'REF') >= 8;
  });
  if (!eligible.length) return null;
  const decisions = Object.fromEntries(eligible.map(({ id }) => [id, null]));
  const events: CombatEvent[] = eligible.map(({ id }) => ({ type: 'areaDodgeRequested', visibility: visibilityFor(state.actors[id]!), combatantId: id, attackTotal: p.attack.total }));
  return { pending: { ...p, kind: 'awaitingAreaDodge', decisions }, events };
}

/** Hook set by grid-area.ts (avoids an import cycle). */
let finisher: ((state: SessionState, p: AreaPending, dice: Dice) => Result) | null = null;
export function setAreaFinisher(f: (state: SessionState, p: AreaPending, dice: Dice) => Result) { finisher = f; }
function finishAreaAttack(state: SessionState, p: AreaPending, dice: Dice): Result {
  if (!finisher) throw new SessionError('INVALID', 'Area attacks aren’t available.');
  return finisher(state, p, dice);
}

// ----- Projection ---------------------------------------------------------------------------

/** Players only learn about area-dodge targets they could see anyway. */
export function projectPendingForPlayer(pending: Pending | null, state: Pick<SessionState, 'actors' | 'map'>): Pending | null {
  if (!pending || pending.kind !== 'awaitingAreaDodge') return pending;
  const seen = new Set(state.map ? Object.keys(projectMap(state.map, state.actors).tokens) : []);
  const ok = (id: string) => {
    const a = state.actors[id];
    return !!a && (factionOf(a) === 'friendly' || seen.has(id));
  };
  return {
    ...pending,
    targets: pending.targets.filter((t) => ok(t.id)).map(({ id }) => ({ id })),
    decisions: Object.fromEntries(Object.entries(pending.decisions).filter(([id]) => ok(id))),
  };
}

export const AMMO_IDS = AMMO_TYPES.map((a) => a.id);
