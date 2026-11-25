/**
 * Hands needed per weapon type, and what arm injuries take away.
 * @interpretation Hand counts follow common table usage (one-handed: pistols,
 * SMGs, Heavy SMGs, light/medium/heavy melee; two-handed: the rest). A Broken
 * Arm, Dismembered Arm or Dismembered Hand each cost one hand (assumed to be
 * different arms). A Quick-Fixed injury no longer restricts.
 */
import { activeInjuries } from './character.js';
import type { Combatant, Weapon, WeaponType } from './types.js';

export const HANDS: Record<WeaponType, 1 | 2> = {
  mediumPistol: 1, heavyPistol: 1, veryHeavyPistol: 1, smg: 1, heavySmg: 1,
  shotgun: 2, assaultRifle: 2, sniperRifle: 2, bowsAndCrossbows: 2, grenadeLauncher: 2, rocketLauncher: 2,
  lightMelee: 1, mediumMelee: 1, heavyMelee: 1, veryHeavyMelee: 2,
};

const ARM_INJURIES = new Set(['brokenArm', 'dismemberedArm', 'dismemberedHand']);

export function handsFree(c: Combatant): number {
  const lost = activeInjuries(c).filter((d) => ARM_INJURIES.has(d.id)).length;
  return Math.max(0, 2 - lost);
}

/** Null if the character can use the weapon, else the reason. */
export function wieldProblem(c: Combatant, weapon: Weapon | 'brawling'): string | null {
  const free = handsFree(c);
  if (weapon === 'brawling') return free === 0 ? `${c.name} has no working arm to fight with.` : null;
  const need = HANDS[weapon.type];
  if (free >= need) return null;
  return free === 0
    ? `${c.name} has no working arm to use ${weapon.name}.`
    : `${weapon.name} needs two hands, and ${c.name} has one working arm.`;
}
