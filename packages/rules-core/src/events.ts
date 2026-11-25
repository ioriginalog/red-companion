/**
 * Events are the sync unit (see ADR-001). They record outcomes AND raw dice,
 * so any device can replay the log and get the same state.
 *
 * `visibility` is a hint for the projection layer: 'gm' events are stripped
 * from player views (e.g. exact NPC HP).
 */
import type { Cell } from './grid.js';
import type { AmmoTypeId, AwarenessKey, CheckResult, CritTable, D10Roll, HitLocation, WoundState } from './types.js';

/**
 * `audience`: when present, only these viewers (player ids, or 'gm') receive
 * the event; the GM always does. Used for whispers.
 */
type Base = { visibility: 'public' | 'gm'; audience?: string[] };

export type CombatEvent = Base & (
  | { type: 'initiativeRolled'; entries: { combatantId: string; base: number; roll: number; total: number; tiebreaks: number[] }[] }
  | { type: 'attackResolved'; attackerId: string; defenderId: string; attack: CheckResult; defenseKind: 'rangeDV' | 'dodge' | 'evasion' | 'fixedDV' | 'gmDV'; defenseValue: number; defense?: CheckResult; hit: boolean; margin: number }
  | { type: 'ammoSpent'; combatantId: string; weaponId: string; rounds: number }
  | { type: 'damageRolled'; dice: number[]; multiplier: number; total: number; critTriggered: boolean }
  | { type: 'damageApplied'; targetId: string; location: HitLocation; rawDamage: number; spBefore: number; spCounted: number; through: number; locationMultiplier: number; hpBefore: number; hpAfter: number }
  | { type: 'armorAblated'; targetId: string; location: HitLocation; pieces: { id: string; from: number; to: number }[] }
  | { type: 'criticalInjury'; targetId: string; injuryId: string; table: CritTable; cause: 'damageDice' | 'mortallyWounded' | 'aimedLeg'; rolls: [number, number][]; bonusDamage: number; hpAfter: number }
  | { type: 'critTableExhausted'; targetId: string; table: CritTable; cause: 'damageDice' | 'mortallyWounded' }
  | { type: 'heldItemDropped'; targetId: string; reason: 'aimedShot' | 'criticalInjury' }
  | { type: 'woundStateChanged'; targetId: string; from: WoundState; to: WoundState }
  | { type: 'deathSavePenaltyChanged'; targetId: string; from: number; to: number; reason: 'deathSaveRolled' | 'damagedWhileMortallyWounded' | 'stabilized' }
  | { type: 'deathSaveRolled'; targetId: string; natural: number; penalty: number; total: number; body: number; success: boolean }
  | { type: 'died'; targetId: string }
  | { type: 'stabilizationAttempted'; medicId: string; targetId: string; check: CheckResult; dv: number; success: boolean }
  | { type: 'stabilized'; targetId: string; hpAfter: number; unconscious: boolean }
  | { type: 'suppressiveFireResolved'; attackerId: string; attack: CheckResult; results: { targetId: string; resist: CheckResult; mustSeekCover: boolean }[] }
  | { type: 'gmRulingRequired'; reason: string }
  | { type: 'tokenMoved'; combatantId: string; path: Cell[]; cost: number; ran: boolean }
  | { type: 'watchSet'; combatantId: string; facing: number; arc: number }
  | { type: 'watchTriggered'; combatantId: string; targetId: string; at: Cell }
  | { type: 'checkRolled'; by: string; combatantId?: string; label: string; check: CheckResult; dv?: number; success?: boolean }
  | { type: 'diceRolled'; by: string; label: string; dice: number[]; sides: 6 | 10; bonus: number; total: number }
  | { type: 'chatMessage'; by: string; asCombatantId?: string; text: string }
  | { type: 'hpAdjusted'; targetId: string; delta: number; hpAfter: number; reason?: string }
  | { type: 'conditionSet'; targetId: string; condition: string; value: boolean }
  | { type: 'sceneChanged'; mapId: string; name: string }
  // --- Track U ---
  | { type: 'handoutShared'; id: string; title: string }
  // --- Track N ---
  /** Netrunning: one line per NET Action, with its check(s). `text` is ready to narrate (sentence case). */
  | { type: 'netAction'; combatantId: string; action: string; text: string; check?: CheckResult; vs?: CheckResult; dv?: number; success?: boolean; dice?: number[]; amount?: number }
  // --- end Track N ---
  | { type: 'areaResolved'; attackerId: string; kind: string; at: Cell; targetIds: string[] }
  // --- Round 3 P ---
  /** A missed explosive is waiting for the GM to place it. */
  | { type: 'explosiveMissed'; attackerId: string; at: Cell }
  /** Where a missed explosive landed (`rolled` = random square, else GM placed). */
  | { type: 'explosiveScattered'; attackerId: string; from: Cell; to: Cell; rolled: boolean }
  /** A hit that did no damage (armor stopped it): safe to show players without SP numbers. */
  | { type: 'noEffect'; targetId: string }
  | { type: 'turnDelayed'; combatantId: string; after: string | null }
  | { type: 'leftInitiative'; combatantId: string }
  // --- end Round 3 P ---
  // --- Track K ---
  | { type: 'injuryTreated'; medicId: string; targetId: string; injuryId: string; kind: 'quickFix' | 'treatment'; skill: string; check: CheckResult; dv: number; outcome: 'quickFixed' | 'removed' | 'failed' }
  | { type: 'humanityChanged'; combatantId: string; from: number; to: number; empFrom: number; empTo: number; reason: 'cyberware' | 'removal' | 'therapy' | 'gm' }
  | { type: 'cyberwareInstalled'; combatantId: string; itemId: string; name: string; humanityLoss: number; rolled?: number[]; lossMode?: 'roll' | 'fixed' | 'none'; maxFrom?: number; maxTo?: number }
  | { type: 'cyberwareRemoved'; combatantId: string; itemId: string; name: string; humanityRestored: number; maxFrom?: number; maxTo?: number }
  | { type: 'therapyResolved'; combatantId: string; kind: 'standard' | 'extreme'; check: CheckResult; dv: number; success: boolean; recovered: number; rolled: number[] }
  | { type: 'awarenessSet'; combatantId: string; allocation: Partial<Record<AwarenessKey, number>> }
  | { type: 'rested'; targetId: string; days: number; care: string; healed: number; hpAfter: number; blocked?: string }
  | { type: 'coverDamaged'; at: Cell; material: string; hpBefore: number; hpAfter: number; destroyed: boolean; byId?: string }
  | { type: 'burning'; targetId: string; damage: number; hpAfter: number }
  | { type: 'ignited'; targetId: string; perTurn: number }
  | { type: 'extinguished'; targetId: string }
  | { type: 'ammoLoaded'; combatantId: string; weaponId: string; ammoType: AmmoTypeId }
  | { type: 'smartAmmoRetry'; attackerId: string; defenderId: string; roll: D10Roll; total: number; dv: number; hit: boolean; kind?: 'smart' | 'improvedSmart'; defense?: CheckResult }
  | { type: 'damageDeflected'; targetId: string; amount: number }
  | { type: 'spotWeakness'; combatantId: string; bonus: number }
  | { type: 'areaDodgeRequested'; combatantId: string; attackTotal: number }
  // --- end Track K ---
);

export type { D10Roll };
