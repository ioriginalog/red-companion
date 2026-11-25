import type { Dice } from './dice.js';
import type { CheckResult, D10Roll, Modifier } from './types.js';

/**
 * 1d10 with Critical Success / Critical Failure.
 * Natural 10: roll another d10 and ADD it. Natural 1: roll another d10 and SUBTRACT it.
 * The second die never chains (a second 10 or 1 is just a number).
 * Source: Easy Mode p.15 (verified).
 */
export function rollD10(dice: Dice): D10Roll {
  const natural = dice.d10();
  if (natural === 10) {
    const critDie = dice.d10();
    return { natural, critDie, kind: 'critSuccess', value: natural + critDie };
  }
  if (natural === 1) {
    const critDie = dice.d10();
    return { natural, critDie, kind: 'critFailure', value: natural - critDie };
  }
  return { natural, kind: 'normal', value: natural };
}

export function sumModifiers(mods: Modifier[]): number {
  return mods.reduce((s, m) => s + m.value, 0);
}

/** STAT + Skill + 1d10 + modifiers. `baseBreakdown` lists the STAT and Skill parts. */
export function makeCheck(baseBreakdown: Modifier[], modifiers: Modifier[], dice: Dice): CheckResult {
  const base = sumModifiers(baseBreakdown);
  const roll = rollD10(dice);
  return { base, baseBreakdown, modifiers, roll, total: base + roll.value + sumModifiers(modifiers) };
}

/** The attacker must BEAT the DV. Ties go to the defender. */
export function beats(attackTotal: number, defenseValue: number): boolean {
  return attackTotal > defenseValue;
}
