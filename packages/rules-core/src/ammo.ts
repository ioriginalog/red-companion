/**
 * Ammunition types. Names are game terms; summaries are our own words.
 * The engine applies the simple mechanical ones; the rest are shown as prompts.
 * Sources: community references (Secondary). See docs/rules-verification.md.
 */
import type { AimTarget, AmmoTypeId, CheckResult, Combatant, DamageSpec, Modifier, Weapon } from './types.js';
import type { Dice } from './dice.js';
import type { CombatEvent } from './events.js';
import { qualityMods } from './quality.js';
import { WEAPON_TYPES } from './data/core.js';
import { beats, rollD10 } from './checks.js';

export interface AmmoTypeDef {
  id: AmmoTypeId;
  name: string;
  summary: string;
  /** Applied by the engine (true) or left to the GM (false). */
  automated: boolean;
  /** Only grenades (launchers / thrown). */
  grenadeOnly?: boolean;
  /** Edgerunners Mission Kit 2070s option: only when the session's 2070s toggle is on. */
  era2070s?: boolean;
}

export const AMMO_TYPES: AmmoTypeDef[] = [
  { id: 'basic', name: 'Basic', summary: 'Standard damage and ablation.', automated: true },
  { id: 'armorPiercing', name: 'Armor-Piercing', summary: 'Ablates armor by 2 instead of 1.', automated: true },
  { id: 'expansive', name: 'Expansive', summary: 'Nastier wounds; the GM applies its Critical Injury effect.', automated: false },
  { id: 'incendiary', name: 'Incendiary', summary: 'If damage gets through armor, the target is On Fire.', automated: true },
  { id: 'rubber', name: 'Rubber', summary: 'Can’t drop a target below 1 HP; no Critical Injuries; no ablation.', automated: true },
  { id: 'smart', name: 'Smart', summary: 'Needs a Targeting Scope. A single shot that misses by 4 or less gets a second attack at 10 + 1d10 against the same DV (they may dodge it).', automated: true },
  { id: 'improvedSmart', name: 'Improved Smart', summary: '2070s option, Smart Weapons only. A shot that misses by 5 or less gets a second attempt at 14 + 1d10; the first shot’s penalties still apply.', automated: true, era2070s: true },
  { id: 'poison', name: 'Poison', summary: 'Target resists or takes direct HP damage; the GM resolves.', automated: false },
  { id: 'sleep', name: 'Sleep', summary: 'Target resists or falls unconscious; the GM resolves.', automated: false },
  { id: 'emp', name: 'EMP', summary: 'Area: cyberware may shut down for a while; the GM resolves.', automated: false, grenadeOnly: true },
  { id: 'smoke', name: 'Smoke', summary: 'Area: blocks sight for about a minute; the GM resolves.', automated: false, grenadeOnly: true },
  { id: 'teargas', name: 'Teargas', summary: 'Area: resist or suffer eye effects; the GM resolves.', automated: false, grenadeOnly: true },
  { id: 'flashbang', name: 'Flashbang', summary: 'Area: resist or suffer eye and ear effects; the GM resolves.', automated: false, grenadeOnly: true },
  { id: 'biotoxin', name: 'Biotoxin', summary: 'Area: resist or take direct HP damage; the GM resolves.', automated: false, grenadeOnly: true },
];

export const INCENDIARY_BURN = 2;
/** Core Smart ammo: miss by this much or less → second attack (Secondary). */
export const SMART_MISS_WINDOW = 4;
export const SMART_SECOND_TRY_BASE = 10;
/** Edgerunners Mission Kit Improved Smart ammo (Secondary, public reviews). */
export const IMPROVED_SMART_MISS_WINDOW = 5;
export const IMPROVED_SMART_SECOND_TRY_BASE = 14;

export function getAmmoType(id: AmmoTypeId | undefined): AmmoTypeDef {
  return AMMO_TYPES.find((a) => a.id === (id ?? 'basic')) ?? AMMO_TYPES[0]!;
}

const isLauncher = (w: Weapon) => w.type === 'grenadeLauncher' || w.type === 'rocketLauncher' || w.type === 'grenade';

/** A 2070s Smart Weapon: built smart, or a Smart Rebuild of a non-Power, non-Tech gun. */
export function isSmartWeapon(w: Weapon): boolean {
  if (w.smart === 'built') return true;
  return w.smart === 'rebuild' && w.tech2070s !== 'power' && w.tech2070s !== 'tech';
}

/** Null if the weapon's smart options are legal, else the reason. */
export function smartWeaponProblem(w: Weapon): string | null {
  if (w.smart === 'rebuild' && (w.tech2070s === 'power' || w.tech2070s === 'tech')) return 'Power and Tech weapons can’t take a Smart Rebuild.';
  if (w.smart && (WEAPON_TYPES[w.type]?.melee || isLauncher(w))) return 'Only firearms can be Smart Weapons.';
  if (w.smartgunLink && (WEAPON_TYPES[w.type]?.melee || w.type === 'grenade')) return 'A Smartgun Link fits only ranged weapons.';
  return null;
}

/** Null if this ammo can be loaded in this weapon, else the reason. */
export function ammoProblem(weapon: Weapon, ammo: AmmoTypeId): string | null {
  const def = AMMO_TYPES.find((a) => a.id === ammo);
  if (!def) return 'Unknown ammunition type.';
  if (WEAPON_TYPES[weapon.type].melee) return `${weapon.name} doesn’t take ammunition.`;
  if (def.grenadeOnly && !isLauncher(weapon)) return `${def.name} comes only as grenades.`;
  if ((ammo === 'smart' || ammo === 'improvedSmart') && isLauncher(weapon)) return 'Smart ammunition is for firearms.';
  if (ammo === 'improvedSmart' && !isSmartWeapon(weapon)) return 'Improved Smart ammunition needs a Smart Weapon.';
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

// ----- Smart targeting ------------------------------------------------------

/** A Smartgun Link only works wired in: Neural Link plus Interface Plugs or a Subdermal Grip. */
export function smartgunLinked(c: Combatant): boolean {
  return !!c.mods?.neuralLink && (!!c.mods.interfacePlugs || !!c.mods.subdermalGrip);
}

/**
 * Standing bonuses from smart gear on a ranged attack.
 * - Smartgun Link attachment: +1 (Secondary).
 * - 2070s Smart Weapon: +1 (Secondary). Both can apply. @interpretation
 * - Targeting Scope: +1 on ranged Aimed Shots (Secondary).
 * Smart Weapons ignore obscurement penalties; the engine has none, so the GM
 * simply doesn't add them.
 */
export function smartAttackMods(attacker: Combatant, weapon: Weapon, aimTarget?: AimTarget): Modifier[] {
  const out: Modifier[] = [];
  if (weapon.smartgunLink && smartgunLinked(attacker)) out.push({ label: 'Smartgun Link', value: 1 });
  if (isSmartWeapon(weapon)) out.push({ label: 'Smart Weapon', value: 1 });
  if (aimTarget && attacker.mods?.targetingScope) out.push({ label: 'Targeting Scope', value: 1 });
  out.push(...qualityMods(weapon)); // Poor −1 / Excellent +1
  return out;
}

export interface SmartRetryInput {
  attacker: Combatant;
  defender: Combatant;
  weapon: Weapon;
  mode: 'single' | 'autofire';
  attack: CheckResult;
  /** The first defense: a dodge check, or absent (range DV). */
  defense?: CheckResult;
  defenseValue: number;
  /** Rolls a fresh dodge for the second attack (Core Smart ammo: "they may dodge as normal"). */
  redodge?: () => CheckResult;
}

/**
 * After a missed shot with Smart ammo. Returns null when no retry applies.
 * - Smart (Core): Targeting Scope; single shot; missed by ≤ 4 → 10 + 1d10 vs the
 *   same DV, or vs a fresh dodge if they dodged. Flat: no other modifiers. (Secondary;
 *   "flat" is an Interpretation.) Luck may be added by the GM.
 * - Improved Smart (2070s; the session gates the option): Smart Weapon; missed by
 *   ≤ 5 → 14 + 1d10 plus the first shot's penalties (negative modifiers) vs the same
 *   defense. Autofire interaction is unknown → GM ruling. (Secondary.)
 */
export function smartRetry(x: SmartRetryInput, dice: Dice): { hit: boolean; events: CombatEvent[]; defenseValue: number } | null {
  const ammo = x.weapon.ammoType;
  const missBy = x.defenseValue - x.attack.total;
  if (missBy < 0 || beats(x.attack.total, x.defenseValue)) return null;
  if (ammo === 'smart') {
    if (x.mode !== 'single' || !x.attacker.mods?.targetingScope || missBy > SMART_MISS_WINDOW) return null;
    const roll = rollD10(dice);
    const total = SMART_SECOND_TRY_BASE + roll.value;
    let dv = x.defenseValue;
    let defense: CheckResult | undefined;
    if (x.defense && x.redodge) { defense = x.redodge(); dv = defense.total; }
    const hit = beats(total, dv);
    return {
      hit, defenseValue: dv,
      events: [{ type: 'smartAmmoRetry', visibility: 'public', attackerId: x.attacker.id, defenderId: x.defender.id, roll, total, dv, hit, kind: 'smart', ...(defense ? { defense } : {}) }],
    };
  }
  if (ammo === 'improvedSmart') {
    if (!isSmartWeapon(x.weapon) || missBy > IMPROVED_SMART_MISS_WINDOW) return null;
    if (x.mode === 'autofire') {
      return { hit: false, defenseValue: x.defenseValue, events: [{ type: 'gmRulingRequired', visibility: 'gm', reason: `${x.attacker.name}'s Improved Smart Autofire missed by ${missBy}. The Mission Kit's Autofire interaction isn't confirmed: decide whether it gets a second attempt.` }] };
    }
    const penalties = x.attack.modifiers.filter((m) => m.value < 0).reduce((s, m) => s + m.value, 0);
    const roll = rollD10(dice);
    const total = IMPROVED_SMART_SECOND_TRY_BASE + roll.value + penalties;
    const hit = beats(total, x.defenseValue);
    return {
      hit, defenseValue: x.defenseValue,
      events: [{ type: 'smartAmmoRetry', visibility: 'public', attackerId: x.attacker.id, defenderId: x.defender.id, roll, total, dv: x.defenseValue, hit, kind: 'improvedSmart' }],
    };
  }
  return null;
}
