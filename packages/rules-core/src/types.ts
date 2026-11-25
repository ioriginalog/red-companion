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
  // --- Track K ---
  /** Role and rank. A Netrunner's rank is their Interface rank (see `interfaceRank`). */
  role?: RoleState;
  /** Humanity; current EMP = floor(current / 10). */
  /** `base` = EMP × 10 at creation; `max` = base − 2 per cyberware with Humanity Loss (4 for borgware). */
  humanity?: { current: number; max: number; base?: number };
  /** Round 3 D: carried gear. */
  gear?: GearItem[];
  cyberware?: CyberwareItem[];
  /** Derived by `applySystems` from role and cyberware. The engine reads only this. */
  mods?: CombatMods;
  /** Once-per-Round abilities already used this Round (Damage Deflection, Spot Weakness). */
  perRound?: { round: number; deflected?: boolean; spotWeakness?: boolean };
  /** On Fire: HP lost at the start of each of this character's Turns until put out. */
  onFire?: number;
  // --- end Track K ---
  // --- Round 3 X ---
  /** Reputation level 0–10 (Facedowns). */
  reputation?: number;
  // --- end Round 3 X ---
}

// --- Track K ---
export type RoleId = 'rockerboy' | 'solo' | 'netrunner' | 'tech' | 'medtech' | 'media' | 'exec' | 'lawman' | 'fixer' | 'nomad';
export type AwarenessKey = 'damageDeflection' | 'fumbleRecovery' | 'initiativeReaction' | 'precisionAttack' | 'spotWeakness' | 'threatDetection';
export interface RoleState {
  id: RoleId;
  /** 1–10. */
  rank: number;
  /** Solo: Combat Awareness points per sub-ability (total ≤ rank). */
  awareness?: Partial<Record<AwarenessKey, number>>;
  /** Medtech: Medicine specialty points (total ≤ rank). */
  medicine?: { surgery: number; pharmaceuticals: number; cryosystem: number };
  // --- Round 3 X ---
  /** Tech: Maker specialty ranks (2 points per Role rank, each specialty ≤ rank). */
  maker?: { field: number; upgrade: number; fabrication: number; invention: number };
  /** Exec: Teamwork members (gained at ranks 3, 5 and 9). */
  team?: TeamMember[];
  /** Nomad: Family vehicles and upgrades chosen with Moto (names only). */
  moto?: { vehicles: string[]; upgrades: string[] };
  // --- end Round 3 X ---
  notes?: string;
}
// --- Round 3 X ---
export type TeamMemberKind = 'bodyguard' | 'covertOperative' | 'driver' | 'netrunner' | 'technician';
export interface TeamMember { name: string; kind: TeamMemberKind; loyalty: number }
// --- end Round 3 X ---
export type CyberwareEffect =
  | { kind: 'stat'; stat: StatKey; value: number }
  | { kind: 'skill'; skill: string; value: number }
  | { kind: 'armor'; location: HitLocation; sp: number }
  | { kind: 'initiative'; value: number }
  /** Legacy alias of 'targetingScope' (saved data from Round 2). */
  | { kind: 'smartLink' }
  /** Cybereye option: Smart ammo can track; +1 to ranged Aimed Shots. */
  | { kind: 'targetingScope' }
  /** Prerequisite for chipware, plugs and a Smartgun Link. */
  | { kind: 'neuralLink' }
  /** Cyberhand option; with a Neural Link it can drive a Smartgun Link. */
  | { kind: 'subdermalGrip' }
  | { kind: 'interfacePlugs' }
  | { kind: 'healingMultiplier'; value: number }
  | { kind: 'ignoreSeriouslyWounded' };
export interface CyberwareItem {
  id: string;
  name: string;
  /** e.g. Neuralware, Cyberoptics, Fashionware. */
  slot?: string;
  /** Humanity actually lost when installed (rolled or set). */
  humanityLoss: number;
  effects: CyberwareEffect[];
  notes?: string;
  // --- Round 3 D ---
  /** Humanity Loss dice as written, e.g. "2d6", "1d6/2", "0". */
  hlDice?: string;
  /** Fixed Humanity Loss taken at character creation. */
  hlFixed?: number;
  /** Borgware lowers maximum Humanity by 4 instead of 2. */
  borgware?: boolean;
  install?: 'mall' | 'clinic' | 'hospital' | 'none';
  costEb?: number;
  // --- end Round 3 D ---
}

/** A gear entry on a character sheet (Round 3 D). */
export interface GearItem { name: string; qty: number; notes?: string }
export interface CombatMods {
  statBonuses?: Partial<Record<StatKey, number>>;
  skillBonuses?: Record<string, number>;
  /** Precision Attack. */
  attack?: number;
  /** Initiative Reaction plus cyberware. */
  initiative?: number;
  damageDeflection?: number;
  spotWeakness?: number;
  fumbleRecovery?: boolean;
  /** Round 3 D: Targeting Scope (Smart ammo tracking, +1 ranged Aimed Shots). */
  targetingScope?: boolean;
  neuralLink?: boolean;
  subdermalGrip?: boolean;
  interfacePlugs?: boolean;
  healingMultiplier?: number;
  ignoreSeriouslyWounded?: boolean;
}
export type AmmoTypeId = 'basic' | 'armorPiercing' | 'expansive' | 'incendiary' | 'rubber' | 'smart' | 'improvedSmart'
  | 'emp' | 'smoke' | 'teargas' | 'flashbang' | 'biotoxin' | 'poison' | 'sleep';
// --- end Track K ---

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

export type WeaponType =
  | 'mediumPistol' | 'heavyPistol' | 'veryHeavyPistol'
  | 'smg' | 'heavySmg'
  | 'shotgun' | 'assaultRifle' | 'sniperRifle'
  | 'bowsAndCrossbows' | 'grenadeLauncher' | 'rocketLauncher'
  | 'lightMelee' | 'mediumMelee' | 'heavyMelee' | 'veryHeavyMelee'
  // --- Round 3 D --- thrown grenades (DEX + Athletics, area attack only)
  | 'grenade';

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
  // --- Track K ---
  /** Loaded ammunition type. Missing = Basic. */
  ammoType?: AmmoTypeId;
  // --- end Track K ---
  // --- Round 3 D ---
  /** Smartgun Link attachment: +1 to ranged attacks with this weapon when wired in (Neural Link + Interface Plugs or Subdermal Grip). */
  smartgunLink?: boolean;
  /** 2070s Smart Weapon: built smart, or a Smart Rebuild (non-Power, non-Tech gun; uses 2 of 3 attachment slots). */
  smart?: 'built' | 'rebuild';
  /** 2070s weapon class. Power and Tech weapons can't be given a Smart Rebuild. */
  tech2070s?: 'power' | 'tech';
  // --- end Round 3 D ---
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
  // --- Track K ---
  /** Rubber ammo: no Critical Injuries, no ablation, can't drop the target below 1 HP. */
  nonLethal?: boolean;
  /** Incendiary: sets On Fire (HP per Turn) when damage gets through armor. */
  ignite?: number;
  /** Spot Weakness etc.: added to the damage roll before armor. */
  bonusDamage?: number;
  /** Encounter Round, for once-per-Round defenses (Damage Deflection). */
  round?: number;
  // --- end Track K ---
}

export interface DamageRoll {
  dice: number[];
  multiplier: number;
  total: number;
  /** Two or more 6s on the damage dice. */
  critTriggered: boolean;
}
