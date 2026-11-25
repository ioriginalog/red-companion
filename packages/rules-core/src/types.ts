/**
 * Data schema for the combat core.
 *
 * Everything here is plain JSON-serializable data so it can live in the
 * event log, IndexedDB, and Postgres without adapters.
 */

// ---------------------------------------------------------------------------
// Provenance — every rule/table entry carries one of these.
// ---------------------------------------------------------------------------

/**
 * How confident we are that a rule matches the Core Rulebook.
 * - easy-mode:      matches the free Easy Mode PDF (a Core subset).
 * - errata:         matches RTG's published errata.
 * - secondary:      reported consistently by community references; not checked against the book.
 * - interpretation: the book is silent/ambiguous; this is our ruling. GM should confirm.
 */
export type Verification = 'easy-mode' | 'errata' | 'secondary' | 'interpretation';

export interface SourceRef {
  book: 'CPR Core' | 'CPR Easy Mode' | 'CPR Errata';
  /** Page in the Core Rulebook, only when a source confirmed it. Never guessed. */
  page?: number;
  verification: Verification;
  note?: string;
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

export type StatKey = 'INT' | 'REF' | 'DEX' | 'TECH' | 'COOL' | 'WILL' | 'LUCK' | 'MOVE' | 'BODY' | 'EMP';
export type Stats = Record<StatKey, number>;

export type HitLocation = 'body' | 'head';

export interface ArmorPiece {
  id: string;
  name: string;
  location: HitLocation;
  maxSP: number;
  currentSP: number;
  /** Non-positive. Applies to REF, DEX and MOVE. */
  penalty: number;
}

export type CritTable = 'body' | 'head';

export interface CriticalInjuryInstance {
  injuryId: string;
  table: CritTable;
  /** A Quick Fix suppresses the Injury Effect until end of day. */
  quickFixed: boolean;
}

export type WoundState = 'unhurt' | 'lightly' | 'seriously' | 'mortally';

export interface Combatant {
  id: string;
  name: string;
  side: 'pc' | 'npc';
  stats: Stats;
  /** Skill LEVELS keyed by skill name (e.g. "Handgun"). Missing = 0. */
  skills: Record<string, number>;
  hp: { max: number; current: number };
  armor: ArmorPiece[];
  criticalInjuries: CriticalInjuryInstance[];
  deathSave: {
    /** +1 per Death Save rolled and per damaging hit while Mortally Wounded. Reset by Stabilization. */
    accumulatedPenalty: number;
  };
  conditions: {
    prone: boolean;
    unconscious: boolean;
    dead: boolean;
    /** Natural healing has started. Cleared if the character takes damage again. */
    stabilized: boolean;
  };
  flags?: {
    /** e.g. Pain Editor chipware. */
    ignoreSeriouslyWoundedPenalty?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

export type WeaponType =
  | 'mediumPistol' | 'heavyPistol' | 'veryHeavyPistol'
  | 'smg' | 'heavySmg'
  | 'shotgun' | 'assaultRifle' | 'sniperRifle'
  | 'bowsAndCrossbows' | 'grenadeLauncher' | 'rocketLauncher'
  | 'lightMelee' | 'mediumMelee' | 'heavyMelee' | 'veryHeavyMelee';

export type RangeRow =
  | 'pistol' | 'smg' | 'shotgunSlug' | 'assaultRifle' | 'sniperRifle'
  | 'bowsAndCrossbows' | 'grenadeLauncher' | 'rocketLauncher';

export type AutofireRow = 'smg' | 'assaultRifle';

export interface WeaponTypeProfile {
  type: WeaponType;
  displayName: string;
  skill: string;
  damageDice: number; // count of d6
  rof: 1 | 2;
  melee: boolean;
  rangeRow?: RangeRow;
  autofire?: { row: AutofireRow; cap: number };
  canFireShells?: boolean;
  source: SourceRef;
}

export interface Weapon {
  id: string;
  name: string;
  type: WeaponType;
  ammo?: { loaded: number; capacity: number };
  /** Overrides for Exotic weapons, quality, homebrew. */
  damageDiceOverride?: number;
  rofOverride?: 1 | 2;
}

// ---------------------------------------------------------------------------
// Checks and modifiers
// ---------------------------------------------------------------------------

export interface Modifier {
  /** Short Headline-Style label shown in the roll breakdown, e.g. "Seriously Wounded". */
  label: string;
  value: number;
}

export interface D10Roll {
  natural: number;
  /** Second d10 rolled on a natural 10 (added) or natural 1 (subtracted). */
  critDie?: number;
  kind: 'normal' | 'critSuccess' | 'critFailure';
  /** natural ± critDie */
  value: number;
}

export interface CheckResult {
  /** STAT + Skill (after armor penalties). */
  base: number;
  baseBreakdown: Modifier[];
  modifiers: Modifier[];
  roll: D10Roll;
  total: number;
  /** Set by the projection layer when stats were hidden from a player; only `total` is meaningful. */
  redacted?: boolean;
}

// ---------------------------------------------------------------------------
// Attacks and damage
// ---------------------------------------------------------------------------

export type AimTarget = 'head' | 'heldItem' | 'leg';
export type DamageSource = 'ranged' | 'autofire' | 'shotgunShell' | 'explosive' | 'melee' | 'brawling' | 'martialArts';

export interface DamageSpec {
  source: DamageSource;
  diceCount: number;
  /** Autofire only: min(margin, weapon cap). */
  multiplier: number;
  location: HitLocation;
  /** Melee weapons and Martial Arts: count half SP, rounded up. */
  halveSP: boolean;
  aimTarget?: AimTarget;
  /** SP lost per armor piece when damage gets through. */
  ablation: number;
  critTable: CritTable;
}

export interface DamageRoll {
  dice: number[];
  multiplier: number;
  total: number;
  /** Two or more 6s on the damage dice. */
  critTriggered: boolean;
}
