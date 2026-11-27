/**
 * Shields, human shields, drugs and basic vehicles: one intent,
 * `{ type: 'gear', op }`. `executeGear` validates the untrusted payload
 * (types, ids, bounds) before touching state. Rules and their status live in
 * rules-core (shields.ts, drugs.ts, vehicles.ts, quality.ts) and
 * docs/rules-verification.md.
 *
 * The authority also calls three hooks:
 *   - `gearAdjust`: a defender behind a raised shield, or held as a human
 *     shield, doesn't dodge ranged attacks.
 *   - `gearGate`: vehicles are attacked with Attack Vehicle, driven by their
 *     driver, and never take Turns of their own.
 *   - `gearDamage`: a hit on a shield's holder goes into the shield (or the
 *     human shield) instead.
 */
import {
  absorb, applyDamage, applySystems, attacksPerAction, beats, cure, dose, DRUG_SKILL, DRUG_TEMPLATES, drugProblem, effectiveStat,
  emptyDrugs, gridDistance, hasLineOfSight, humanShieldBlocks, makeCheck, metersBetween, profileOf, qualityMods, RANGE_DV,
  rangeBandIndex, rollDamage, seatsLeft, SHIELD_TEMPLATES, shieldBlocks, shieldUp, skillLevel, spendAmmo, standingModifiers,
  VEHICLE_AIM_PENALTY, VEHICLE_TEMPLATES, vehicleDamage, wearOff, handsFree,
  type Cell, type CombatEvent, type Combatant, type Dice, type DrugDef, type Modifier, type ShieldState,
} from '@cprc/rules-core';
import { checkAttackAction, checkOtherAction, controls, currentActorId, getActor, getWeapon, SessionError, usageFor, visibilityFor } from './helpers.js';
import { factionOf, planMove, withSpotted } from './tactical.js';
import type { Actor, Encounter, Grapple, Intent, Pending, SessionState, StatePatch, TacticalMap, Viewer } from './types.js';

type Result = { events: CombatEvent[]; patch: StatePatch };
type DamagePending = Extract<Pending, { kind: 'awaitingDamage' }>;

export type GearOp =
  | { op: 'equipShield'; actorId: string; templateId?: string; shield?: { name: string; hp: number } }
  | { op: 'dropShield'; actorId: string }
  | { op: 'raiseShield'; actorId: string; raised: boolean }
  | { op: 'humanShield'; actorId: string }
  | { op: 'takeDrug'; actorId: string; targetId?: string; drugId?: string; drug?: DrugDef }
  | { op: 'drugWearsOff'; actorId: string; drugId: string }
  | { op: 'cureAddiction'; actorId: string; drugId: string }
  | { op: 'spawnVehicle'; templateId: string; id: string; name?: string; at?: Cell; allegiance?: 'party' | 'ally' | 'neutral' | 'hostile'; controller?: string; sp?: number }
  | { op: 'board'; actorId: string; vehicleId: string; drive?: boolean }
  | { op: 'exit'; actorId: string; at?: Cell }
  | { op: 'drive'; actorId: string; to: Cell }
  | { op: 'attackVehicle'; attackerId: string; vehicleId: string; weaponId: string; aimed?: boolean }
  | { op: 'ram'; vehicleId: string; targetId: string };

// ----- Validation ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const bad = (m: string): never => { throw new SessionError('INVALID', m); };
const id = (v: unknown, what: string): string => (typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(v) ? v : bad(`${what} isn’t a valid id.`));
const optId = (v: unknown, what: string) => (v === undefined ? undefined : id(v, what));
const int = (v: unknown, lo: number, hi: number, what: string): number =>
  (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : bad(`${what} must be a whole number from ${lo} to ${hi}.`));
const bool = (v: unknown, what: string): boolean => (typeof v === 'boolean' ? v : bad(`${what} must be true or false.`));
const optBool = (v: unknown, what: string) => (v === undefined ? undefined : bool(v, what));
const cell = (v: unknown): Cell => (isObj(v) ? { x: int(v.x, 0, 999, 'Column'), y: int(v.y, 0, 999, 'Row') } : bad('Pick a square.'));
const ALLEGIANCES = ['party', 'ally', 'neutral', 'hostile'] as const;

export function parseGearOp(v: unknown): GearOp {
  if (!isObj(v)) return bad('Missing gear operation.');
  const actorId = () => id(v.actorId, 'Character');
  switch (v.op) {
    case 'equipShield': {
      const templateId = optId(v.templateId, 'Shield');
      let shield: { name: string; hp: number } | undefined;
      if (v.shield !== undefined) {
        const s = isObj(v.shield) ? v.shield : bad('A shield must be an object.');
        const name = typeof s.name === 'string' && s.name.trim() && s.name.length <= 60 ? s.name : bad('A shield needs a name (up to 60 characters).');
        shield = { name, hp: int(s.hp, 1, 100, 'Shield HP') };
      }
      if (!templateId === !shield) bad('Pick a shield, or describe one.');
      return { op: 'equipShield', actorId: actorId(), ...(templateId ? { templateId } : {}), ...(shield ? { shield } : {}) };
    }
    case 'dropShield': return { op: 'dropShield', actorId: actorId() };
    case 'raiseShield': return { op: 'raiseShield', actorId: actorId(), raised: bool(v.raised, 'Raised') };
    case 'humanShield': return { op: 'humanShield', actorId: actorId() };
    case 'takeDrug': {
      const drugId = optId(v.drugId, 'Drug');
      if (v.drug !== undefined) { const p = drugProblem(v.drug); if (p) bad(p); }
      if (!drugId === (v.drug === undefined)) bad('Pick a drug, or describe one.');
      return { op: 'takeDrug', actorId: actorId(), ...(v.targetId !== undefined ? { targetId: id(v.targetId, 'Target') } : {}),
        ...(drugId ? { drugId } : {}), ...(v.drug !== undefined ? { drug: structuredClone(v.drug) as DrugDef } : {}) };
    }
    case 'drugWearsOff': return { op: 'drugWearsOff', actorId: actorId(), drugId: id(v.drugId, 'Drug') };
    case 'cureAddiction': return { op: 'cureAddiction', actorId: actorId(), drugId: id(v.drugId, 'Drug') };
    case 'spawnVehicle': {
      const name = v.name === undefined ? undefined
        : typeof v.name === 'string' && v.name.trim() && v.name.length <= 60 ? v.name : bad('A vehicle name is text up to 60 characters.');
      const allegiance = v.allegiance === undefined ? undefined
        : (ALLEGIANCES as readonly unknown[]).includes(v.allegiance) ? (v.allegiance as (typeof ALLEGIANCES)[number]) : bad('Unknown allegiance.');
      const controller = v.controller === undefined ? undefined : id(v.controller, 'Controller');
      return {
        op: 'spawnVehicle', templateId: id(v.templateId, 'Vehicle'), id: id(v.id, 'Vehicle id'),
        ...(name ? { name } : {}), ...(v.at !== undefined ? { at: cell(v.at) } : {}), ...(allegiance ? { allegiance } : {}),
        ...(controller ? { controller } : {}), ...(v.sp !== undefined ? { sp: int(v.sp, 0, 50, 'Plating SP') } : {}),
      };
    }
    case 'board': return { op: 'board', actorId: actorId(), vehicleId: id(v.vehicleId, 'Vehicle'), ...(v.drive !== undefined ? { drive: bool(v.drive, 'Drive') } : {}) };
    case 'exit': return { op: 'exit', actorId: actorId(), ...(v.at !== undefined ? { at: cell(v.at) } : {}) };
    case 'drive': return { op: 'drive', actorId: actorId(), to: cell(v.to) };
    case 'attackVehicle': return {
      op: 'attackVehicle', attackerId: id(v.attackerId, 'Attacker'), vehicleId: id(v.vehicleId, 'Vehicle'), weaponId: id(v.weaponId, 'Weapon'),
      ...(optBool(v.aimed, 'Aimed') ? { aimed: true } : {}),
    };
    case 'ram': return { op: 'ram', vehicleId: id(v.vehicleId, 'Vehicle'), targetId: id(v.targetId, 'Target') };
    default: return bad('Unknown gear operation.');
  }
}

// ----- Helpers ------------------------------------------------------------------------------

const name = (a: Actor) => a.combatant.name;
const withC = (a: Actor, c: Combatant): Actor => ({ ...a, combatant: c });
const isVehicle = (a: Actor | undefined) => !!a?.combatant.vehicle;
const friendly = (a: Actor) => factionOf(a) === 'friendly';
/** Hits everyone at the table can see (shields, human shields, vehicles) are public; numbers are redacted per viewer. */
const SEEN = new Set(['shieldHit', 'humanShield', 'corpseShield', 'vehicleDamaged', 'ram', 'equipShield', 'dropShield']);
const ev = (a: Actor, action: string, text: string, extra: Partial<Extract<CombatEvent, { type: 'gearAction' }>> = {}): CombatEvent =>
  ({ type: 'gearAction', visibility: SEEN.has(action) ? 'public' : visibilityFor(a), combatantId: a.id, action, text, ...extra });

function gmOnly(by: Viewer) { if (by.role !== 'gm') throw new SessionError('FORBIDDEN', 'Only the GM can do that.'); }

/** Control, Turn, Death Save first (like the authority's requireActing). */
function acting(state: SessionState, by: Viewer, actorId: string): Actor {
  const a = getActor(state, actorId);
  if (!controls(by, a)) throw new SessionError('FORBIDDEN', `You don’t control ${name(a)}.`);
  if (isVehicle(a)) throw new SessionError('INVALID', 'Vehicles act through their driver.');
  if (by.role === 'gm') return a;
  if (state.encounter.active && currentActorId(state) !== actorId) throw new SessionError('NOT_YOUR_TURN', `It isn’t ${name(a)}’s Turn.`);
  if (state.encounter.deathSaveRequiredFor === actorId) throw new SessionError('DEATH_SAVE_FIRST', `${name(a)} must roll a Death Save first.`);
  const cond = a.combatant.conditions;
  if (cond.dead || cond.unconscious) throw new SessionError('INVALID', `${name(a)} can’t act right now.`);
  return a;
}

/** Spend the Move Action (players; the GM is recorded, never refused). */
function useMove(state: SessionState, by: Viewer, a: Actor): Encounter | undefined {
  const u = usageFor(state, a.id);
  if (!u) return undefined;
  const move = effectiveStat(a.combatant, 'MOVE');
  if (by.role !== 'gm' && u.moveUsed > 0) throw new SessionError('NO_MOVEMENT', `${name(a)} has already moved this Turn.`);
  return { ...state.encounter, usage: { ...u, moveUsed: Math.max(u.moveUsed, move) } };
}

const grappleHeld = (state: SessionState, heldId: string) => state.extras?.grapples.find((g) => g.heldId === heldId);
const grappleHolding = (state: SessionState, holderId: string) => state.extras?.grapples.find((g) => g.holderId === holderId);

const vehicleOf = (state: SessionState, actorId: string): Actor | undefined =>
  Object.values(state.actors).find((v) => v.combatant.vehicle?.passengers.includes(actorId));

function freeCellNear(map: TacticalMap, state: SessionState, at: Cell): Cell | null {
  const taken = new Set(Object.values(map.tokens).map((c) => `${c.x},${c.y}`));
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const c = { x: at.x + dx, y: at.y + dy };
    if ((dx || dy) && c.x >= 0 && c.y >= 0 && c.x < map.width && c.y < map.height && map.cells[c.y * map.width + c.x] === '.' && !taken.has(`${c.x},${c.y}`)) return c;
  }
  return null;
}

// ----- Authority hooks ----------------------------------------------------------------------

/** Who can't dodge a ranged attack right now: behind a raised shield, held as a human shield, or a vehicle. */
export function cantDodgeRanged(state: SessionState, defenderId: string): boolean {
  const d = state.actors[defenderId];
  if (!d) return false;
  if (isVehicle(d) || shieldUp(d.combatant.shield)) return true;
  const g = grappleHeld(state, defenderId);
  return !!g?.humanShield;
}

export function gearAdjust(state: SessionState, intent: Intent): Intent {
  if (intent.type === 'rangedAttack' && cantDodgeRanged(state, intent.defenderId)) return { ...intent, defenderDodges: false };
  return intent;
}

/** Refuse what vehicles can't do through the ordinary intents. */
export function gearGate(state: SessionState, intent: Intent, by: Viewer): void {
  const v = (aid: string | undefined) => (aid ? isVehicle(state.actors[aid]) : false);
  switch (intent.type) {
    case 'rangedAttack': case 'meleeAttack':
      if (v(intent.defenderId)) throw new SessionError('INVALID', 'Shoot vehicles with Attack Vehicle (vehicles can’t dodge).');
      if (v(intent.attackerId)) throw new SessionError('INVALID', 'Vehicles attack through their passengers.');
      if (vehicleOf(state, intent.defenderId) && by.role !== 'gm') throw new SessionError('INVALID', `${state.actors[intent.defenderId]!.combatant.name} is inside a vehicle. The GM rules on shots at occupants.`);
      return;
    case 'moveToken':
      if (v(intent.actorId) && by.role !== 'gm') throw new SessionError('INVALID', 'Drive the vehicle from the driver’s seat.');
      return;
    case 'startEncounter':
      if (intent.participants?.some((p) => v(p?.actorId))) throw new SessionError('INVALID', 'Vehicles act on their driver’s Turn; leave them out of initiative.');
      return;
    case 'addToInitiative':
      if (v(intent.actorId)) throw new SessionError('INVALID', 'Vehicles act on their driver’s Turn; leave them out of initiative.');
      return;
    default:
  }
}

/**
 * Damage step: a hit on someone behind a raised shield goes into the shield;
 * a ranged hit (not at the head) on someone holding a human shield goes to the
 * person held. Returns null when neither applies.
 */
export function gearDamage(state: SessionState, p: DamagePending, spec: DamagePending['spec'], dice: Dice, pre: { events: CombatEvent[]; actors: Record<string, Actor> }): Result | null {
  const target = state.actors[p.targetId];
  if (!target) return null;
  const g = grappleHolding(state, target.id);
  const held = g?.humanShield ? state.actors[g.heldId] : undefined;
  const shield = target.combatant.shield;
  const viaHuman = !!held && !held.combatant.conditions.dead && humanShieldBlocks(spec);
  const viaShield = !viaHuman && shieldUp(shield) && shieldBlocks(spec);
  if (!viaHuman && !viaShield) return null;
  const roll = rollDamage(spec, dice);
  const events: CombatEvent[] = [...pre.events, { type: 'damageRolled', visibility: 'public', dice: roll.dice, multiplier: roll.multiplier, total: roll.total, critTriggered: roll.critTriggered }];
  const actors: Record<string, Actor | null> = { ...pre.actors };

  if (viaHuman && held && g) {
    events.push(ev(target, 'humanShield', `${name(held)} takes the hit meant for ${name(target)}.`, { targetId: held.id }));
    const r = applyDamage(held.combatant, spec, roll, dice);
    events.push(...r.events);
    if (r.hpLost === 0 && !friendly(held)) events.push({ type: 'noEffect', visibility: 'public', targetId: held.id });
    actors[held.id] = withC(held, r.target); // if this kills them, trackExtras turns them into a shield
  } else if (shield) {
    const r = absorb(shield, roll.total + (spec.bonusDamage ?? 0));
    actors[target.id] = withC(target, applySystems({ ...target.combatant, shield: r.shield }));
    const own = friendly(target);
    events.push(ev(target, 'shieldHit', r.destroyed ? `${name(target)}’s ${shield.name} takes the hit and breaks.` : `${name(target)}’s ${shield.name} takes the hit.`,
      { success: !r.destroyed, ...(own ? { amount: r.absorbed, hpLeft: r.shield.hp } : {}) }));
  }
  return { events, patch: { actors, pending: null } };
}

/** Holders of human shields who just died get their bodies as shields. Called by trackExtras for dropped grapples. */
export function corpseShields(dropped: Grapple[], actors: Record<string, Actor | null>): { events: CombatEvent[]; actors?: Record<string, Actor> } {
  const out: Record<string, Actor> = {};
  const events: CombatEvent[] = [];
  for (const g of dropped) {
    const holder = actors[g.holderId];
    const held = actors[g.heldId];
    if (!g.humanShield || !holder || !held || !held.combatant.conditions.dead || holder.combatant.shield) continue;
    const body = held.combatant.stats.BODY;
    out[holder.id] = withC(holder, applySystems({ ...holder.combatant, shield: { name: `${name(held)}’s Body`, hp: body, maxHp: body, raised: true, body: true } }));
    events.push(ev(holder, 'corpseShield', `${name(holder)} keeps holding ${name(held)}’s body as a shield.`, { targetId: held.id, ...(friendly(holder) ? { hpLeft: body } : {}) }));
  }
  return Object.keys(out).length ? { events, actors: out } : { events };
}

// ----- Execution ----------------------------------------------------------------------------

export function executeGear(state: SessionState, raw: unknown, by: Viewer, dice: Dice, newId: () => string): Result {
  const op = parseGearOp(raw);
  const out = (events: CombatEvent[], patch: StatePatch, encounter?: Encounter): Result => ({ events, patch: encounter ? { ...patch, encounter } : patch });

  switch (op.op) {
    // ----- Shields -----
    case 'equipShield': {
      const a = acting(state, by, op.actorId);
      if (a.combatant.shield) throw new SessionError('INVALID', `${name(a)} already holds ${a.combatant.shield.name}. Drop it first.`);
      if (grappleHolding(state, a.id)?.humanShield) throw new SessionError('INVALID', `${name(a)} is already holding a human shield.`);
      const t = op.templateId ? SHIELD_TEMPLATES.find((x) => x.id === op.templateId) : undefined;
      if (op.templateId && !t) throw new SessionError('NOT_FOUND', 'No such shield.');
      const src = t ? { name: t.name, hp: t.hp } : op.shield!;
      const c: Combatant = { ...a.combatant, shield: { name: src.name, hp: src.hp, maxHp: src.hp, raised: true } };
      // It takes a hand (a character needs one free).
      if (handsFree(a.combatant) < 1) throw new SessionError('INVALID', `${name(a)} has no free hand for a shield.`);
      const enc = checkOtherAction(state, by, a);
      return out([ev(a, 'equipShield', `${name(a)} raises ${src.name}.`)], { actors: { [a.id]: withC(a, c) } }, enc);
    }
    case 'dropShield': {
      const a = acting(state, by, op.actorId);
      const s = a.combatant.shield;
      if (!s) throw new SessionError('INVALID', `${name(a)} isn’t holding a shield.`);
      const enc = checkOtherAction(state, by, a);
      const { shield: _gone, ...c } = a.combatant;
      return out([ev(a, 'dropShield', `${name(a)} drops ${s.name}.`)], { actors: { [a.id]: withC(a, c) } }, enc);
    }
    case 'raiseShield': {
      const a = getActor(state, op.actorId);
      if (!controls(by, a)) throw new SessionError('FORBIDDEN', `You don’t control ${name(a)}.`);
      const s = a.combatant.shield;
      if (!s) throw new SessionError('INVALID', `${name(a)} isn’t holding a shield.`);
      if (s.raised === op.raised) return out([], {});
      return out([ev(a, 'raiseShield', op.raised ? `${name(a)} raises ${s.name}.` : `${name(a)} lowers ${s.name}.`)], { actors: { [a.id]: withC(a, { ...a.combatant, shield: { ...s, raised: op.raised } }) } });
    }
    case 'humanShield': {
      const a = acting(state, by, op.actorId);
      const g = grappleHolding(state, a.id);
      if (!g) throw new SessionError('INVALID', `${name(a)} must be holding someone in a Grapple.`);
      if (g.humanShield) throw new SessionError('INVALID', 'Already a human shield.');
      if (a.combatant.shield) throw new SessionError('INVALID', `${name(a)} already holds a shield.`);
      const held = getActor(state, g.heldId);
      const enc = checkOtherAction(state, by, a);
      const grapples = state.extras!.grapples.map((x): Grapple => (x === g ? { ...x, humanShield: true } : x));
      return out([ev(a, 'humanShield', `${name(a)} holds ${name(held)} up as a human shield.`, { targetId: held.id })], { extras: { ...state.extras!, grapples } }, enc);
    }

    // ----- Drugs -----
    case 'takeDrug': {
      const a = acting(state, by, op.actorId);
      const t = op.targetId ? getActor(state, op.targetId) : a;
      if (isVehicle(t)) throw new SessionError('INVALID', 'That’s a vehicle.');
      const drug = op.drug ?? DRUG_TEMPLATES.find((d) => d.id === op.drugId);
      if (!drug) throw new SessionError('NOT_FOUND', 'No such drug.');
      if (t.id !== a.id) {
        // A willing target, within reach. Hostile dosing is a melee attack: the GM rules it.
        if (!controls(by, t) && by.role !== 'gm' && friendly(t) !== friendly(a)) throw new SessionError('FORBIDDEN', 'Only willing targets. Dosing an enemy is a melee attack the GM rules on.');
        const m = state.map;
        const p = m?.tokens[a.id], q = m?.tokens[t.id];
        if (p && q && gridDistance(p, q) > 1) throw new SessionError('OUT_OF_REACH', `${name(t)} isn’t in an adjacent square.`);
      }
      const enc = checkOtherAction(state, by, a);
      const r = dose(t.combatant.drugs, drug);
      const c = applySystems({ ...t.combatant, drugs: r.drugs });
      const takes = t.id === a.id ? `${name(a)} takes` : `${name(a)} doses ${name(t)} with`;
      const text = r.redose ? `${takes} another dose of ${drug.name}; it lasts ${drug.duration} from now.` : `${takes} ${drug.name} (${drug.duration}). ${drug.effect.note}`;
      return out([ev(t, 'takeDrug', text, { ...(t.id !== a.id ? { targetId: a.id } : {}) })], { actors: { [t.id]: withC(t, c) } }, enc);
    }
    case 'drugWearsOff': {
      gmOnly(by);
      const a = getActor(state, op.actorId);
      const s = a.combatant.drugs;
      const active = s?.active.find((d) => d.id === op.drugId);
      if (!s || !active) throw new SessionError('INVALID', `${name(a)} isn’t on that drug.`);
      const check = makeCheck([{ label: 'WILL', value: effectiveStat(a.combatant, 'WILL') }, { label: DRUG_SKILL, value: skillLevel(a.combatant, DRUG_SKILL) }], standingModifiers(a.combatant, 'other'), dice);
      const ok = beats(check.total, active.addictionDv);
      const r = wearOff(s, op.drugId, ok);
      const c = applySystems({ ...a.combatant, drugs: r.drugs });
      const already = s.addictions.some((d) => d.id === op.drugId);
      const text = ok ? `${active.name} wears off; ${name(a)} shakes it.`
        : r.addicted ? `${active.name} wears off and ${name(a)} is hooked. ${active.secondary.note}`
        : `${active.name} wears off; ${name(a)} is still hooked.`;
      return out([ev(a, 'drugWoreOff', text, { check, dv: active.addictionDv, success: ok || (!r.addicted && !already) })], { actors: { [a.id]: withC(a, c) } });
    }
    case 'cureAddiction': {
      gmOnly(by);
      const a = getActor(state, op.actorId);
      const s = a.combatant.drugs ?? emptyDrugs();
      const d = s.addictions.find((x) => x.id === op.drugId);
      if (!d) throw new SessionError('INVALID', `${name(a)} isn’t addicted to that.`);
      const c = applySystems({ ...a.combatant, drugs: cure(s, op.drugId) });
      return out([ev(a, 'cureAddiction', `${name(a)} is free of ${d.name}.`)], { actors: { [a.id]: withC(a, c) } });
    }

    // ----- Vehicles -----
    case 'spawnVehicle': {
      gmOnly(by);
      const t = VEHICLE_TEMPLATES.find((x) => x.id === op.templateId);
      if (!t) throw new SessionError('NOT_FOUND', 'No such vehicle.');
      if (state.actors[op.id]) throw new SessionError('INVALID', 'That id is taken.');
      const party = op.allegiance === 'party' || op.allegiance === 'ally';
      const vname = op.name ?? t.name;
      const combatant: Combatant = {
        id: op.id, name: vname, side: party ? 'pc' : 'npc',
        stats: { INT: 0, REF: 0, DEX: 0, TECH: 0, COOL: 0, WILL: 0, LUCK: 0, MOVE: t.move, BODY: 0, EMP: 0 },
        skills: {}, hp: { max: t.sdp, current: t.sdp }, armor: [], criticalInjuries: [], deathSave: { accumulatedPenalty: 0 },
        conditions: { prone: false, unconscious: false, dead: false, stabilized: false },
        vehicle: { seats: t.seats, move: t.move, topSpeed: t.topSpeed, passengers: [], driverId: null, ...(op.sp ? { sp: op.sp } : {}) },
      };
      const actor: Actor = { id: op.id, controller: op.controller ?? 'gm', weapons: [], combatant, allegiance: op.allegiance ?? 'neutral' };
      const patch: StatePatch = { actors: { [op.id]: actor } };
      const map = state.map;
      if (op.at && map) {
        if (op.at.x >= map.width || op.at.y >= map.height) throw new SessionError('INVALID', 'Pick a square on the map.');
        patch.map = withSpotted({ ...map, tokens: { ...map.tokens, [op.id]: op.at } }, { ...state.actors, [op.id]: actor });
      }
      return out([], patch);
    }
    case 'board': {
      const a = acting(state, by, op.actorId);
      const v = getActor(state, op.vehicleId);
      const vd = v.combatant.vehicle;
      if (!vd) throw new SessionError('INVALID', `${name(v)} isn’t a vehicle.`);
      if (vehicleOf(state, a.id)) throw new SessionError('INVALID', `${name(a)} is already aboard.`);
      if (!seatsLeft(vd)) throw new SessionError('INVALID', `${name(v)} is full.`);
      if (op.drive && vd.driverId) throw new SessionError('INVALID', `${name(v)} already has a driver.`);
      if (op.drive && v.combatant.conditions.dead) throw new SessionError('INVALID', `${name(v)} is wrecked.`);
      const map = state.map;
      const p = map?.tokens[a.id], q = map?.tokens[v.id];
      if (p && q && gridDistance(p, q) > 1) throw new SessionError('OUT_OF_REACH', `${name(a)} needs to be next to ${name(v)}.`);
      const enc = useMove(state, by, a);
      const vehicle = { ...vd, passengers: [...vd.passengers, a.id], ...(op.drive ? { driverId: a.id } : {}) };
      const patch: StatePatch = { actors: { [v.id]: withC(v, { ...v.combatant, vehicle }) } };
      if (map && p) { const { [a.id]: _in, ...tokens } = map.tokens; patch.map = { ...map, tokens }; }
      return out([ev(a, 'board', op.drive ? `${name(a)} takes the wheel of ${name(v)}.` : `${name(a)} climbs into ${name(v)}.`, { targetId: v.id })], patch, enc);
    }
    case 'exit': {
      const a = acting(state, by, op.actorId);
      const v = vehicleOf(state, a.id);
      if (!v) throw new SessionError('INVALID', `${name(a)} isn’t in a vehicle.`);
      const vd = v.combatant.vehicle!;
      const enc = useMove(state, by, a);
      const vehicle = { ...vd, passengers: vd.passengers.filter((x) => x !== a.id), driverId: vd.driverId === a.id ? null : vd.driverId ?? null };
      const patch: StatePatch = { actors: { [v.id]: withC(v, { ...v.combatant, vehicle }) } };
      const map = state.map;
      const vat = map?.tokens[v.id];
      if (map && vat) {
        const at = op.at ?? freeCellNear(map, state, vat);
        if (!at) throw new SessionError('NO_MOVEMENT', `There’s no room to get out of ${name(v)}.`);
        if (gridDistance(at, vat) > 1 || at.x >= map.width || at.y >= map.height || map.cells[at.y * map.width + at.x] === '#'
          || Object.values(map.tokens).some((c) => c.x === at.x && c.y === at.y)) throw new SessionError('INVALID', 'Get out into a free square next to the vehicle.');
        patch.map = withSpotted({ ...map, tokens: { ...map.tokens, [a.id]: at } }, state.actors);
      }
      return out([ev(a, 'exit', `${name(a)} gets out of ${name(v)}.`, { targetId: v.id })], patch, enc);
    }
    case 'drive': {
      const a = acting(state, by, op.actorId);
      const v = vehicleOf(state, a.id);
      if (!v || v.combatant.vehicle!.driverId !== a.id) throw new SessionError('INVALID', `${name(a)} isn’t driving anything.`);
      if (v.combatant.conditions.dead || v.combatant.hp.current <= 0) throw new SessionError('INVALID', `${name(v)} is wrecked.`);
      const map = state.map;
      if (!map || !map.tokens[v.id]) throw new SessionError('INVALID', `${name(v)} isn’t on the map.`);
      if (op.to.x >= map.width || op.to.y >= map.height) throw new SessionError('INVALID', 'Pick a square on the map.');
      const u = usageFor(state, a.id);
      const budget = by.role === 'gm' || !u ? map.width * map.height * 2 : v.combatant.vehicle!.move;
      if (u && by.role !== 'gm' && u.moveUsed > 0) throw new SessionError('NO_MOVEMENT', `${name(a)} has already used the Move Action.`);
      const plan = planMove(map, state.actors, v.id, op.to, budget);
      if (!plan || !plan.path.length) throw new SessionError('NO_MOVEMENT', `${name(v)} can’t reach that square this Turn.`);
      const dest = plan.path[plan.path.length - 1]!;
      const enc = u ? { ...state.encounter, usage: { ...u, moveUsed: Math.max(u.moveUsed, effectiveStat(a.combatant, 'MOVE')) } } : undefined;
      const events: CombatEvent[] = [{ type: 'tokenMoved', visibility: visibilityFor(v), combatantId: v.id, path: plan.path, cost: plan.path.length, ran: false }];
      // Driving with REF + Drive Land Vehicle of 9 or less needs a control check each Turn (Secondary): the GM rolls it.
      const drive = effectiveStat(a.combatant, 'REF') + skillLevel(a.combatant, 'Drive Land Vehicle');
      if (drive <= 9) events.push({ type: 'gmRulingRequired', visibility: 'gm', reason: `${name(a)} (REF + Drive Land Vehicle ${drive}) must spend an Action on a Drive check to keep ${name(v)} under control.` });
      return out(events, { map: withSpotted({ ...map, tokens: { ...map.tokens, [v.id]: dest } }, state.actors) }, enc);
    }
    case 'attackVehicle': {
      const a = acting(state, by, op.attackerId);
      const v = getActor(state, op.vehicleId);
      const vd = v.combatant.vehicle;
      if (!vd) throw new SessionError('INVALID', `${name(v)} isn’t a vehicle.`);
      if (v.combatant.conditions.dead) throw new SessionError('INVALID', `${name(v)} is already wrecked.`);
      const w = getWeapon(a, op.weaponId);
      const p = profileOf(w);
      if (p.rangeRow === 'grenadeLauncher' || p.rangeRow === 'rocketLauncher') throw new SessionError('INVALID', `Fire ${w.name} as an area attack.`);
      const map = state.map;
      const from = map?.tokens[a.id], to = map?.tokens[v.id];
      const events: CombatEvent[] = [];
      let hit = true;
      let spent = 0;
      const aimMod: Modifier[] = op.aimed ? [{ label: 'Aimed at a Weak Spot', value: VEHICLE_AIM_PENALTY }] : [];
      if (p.melee) {
        if (from && to && gridDistance(from, to) > 1) throw new SessionError('OUT_OF_REACH', `${name(v)} isn’t in an adjacent square.`);
        if (op.aimed) {
          const check = makeCheck([{ label: 'DEX', value: effectiveStat(a.combatant, 'DEX') }, { label: p.skill, value: skillLevel(a.combatant, p.skill) }], [...standingModifiers(a.combatant, 'meleeAttack'), ...qualityMods(w), ...aimMod], dice);
          // Interpretation: a melee weak-spot strike rolls against DV 15.
          hit = beats(check.total, 15);
          events.push({ type: 'checkRolled', visibility: visibilityFor(a), by: a.controller, combatantId: a.id, label: 'Strike a Weak Spot', check, dv: 15, success: hit });
        }
      } else {
        if (!from || !to) throw new SessionError('INVALID', 'Both need to be on the map.');
        if (!hasLineOfSight(map!, from, to)) throw new SessionError('NO_LINE_OF_SIGHT', `${name(v)} is out of sight.`);
        const band = rangeBandIndex(Math.max(1, metersBetween(from, to)));
        const dv = band < 0 ? null : RANGE_DV[p.rangeRow!][band];
        if (dv == null) throw new SessionError('OUT_OF_REACH', `${w.name} can’t reach that far.`);
        if (w.ammo && w.ammo.loaded < 1) throw new SessionError('INVALID', `${w.name} is empty.`);
        spent = w.ammo ? 1 : 0;
        const check = makeCheck([{ label: 'REF', value: effectiveStat(a.combatant, 'REF') }, { label: p.skill, value: skillLevel(a.combatant, p.skill) }],
          [...standingModifiers(a.combatant, 'rangedAttack'), ...qualityMods(w), ...aimMod], dice);
        hit = beats(check.total, dv);
        events.push({ type: 'checkRolled', visibility: visibilityFor(a), by: a.controller, combatantId: a.id, label: op.aimed ? 'Shoot a Weak Spot' : 'Shoot the Vehicle', check, dv, success: hit });
        if (spent) events.push({ type: 'ammoSpent', visibility: visibilityFor(a), combatantId: a.id, weaponId: w.id, rounds: spent });
      }
      const encounter = checkAttackAction(state, by, a, w.id, attacksPerAction(w));
      const actors: Record<string, Actor> = {};
      if (spent) actors[a.id] = { ...a, weapons: a.weapons.map((x) => (x.id === w.id ? spendAmmo(x, spent) : x)) };
      if (hit) {
        const roll = rollDamage({ diceCount: w.damageDiceOverride ?? p.damageDice, multiplier: 1 }, dice);
        events.push({ type: 'damageRolled', visibility: 'public', dice: roll.dice, multiplier: 1, total: roll.total, critTriggered: false });
        const dmg = vehicleDamage(roll.total, vd.sp, !!op.aimed);
        const sdp = Math.max(0, v.combatant.hp.current - dmg);
        const wrecked = sdp === 0;
        actors[v.id] = withC(v, { ...v.combatant, hp: { ...v.combatant.hp, current: sdp }, conditions: { ...v.combatant.conditions, dead: wrecked } });
        const own = friendly(v);
        events.push(ev(v, 'vehicleDamaged', wrecked ? `${name(v)} is wrecked.` : dmg === 0 ? `The hit doesn’t get through ${name(v)}’s plating.` : `${name(v)} takes the hit.`,
          { targetId: a.id, success: dmg > 0, ...(own ? { amount: dmg, hpLeft: sdp } : {}) }));
        if (wrecked && vd.passengers.length) events.push({ type: 'gmRulingRequired', visibility: 'gm', reason: `${name(v)} is wrecked with people aboard. Rule what happens to them.` });
      }
      return { events, patch: { ...(Object.keys(actors).length ? { actors } : {}), ...(encounter ? { encounter } : {}) } };
    }
    case 'ram': {
      const v = getActor(state, op.vehicleId);
      const vd = v.combatant.vehicle;
      if (!vd) throw new SessionError('INVALID', `${name(v)} isn’t a vehicle.`);
      const driver = vd.driverId ? getActor(state, vd.driverId) : undefined;
      if (by.role !== 'gm' && !(driver && controls(by, driver))) throw new SessionError('FORBIDDEN', 'Only the driver (or the GM) can ram.');
      if (driver) acting(state, by, driver.id);
      const t = getActor(state, op.targetId);
      const enc = driver ? checkOtherAction(state, by, driver) : undefined;
      return out([
        ev(v, 'ram', `${name(v)} rams ${name(t)}.`, { targetId: t.id }),
        { type: 'gmRulingRequired', visibility: 'gm', reason: `${name(v)} rams ${name(t)}: both take damage and everyone involved risks whiplash. A pedestrian may try to dodge. If ${name(t)} doesn’t drop, the vehicle stops.` },
      ], {}, enc);
    }
  }
}
