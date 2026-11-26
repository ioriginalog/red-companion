/**
 * Round 4 R4: Turn and Round upkeep the authority runs automatically.
 *
 * End of a Turn: re-bleeding Critical Injuries and the ear injuries' lost Move
 * Action (from how far the character moved this Turn).
 * Start of a Turn: On Fire (Track K's `onTurnStart`), a Spinal Injury's lost
 * Action, an ear injury's lost Move Action, and a checklist of reminders.
 * Start of a Round: speedware counts down, and the GM is prompted for Black ICE
 * and Demons that can act (they act at the top of the Round).
 *
 * Events are shown like the character's other events: friendly characters'
 * are public; everyone else's go to the GM only. No HP figures.
 */
import {
  effectiveStat, endOfTurnInjuries, startOfTurnInjuries, turnReminders, METERS_PER_SQUARE,
  type CombatEvent, type Combatant, type TurnReminder,
} from '@cprc/rules-core';
import { visibilityFor } from './helpers.js';
import { netThreats } from './netrun.js';
import { onTurnStart } from './systems.js';
import type { Actor, Encounter, SessionState } from './types.js';

const withC = (a: Actor, c: Combatant): Actor => ({ ...a, combatant: c });
const as = (a: Actor, events: CombatEvent[]): CombatEvent[] => events.map((e) => ({ ...e, visibility: visibilityFor(a) }));

/** End of the current actor's Turn (call before advancing). */
export function endTurnUpkeep(state: SessionState): { events: CombatEvent[]; actors: Record<string, Actor> } {
  const enc = state.encounter;
  const id = enc.active ? enc.order[enc.turnIndex] : undefined;
  const a = id ? state.actors[id] : undefined;
  if (!a || !enc.usage || enc.usage.actorId !== id) return { events: [], actors: {} };
  const walked = Math.max(0, enc.usage.moveUsed - (enc.usage.moveBlocked ?? 0));
  const r = endOfTurnInjuries(a.combatant, walked * METERS_PER_SQUARE);
  if (r.combatant === a.combatant) return { events: [], actors: {} };
  return { events: as(a, r.events), actors: { [a.id]: withC(a, r.combatant) } };
}

/** What a grapple means for this character at Turn start (Round 3 X state). */
function grappleReminders(state: SessionState, a: Actor): TurnReminder[] {
  const g = state.extras?.grapples.find((x) => x.holderId === a.id || x.heldId === a.id);
  if (!g) return [];
  const other = state.actors[g.holderId === a.id ? g.heldId : g.holderId]?.combatant.name ?? 'someone';
  return [{
    key: 'grappled',
    text: g.heldId === a.id
      ? `${a.combatant.name} is held by ${other}: can’t move, −2 to Actions, no two-handed weapons.`
      : `${a.combatant.name} is holding ${other}: −2 to Actions, no two-handed weapons.`,
  }];
}

/**
 * Start of whoever `encounter` makes current. `prevRound` detects a new Round.
 * Returns the encounter with this Turn's usage adjusted for lost Actions.
 */
export function turnUpkeep(state: SessionState, encounter: Encounter, prevRound: number): { events: CombatEvent[]; actors: Record<string, Actor>; encounter: Encounter } {
  if (!encounter.active) return { events: [], actors: {}, encounter };
  const events: CombatEvent[] = [];
  const actors: Record<string, Actor> = {};
  const cur = (id: string) => actors[id] ?? state.actors[id];

  // New Round: speedware counts down; Black ICE and Demons get their prompt.
  if (encounter.round > prevRound) {
    for (const a of Object.values(state.actors)) {
      const sw = a.combatant.speedware;
      if (!sw?.active) continue;
      const left = sw.roundsLeft - 1;
      const next: Combatant = { ...a.combatant, speedware: { ...sw, active: left > 0, roundsLeft: Math.max(0, left) } };
      actors[a.id] = withC(a, next);
      if (left <= 0) events.push({ type: 'speedwareChanged', visibility: visibilityFor(a), combatantId: a.id, state: 'expired' });
    }
    for (const t of netThreats(state)) {
      events.push({ type: 'netThreat', visibility: 'gm', audience: ['gm'], combatantId: t.runnerId, ice: t.ice, ...(t.demon ? { demon: t.demon } : {}) });
    }
  }

  // Start of this Turn.
  const id = encounter.order[encounter.turnIndex];
  const a0 = id ? cur(id) : undefined;
  if (!a0 || a0.combatant.conditions.dead) return { events, actors, encounter };

  // On Fire (Track K), against the latest copy of the actor.
  const burn = onTurnStart({ ...state, actors: { ...state.actors, ...actors } }, encounter);
  Object.assign(actors, burn.actors);
  events.push(...burn.events);

  const a = cur(a0.id)!;
  const items = turnReminders(a.combatant, grappleReminders(state, a));
  if (items.some((r) => r.key !== 'injury')) events.push({ type: 'turnReminders', visibility: visibilityFor(a), combatantId: a.id, items });

  const s = startOfTurnInjuries(a.combatant);
  let enc = encounter;
  if (s.combatant !== a.combatant) {
    actors[a.id] = withC(a, s.combatant);
    events.push(...as(a, s.events));
    const usage = enc.usage?.actorId === a.id ? enc.usage : { actorId: a.id, moveUsed: 0, actionUsed: false, ran: false, attacks: 0, attackWith: null };
    let u = usage;
    if (s.loseAction) u = { ...u, actionUsed: true };
    if (s.noMove) {
      const move = effectiveStat(s.combatant, 'MOVE');
      u = { ...u, moveUsed: u.moveUsed + move, moveBlocked: (u.moveBlocked ?? 0) + move };
    }
    enc = { ...enc, usage: u };
  }
  return { events, actors, encounter: enc };
}
