/**
 * Hands needed per weapon type, and what arm injuries take away.
 * Hands per type (user ruling 2026-11-25, status Secondary): one-handed =
 * Medium/Heavy/Very Heavy Pistol, SMG, Heavy SMG, Light and Medium Melee, thrown
 * grenades; two-handed = everything else (Heavy Melee included).
 * @interpretation A Broken
 * Arm, Dismembered Arm or Dismembered Hand each cost one hand (assumed to be
 * different arms). A Quick-Fixed injury no longer restricts.
 */
import { activeInjuries } from './character.js';
import type { Combatant, Weapon, WeaponType } from './types.js';

export const HANDS: Record<WeaponType, 1 | 2> = {
  mediumPistol: 1, heavyPistol: 1, veryHeavyPistol: 1, smg: 1, heavySmg: 1,
  shotgun: 2, assaultRifle: 2, sniperRifle: 2, bowsAndCrossbows: 2, grenadeLauncher: 2, rocketLauncher: 2,
  lightMelee: 1, mediumMelee: 1, heavyMelee: 2, veryHeavyMelee: 2, grenade: 1,
};

const ARM_INJURIES = new Set(['brokenArm', 'dismemberedArm', 'dismemberedHand']);

/** Working hands not holding a shield. A shield takes one hand (Secondary). */
export function handsFree(c: Combatant): number {
  const lost = activeInjuries(c).filter((d) => ARM_INJURIES.has(d.id)).length;
  return Math.max(0, 2 - lost - (c.shield ? 1 : 0));
}

/** Null if the character can use the weapon, else the reason. */
export function wieldProblem(c: Combatant, weapon: Weapon | 'brawling'): string | null {
  const free = handsFree(c);
  if (weapon === 'brawling') return free === 0 ? `${c.name} has no working arm to fight with.` : null;
  const need = HANDS[weapon.type];
  if (free >= need) return null;
  if (c.shield && free < need) return free === 0 ? `${c.name}’s free hand is busy: drop the shield to use ${weapon.name}.` : `${weapon.name} needs two hands; drop the shield first.`;
  return free === 0
    ? `${c.name} has no working arm to use ${weapon.name}.`
    : `${weapon.name} needs two hands, and ${c.name} has one working arm.`;
}
