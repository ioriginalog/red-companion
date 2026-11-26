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
// --- Track N ---
import type { NetOp, NetState, NetView } from './netrun-types.js';
// --- end Track N ---
import type { AimTarget, AmmoTypeId, AwarenessKey, Care, Cell, CheckResult, CombatEvent, Combatant, CoverMaterialId, CyberwareItem, DamageSpec, GridMap, Modifier, Weapon, WoundState } from '@cprc/rules-core';

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
  /** Free-text notes (cyberware, gear, background). Full-sheet viewers only. */
  notes?: string;
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
  /** Player views only: an actor the party hasn't seen holds the current Turn (Round 3 Track R). */
  hiddenActing?: boolean;
  // --- Round 3 P ---
  /** Initiative totals by actor id, kept so late arrivals can be slotted in. */
  initiative?: Record<string, number>;
  /** House rule: may the current actor Delay? Default on. Survives across encounters. */
  delayAllowed?: boolean;
  // --- end Round 3 P ---
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
  /** Round 4 R4: squares of `moveUsed` that were blocked, not walked (an ear injury took the Move Action). */
  moveBlocked?: number;
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
  /** GM lighting overrides. `revealed` squares are always visible to players. */
  lighting?: { revealAll?: boolean; revealed?: string[] };
  // --- Track K ---
  /** Cover squares ('c') with a material and current HP, keyed "x,y". Missing = default material at full HP. */
  cover?: Record<string, { material: CoverMaterialId; hp: number }>;
  // --- end Track K ---
}

/** GM-only prep library (never projected to players). */
export interface Library {
  maps: Record<string, TacticalMap>;
  actors: Record<string, Actor>;
}

/** RED rolls only d6 and d10. `count` dice of `sides`, plus `bonus`. */
export interface DiceExpr { count: number; sides: 6 | 10; bonus: number }

export type ConditionKey = 'prone' | 'unconscious' | 'dead' | 'stabilized';

export type Pending =
  | { kind: 'awaitingDodge'; id: string; attack: RangedAttackIntent; defenderId: string }
  | { kind: 'awaitingDamage'; id: string; attackerId: string; targetId: string; spec: DamageSpec }
  /** A watch (house rule) triggered: the watcher may attack the mover now, out of Turn. */
  | { kind: 'awaitingWatch'; id: string; watcherId: string; targetId: string }
  // --- Track K ---
  /** An area attack hit: each eligible defender (REF 8+) decides whether to dodge before damage is rolled. */
  | {
    kind: 'awaitingAreaDodge'; id: string; attackerId: string; areaKind: 'shotgunShell' | 'launcher' | 'thrownGrenade'; at: Cell;
    attack: CheckResult; damageDice: number; source: 'shotgunShell' | 'explosive';
    /** Everyone caught, with the HP of the cover protecting them (explosives). */
    targets: { id: string; coverHp?: number }[];
    /** Eligible defenders: null until they decide. */
    decisions: Record<string, boolean | null>;
  }
  // --- end Track K ---
  // --- Round 3 P ---
  /** A missed explosive: the GM places where it lands (or rolls), then the blast resolves there. */
  | {
    kind: 'awaitingScatter'; id: string; attackerId: string; areaKind: 'launcher' | 'thrownGrenade'; at: Cell;
    attack: CheckResult; damageDice: number;
  };
  // --- end Round 3 P ---

/** What a player sees of a pending step: NPC damage dice are withheld. */
export type ProjectedPending =
  | Exclude<Pending, { kind: 'awaitingDamage' }>
  | (Omit<Extract<Pending, { kind: 'awaitingDamage' }>, 'spec'> & { spec?: DamageSpec });

export interface SessionState {
  sessionId: string;
  /** seq of the last applied entry; 0 = empty log. */
  seq: number;
  actors: Record<string, Actor>;
  encounter: Encounter;
  pending: Pending | null;
  map: TacticalMap | null;
  /** GM prep: saved maps (scenes) and NPC templates. Stripped from player views. */
  library: Library;
  // --- Track U ---
  /** Handouts and GM journal pages, filtered by audience in projections. */
  handouts: Record<string, Handout>;
  // --- Track N ---
  netrun?: NetState;
  // --- end Track N ---
  // --- Round 3 X ---
  extras?: ExtrasState;
  // --- end Round 3 X ---
}

// --- Round 3 X --- Grapples, Facedowns and per-Round attack history for Special Move triggers.
export interface Grapple { holderId: string; heldId: string; chokes: number; lastChokeRound: number | null; ironGrip: boolean }
export interface Facedown { id: string; winnerId: string; loserId: string; status: 'choosing' | 'fighting' }
export interface RoundHit { round: number; turnIndex: number; attackerId: string; defenderId: string; with: 'ranged' | 'weapon' | 'brawling' | 'martialArts'; hit: boolean }
export interface ExtrasState {
  grapples: Grapple[];
  facedowns: Facedown[];
  /** This Round's attacks (GM only; pruned each Round). */
  hits: RoundHit[];
  /** Triggered Special Moves used this Turn (GM only). */
  movesUsed: { round: number; turnIndex: number; actorId: string; moveId: string }[];
}
export type ExtraOp =
  | { kind: 'grab'; actorId: string; targetId: string; choice: 'grapple' | 'takeItem'; weaponId?: string }
  | { kind: 'escape'; actorId: string; heldId: string }
  | { kind: 'release'; actorId: string }
  | { kind: 'choke'; actorId: string }
  | { kind: 'throw'; actorId: string }
  | { kind: 'getUp'; actorId: string; form?: string }
  | { kind: 'specialMove'; actorId: string; moveId: string; targetId?: string; aimHead?: boolean; weaponId?: string; force?: boolean; gmDv?: number }
  | { kind: 'facedown'; actorId: string; targetId: string }
  | { kind: 'facedownChoice'; facedownId: string; choice: 'backDown' | 'fight' }
  | { kind: 'endFacedown'; facedownId: string }
  | { kind: 'setReputation'; actorId: string; value: number }
  | { kind: 'impact'; actorId: string; audience: 'single' | 'small' | 'huge' }
  | { kind: 'backup'; actorId: string }
  | { kind: 'haggle'; actorId: string; sellerTotal?: number }
  | { kind: 'publish'; actorId: string; dv: number; evidence: number }
  | { kind: 'rumor'; actorId: string; dv: number }
  | { kind: 'maker'; actorId: string; specialty: 'upgrade' | 'fabrication' | 'invention'; skill: string; price: 'cheap' | 'costly' | 'premium' | 'expensive' | 'veryExpensive' | 'luxury' | 'superLuxury'; item: string }
  | { kind: 'juryRig'; actorId: string; item: string }
  | { kind: 'recruit'; actorId: string; name: string; memberKind: 'bodyguard' | 'covertOperative' | 'driver' | 'netrunner' | 'technician' }
  | { kind: 'loyalty'; actorId: string; member: number; order?: string }
  | { kind: 'setRoleExtras'; actorId: string; maker?: { field: number; upgrade: number; fabrication: number; invention: number }; team?: { name: string; kind: 'bodyguard' | 'covertOperative' | 'driver' | 'netrunner' | 'technician'; loyalty: number }[]; moto?: { vehicles: string[]; upgrades: string[] } };
// --- end Round 3 X ---

// --- Track U ---
/** Shared text (optional image). audience: everyone, GM only (journal), or listed player ids. */
export interface Handout { id: string; title: string; body: string; imageUrl?: string; audience: 'all' | 'gm' | string[]; updatedAt?: string }

export interface StatePatch {
  /** null = remove actor. */
  actors?: Record<string, Actor | null>;
  encounter?: Encounter;
  /** Present (even as null) = replace. */
  pending?: Pending | null;
  /** Present (even as null) = replace. Small enough to send whole. */
  map?: TacticalMap | null;
  /** Replace the whole library. GM only; never projected. */
  library?: Library;
  /** Track U: replace all handouts. */
  handouts?: Record<string, Handout>;
  // --- Track N ---
  netrun?: NetState;
  // --- end Track N ---
  extras?: ExtrasState; // Round 3 X
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
  | { type: 'declineWatch'; pendingId: string }
  // Table tools
  /** Skill check: actor's STAT + skill (or a raw base) + 1d10 vs an optional DV. Private = GM eyes only. */
  | { type: 'rollCheck'; actorId?: string; label: string; stat?: StatKeyName; skill?: string; base?: number; modifiers?: Modifier[]; dv?: number; private?: boolean }
  /** Free dice (damage, tables). Private = GM eyes only. */
  | { type: 'rollDice'; label: string; dice: DiceExpr; private?: boolean }
  /** Chat. `to` = whisper recipients (player ids or 'gm'); omitted = everyone. */
  | { type: 'chat'; text: string; to?: string[]; asActorId?: string }
  // GM tools
  | { type: 'adjustHp'; actorId: string; delta: number; reason?: string }
  | { type: 'setCondition'; actorId: string; condition: ConditionKey; value: boolean }
  | { type: 'saveToLibrary'; kind: 'map' | 'actor'; item: TacticalMap | Actor }
  | { type: 'removeFromLibrary'; kind: 'map' | 'actor'; id: string }
  /** Activate a saved map (keeps tokens of actors that still exist). */
  | { type: 'switchScene'; mapId: string }
  /** Spawn a copy of a library actor with a fresh id, optionally on the map. */
  | { type: 'spawnFromLibrary'; templateId: string; newId: string; name?: string; at?: Cell }
  | { type: 'setLighting'; lighting: NonNullable<TacticalMap['lighting']> }
  // Area attacks on the grid
  | { type: 'areaAttack'; attackerId: string; weaponId: string; kind: 'shotgunShell' | 'launcher' | 'thrownGrenade'; at: Cell }
  | { type: 'suppressiveFire'; attackerId: string; weaponId: string }
  // --- Track K ---
  | { type: 'respondAreaDodge'; pendingId: string; actorId: string; dodge: boolean }
  /** GM: everyone who hasn't decided dodges (if able), then damage resolves. */
  | { type: 'resolveAreaDodges'; pendingId: string }
  | { type: 'attackCover'; attackerId: string; weaponId: string; at: Cell }
  | { type: 'setCover'; at: Cell; material: CoverMaterialId | null }
  | { type: 'setAmmoType'; actorId: string; weaponId: string; ammoType: AmmoTypeId }
  | { type: 'extinguish'; actorId: string }
  | { type: 'setAwareness'; actorId: string; allocation: Partial<Record<AwarenessKey, number>> }
  /** GM. `rollLoss` rolls that many d6 (+ bonus) for Humanity Loss instead of item.humanityLoss. */
  | { type: 'installCyberware'; actorId: string; item: CyberwareItem; rollLoss?: { count: number; bonus: number }
    // --- Round 3 D --- roll the item's hlDice, take its fixed value, or no loss (GM option).
    lossMode?: 'roll' | 'fixed' | 'none' }
  | { type: 'removeCyberware'; actorId: string; itemId: string }
  /** GM. The therapist's STAT + skill total; DV and eligibility from the therapy kind. */
  | { type: 'therapy'; actorId: string; kind: 'standard' | 'extreme'; therapistBase: number }
  | { type: 'treatInjury'; medicId: string; targetId: string; injuryIndex: number; kind: 'quickFix' | 'treatment'; skill: string }
  /** GM. Advance downtime: natural healing for these actors (default: everyone not dead). */
  | { type: 'rest'; days: number; care: Care; actorIds?: string[] }
  // --- end Track K ---
  // --- Round 4 R4 ---
  /** Turn on activated speedware (Sandevistan type). Uses the Action in an encounter; recharges on rest. */
  | { type: 'activateSpeedware'; actorId: string }
  // --- end Round 4 R4 ---
  // --- Track U ---
  | { type: 'setHandout'; id: string; title: string; body: string; imageUrl?: string; audience: 'all' | 'gm' | string[] }
  | { type: 'removeHandout'; id: string }
  // --- Round 3 P ---
  /** GM: put a late arrival into the Turn order (rolled, or a given total). */
  | { type: 'addToInitiative'; actorId: string; roll?: 'roll' | number }
  | { type: 'removeFromInitiative'; actorId: string }
  /** House rule: the current actor acts later this Round: after `after`, or last. */
  | { type: 'delayTurn'; after?: string }
  | { type: 'setDelayRule'; allowed: boolean }
  /** GM: where a missed explosive lands (omit `at` to roll it within the blast area). */
  | { type: 'placeScatter'; pendingId: string; at?: Cell }
  // --- end Round 3 P ---
  // --- Track N ---
  | { type: 'net'; op: NetOp }
  // --- end Track N ---
  | { type: 'extra'; op: ExtraOp }; // Round 3 X

export type StatKeyName = 'INT' | 'REF' | 'DEX' | 'TECH' | 'COOL' | 'WILL' | 'LUCK' | 'MOVE' | 'BODY' | 'EMP';

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
  /** Stand-in for an unseen combatant while it acts (id `hidden`). */
  placeholder?: true;
  /** Only when the viewer may see full stats (own actor, PCs, or GM). */
  combatant?: Combatant;
  weapons?: Weapon[];
  notes?: string;
}

export interface ViewState {
  sessionId: string;
  seq: number;
  actors: Record<string, ProjectedActor>;
  encounter: Encounter;
  pending: ProjectedPending | null;
  map: TacticalMap | null;
  /** GM view only. */
  library?: Library;
  /** Track U: handouts this viewer may read. */
  handouts?: Record<string, Handout>;
  // --- Track N ---
  netrun?: NetView;
  // --- end Track N ---
  extras?: ExtrasState; // Round 3 X (players: only grapples and Facedowns between known characters)
}

export interface ProjectedEntry {
  seq: number;
  id: string;
  at: string;
  by: AuthorId;
  intentType: IntentType;
  events: CombatEvent[];
  patch: { actors?: Record<string, ProjectedActor | null>; encounter?: Encounter; pending?: ProjectedPending | null; map?: TacticalMap | null; library?: Library; handouts?: Record<string, Handout>; /* Track N */ netrun?: NetView; /* Round 3 X */ extras?: ExtrasState };
}
