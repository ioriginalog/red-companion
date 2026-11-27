/**
 * Weapon quality (Secondary: community Player Handbook, weapons page).
 * Poor −1 and Excellent +1 to attack rolls with the weapon; Standard 0.
 * Quality never changes damage. Bows and crossbows can't be Excellent.
 */
import type { Modifier, Weapon, WeaponQuality } from './types.js';

export const QUALITY_LABEL: Record<WeaponQuality, string> = { poor: 'Poor Quality', standard: 'Standard Quality', excellent: 'Excellent Quality' };
export const QUALITY_MOD: Record<WeaponQuality, number> = { poor: -1, standard: 0, excellent: 1 };
export const WEAPON_QUALITIES: readonly WeaponQuality[] = ['poor', 'standard', 'excellent'];

/** The attack modifier for a weapon's quality (none for Standard). */
export function qualityMods(weapon: Weapon | undefined): Modifier[] {
  const q = weapon?.quality;
  if (!q || q === 'standard') return [];
  return [{ label: QUALITY_LABEL[q], value: QUALITY_MOD[q] }];
}

/** Null if the weapon's quality is allowed, else the reason. */
export function qualityProblem(weapon: Pick<Weapon, 'type' | 'quality'>): string | null {
  if (weapon.quality === undefined) return null;
  if (!WEAPON_QUALITIES.includes(weapon.quality)) return 'Quality must be Poor, Standard or Excellent.';
  if (weapon.quality === 'excellent' && weapon.type === 'bowsAndCrossbows') return 'Bows and crossbows can’t be Excellent quality.';
  return null;
}
