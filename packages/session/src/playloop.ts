/**
 * Turn-order tools and explosive scatter.
 *
 *   - addToInitiative / removeFromInitiative (GM): late arrivals roll REF + 1d10
 *     (via the engine) and slot in by total; ties with an existing slot go to a
 *     d10 roll-off. Interpretation: Core says ties reroll; we only reroll the
 *     newcomer against the tied slot, so nobody else's place changes.
 *   - delayTurn (house rule; RED Core has no Delay or Hold Action that we could
 *     confirm): the current actor acts later this Round, after a chosen actor or
 *     last. Only before they've moved or acted. The GM can switch it off.
 *   - placeScatter (GM): a missed explosive waits in `awaitingScatter`; the GM
 *     clicks where it lands or has it rolled: a random square within the 5 × 5
 *     blast area around the aim point (each axis (d10 − 1) mod 5 − 2; never the
 *     aim square itself; never a wall). Interpretation: Core leaves the landing
 *     spot to the GM.
 */
import {
  inBounds, rollInitiative, terrainAt, type Cell, type CombatEvent, type Dice, type InitiativeEntry,
} from '@cprc/rules-core';
import { finishArea, blastTargetsWithCover, BLAST_RADIUS } from './grid-area.js';
import { controls, currentActorId, getActor, requireMap, SessionError } from './helpers.js';
import { startAreaDodge } from './systems.js';
import type { Actor, Encounter, Intent, SessionState, StatePatch, Viewer } from './types.js';

type Result = { events: CombatEvent[]; patch: StatePatch };

export const PLAYLOOP_INTENTS = ['addToInitiative', 'removeFromInitiative', 'delayTurn', 'setDelayRule', 'placeScatter'] as const;
type PlayLoopIntent = Extract<Intent, { type: (typeof PLAYLOOP_INTENTS)[number] }>;
const ALL: ReadonlySet<string> = new Set(PLAYLOOP_INTENTS);
export const isPlayLoopIntent = (i: Intent): i is PlayLoopIntent => ALL.has(i.type);
export const PLAYLOOP_GM_ONLY: ReadonlySet<string> = new Set(['addToInitiative', 'removeFromInitiative', 'setDelayRule', 'placeScatter']);
export const PLAYLOOP_WHILE_PENDING: ReadonlySet<string> = new Set(['placeScatter', 'setDelayRule']);

export interface TurnHooks {
  settleTurn: (enc: Encounter, actors: Record<string, Actor>) => Encounter;
  /** Start-of-Turn upkeep for whoever is now current (e.g. On Fire). */
  onTurnStart: (state: SessionState, enc: Encounter) => { events: CombatEvent[]; actors: Record<string, Actor> };
  /** Full Turn-start upkeep (On Fire, lost Actions, reminders, new-Round prompts). */
  turnUpkeep?: (state: SessionState, enc: Encounter, prevRound: number) => { events: CombatEvent[]; actors: Record<string, Actor>; encounter: Encounter };
}

// ----- Validation -------------------------------------------------------------------------

const need = (ok: unknown, msg: string): void => { if (!ok) throw new SessionError('INVALID', msg); };
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 80;
const isInt = (n: unknown, lo: number, hi: number): n is number => Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi;
const isCell = (c: unknown): c is Cell =>
  !!c && typeof c === 'object' && isInt((c as Cell).x, 0, 9_999) && isInt((c as Cell).y, 0, 9_999) && Object.keys(c).length === 2;

/** Shape checks and permissions, before anything is executed. */
export function authorizePlayLoop(state: SessionState, intent: PlayLoopIntent, by: Viewer): void {
  if (PLAYLOOP_GM_ONLY.has(intent.type) && by.role !== 'gm') throw new SessionError('FORBIDDEN', 'Only the GM can do that.');
  switch (intent.type) {
    case 'addToInitiative':
      need(isId(intent.actorId), 'Missing character.');
      need(intent.roll === undefined || intent.roll === 'roll' || isInt(intent.roll, -20, 60), 'Initiative must be a whole number from −20 to 60.');
      return;
    case 'removeFromInitiative':
      need(isId(intent.actorId), 'Missing character.');
      return;
    case 'setDelayRule':
      need(typeof intent.allowed === 'boolean', 'Allowed must be true or false.');
      return;
    case 'placeScatter':
      need(isId(intent.pendingId), 'Missing pending step.');
      need(intent.at === undefined || isCell(intent.at), 'Pick a square.');
      return;
    case 'delayTurn': {
      need(intent.after === undefined || isId(intent.after), 'Pick who to act after.');
      const enc = state.encounter;
      if (!enc.active) throw new SessionError('INVALID', 'No encounter is running.');
      if (enc.delayAllowed === false && by.role !== 'gm') throw new SessionError('FORBIDDEN', 'The GM has turned off Delay.');
      const cur = currentActorId(state);
      if (!cur) throw new SessionError('INVALID', 'No one is acting.');
      const a = getActor(state, cur);
      if (!controls(by, a)) throw new SessionError('NOT_YOUR_TURN', 'It isn’t your Turn.');
      if (by.role !== 'gm') {
        if (enc.deathSaveRequiredFor === cur) throw new SessionError('DEATH_SAVE_FIRST', `${a.combatant.name} must roll a Death Save first.`);
        const u = enc.usage?.actorId === cur ? enc.usage : null;
        if (u && (u.moveUsed > 0 || u.actionUsed)) throw new SessionError('INVALID', 'You can only Delay before you move or act.');
      }
      return;
    }
  }
}

// ----- Execution --------------------------------------------------------------------------

export function executePlayLoop(state: SessionState, intent: PlayLoopIntent, by: Viewer, dice: Dice, newId: () => string, hooks: TurnHooks): Result {
  switch (intent.type) {
    case 'addToInitiative': return addToInitiative(state, intent, dice);
    case 'removeFromInitiative': return removeFromInitiative(state, intent.actorId, hooks);
    case 'delayTurn': return delayTurn(state, intent.after, hooks);
    case 'setDelayRule':
      return { events: [], patch: { encounter: { ...state.encounter, delayAllowed: intent.allowed } } };
    case 'placeScatter': return placeScatter(state, intent, dice, newId, by);
  }
}

/** Totals for the current order; slots with no recorded total count as higher than any roll. */
function totalsOf(enc: Encounter): (id: string) => number {
  return (id) => enc.initiative?.[id] ?? Number.POSITIVE_INFINITY;
}

function addToInitiative(state: SessionState, intent: Extract<PlayLoopIntent, { type: 'addToInitiative' }>, dice: Dice): Result {
  const enc = state.encounter;
  if (!enc.active) throw new SessionError('INVALID', 'Start an encounter first.');
  const a = getActor(state, intent.actorId);
  if (enc.order.includes(a.id)) throw new SessionError('INVALID', `${a.combatant.name} is already in the Turn order.`);

  let entry: InitiativeEntry;
  if (typeof intent.roll === 'number') {
    entry = { combatantId: a.id, base: intent.roll, roll: 0, total: intent.roll, tiebreaks: [] };
  } else {
    entry = rollInitiative([{ combatant: a.combatant }], dice).order[0]!;
  }

  const total = totalsOf(enc);
  let idx = enc.order.length;
  for (let i = 0; i < enc.order.length; i++) {
    const t = total(enc.order[i]!);
    if (entry.total > t) { idx = i; break; }
    if (entry.total === t) {
      // Roll-off against the tied slot only.
      let mine = 0, theirs = 0, guard = 0;
      do { mine = dice.d10(); theirs = dice.d10(); entry.tiebreaks.push(mine); } while (mine === theirs && ++guard < 20);
      if (mine > theirs) { idx = i; break; }
    }
  }
  const order = [...enc.order.slice(0, idx), a.id, ...enc.order.slice(idx)];
  // Keep the same actor acting: anyone slotted at or before the current Turn acts next Round.
  const turnIndex = idx <= enc.turnIndex ? enc.turnIndex + 1 : enc.turnIndex;
  const encounter: Encounter = { ...enc, order, turnIndex, initiative: { ...(enc.initiative ?? {}), [a.id]: entry.total } };
  return { events: [{ type: 'initiativeRolled', visibility: 'public', entries: [entry] }], patch: { encounter } };
}

function removeFromInitiative(state: SessionState, actorId: string, hooks: TurnHooks): Result {
  const enc = state.encounter;
  const a = getActor(state, actorId);
  const idx = enc.order.indexOf(actorId);
  if (idx < 0) throw new SessionError('INVALID', `${a.combatant.name} isn’t in the Turn order.`);
  const order = enc.order.filter((id) => id !== actorId);
  const wasCurrent = idx === enc.turnIndex;
  let turnIndex = idx < enc.turnIndex ? enc.turnIndex - 1 : enc.turnIndex;
  let round = enc.round;
  if (turnIndex >= order.length) { turnIndex = 0; round += 1; }
  const { [actorId]: _gone, ...initiative } = enc.initiative ?? {};
  const base: Encounter = {
    ...enc, order, turnIndex, round, active: enc.active && order.length > 0, initiative,
    ...(wasCurrent ? { usage: undefined, deathSaveRequiredFor: null } : {}),
  };
  const settled = hooks.settleTurn(base, state.actors);
  // The next actor's Turn starts if the current one left.
  if (!wasCurrent || !hooks.turnUpkeep) return { events: [{ type: 'leftInitiative', visibility: 'public', combatantId: actorId }], patch: { encounter: settled } };
  const up = hooks.turnUpkeep(state, settled, enc.round);
  const patch: StatePatch = { encounter: up.encounter };
  if (Object.keys(up.actors).length) patch.actors = up.actors;
  return { events: [{ type: 'leftInitiative', visibility: 'public', combatantId: actorId }, ...up.events], patch };
}

function delayTurn(state: SessionState, after: string | undefined, hooks: TurnHooks): Result {
  const enc = state.encounter;
  const cur = enc.order[enc.turnIndex]!;
  if (after !== undefined) {
    const i = enc.order.indexOf(after);
    if (i < 0) throw new SessionError('INVALID', 'That character isn’t in the Turn order.');
    if (i <= enc.turnIndex) throw new SessionError('INVALID', 'Pick someone who hasn’t acted yet this Round.');
  } else if (enc.turnIndex >= enc.order.length - 1) {
    throw new SessionError('INVALID', 'You’re already last this Round.');
  }
  const rest = enc.order.filter((_, i) => i !== enc.turnIndex);
  const insertAt = after === undefined ? rest.length : rest.indexOf(after) + 1;
  const order = [...rest.slice(0, insertAt), cur, ...rest.slice(insertAt)];
  const totals = enc.initiative ?? {};
  const lowest = Math.min(...Object.values(totals), 0);
  const initiative = { ...totals, [cur]: after !== undefined ? (totals[after] ?? lowest) : lowest - 1 };

  // The next actor's Turn starts now (same index, new occupant).
  const settled = hooks.settleTurn({ ...enc, order, initiative, usage: undefined, deathSaveRequiredFor: null }, state.actors);
  // Full upkeep when the authority provides it.
  const upkeep = hooks.turnUpkeep ? hooks.turnUpkeep(state, settled, enc.round) : { ...hooks.onTurnStart(state, settled), encounter: settled };
  const encounter = upkeep.encounter;
  const patch: StatePatch = { encounter };
  if (Object.keys(upkeep.actors).length) patch.actors = upkeep.actors;
  const next = encounter.order[encounter.turnIndex];
  if (state.map && next && state.map.watches[next]) {
    const { [next]: _ended, ...watches } = state.map.watches;
    patch.map = { ...state.map, watches };
  }
  return { events: [{ type: 'turnDelayed', visibility: 'public', combatantId: cur, after: after ?? null }, ...upkeep.events], patch };
}

/** A random square within the blast area around `around`: never the aim square, never a wall. */
export function rollScatter(state: SessionState, around: Cell, dice: Dice): Cell {
  const map = requireMap(state);
  const offset = () => ((dice.d10() - 1) % 5) - BLAST_RADIUS;
  for (let tries = 0; tries < 40; tries++) {
    const c = { x: around.x + offset(), y: around.y + offset() };
    if ((c.x === around.x && c.y === around.y) || !inBounds(map, c) || terrainAt(map, c) === '#') continue;
    return c;
  }
  throw new SessionError('INVALID', 'Couldn’t find a square to land on. Pick one.');
}

function placeScatter(
  state: SessionState, intent: Extract<PlayLoopIntent, { type: 'placeScatter' }>, dice: Dice, newId: () => string, _by: Viewer,
): Result {
  const p = state.pending;
  if (!p || p.kind !== 'awaitingScatter' || p.id !== intent.pendingId) throw new SessionError('NO_PENDING', 'No explosive is waiting to land.');
  const map = requireMap(state);
  let to: Cell;
  const rolled = intent.at === undefined;
  if (intent.at) {
    to = intent.at;
    if (!inBounds(map, to) || terrainAt(map, to) === '#') throw new SessionError('INVALID', 'It can’t land inside a wall.');
  } else {
    to = rollScatter(state, p.at, dice);
  }
  const events: CombatEvent[] = [{ type: 'explosiveScattered', visibility: 'public', attackerId: p.attackerId, from: p.at, to, rolled }];
  const base = {
    id: newId(), attackerId: p.attackerId, areaKind: p.areaKind, at: to, attack: p.attack, damageDice: p.damageDice,
    source: 'explosive' as const, targets: blastTargetsWithCover(state, to),
  };
  const cleared: SessionState = { ...state, pending: null };
  const ask = startAreaDodge(base, cleared);
  if (ask) return { events: [...events, ...ask.events], patch: { pending: ask.pending } };
  const done = finishArea(cleared, { ...base, kind: 'awaitingAreaDodge', decisions: {} }, dice);
  return { events: [...events, ...done.events], patch: { ...done.patch, pending: null } };
}
