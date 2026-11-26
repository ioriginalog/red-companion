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
  applyDamage, attacksPerAction, canDodgeRanged, cellKey, effectiveStat, gridDistance, hasLineOfSight, isPassable, metersBetween,
  resolveMeleeAttack, terrainAt, resolveRangedAttack, rollDamage, rollDeathSave, rollInitiative,
  RulesError, spendAmmo, stabilize, turnStartChecklist, woundState,
  type Cell, type CombatEvent, type Dice, type Weapon,
} from '@cprc/rules-core';
import { factionOf, planMove, watchTrigger, withSpotted } from './tactical.js';
import {
  checkAttackAction, checkOtherAction, controls, currentActorId, freshUsage, getActor, getWeapon, requireMap, SessionError, usageFor, visibilityFor,
} from './helpers.js';
import { executeTool, TOOL_GM_ONLY, TOOL_WHILE_PENDING } from './tools.js';
import { executeHandout } from './handouts.js'; // Track U
import { executePlayerEdit } from './player-edits.js'; // Round 4 U4
// --- Track N ---
import { executeNet } from './netrun.js';
// --- end Track N ---
import { doAreaAttack, doSuppressiveFire } from './grid-area.js';
import { validateIntent } from './validate.js';
import { executeExtra, extrasAdjust, extrasGate, trackExtras } from './extras.js'; // Round 3 X
// --- Track K ---
import { authorizeSystems, beforeDamage, executeSystems, isSystemsIntent, onTurnStart, SYSTEMS_GM_ONLY, SYSTEMS_WHILE_PENDING, wieldCheck } from './systems.js';
// --- end Track K ---
// --- Round 3 P ---
import { authorizePlayLoop, executePlayLoop, isPlayLoopIntent, PLAYLOOP_WHILE_PENDING } from './playloop.js';
// --- end Round 3 P ---

export { SessionError, currentActorId };
import type {
  Accepted, Actor, AuthorId, Encounter, Intent, IntentType, LogEntry, Pending, RangedAttackIntent, Rejection, SessionState,
  StatePatch, TacticalMap, TurnUsage, Viewer,
} from './types.js';

export interface AuthorityContext {
  dice: Dice;
  now?: () => string;
  newId?: () => string;
}

const GM_ONLY: ReadonlySet<IntentType> = new Set([
  'addActor', 'replaceActor', 'removeActor', 'assignController', 'startEncounter', 'endEncounter', 'cancelPending', 'setMap', 'placeToken',
  ...TOOL_GM_ONLY,
  'setHandout', 'removeHandout', // Track U
]);
const ALLOWED_WHILE_PENDING: ReadonlySet<IntentType> = new Set(['respondDodge', 'rollDamage', 'cancelPending', 'declineWatch', ...TOOL_WHILE_PENDING, 'setHandout', 'removeHandout', 'editOwnSheet' /* Round 4 U4 */, ...SYSTEMS_WHILE_PENDING /* Track K */, ...(PLAYLOOP_WHILE_PENDING as ReadonlySet<IntentType>) /* Round 3 P */]);

export function authorId(v: Viewer): AuthorId {
  return v.role === 'gm' ? 'gm' : `player:${v.playerId}`;
}

export function handleIntent(state: SessionState, intent: Intent, by: Viewer, ctx: AuthorityContext): Accepted | Rejection {
  const newId = ctx.newId ?? (() => globalThis.crypto.randomUUID());
  try {
    validateIntent(state, intent, by);
    const effective = extrasAdjust(state, intent); // Round 3 X: Grapple and Facedown penalties
    authorize(state, effective, by);
    const { events, patch } = trackExtras(state, effective, execute(state, effective, by, ctx.dice, newId)); // Round 3 X
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

function requireActing(state: SessionState, by: Viewer, actorId: string, outOfTurnOk = false) {
  const a = getActor(state, actorId);
  if (!controls(by, a)) throw new SessionError('FORBIDDEN', `You don’t control ${a.combatant.name}.`);
  if (by.role === 'gm' || outOfTurnOk) return;
  if (state.encounter.active && currentActorId(state) !== actorId) throw new SessionError('NOT_YOUR_TURN', `It isn’t ${a.combatant.name}’s Turn.`);
  if (state.encounter.deathSaveRequiredFor === actorId) throw new SessionError('DEATH_SAVE_FIRST', `${a.combatant.name} must roll a Death Save first.`);
}

function authorize(state: SessionState, intent: Intent, by: Viewer) {
  if (GM_ONLY.has(intent.type) && by.role !== 'gm') throw new SessionError('FORBIDDEN', 'Only the GM can do that.');
  if (SYSTEMS_GM_ONLY.has(intent.type) && by.role !== 'gm') throw new SessionError('FORBIDDEN', 'Only the GM can do that.'); // Track K
  const watch = state.pending?.kind === 'awaitingWatch' ? state.pending : null;
  const isWatchShot = !!watch && (intent.type === 'rangedAttack' || intent.type === 'meleeAttack')
    && intent.attackerId === watch.watcherId && intent.defenderId === watch.targetId;
  if (state.pending && !ALLOWED_WHILE_PENDING.has(intent.type) && !isWatchShot) {
    throw new SessionError('PENDING', watch ? 'Resolve the watch first.' : 'Finish the current attack first.');
  }

  wieldCheck(state, intent); // Track K: arm injuries limit weapons
  extrasGate(state, intent); // Round 3 X: what a grapple forbids
  switch (intent.type) {
    case 'rangedAttack':
    case 'meleeAttack':
      requireActing(state, by, intent.attackerId, isWatchShot);
      getActor(state, intent.defenderId);
      if (intent.type === 'rangedAttack' && intent.ignoreLineOfSight && by.role !== 'gm') throw new SessionError('FORBIDDEN', 'Only the GM can rule a target visible.');
      break;
    case 'moveToken':
    case 'setWatch':
      requireActing(state, by, intent.actorId);
      break;
    case 'areaAttack':
    case 'suppressiveFire':
      requireActing(state, by, intent.attackerId);
      break;
    case 'clearWatch': {
      const a = getActor(state, intent.actorId);
      if (!controls(by, a)) throw new SessionError('FORBIDDEN', `You don’t control ${a.combatant.name}.`);
      break;
    }
    case 'declineWatch': {
      if (!watch || watch.id !== intent.pendingId) throw new SessionError('NO_PENDING', 'No watch is waiting.');
      const w = getActor(state, watch.watcherId);
      if (!controls(by, w)) throw new SessionError('FORBIDDEN', `Only ${w.combatant.name}’s player decides.`);
      break;
    }
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
      if (isPlayLoopIntent(intent)) { authorizePlayLoop(state, intent, by); break; } // Round 3 P
      authorizeSystems(state, intent, by); // Track K
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
      if (state.map?.tokens[intent.actorId]) {
        const { [intent.actorId]: _t, ...tokens } = state.map.tokens;
        const { [intent.actorId]: _w, ...watches } = state.map.watches;
        patch.map = { ...state.map, tokens, watches };
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
      const encounter = settleTurn({
        active: true, round: 1, order: order.map((e) => e.combatantId), turnIndex: 0, deathSaveRequiredFor: null,
        // Round 3 P: keep totals for late arrivals; the Delay house rule setting carries over.
        initiative: Object.fromEntries(order.map((e) => [e.combatantId, e.total])),
        ...(state.encounter.delayAllowed !== undefined ? { delayAllowed: state.encounter.delayAllowed } : {}),
      }, state.actors);
      const patch: StatePatch = { encounter, pending: null };
      if (state.map && Object.keys(state.map.watches).length) patch.map = { ...state.map, watches: {} };
      return { events, patch };
    }
    case 'endEncounter':
      return { events: [], patch: { encounter: { active: false, round: 0, order: [], turnIndex: 0, deathSaveRequiredFor: null, ...(state.encounter.delayAllowed !== undefined ? { delayAllowed: state.encounter.delayAllowed } : {}) /* Round 3 P */ }, pending: null } };
    case 'cancelPending':
      if (!state.pending) throw new SessionError('NO_PENDING', 'Nothing to cancel.');
      return { events: [], patch: { pending: null } };
    case 'endTurn': {
      const encounter = settleTurn({ ...advance(state.encounter), usage: undefined }, state.actors);
      const patch: StatePatch = { encounter };
      const burn = onTurnStart(state, encounter); // Track K: On Fire
      if (Object.keys(burn.actors).length) patch.actors = burn.actors;
      // A watch lasts until the watcher's next Turn.
      const next = encounter.order[encounter.turnIndex];
      if (state.map && next && state.map.watches[next]) {
        const { [next]: _ended, ...watches } = state.map.watches;
        patch.map = { ...state.map, watches };
      }
      return { events: burn.events, patch };
    }

    case 'rangedAttack': {
      const attacker = getActor(state, intent.attackerId);
      const defender = getActor(state, intent.defenderId);
      const weapon = getWeapon(attacker, intent.weaponId);
      const geo = withMapGeometry(state, intent);
      checkAttackAction(state, by, attacker, intent.weaponId, attacksPerAction(weapon, { aimed: !!geo.aimTarget, autofire: geo.mode === 'autofire' }));
      if (geo.defenderDodges === undefined && canDodgeRanged(defender.combatant)) {
        precheckRanged(geo, attacker, defender, weapon);
        const pending: Pending = { kind: 'awaitingDodge', id: newId(), attack: geo, defenderId: defender.id };
        return { events: [], patch: { pending } };
      }
      return doRanged(state, geo, geo.defenderDodges ?? false, dice, newId);
    }
    case 'declineWatch':
      return { events: [], patch: { pending: null } };
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
      const a = state.map?.tokens[attacker.id];
      const d = state.map?.tokens[defender.id];
      if (a && d && gridDistance(a, d) > 1) throw new SessionError('OUT_OF_REACH', `${defender.combatant.name} isn’t in an adjacent square.`);
      const withKey = withKind.kind === 'weapon' ? withKind.weapon.id : withKind.kind;
      const encounter = checkAttackAction(state, by, attacker, withKey,
        attacksPerAction(withKind.kind === 'weapon' ? withKind.weapon : withKind.kind, { aimed: !!intent.aimTarget }));
      const out = resolveMeleeAttack({
        attacker: attacker.combatant, defender: defender.combatant, with: withKind,
        aimTarget: intent.aimTarget, situational: intent.situational, gmDvIfDefenderCannotEvade: intent.gmDv,
      }, dice);
      const pending: Pending | null = out.damage ? { kind: 'awaitingDamage', id: newId(), attackerId: attacker.id, targetId: defender.id, spec: out.damage } : null;
      return { events: out.events, patch: encounter ? { pending, encounter } : { pending } };
    }
    case 'rollDamage': {
      const p = state.pending as Extract<Pending, { kind: 'awaitingDamage' }>;
      const target = getActor(state, p.targetId);
      const k = beforeDamage(state, p); // Track K: Round stamp (Damage Deflection), Spot Weakness
      const roll = rollDamage(k.spec, dice);
      const r = applyDamage(target.combatant, k.spec, roll, dice);
      const events: CombatEvent[] = [
        ...k.events,
        { type: 'damageRolled', visibility: 'public', dice: roll.dice, multiplier: roll.multiplier, total: roll.total, critTriggered: roll.critTriggered },
        ...r.events,
      ];
      // Round 3 P: players see "no effect" when armor stopped it (no SP numbers).
      if (r.hpLost === 0 && factionOf(target) !== 'friendly') events.push({ type: 'noEffect', visibility: 'public', targetId: target.id });
      return { events, patch: { actors: { ...k.actors, [target.id]: { ...target, combatant: r.target } }, pending: null } };
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
      const md = state.map?.tokens[medic.id];
      const td = state.map?.tokens[target.id];
      if (md && td && gridDistance(md, td) > 1) throw new SessionError('OUT_OF_REACH', `${target.combatant.name} isn’t in an adjacent square.`);
      const encounter = checkOtherAction(state, by, medic);
      const r = stabilize(medic.combatant, target.combatant, intent.skill, dice, intent.situational);
      const patch: StatePatch = { actors: { [target.id]: { ...target, combatant: r.combatant } } };
      if (encounter) patch.encounter = encounter;
      return { events: r.events, patch };
    }
    case 'reload': {
      const a = getActor(state, intent.actorId);
      const w = getWeapon(a, intent.weaponId);
      if (!w.ammo) throw new SessionError('INVALID', `${w.name} doesn’t use a magazine.`);
      const encounter = checkOtherAction(state, by, a);
      const reloaded: Weapon = { ...w, ammo: { ...w.ammo, loaded: w.ammo.capacity } };
      const patch: StatePatch = { actors: { [a.id]: { ...a, weapons: a.weapons.map((x) => (x.id === w.id ? reloaded : x)) } } };
      if (encounter) patch.encounter = encounter;
      return { events: [], patch };
    }

    // ----- Tactical map -----
    case 'setMap': {
      const m = intent.map;
      if (!m) return { events: [], patch: { map: null } };
      if (m.width < 1 || m.height < 1 || m.width * m.height !== m.cells.length || m.width * m.height > 10_000) {
        throw new SessionError('INVALID', 'Map cells must be width × height (at most 10,000 squares).');
      }
      const tokens = Object.fromEntries(Object.entries(m.tokens).filter(([id]) => state.actors[id]));
      return { events: [], patch: { map: withSpotted({ ...m, tokens }, state.actors) } };
    }
    case 'placeToken': {
      const map = requireMap(state);
      getActor(state, intent.actorId);
      if (!intent.at) {
        const { [intent.actorId]: _t, ...tokens } = map.tokens;
        const { [intent.actorId]: _w, ...watches } = map.watches;
        return { events: [], patch: { map: { ...map, tokens, watches } } };
      }
      const at = intent.at;
      if (!isPassable(map, at) || at.x < 0 || at.y < 0 || at.x >= map.width || at.y >= map.height) throw new SessionError('INVALID', 'That square is blocked.');
      if (Object.entries(map.tokens).some(([id, c]) => id !== intent.actorId && c.x === at.x && c.y === at.y)) throw new SessionError('INVALID', 'That square is occupied.');
      return { events: [], patch: { map: withSpotted({ ...map, tokens: { ...map.tokens, [intent.actorId]: at } }, state.actors) } };
    }
    case 'moveToken':
      return doMove(state, intent.actorId, intent.to, !!intent.run, by, newId);
    case 'setWatch': {
      const map = requireMap(state);
      const a = getActor(state, intent.actorId);
      if (!map.tokens[a.id]) throw new SessionError('INVALID', `${a.combatant.name} isn’t on the map.`);
      const encounter = checkOtherAction(state, by, a);
      const arc = Math.min(180, Math.max(30, intent.arc ?? 90));
      const facing = ((intent.facing % 360) + 360) % 360;
      const patch: StatePatch = { map: { ...map, watches: { ...map.watches, [a.id]: { facing, arc, range: map.sightRange } } } };
      if (encounter) patch.encounter = encounter;
      return { events: [{ type: 'watchSet', visibility: visibilityFor(a), combatantId: a.id, facing, arc }], patch };
    }
    case 'clearWatch': {
      const map = requireMap(state);
      const { [intent.actorId]: _w, ...watches } = map.watches;
      return { events: [], patch: { map: { ...map, watches } } };
    }
    case 'areaAttack':
      return doAreaAttack(state, intent, by, dice, newId);
    case 'suppressiveFire':
      return doSuppressiveFire(state, intent, by, dice);
    case 'editOwnSheet': return executePlayerEdit(state, intent, by); // Round 4 U4
    case 'setHandout': case 'removeHandout': // Track U
      return executeHandout(state, intent, by);
    // --- Round 3 P ---
    case 'addToInitiative': case 'removeFromInitiative': case 'delayTurn': case 'setDelayRule': case 'placeScatter':
      return executePlayLoop(state, intent, by, dice, newId, { settleTurn, onTurnStart });
    // --- end Round 3 P ---
    // --- Track N ---
    case 'net':
      return executeNet(state, (intent as { op: unknown }).op, by, dice);
    // --- end Track N ---
    case 'extra': // Round 3 X
      return executeExtra(state, (intent as { op: unknown }).op, by, dice, newId);
    default:
      if (isSystemsIntent(intent)) return executeSystems(state, intent, by, dice, newId); // Track K
      return executeTool(state, intent, by, dice);
  }
}

// ----- Tactical helpers ------------------------------------------------------------

/**
 * With both tokens on the map, the map decides: range comes from the grid
 * (the client's distance is ignored), and the attacker needs line of sight.
 * RED cover is binary, so no line of sight means no shot, unless the GM rules otherwise.
 */
function withMapGeometry(state: SessionState, intent: RangedAttackIntent): RangedAttackIntent {
  const a = state.map?.tokens[intent.attackerId];
  const d = state.map?.tokens[intent.defenderId];
  if (!state.map || !a || !d) return intent;
  if (!intent.ignoreLineOfSight && !hasLineOfSight(state.map, a, d)) {
    throw new SessionError('NO_LINE_OF_SIGHT', `${getActor(state, intent.defenderId).combatant.name} is behind cover or out of sight.`);
  }
  return { ...intent, distance: Math.max(1, metersBetween(a, d)) };
}

const stepCost = (map: TacticalMap, path: Cell[]) => path.reduce((s, c) => s + (terrainAt(map, c) === '~' ? 2 : 1), 0);

/**
 * Move Action = MOVE squares. Running spends the Action for MOVE more.
 * Players must ask to run; the GM's moves are recorded but not capped.
 */
function doMove(state: SessionState, actorId: string, to: Cell, run: boolean, by: Viewer, newId: () => string): Result {
  const map = requireMap(state);
  const a = getActor(state, actorId);
  if (!map.tokens[actorId]) throw new SessionError('INVALID', `${a.combatant.name} isn’t on the map.`);
  if (a.combatant.conditions.dead || a.combatant.conditions.unconscious) throw new SessionError('INVALID', `${a.combatant.name} can’t move.`);
  const u = usageFor(state, actorId);
  const move = effectiveStat(a.combatant, 'MOVE');
  const unlimited = map.width * map.height * 2;
  let budget = unlimited;
  if (u && by.role !== 'gm') {
    const canRun = run && !u.actionUsed;
    budget = (u.ran || canRun ? 2 * move : move) - u.moveUsed;
  }
  const plan = planMove(map, state.actors, actorId, to, budget);
  if (!plan || plan.path.length === 0) {
    const extra = u && by.role !== 'gm' && !run && !u.actionUsed && planMove(map, state.actors, actorId, to, 2 * move - u.moveUsed);
    throw new SessionError('NO_MOVEMENT', extra ? 'That needs a Run, which uses your Action.' : `${a.combatant.name} can’t reach that square this Turn.`);
  }

  // A watch stops the mover in the watched square (if they can stand there).
  let path = plan.path;
  const trig = watchTrigger(map, state.actors, actorId, path);
  if (trig) {
    const i = path.findIndex((c) => c.x === trig.at.x && c.y === trig.at.y);
    const standable = !Object.entries(map.tokens).some(([id, c]) => id !== actorId && cellKey(c) === cellKey(trig.at));
    if (standable) path = path.slice(0, i + 1);
  }
  const cost = stepCost(map, path);
  const dest = path[path.length - 1]!;

  const events: CombatEvent[] = [];
  const patch: StatePatch = {};
  let ran = false;
  if (u) {
    const used = u.moveUsed + cost;
    ran = used > move && !u.ran;
    const usage: TurnUsage = { ...u, moveUsed: used, ran: u.ran || ran, actionUsed: u.actionUsed || ran };
    patch.encounter = { ...state.encounter, usage };
  }
  events.push({ type: 'tokenMoved', visibility: visibilityFor(a), combatantId: a.id, path, cost, ran });

  let next: TacticalMap = { ...map, tokens: { ...map.tokens, [actorId]: dest } };
  if (trig && cellKey(dest) === cellKey(trig.at)) {
    const watcher = getActor(state, trig.watcherId);
    const { [trig.watcherId]: _spent, ...watches } = next.watches;
    next = { ...next, watches };
    events.push({ type: 'watchTriggered', visibility: visibilityFor(watcher), combatantId: watcher.id, targetId: a.id, at: trig.at });
    patch.pending = { kind: 'awaitingWatch', id: newId(), watcherId: watcher.id, targetId: a.id };
  }
  patch.map = withSpotted(next, state.actors);
  return { events, patch };
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
  const patch: StatePatch = { actors: { [attacker.id]: { ...attacker, weapons: attacker.weapons.map((w) => (w.id === weapon.id ? spent : w)) } }, pending };
  // Already validated when the attack was declared; here we only record it.
  const encounter = checkAttackAction(state, { role: 'gm' }, attacker, weapon.id,
    attacksPerAction(weapon, { aimed: !!intent.aimTarget, autofire: intent.mode === 'autofire' }));
  if (encounter) patch.encounter = encounter;
  return { events: out.events, patch };
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
  if (!enc.active || enc.order.length === 0) return { ...enc, deathSaveRequiredFor: null, usage: undefined };
  let e = enc;
  for (let i = 0; i < enc.order.length; i++) {
    const id = e.order[e.turnIndex]!;
    const a = actors[id];
    if (a) {
      const c = a.combatant;
      const dying = woundState(c.hp) === 'mortally' && !c.conditions.dead;
      if (dying || !turnStartChecklist(c).skipTurn) {
        return {
          ...e,
          deathSaveRequiredFor: turnStartChecklist(c).deathSaveRequired ? id : null,
          usage: e.usage?.actorId === id ? e.usage : freshUsage(id),
        };
      }
    }
    e = advance(e);
  }
  return { ...e, deathSaveRequiredFor: null };
}
