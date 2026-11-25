/**
 * Rules data pack: CPR Core combat tables.
 *
 * IP NOTE (RTG Homebrew Content Policy): this file holds numbers and short
 * summaries written in our own words, each with a page reference where one
 * was confirmed. It must never hold rulebook prose. Keep it isolated so it can
 * be swapped or removed without touching engine code.
 */
import type { AutofireRow, RangeRow, SourceRef, WeaponType, WeaponTypeProfile } from '../types.js';

export const RULES_PACK_ID = 'cpr-core-combat';
export const RULES_PACK_VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// Range bands (m/yds). Upper bounds inclusive.
// ---------------------------------------------------------------------------
export const RANGE_BANDS = [6, 12, 25, 50, 100, 200, 400, 800] as const;
export const RANGE_BAND_LABELS = ['0–6', '7–12', '13–25', '26–50', '51–100', '101–200', '201–400', '401–800'] as const;

/** null = cannot attack at that band. */
export const RANGE_DV: Record<RangeRow, readonly (number | null)[]> = {
  pistol:           [13, 15, 20, 25, 30, 30, null, null],
  smg:              [15, 13, 15, 20, 25, 25, 30, null],
  shotgunSlug:      [13, 15, 20, 25, 30, 35, null, null],
  assaultRifle:     [17, 16, 15, 13, 15, 20, 25, 30],
  sniperRifle:      [30, 25, 25, 20, 15, 16, 17, 20],
  bowsAndCrossbows: [15, 13, 15, 17, 20, 22, null, null],
  grenadeLauncher:  [16, 15, 15, 17, 20, 22, 25, null],
  rocketLauncher:   [17, 16, 15, 15, 20, 20, 25, 30],
};
export const RANGE_DV_SOURCE: SourceRef = {
  book: 'CPR Core', page: 173, verification: 'secondary',
  note: 'Pistol row also matches Easy Mode. Other rows consistent across 3+ community references.',
};

/** Autofire uses the first five bands only (0–100 m/yds). */
export const AUTOFIRE_DV: Record<AutofireRow, readonly (number | null)[]> = {
  smg:          [20, 17, 20, 25, 30, null, null, null],
  assaultRifle: [22, 20, 17, 20, 25, null, null, null],
};
export const AUTOFIRE_DV_SOURCE: SourceRef = {
  book: 'CPR Errata', verification: 'errata',
  note: 'Errata values. Some early printings differ — use these.',
};

export const SHOTGUN_SHELL = {
  dv: 13,
  damageDice: 3,
  /** Every target in front of the shooter within this distance. */
  reachMeters: 6,
  source: { book: 'CPR Core', verification: 'secondary' } as SourceRef,
};

// ---------------------------------------------------------------------------
// Weapon types
// ---------------------------------------------------------------------------
const W = (p: Omit<WeaponTypeProfile, 'source'>, source: SourceRef = { book: 'CPR Core', verification: 'secondary' }): WeaponTypeProfile => ({ ...p, source });

export const WEAPON_TYPES: Record<WeaponType, WeaponTypeProfile> = {
  mediumPistol:     W({ type: 'mediumPistol', displayName: 'Medium Pistol', skill: 'Handgun', damageDice: 2, rof: 2, melee: false, rangeRow: 'pistol' }),
  heavyPistol:      W({ type: 'heavyPistol', displayName: 'Heavy Pistol', skill: 'Handgun', damageDice: 3, rof: 2, melee: false, rangeRow: 'pistol' }),
  veryHeavyPistol:  W({ type: 'veryHeavyPistol', displayName: 'Very Heavy Pistol', skill: 'Handgun', damageDice: 4, rof: 1, melee: false, rangeRow: 'pistol' }, { book: 'CPR Easy Mode', verification: 'easy-mode' }),
  smg:              W({ type: 'smg', displayName: 'SMG', skill: 'Handgun', damageDice: 2, rof: 1, melee: false, rangeRow: 'smg', autofire: { row: 'smg', cap: 3 } }),
  heavySmg:         W({ type: 'heavySmg', displayName: 'Heavy SMG', skill: 'Handgun', damageDice: 3, rof: 1, melee: false, rangeRow: 'smg', autofire: { row: 'smg', cap: 3 } }),
  shotgun:          W({ type: 'shotgun', displayName: 'Shotgun', skill: 'Shoulder Arms', damageDice: 5, rof: 1, melee: false, rangeRow: 'shotgunSlug', canFireShells: true }),
  assaultRifle:     W({ type: 'assaultRifle', displayName: 'Assault Rifle', skill: 'Shoulder Arms', damageDice: 5, rof: 1, melee: false, rangeRow: 'assaultRifle', autofire: { row: 'assaultRifle', cap: 4 } }),
  sniperRifle:      W({ type: 'sniperRifle', displayName: 'Sniper Rifle', skill: 'Shoulder Arms', damageDice: 5, rof: 1, melee: false, rangeRow: 'sniperRifle' }),
  bowsAndCrossbows: W({ type: 'bowsAndCrossbows', displayName: 'Bows & Crossbows', skill: 'Archery', damageDice: 4, rof: 1, melee: false, rangeRow: 'bowsAndCrossbows' }),
  grenadeLauncher:  W({ type: 'grenadeLauncher', displayName: 'Grenade Launcher', skill: 'Heavy Weapons', damageDice: 6, rof: 1, melee: false, rangeRow: 'grenadeLauncher' }),
  rocketLauncher:   W({ type: 'rocketLauncher', displayName: 'Rocket Launcher', skill: 'Heavy Weapons', damageDice: 8, rof: 1, melee: false, rangeRow: 'rocketLauncher' }),
  lightMelee:       W({ type: 'lightMelee', displayName: 'Light Melee Weapon', skill: 'Melee Weapon', damageDice: 1, rof: 2, melee: true }),
  mediumMelee:      W({ type: 'mediumMelee', displayName: 'Medium Melee Weapon', skill: 'Melee Weapon', damageDice: 2, rof: 2, melee: true }),
  heavyMelee:       W({ type: 'heavyMelee', displayName: 'Heavy Melee Weapon', skill: 'Melee Weapon', damageDice: 3, rof: 2, melee: true }, { book: 'CPR Easy Mode', verification: 'easy-mode' }),
  veryHeavyMelee:   W({ type: 'veryHeavyMelee', displayName: 'Very Heavy Melee Weapon', skill: 'Melee Weapon', damageDice: 4, rof: 1, melee: true }),
  // Round 3 D: thrown grenades. Area attack only; DEX + Athletics vs the Grenade Launcher row (Interpretation).
  grenade:          W({ type: 'grenade', displayName: 'Thrown Grenade', skill: 'Athletics', damageDice: 6, rof: 1, melee: false, rangeRow: 'grenadeLauncher' }),
};

/** Brawling and Martial Arts damage by BODY. */
export function unarmedDamageDice(body: number): number {
  if (body <= 4) return 1;
  if (body <= 6) return 2;
  if (body <= 10) return 3;
  return 4;
}
export const UNARMED_SOURCE: SourceRef = { book: 'CPR Core', verification: 'secondary' };

// ---------------------------------------------------------------------------
// Armor
// ---------------------------------------------------------------------------
export const ARMOR_TYPES = [
  { id: 'leathers', displayName: 'Leathers', sp: 4, penalty: 0 },
  // Kevlar® is a registered trademark of DuPont; named here as the game term only.
  { id: 'kevlar', displayName: 'Kevlar®', sp: 7, penalty: 0 },
  { id: 'lightArmorjack', displayName: 'Light Armorjack', sp: 11, penalty: 0 },
  { id: 'bodyweightSuit', displayName: 'Bodyweight Suit', sp: 11, penalty: 0 },
  { id: 'mediumArmorjack', displayName: 'Medium Armorjack', sp: 12, penalty: -2 },
  { id: 'heavyArmorjack', displayName: 'Heavy Armorjack', sp: 13, penalty: -2 },
  { id: 'flak', displayName: 'Flak', sp: 15, penalty: -4 },
  { id: 'metalgear', displayName: 'Metalgear', sp: 18, penalty: -4 },
] as const;
export const ARMOR_SOURCE: SourceRef = { book: 'CPR Core', verification: 'secondary', note: 'Light Armorjack SP 11 also in Easy Mode.' };

// ---------------------------------------------------------------------------
// Wounds, stabilization, aimed shots
// ---------------------------------------------------------------------------
export const WOUND_PENALTIES = {
  seriously: { allActions: -2, move: 0 },
  mortally: { allActions: -4, move: -6 },
} as const;
export const STABILIZE_DV = { unhurt: 0, lightly: 10, seriously: 13, mortally: 15 } as const;
export const AIMED_SHOT_PENALTY = -8;
export const CRIT_BONUS_DAMAGE = 5;
export const DODGE_REF_THRESHOLD = 8;
export const AUTOFIRE_AMMO = 10;
export const SUPPRESSIVE_FIRE_RADIUS = 25;
export const EXPLOSIVE_AREA_METERS = 10;
