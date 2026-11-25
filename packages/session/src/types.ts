/**
 * Session schema. All plain JSON.
 *
 * Model (see docs/ADR-001):
 *   client --Intent--> authority (GM device) --LogEntry--> relay --projected LogEntry--> players
 *
 * A LogEntry carries two things:
 *   - `events`: what happened, with raw dice (for the combat log / narration)
 *   - `patch`:  the resulting state changes (for replay)
 * Clients never re-run the rules engine; they apply patches. That keeps replay
 * trivially deterministic and lets the relay redact patches per viewer.
 */
import type { AimTarget, CombatEvent, Combatant, DamageSpec, Modifier, Weapon, WoundState } from '@cprc/rules-core';

export type Viewer = { role: 'gm' } | { role: 'player'; playerId: string };
/** Serialized author of an entry: 'gm' or 'player:<id>'. */
export type AuthorId = 'gm' | `player:${string}`;

export interface Actor {
  id: string;
  combatant: Combatant;
  weapons: Weapon[];
  /** 'gm' or a playerId. */
  controller: string;
}

export interface Encounter {
  active: boolean;
  round: number;
  /** Actor ids in initiative order. */
  order: string[];
  turnIndex: number;
  /** Set when the current actor must roll a Death Save before acting. */
  deathSaveRequiredFor: string | null;
}

export type Pending =
  | { kind: 'awaitingDodge'; id: string; attack: RangedAttackIntent; defenderId: string }
  | { kind: 'awaitingDamage'; id: string; attackerId: string; targetId: string; spec: DamageSpec };

export interface SessionState {
  sessionId: string;
  /** seq of the last applied entry; 0 = empty log. */
  seq: number;
  actors: Record<string, Actor>;
  encounter: Encounter;
  pending: Pending | null;
}

export interface StatePatch {
  /** null = remove actor. */
  actors?: Record<string, Actor | null>;
  encounter?: Encounter;
  /** Present (even as null) = replace. */
  pending?: Pending | null;
}

export interface LogEntry {
  seq: number;
  id: string;
  at: string;
  by: AuthorId;
  intent: Intent;
  events: CombatEvent[];
  patch: StatePatch;
}

// ----- Intents ----------------------------------------------------------------

export interface RangedAttackIntent {
  type: 'rangedAttack';
  attackerId: string;
  defenderId: string;
  weaponId: string;
  distance: number;
  mode?: 'single' | 'autofire';
  aimTarget?: AimTarget;
  situational?: Modifier[];
  /** Omit to let the defender's controller decide (if eligible). */
  defenderDodges?: boolean;
}

export type MeleeWith = { kind: 'weapon'; weaponId: string } | { kind: 'brawling' } | { kind: 'martialArts'; form: string };

export type Intent =
  // GM setup
  | { type: 'addActor'; actor: Actor }
  | { type: 'replaceActor'; actor: Actor }
  | { type: 'removeActor'; actorId: string }
  | { type: 'assignController'; actorId: string; controller: string }
  | { type: 'startEncounter'; participants: { actorId: string; bonus?: number }[] }
  | { type: 'endEncounter' }
  | { type: 'cancelPending' }
  // Turn flow
  | { type: 'endTurn' }
  // Combat
  | RangedAttackIntent
  | { type: 'respondDodge'; pendingId: string; dodge: boolean }
  | { type: 'meleeAttack'; attackerId: string; defenderId: string; with: MeleeWith; aimTarget?: AimTarget; situational?: Modifier[]; gmDv?: number }
  | { type: 'rollDamage'; pendingId: string }
  | { type: 'deathSave'; actorId: string }
  | { type: 'stabilize'; medicId: string; targetId: string; skill: 'First Aid' | 'Paramedic'; situational?: Modifier[] }
  | { type: 'reload'; actorId: string; weaponId: string };

export type IntentType = Intent['type'];

export type Rejection = { ok: false; code: string; message: string };
export type Accepted = { ok: true; entry: LogEntry };

// ----- Projected (player-facing) view ----------------------------------------

export interface PublicCombatantView {
  name: string;
  side: 'pc' | 'npc';
  woundState: WoundState;
  conditions: Combatant['conditions'];
  injuries: string[];
}

export interface ProjectedActor {
  id: string;
  controller: string;
  public: PublicCombatantView;
  /** Only when the viewer may see full stats (own actor, PCs, or GM). */
  combatant?: Combatant;
  weapons?: Weapon[];
}

export interface ViewState {
  sessionId: string;
  seq: number;
  actors: Record<string, ProjectedActor>;
  encounter: Encounter;
  pending: Pending | null;
}

export interface ProjectedEntry {
  seq: number;
  id: string;
  at: string;
  by: AuthorId;
  intentType: IntentType;
  events: CombatEvent[];
  patch: { actors?: Record<string, ProjectedActor | null>; encounter?: Encounter; pending?: Pending | null };
}
