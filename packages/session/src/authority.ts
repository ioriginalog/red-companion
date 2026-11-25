/**
 * The authority: validates an Intent, runs the rules engine, and produces the
 * next LogEntry. Runs only on the GM device. Pure given (state, intent, dice).
 *
 * Flow rules enforced here (beyond the rules engine):
 *  - Only the GM can set up actors, encounters, and overrides.
 *  - Players act only through actors they control, and only on that actor's Turn.
 *  - One pending step at a time (awaiting a dodge decision or a damage roll);
 *    nothing else happens until it's resolved or the GM cancels it.
 *  - A Mortally Wounded actor must roll its Death Save before doing anything else on its Turn.
 */
import {
  applyDamage, canDodgeRanged, resolveMeleeAttack, resolveRangedAttack, rollDamage, rollDeathSave, rollInitiative,
  RulesError, spendAmmo, stabilize, turnStartChecklist, woundState,
  type CombatEvent, type Dice, type Weapon,
} from '@cprc/rules-core';
import type {
  Accepted, Actor, AuthorId, Encounter, Intent, IntentType, LogEntry, Pending, RangedAttackIntent, Rejection, SessionState,
  StatePatch, Viewer,
} from './types.js';

export class SessionError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'NOT_YOUR_TURN' | 'PENDING' | 'NO_PENDING' | 'DEATH_SAVE_FIRST' | 'INVALID', message: string) {
    super(message);
  }
}

export interface AuthorityContext {
  dice: Dice;
  now?: () => string;
  newId?: () => string;
}

const GM_ONLY: ReadonlySet<IntentType> = new Set(['addActor', 'replaceActor', 'removeActor', 'assignController', 'startEncounter', 'endEncounter', 'cancelPending']);
const ALLOWED_WHILE_PENDING: ReadonlySet<IntentType> = new Set(['respondDodge', 'rollDamage', 'cancelPending']);

export function authorId(v: Viewer): AuthorId {
  return v.role === 'gm' ? 'gm' : `player:${v.playerId}`;
}

export function handleIntent(state: SessionState, intent: Intent, by: Viewer, ctx: AuthorityContext): Accepted | Rejection {
  const newId = ctx.newId ?? (() => globalThis.crypto.randomUUID());
  try {
    authorize(state, intent, by);
    const { events, patch } = execute(state, intent, by, ctx.dice, newId);
    const entry: LogEntry = {
      seq: state.seq + 1,
      id: newId(),
      at: (ctx.now ?? (() => new Date().toISOString()))(),
      by: authorId(by),
      intent,
      events,
      patch,
    };
    return { ok: true, entry };
  } catch (e) {
    if (e instanceof RulesError || e instanceof SessionError) return { ok: false, code: e.code, message: e.message };
    throw e;
  }
}

// ----- Authorization -------------------------------------------------------------

function getActor(state: SessionState, id: string): Actor {
  const a = state.actors[id];
  if (!a) throw new SessionError('NOT_FOUND', `No actor ${id}.`);
  return a;
}

function controls(by: Viewer, a: Actor): boolean {
  return by.role === 'gm' || a.controller === by.playerId;
}

export function currentActorId(state: SessionState): string | null {
  return state.encounter.active ? (state.encounter.order[state.encounter.turnIndex] ?? null) : null;
}

function requireActing(state: SessionState, by: Viewer, actorId: string) {
  const a = getActor(state, actorId);
  if (!controls(by, a)) throw new SessionError('FORBIDDEN', `You don’t control ${a.combatant.name}.`);
  if (by.role === 'gm') return;
  if (state.encounter.active && currentActorId(state) !== actorId) throw new SessionError('NOT_YOUR_TURN', `It isn’t ${a.combatant.name}’s Turn.`);
  if (state.encounter.deathSaveRequiredFor === actorId) throw new SessionError('DEATH_SAVE_FIRST', `${a.combatant.name} must roll a Death Save first.`);
}

function authorize(state: SessionState, intent: Intent, by: Viewer) {
  if (GM_ONLY.has(intent.type) && by.role !== 'gm') throw new SessionError('FORBIDDEN', 'Only the GM can do that.');
  if (state.pending && !ALLOWED_WHILE_PENDING.has(intent.type)) throw new SessionError('PENDING', 'Finish the current attack first.');

  switch (intent.type) {
    case 'rangedAttack':
    case 'meleeAttack':
      requireActing(state, by, intent.attackerId);
      getActor(state, intent.defenderId);
      break;
    case 'stabilize':
      requireActing(state, by, intent.medicId);
      getActor(state, intent.targetId);
      break;
    case 'reload':
      requireActing(state, by, intent.actorId);
      break;
    case 'deathSave': {
      const a = getActor(state, intent.actorId);
      if (!controls(by, a)) throw new SessionError('FORBIDDEN', `You don’t control ${a.combatant.name}.`);
      break;
    }
    case 'respondDodge': {
      const p = state.pending;
      if (!p || p.kind !== 'awaitingDodge' || p.id !== intent.pendingId) throw new SessionError('NO_PENDING', 'No dodge decision is waiting.');
      const d = getActor(state, p.defenderId);
      if (!controls(by, d)) throw new SessionError('FORBIDDEN', `Only ${d.combatant.name}’s player decides.`);
      break;
    }
    case 'rollDamage': {
      const p = state.pending;
      if (!p || p.kind !== 'awaitingDamage' || p.id !== intent.pendingId) throw new SessionError('NO_PENDING', 'No damage roll is waiting.');
      const a = getActor(state, p.attackerId);
      if (!controls(by, a)) throw new SessionError('FORBIDDEN', `Only ${a.combatant.name}’s player rolls damage.`);
      break;
    }
    case 'endTurn': {
      if (!state.encounter.active) throw new SessionError('INVALID', 'No encounter is running.');
      const cur = currentActorId(state);
      if (by.role !== 'gm' && (!cur || getActor(state, cur).controller !== by.playerId)) throw new SessionError('NOT_YOUR_TURN', 'It isn’t your Turn.');
      break;
    }
    default:
      break;
  }
}

// ----- Execution ----------------------------------------------------------------

type Result = { events: CombatEvent[]; patch: StatePatch };

function execute(state: SessionState, intent: Intent, by: Viewer, dice: Dice, newId: () => string): Result {
  switch (intent.type) {
    case 'addActor': {
      const a = intent.actor;
      if (state.actors[a.id]) throw new SessionError('INVALID', `Actor ${a.id} already exists.`);
      if (a.combatant.id !== a.id) throw new SessionError('INVALID', 'actor.id must equal combatant.id.');
      return { events: [], patch: { actors: { [a.id]: a } } };
    }
    case 'replaceActor': {
      getActor(state, intent.actor.id);
      if (intent.actor.combatant.id !== intent.actor.id) throw new SessionError('INVALID', 'actor.id must equal combatant.id.');
      return { events: [], patch: { actors: { [intent.actor.id]: intent.actor } } };
    }
    case 'removeActor': {
      getActor(state, intent.actorId);
      const patch: StatePatch = { actors: { [intent.actorId]: null } };
      const enc = state.encounter;
      const idx = enc.order.indexOf(intent.actorId);
      if (idx >= 0) {
        const order = enc.order.filter((id) => id !== intent.actorId);
        let turnIndex = idx < enc.turnIndex ? enc.turnIndex - 1 : enc.turnIndex;
        if (turnIndex >= order.length) turnIndex = 0;
        const actorsAfter = { ...state.actors };
        delete actorsAfter[intent.actorId];
        patch.encounter = settleTurn({ ...enc, order, turnIndex, active: enc.active && order.length > 0 }, actorsAfter);
      }
      return { events: [], patch };
    }
    case 'assignController': {
      const a = getActor(state, intent.actorId);
      return { events: [], patch: { actors: { [a.id]: { ...a, controller: intent.controller } } } };
    }
    case 'startEncounter': {
      if (state.encounter.active) throw new SessionError('INVALID', 'An encounter is already running.');
      if (intent.participants.length === 0) throw new SessionError('INVALID', 'Add at least one participant.');
      const parts = intent.participants.map((p) => ({ combatant: getActor(state, p.actorId).combatant, bonus: p.bonus }));
      const { order, events } = rollInitiative(parts, dice);
      const encounter = settleTurn({ active: true, round: 1, order: order.map((e) => e.combatantId), turnIndex: 0, deathSaveRequiredFor: null }, state.actors);
      return { events, patch: { encounter, pending: null } };
    }
    case 'endEncounter':
      return { events: [], patch: { encounter: { active: false, round: 0, order: [], turnIndex: 0, deathSaveRequiredFor: null }, pending: null } };
    case 'cancelPending':
      if (!state.pending) throw new SessionError('NO_PENDING', 'Nothing to cancel.');
      return { events: [], patch: { pending: null } };
    case 'endTurn':
      return { events: [], patch: { encounter: settleTurn(advance(state.encounter), state.actors) } };

    case 'rangedAttack': {
      const attacker = getActor(state, intent.attackerId);
      const defender = getActor(state, intent.defenderId);
      const weapon = getWeapon(attacker, intent.weaponId);
      if (intent.defenderDodges === undefined && canDodgeRanged(defender.combatant)) {
        precheckRanged(intent, attacker, defender, weapon);
        const pending: Pending = { kind: 'awaitingDodge', id: newId(), attack: intent, defenderId: defender.id };
        return { events: [], patch: { pending } };
      }
      return doRanged(state, intent, intent.defenderDodges ?? false, dice, newId);
    }
    case 'respondDodge': {
      const p = state.pending as Extract<Pending, { kind: 'awaitingDodge' }>;
      return doRanged(state, p.attack, intent.dodge, dice, newId);
    }
    case 'meleeAttack': {
      const attacker = getActor(state, intent.attackerId);
      const defender = getActor(state, intent.defenderId);
      const withKind = intent.with.kind === 'weapon'
        ? { kind: 'weapon' as const, weapon: getWeapon(attacker, intent.with.weaponId) }
        : intent.with;
      const out = resolveMeleeAttack({
        attacker: attacker.combatant, defender: defender.combatant, with: withKind,
        aimTarget: intent.aimTarget, situational: intent.situational, gmDvIfDefenderCannotEvade: intent.gmDv,
      }, dice);
      const pending: Pending | null = out.damage ? { kind: 'awaitingDamage', id: newId(), attackerId: attacker.id, targetId: defender.id, spec: out.damage } : null;
      return { events: out.events, patch: { pending } };
    }
    case 'rollDamage': {
      const p = state.pending as Extract<Pending, { kind: 'awaitingDamage' }>;
      const target = getActor(state, p.targetId);
      const roll = rollDamage(p.spec, dice);
      const r = applyDamage(target.combatant, p.spec, roll, dice);
      const events: CombatEvent[] = [
        { type: 'damageRolled', visibility: 'public', dice: roll.dice, multiplier: roll.multiplier, total: roll.total, critTriggered: roll.critTriggered },
        ...r.events,
      ];
      return { events, patch: { actors: { [target.id]: { ...target, combatant: r.target } }, pending: null } };
    }
    case 'deathSave': {
      const a = getActor(state, intent.actorId);
      const r = rollDeathSave(a.combatant, dice);
      const patch: StatePatch = { actors: { [a.id]: { ...a, combatant: r.combatant } } };
      if (state.encounter.deathSaveRequiredFor === a.id) patch.encounter = { ...state.encounter, deathSaveRequiredFor: null };
      return { events: r.events, patch };
    }
    case 'stabilize': {
      const medic = getActor(state, intent.medicId);
      const target = getActor(state, intent.targetId);
      const r = stabilize(medic.combatant, target.combatant, intent.skill, dice, intent.situational);
      return { events: r.events, patch: { actors: { [target.id]: { ...target, combatant: r.combatant } } } };
    }
    case 'reload': {
      const a = getActor(state, intent.actorId);
      const w = getWeapon(a, intent.weaponId);
      if (!w.ammo) throw new SessionError('INVALID', `${w.name} doesn’t use a magazine.`);
      const reloaded: Weapon = { ...w, ammo: { ...w.ammo, loaded: w.ammo.capacity } };
      return { events: [], patch: { actors: { [a.id]: { ...a, weapons: a.weapons.map((x) => (x.id === w.id ? reloaded : x)) } } } };
    }
  }
}

function getWeapon(a: Actor, weaponId: string): Weapon {
  const w = a.weapons.find((x) => x.id === weaponId);
  if (!w) throw new SessionError('NOT_FOUND', `${a.combatant.name} has no weapon ${weaponId}.`);
  return w;
}

class PrecheckPassed extends Error {}
const PRECHECK_DICE: Dice = {
  d10: () => { throw new PrecheckPassed(); },
  d6: () => { throw new PrecheckPassed(); },
};

/**
 * Validate range/ammo/mode BEFORE asking the defender to decide on a dodge.
 * The engine throws every RulesError before its first die roll, so running it
 * with dice that abort on first use is a side-effect-free validation.
 */
function precheckRanged(intent: RangedAttackIntent, attacker: Actor, defender: Actor, weapon: Weapon) {
  try {
    resolveRangedAttack({ ...toEngineRanged(intent, attacker, defender, weapon), defenderDodges: false }, PRECHECK_DICE);
  } catch (e) {
    if (e instanceof PrecheckPassed) return;
    throw e;
  }
}

function toEngineRanged(intent: RangedAttackIntent, attacker: Actor, defender: Actor, weapon: Weapon) {
  return {
    attacker: attacker.combatant, defender: defender.combatant, weapon,
    distance: intent.distance, mode: intent.mode, aimTarget: intent.aimTarget, situational: intent.situational,
  };
}

function doRanged(state: SessionState, intent: RangedAttackIntent, dodge: boolean, dice: Dice, newId: () => string): Result {
  const attacker = getActor(state, intent.attackerId);
  const defender = getActor(state, intent.defenderId);
  const weapon = getWeapon(attacker, intent.weaponId);
  const out = resolveRangedAttack({ ...toEngineRanged(intent, attacker, defender, weapon), defenderDodges: dodge }, dice);
  const spent = spendAmmo(weapon, out.ammoSpent);
  const pending: Pending | null = out.damage ? { kind: 'awaitingDamage', id: newId(), attackerId: attacker.id, targetId: defender.id, spec: out.damage } : null;
  return {
    events: out.events,
    patch: { actors: { [attacker.id]: { ...attacker, weapons: attacker.weapons.map((w) => (w.id === weapon.id ? spent : w)) } }, pending },
  };
}

// ----- Turn order -------------------------------------------------------------

function advance(enc: Encounter): Encounter {
  const next = enc.turnIndex + 1;
  return next >= enc.order.length ? { ...enc, turnIndex: 0, round: enc.round + 1 } : { ...enc, turnIndex: next };
}

/**
 * Skip actors who can't take a Turn (dead, removed, or Unconscious and not
 * dying). Unconscious-but-Mortally-Wounded still gets a Turn for the Death Save.
 * Flags the Death Save requirement for whoever lands as current.
 */
export function settleTurn(enc: Encounter, actors: Record<string, Actor>): Encounter {
  if (!enc.active || enc.order.length === 0) return { ...enc, deathSaveRequiredFor: null };
  let e = enc;
  for (let i = 0; i < enc.order.length; i++) {
    const id = e.order[e.turnIndex]!;
    const a = actors[id];
    if (a) {
      const c = a.combatant;
      const dying = woundState(c.hp) === 'mortally' && !c.conditions.dead;
      if (dying || !turnStartChecklist(c).skipTurn) {
        return { ...e, deathSaveRequiredFor: turnStartChecklist(c).deathSaveRequired ? id : null };
      }
    }
    e = advance(e);
  }
  return { ...e, deathSaveRequiredFor: null };
}
