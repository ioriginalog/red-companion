/**
 * Recovery between fights.
 *
 * Natural healing (Secondary): resting at home heals BODY HP per day; a
 * hospital bed or Enhanced Antibodies heal BODY × 2 per day (they don't stack:
 * the best applies; Interpretation). Sleeping rough heals nothing.
 * A Mortally Wounded character must be Stabilized before healing starts.
 *
 * Critical Injuries: a Quick Fix check suppresses the effect; Treatment removes
 * the injury. Which skills and DVs apply comes from the injury table.
 */
import { makeCheck, beats } from './checks.js';
import { effectiveStat, skillLevel, standingModifiers, woundState } from './character.js';
import { getInjury } from './data/critical-injuries.js';
import type { Dice } from './dice.js';
import type { CombatEvent } from './events.js';
import type { Combatant } from './types.js';

export type Care = 'street' | 'home' | 'hospital';
export const CARE_MULTIPLIER: Record<Care, number> = { street: 0, home: 1, hospital: 2 };

export interface HealResult { combatant: Combatant; healed: number; blocked?: string }

export function naturalHealing(c: Combatant, days: number, care: Care): HealResult {
  if (c.conditions.dead) return { combatant: c, healed: 0, blocked: 'dead' };
  if (woundState(c.hp) === 'mortally' && !c.conditions.stabilized) return { combatant: c, healed: 0, blocked: 'needs Stabilization' };
  const mult = care === 'street' ? 0 : Math.max(CARE_MULTIPLIER[care], c.mods?.healingMultiplier ?? 0);
  const perDay = c.stats.BODY * mult;
  const hp = Math.min(c.hp.max, c.hp.current + perDay * days);
  const healed = Math.max(0, hp - c.hp.current);
  const next: Combatant = { ...c, hp: { ...c.hp, current: Math.max(c.hp.current, hp) }, onFire: undefined, perRound: undefined };
  if (next.hp.current > 0 && next.conditions.unconscious && woundState(next.hp) !== 'mortally') next.conditions = { ...next.conditions, unconscious: false };
  delete next.onFire;
  delete next.perRound;
  return { combatant: next, healed };
}

export type TreatmentKind = 'quickFix' | 'treatment';

/** DV for this injury, kind and skill, or the reason it can't be done that way. */
export function treatmentDv(injuryId: string, kind: TreatmentKind, skill: string): { dv: number } | { problem: string } {
  const def = getInjury(injuryId);
  if (kind === 'quickFix') {
    const opt = def.quickFix?.find((o) => o.skill === skill);
    if (!def.quickFix) return { problem: `${def.name} has no Quick Fix.` };
    return opt ? { dv: opt.dv } : { problem: `Quick Fix for ${def.name} uses ${def.quickFix.map((o) => o.skill).join(' or ')}.` };
  }
  if (def.treatment === 'quickFixIsPermanent') return { problem: `A Quick Fix treats ${def.name} for good.` };
  const opt = def.treatment.find((o) => o.skill === skill);
  return opt ? { dv: opt.dv } : { problem: `Treatment for ${def.name} uses ${def.treatment.map((o) => o.skill).join(' or ')}.` };
}

/**
 * TECH + skill + 1d10 vs the DV. Success: a Quick Fix suppresses the effect
 * (or removes it when the table says the Quick Fix is permanent); Treatment
 * removes the injury.
 */
export function treatInjury(medic: Combatant, target: Combatant, index: number, kind: TreatmentKind, skill: string, dv: number, dice: Dice) {
  const inst = target.criticalInjuries[index]!;
  const def = getInjury(inst.injuryId);
  const check = makeCheck([{ label: 'TECH', value: effectiveStat(medic, 'TECH') }, { label: skill, value: skillLevel(medic, skill) }], standingModifiers(medic, 'other'), dice);
  const success = beats(check.total, dv);
  let next = target;
  let outcome: 'quickFixed' | 'removed' | 'failed' = 'failed';
  if (success) {
    if (kind === 'quickFix' && def.treatment !== 'quickFixIsPermanent') {
      next = { ...target, criticalInjuries: target.criticalInjuries.map((c, i) => (i === index ? { ...c, quickFixed: true } : c)) };
      outcome = 'quickFixed';
    } else {
      next = { ...target, criticalInjuries: target.criticalInjuries.filter((_, i) => i !== index) };
      outcome = 'removed';
    }
  }
  const events: CombatEvent[] = [{
    type: 'injuryTreated', visibility: 'public', medicId: medic.id, targetId: target.id, injuryId: inst.injuryId, kind, skill, check, dv, outcome,
  }];
  return { target: next, events, success };
}
