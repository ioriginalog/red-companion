/** Shared authority helpers (used by authority.ts, tools.ts and area.ts). */
import { type Weapon } from '@cprc/rules-core';
import { factionOf } from './tactical.js';
import type { Actor, Encounter, SessionState, TacticalMap, TurnUsage, Viewer } from './types.js';

export class SessionError extends Error {
  constructor(
    public readonly code:
      | 'NOT_FOUND' | 'FORBIDDEN' | 'NOT_YOUR_TURN' | 'PENDING' | 'NO_PENDING' | 'DEATH_SAVE_FIRST' | 'INVALID'
      | 'NO_LINE_OF_SIGHT' | 'OUT_OF_REACH' | 'NO_MOVEMENT' | 'ACTION_USED',
    message: string,
  ) {
    super(message);
  }
}


export function getActor(state: SessionState, id: string): Actor {
  const a = state.actors[id];
  if (!a) throw new SessionError('NOT_FOUND', `No actor ${id}.`);
  return a;
}

export function controls(by: Viewer, a: Actor): boolean {
  return by.role === 'gm' || a.controller === by.playerId;
}


export function currentActorId(state: SessionState): string | null {
  return state.encounter.active ? (state.encounter.order[state.encounter.turnIndex] ?? null) : null;
}


export function requireMap(state: SessionState): TacticalMap {
  if (!state.map) throw new SessionError('INVALID', 'No map is loaded.');
  return state.map;
}

export const visibilityFor = (a: Actor): 'public' | 'gm' => (factionOf(a) === 'friendly' ? 'public' : 'gm');


export const freshUsage = (actorId: string): TurnUsage => ({ actorId, moveUsed: 0, actionUsed: false, ran: false, attacks: 0, attackWith: null });

/** Usage is tracked only for the current actor during an encounter. */
export function usageFor(state: SessionState, actorId: string): TurnUsage | null {
  const enc = state.encounter;
  if (!enc.active || currentActorId(state) !== actorId) return null;
  return enc.usage?.actorId === actorId ? enc.usage : freshUsage(actorId);
}

/**
 * The GM is the referee: their intents are recorded against the Turn but never
 * refused for economy. Players are held to one Action per Turn.
 */
export function checkAttackAction(state: SessionState, by: Viewer, a: Actor, withKey: string, perAction: number): Encounter | undefined {
  const u = usageFor(state, a.id);
  if (!u) return undefined;
  const followUp = u.actionUsed && u.attackWith === withKey && u.attacks < perAction;
  if (u.actionUsed && !followUp && by.role !== 'gm') {
    throw new SessionError('ACTION_USED', `${a.combatant.name} has already used their Action this Turn.`);
  }
  // Single-attack actions (aimed, autofire, ROF 1) close the Action outright.
  const attacks = perAction === 1 ? 99 : (followUp ? u.attacks : 0) + 1;
  return { ...state.encounter, usage: { ...u, actionUsed: true, attackWith: withKey, attacks } };
}

export function checkOtherAction(state: SessionState, by: Viewer, a: Actor): Encounter | undefined {
  const u = usageFor(state, a.id);
  if (!u) return undefined;
  if (u.actionUsed && by.role !== 'gm') throw new SessionError('ACTION_USED', `${a.combatant.name} has already used their Action this Turn.`);
  return { ...state.encounter, usage: { ...u, actionUsed: true } };
}


export function getWeapon(a: Actor, weaponId: string): Weapon {
  const w = a.weapons.find((x) => x.id === weaponId);
  if (!w) throw new SessionError('NOT_FOUND', `${a.combatant.name} has no weapon ${weaponId}.`);
  return w;
}

