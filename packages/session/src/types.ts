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
import type { AimTarget, Cell, CombatEvent, Combatant, DamageSpec, GridMap, Modifier, Weapon, WoundState } from '@cprc/rules-core';

export type Viewer = { role: 'gm' } | { role: 'player'; playerId: string };
/** Serialized author of an entry: 'gm' or 'player:<id>'. */
export type AuthorId = 'gm' | `player:${string}`;

export interface Actor {
  id: string;
  combatant: Combatant;
  weapons: Weapon[];
  /** 'gm' or a playerId. */
  controller: string;
  /** Map faction. Default: PCs 'party', NPCs 'hostile'. Allies share the party's vision. */
  allegiance?: Allegiance;
  /** Portrait image URL. */
  portrait?: string;
}

export type Allegiance = 'party' | 'ally' | 'neutral' | 'hostile';

export interface Encounter {
  active: boolean;
  round: number;
  /** Actor ids in initiative order. */
  order: string[];
  turnIndex: number;
  /** Set when the current actor must roll a Death Save before acting. */
  deathSaveRequiredFor: string | null;
  /** What the current actor has spent this Turn. Absent outside encounters. */
  usage?: TurnUsage;
}

/**
 * RED Turn economy: one Move Action (MOVE squares) and one Action. Running
 * spends the Action on a second MOVE. Weapons with ROF 2 get two attacks
 * with the same weapon for the one Action.
 */
export interface TurnUsage {
  actorId: string;
  moveUsed: number;
  actionUsed: boolean;
  ran: boolean;
  attacks: number;
  /** Weapon (or 'brawling' / 'martialArts') that used the Action, for ROF follow-ups. */
  attackWith: string | null;
}

/**
 * House rule, not RED Core: an actor spends its Action to watch a cone.
 * When an opposing token moves into a visible watched square, the GM gets a
 * prompt to resolve an attack. The watch ends at the watcher's next Turn.
 */
export interface Watch {
  facing: number;
  arc: number;
  /** Squares. */
  range: number;
}

export interface TacticalMap extends GridMap {
  id: string;
  name: string;
  /** URL of the painted background, drawn under the grid. */
  background?: string;
  /** Pixel size of one square in the background image. */
  cellPx: number;
  /** Squares. Use a small number for dark scenes. */
  sightRange: number;
  tokens: Record<string, Cell>;
  watches: Record<string, Watch>;
  /** NPC actor ids the party has seen at least once (names revealed). */
  spotted: string[];
}

export type Pending =
  | { kind: 'awaitingDodge'; id: string; attack: RangedAttackIntent; defenderId: string }
  | { kind: 'awaitingDamage'; id: string; attackerId: string; targetId: string; spec: DamageSpec }
  /** A watch (house rule) triggered: the watcher may attack the mover now, out of Turn. */
  | { kind: 'awaitingWatch'; id: string; watcherId: string; targetId: string };

export interface SessionState {
  sessionId: string;
  /** seq of the last applied entry; 0 = empty log. */
  seq: number;
  actors: Record<string, Actor>;
  encounter: Encounter;
  pending: Pending | null;
  map: TacticalMap | null;
}

export interface StatePatch {
  /** null = remove actor. */
  actors?: Record<string, Actor | null>;
  encounter?: Encounter;
  /** Present (even as null) = replace. */
  pending?: Pending | null;
  /** Present (even as null) = replace. Small enough to send whole. */
  map?: TacticalMap | null;
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
  /** GM only: rule the target visible despite the map's line of sight. */
  ignoreLineOfSight?: boolean;
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
  | { type: 'reload'; actorId: string; weaponId: string }
  // Tactical map
  | { type: 'setMap'; map: TacticalMap | null }
  | { type: 'placeToken'; actorId: string; at: Cell | null }
  | { type: 'moveToken'; actorId: string; to: Cell; run?: boolean }
  | { type: 'setWatch'; actorId: string; facing: number; arc?: number }
  | { type: 'clearWatch'; actorId: string }
  | { type: 'declineWatch'; pendingId: string };

export type IntentType = Intent['type'];

export type Rejection = { ok: false; code: string; message: string };
export type Accepted = { ok: true; entry: LogEntry };

// ----- Projected (player-facing) view ----------------------------------------

export interface PublicCombatantView {
  name: string;
  side: 'pc' | 'npc';
  allegiance: Allegiance;
  portrait?: string;
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
  map: TacticalMap | null;
}

export interface ProjectedEntry {
  seq: number;
  id: string;
  at: string;
  by: AuthorId;
  intentType: IntentType;
  events: CombatEvent[];
  patch: { actors?: Record<string, ProjectedActor | null>; encounter?: Encounter; pending?: Pending | null; map?: TacticalMap | null };
}
