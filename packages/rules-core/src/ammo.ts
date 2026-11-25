/**
 * Ammunition types. Names are game terms; summaries are our own words.
 * The engine applies the simple mechanical ones; the rest are shown as prompts.
 * Sources: community references (Secondary). See docs/rules-verification.md.
 */
import type { AmmoTypeId, DamageSpec, Weapon } from './types.js';
import { WEAPON_TYPES } from './data/core.js';

export interface AmmoTypeDef {
  id: AmmoTypeId;
  name: string;
  summary: string;
  /** Applied by the engine (true) or left to the GM (false). */
  automated: boolean;
  /** Only grenades (launchers / thrown). */
  grenadeOnly?: boolean;
}

export const AMMO_TYPES: AmmoTypeDef[] = [
  { id: 'basic', name: 'Basic', summary: 'Standard damage and ablation.', automated: true },
  { id: 'armorPiercing', name: 'Armor-Piercing', summary: 'Ablates armor by 2 instead of 1.', automated: true },
  { id: 'expansive', name: 'Expansive', summary: 'Nastier wounds; the GM applies its Critical Injury effect.', automated: false },
  { id: 'incendiary', name: 'Incendiary', summary: 'If damage gets through armor, the target is On Fire.', automated: true },
  { id: 'rubber', name: 'Rubber', summary: 'Can’t drop a target below 1 HP; no Critical Injuries; no ablation.', automated: true },
  { id: 'smart', name: 'Smart', summary: 'With a Targeting Scope or smartgun link, a single shot that misses by 4 or less gets a second try at 10 + 1d10.', automated: true },
  { id: 'poison', name: 'Poison', summary: 'Target resists or takes direct HP damage; the GM resolves.', automated: false },
  { id: 'sleep', name: 'Sleep', summary: 'Target resists or falls unconscious; the GM resolves.', automated: false },
  { id: 'emp', name: 'EMP', summary: 'Area: cyberware may shut down for a while; the GM resolves.', automated: false, grenadeOnly: true },
  { id: 'smoke', name: 'Smoke', summary: 'Area: blocks sight for about a minute; the GM resolves.', automated: false, grenadeOnly: true },
  { id: 'teargas', name: 'Teargas', summary: 'Area: resist or suffer eye effects; the GM resolves.', automated: false, grenadeOnly: true },
  { id: 'flashbang', name: 'Flashbang', summary: 'Area: resist or suffer eye and ear effects; the GM resolves.', automated: false, grenadeOnly: true },
  { id: 'biotoxin', name: 'Biotoxin', summary: 'Area: resist or take direct HP damage; the GM resolves.', automated: false, grenadeOnly: true },
];

export const INCENDIARY_BURN = 2;
export const SMART_MISS_WINDOW = 4;
export const SMART_SECOND_TRY_BASE = 10;

export function getAmmoType(id: AmmoTypeId | undefined): AmmoTypeDef {
  return AMMO_TYPES.find((a) => a.id === (id ?? 'basic')) ?? AMMO_TYPES[0]!;
}

const isLauncher = (w: Weapon) => w.type === 'grenadeLauncher' || w.type === 'rocketLauncher';

/** Null if this ammo can be loaded in this weapon, else the reason. */
export function ammoProblem(weapon: Weapon, ammo: AmmoTypeId): string | null {
  const def = AMMO_TYPES.find((a) => a.id === ammo);
  if (!def) return 'Unknown ammunition type.';
  if (WEAPON_TYPES[weapon.type].melee) return `${weapon.name} doesn’t take ammunition.`;
  if (def.grenadeOnly && !isLauncher(weapon)) return `${def.name} comes only as grenades.`;
  if (ammo === 'smart' && isLauncher(weapon)) return 'Smart ammunition is for firearms.';
  return null;
}

/** The damage spec a hit with this ammo produces. */
export function applyAmmo(spec: DamageSpec, ammo: AmmoTypeId | undefined): DamageSpec {
  switch (ammo) {
    case 'armorPiercing': return { ...spec, ablation: 2 };
    case 'rubber': return { ...spec, nonLethal: true, ablation: 0 };
    case 'incendiary': return { ...spec, ignite: INCENDIARY_BURN };
    default: return spec;
  }
}
