/**
 * Derived values: HP, wound state, armor, effective STATs, standing modifiers.
 */
import { getInjury } from './data/critical-injuries.js';
import { WOUND_PENALTIES } from './data/core.js';
import type { ArmorPiece, Combatant, HitLocation, Modifier, StatKey, WoundState } from './types.js';

// ----- HP -------------------------------------------------------------------

/** HP = 10 + 5 × ceil((BODY + WILL) / 2). Source: Core p.79 (secondary). */
export function maxHP(body: number, will: number): number {
  return 10 + 5 * Math.ceil((body + will) / 2);
}

/** Seriously Wounded threshold = ceil(max HP / 2). */
export function seriouslyWoundedThreshold(maxHp: number): number {
  return Math.ceil(maxHp / 2);
}

/**
 * Wound State from current HP.
 * Core: Seriously Wounded = LESS THAN half (rounded up). Easy Mode says
 * "equal to or less than 1/2"; the two disagree only when HP is exactly
 * ceil(max/2) and max is even. We follow Core.
 */
export function woundState(hp: { max: number; current: number }): WoundState {
  if (hp.current < 1) return 'mortally';
  if (hp.current < seriouslyWoundedThreshold(hp.max)) return 'seriously';
  if (hp.current < hp.max) return 'lightly';
  return 'unhurt';
}

// ----- Critical Injury effects ---------------------------------------------

/** Active (non-Quick-Fixed) injury definitions on a combatant. */
export function activeInjuries(c: Combatant) {
  return c.criticalInjuries.filter((i) => !i.quickFixed).map((i) => getInjury(i.injuryId));
}

export function hasInjury(c: Combatant, injuryId: string): boolean {
  return c.criticalInjuries.some((i) => i.injuryId === injuryId);
}

/**
 * Base Death Save Penalty = sum of active injuries that raise it.
 * @interpretation A Quick Fix suppresses the whole Injury Effect cell, which
 * includes the Death Save line, so Quick-Fixed injuries don't count.
 */
export function baseDeathSavePenalty(c: Combatant): number {
  return activeInjuries(c).reduce((s, d) => s + (d.effect.deathSavePenalty ?? 0), 0);
}

export function currentDeathSavePenalty(c: Combatant): number {
  return baseDeathSavePenalty(c) + c.deathSave.accumulatedPenalty;
}

export function canDodge(c: Combatant): boolean {
  return !activeInjuries(c).some((d) => d.effect.cannotDodge);
}

export function headshotMultiplier(c: Combatant): number {
  return activeInjuries(c).reduce((m, d) => Math.max(m, d.effect.headshotMultiplier ?? 2), 2);
}

// ----- Armor ----------------------------------------------------------------

/** SP doesn't stack: only the highest current SP in a location counts. */
export function effectiveSP(c: Combatant, loc: HitLocation): number {
  return c.armor.filter((a) => a.location === loc).reduce((m, a) => Math.max(m, a.currentSP), 0);
}

/**
 * @interpretation Armor penalties don't stack: use the single worst penalty
 * among all worn pieces (head or body). Community-sourced; verify.
 */
export function armorPenalty(c: Combatant): number {
  return c.armor.reduce((m, a) => Math.min(m, a.penalty), 0);
}

/** Every worn piece in the location loses SP together (floor 0). */
export function ablate(armor: ArmorPiece[], loc: HitLocation, amount: number) {
  const changes: { id: string; from: number; to: number }[] = [];
  const next = armor.map((a) => {
    if (a.location !== loc || a.currentSP === 0 || amount <= 0) return a;
    const to = Math.max(0, a.currentSP - amount);
    changes.push({ id: a.id, from: a.currentSP, to });
    return { ...a, currentSP: to };
  });
  return { armor: next, changes };
}

// ----- Effective STATs ------------------------------------------------------

/**
 * STAT after armor penalty. REF/DEX/MOVE only; floor 0.
 * MOVE also takes injury and Mortally Wounded reductions, floored at 1
 * ("minimum 1") unless armor alone already took it to 0.
 */
export function effectiveStat(c: Combatant, stat: StatKey): number {
  const raw = c.stats[stat] + (c.mods?.statBonuses?.[stat] ?? 0); // Track K: cyberware STAT bonuses
  if (stat !== 'REF' && stat !== 'DEX' && stat !== 'MOVE') return raw;
  const afterArmor = Math.max(0, raw + armorPenalty(c));
  if (stat !== 'MOVE') return afterArmor;
  let reduction = activeInjuries(c).reduce((s, d) => s + (d.effect.move ?? 0), 0);
  if (woundState(c.hp) === 'mortally') reduction += WOUND_PENALTIES.mortally.move;
  if (reduction === 0) return afterArmor;
  return Math.max(Math.min(1, afterArmor), afterArmor + reduction);
}

export function skillLevel(c: Combatant, skill: string): number {
  return (c.skills[skill] ?? 0) + (c.mods?.skillBonuses?.[skill] ?? 0); // Track K: Role and cyberware skill bonuses
}

// ----- Standing modifiers to checks -----------------------------------------

export type ActionKind = 'rangedAttack' | 'meleeAttack' | 'other';

/** Wound State and Critical Injury penalties that apply to any check of this kind. */
export function standingModifiers(c: Combatant, kind: ActionKind): Modifier[] {
  const mods: Modifier[] = [];
  const ws = woundState(c.hp);
  if (ws === 'mortally') mods.push({ label: 'Mortally Wounded', value: WOUND_PENALTIES.mortally.allActions });
  else if (ws === 'seriously' && !c.flags?.ignoreSeriouslyWoundedPenalty && !c.mods?.ignoreSeriouslyWounded) {
    mods.push({ label: 'Seriously Wounded', value: WOUND_PENALTIES.seriously.allActions });
  }
  for (const d of activeInjuries(c)) {
    if (d.effect.allActions) mods.push({ label: d.name, value: d.effect.allActions });
    if (kind === 'rangedAttack' && d.effect.rangedAttacks) mods.push({ label: d.name, value: d.effect.rangedAttacks });
    if (kind === 'meleeAttack' && d.effect.meleeAttacks) mods.push({ label: d.name, value: d.effect.meleeAttacks });
  }
  // --- Track K --- Solo Combat Awareness: Precision Attack.
  if ((kind === 'rangedAttack' || kind === 'meleeAttack') && c.mods?.attack) mods.push({ label: 'Precision Attack', value: c.mods.attack });
  return mods;
}
