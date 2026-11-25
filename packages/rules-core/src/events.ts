/**
 * Events are the sync unit (see ADR-001). They record outcomes AND raw dice,
 * so any device can replay the log and get the same state.
 *
 * `visibility` is a hint for the projection layer: 'gm' events are stripped
 * from player views (e.g. exact NPC HP).
 */
import type { Cell } from './grid.js';
import type { CheckResult, CritTable, D10Roll, HitLocation, WoundState } from './types.js';

type Base = { visibility: 'public' | 'gm' };

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
);

export type { D10Roll };
