/**
 * Attack resolution: ranged (single shot, Aimed Shot, Autofire), melee
 * (weapons, Brawling, Martial Arts). One call = one attack. ROF 2 means the
 * UI calls twice (and may split movement between them).
 *
 * Output is a DamageSpec on a hit; the caller then rolls damage and applies it
 * (see damage.ts). Keeping these separate lets the UI show "HIT — roll damage"
 * as its own tap, which is how tables actually play.
 */
import { makeCheck, beats, rollD10 } from './checks.js';
import { applyAmmo, smartAttackMods, smartRetry } from './ammo.js';
import {
  AIMED_SHOT_PENALTY, AUTOFIRE_AMMO, AUTOFIRE_DV, DODGE_REF_THRESHOLD, RANGE_BANDS, RANGE_BAND_LABELS, RANGE_DV,
  WEAPON_TYPES, unarmedDamageDice,
} from './data/core.js';
import type { Dice } from './dice.js';
import { RulesError } from './errors.js';
import type { CombatEvent } from './events.js';
import { canDodge, effectiveStat, skillLevel, standingModifiers } from './character.js';
import type { AimTarget, CheckResult, Combatant, DamageSpec, Modifier, Weapon, WeaponTypeProfile } from './types.js';

// ----- Range ----------------------------------------------------------------

/**
 * Band index for a distance in m/yds. Fractional distances round UP
 * (6.5 m is in 7–12). Returns -1 past 800.
 */
export function rangeBandIndex(distance: number): number {
  if (!(distance >= 0)) throw new RangeError(`Invalid distance ${distance}`);
  const d = Math.ceil(distance);
  return RANGE_BANDS.findIndex((upper) => d <= upper);
}

export function profileOf(weapon: Weapon): WeaponTypeProfile {
  return WEAPON_TYPES[weapon.type];
}

export function attacksPerAction(weapon: Weapon | 'brawling' | 'martialArts', opts: { aimed?: boolean; autofire?: boolean } = {}): number {
  if (opts.aimed || opts.autofire) return 1;
  if (weapon === 'brawling' || weapon === 'martialArts') return 2;
  return weapon.rofOverride ?? profileOf(weapon).rof;
}

/** Can this defender choose to dodge a ranged attack? REF (after armor penalty) 8+ and not barred by an injury. */
export function canDodgeRanged(defender: Combatant): boolean {
  return effectiveStat(defender, 'REF') >= DODGE_REF_THRESHOLD && canDodge(defender) && !defender.conditions.unconscious;
}

// ----- Shared ----------------------------------------------------------------

export interface AttackOutcome {
  attack: CheckResult;
  defenseValue: number;
  defense?: CheckResult;
  hit: boolean;
  margin: number;
  ammoSpent: number;
  /** Present on a hit. */
  damage?: DamageSpec;
  events: CombatEvent[];
}

function aimMods(aimTarget?: AimTarget): Modifier[] {
  return aimTarget ? [{ label: `Aimed Shot (${aimLabel(aimTarget)})`, value: AIMED_SHOT_PENALTY }] : [];
}
function aimLabel(a: AimTarget) {
  return a === 'head' ? 'Head' : a === 'heldItem' ? 'Held Item' : 'Leg';
}

function evasionCheck(defender: Combatant, dice: Dice): CheckResult {
  return makeCheck(
    [{ label: 'DEX', value: effectiveStat(defender, 'DEX') }, { label: 'Evasion', value: skillLevel(defender, 'Evasion') }],
    standingModifiers(defender, 'other'),
    dice,
  );
}

// --- Track K --- Solo Fumble Recovery: a natural 1 on an attack is just a 1.
export function withFumbleRecovery(attacker: Combatant, check: CheckResult): CheckResult {
  if (!attacker.mods?.fumbleRecovery || check.roll.kind !== 'critFailure') return check;
  const roll = { natural: check.roll.natural, kind: 'normal' as const, value: check.roll.natural };
  return { ...check, roll, total: check.total - check.roll.value + roll.value };
}

/** Launchers fire at squares, not people: use an area attack. */
function refuseDirectFire(weapon: Weapon, p: WeaponTypeProfile) {
  if (p.rangeRow === 'grenadeLauncher' || p.rangeRow === 'rocketLauncher') {
    throw new RulesError('ILLEGAL_MODE', `${weapon.name} fires at an area. Use an area attack.`);
  }
}
// --- end Track K ---

function checkAmmo(weapon: Weapon, need: number) {
  if (weapon.ammo && weapon.ammo.loaded < need) {
    throw new RulesError('NOT_ENOUGH_AMMO', `${weapon.name} needs ${need} rounds loaded; has ${weapon.ammo.loaded}.`);
  }
}

/** Returns a copy with ammo deducted (no-op for weapons that don't track ammo). */
export function spendAmmo(weapon: Weapon, rounds: number): Weapon {
  if (!weapon.ammo) return weapon;
  return { ...weapon, ammo: { ...weapon.ammo, loaded: weapon.ammo.loaded - rounds } };
}

// ----- Ranged ----------------------------------------------------------------

export interface RangedAttackInput {
  attacker: Combatant;
  defender: Combatant;
  weapon: Weapon;
  distance: number;
  mode?: 'single' | 'autofire';
  aimTarget?: AimTarget;
  /** Defender's declared choice. Throws if they aren't eligible. */
  defenderDodges?: boolean;
  /** GM-applied situational modifiers (cover-adjacent, lighting, etc.). */
  situational?: Modifier[];
}

export function resolveRangedAttack(input: RangedAttackInput, dice: Dice): AttackOutcome {
  const { attacker, defender, weapon, distance, aimTarget } = input;
  const mode = input.mode ?? 'single';
  const p = profileOf(weapon);
  if (p.melee) throw new RulesError('ILLEGAL_MODE', `${weapon.name} is a melee weapon.`);
  refuseDirectFire(weapon, p);

  const band = rangeBandIndex(distance);
  let dv: number | null | undefined;
  let skill: string;
  let ammo: number;

  if (mode === 'autofire') {
    if (!p.autofire) throw new RulesError('ILLEGAL_MODE', `${p.displayName} can't Autofire.`);
    if (aimTarget) throw new RulesError('ILLEGAL_MODE', 'Autofire can’t be an Aimed Shot.');
    ammo = AUTOFIRE_AMMO;
    skill = 'Autofire';
    dv = band < 0 ? null : AUTOFIRE_DV[p.autofire.row][band];
  } else {
    ammo = 1;
    skill = p.skill;
    dv = band < 0 ? null : RANGE_DV[p.rangeRow!][band];
  }
  if (dv == null) {
    throw new RulesError('OUT_OF_RANGE', `${p.displayName}${mode === 'autofire' ? ' (Autofire)' : ''} can’t reach ${distance} m/yds.`);
  }
  checkAmmo(weapon, ammo);

  const attack = withFumbleRecovery(attacker, makeCheck(
    [{ label: 'REF', value: effectiveStat(attacker, 'REF') }, { label: skill, value: skillLevel(attacker, skill) }],
    [...standingModifiers(attacker, 'rangedAttack'), ...aimMods(aimTarget), ...smartAttackMods(attacker, weapon, aimTarget) /* Round 3 D */, ...(input.situational ?? [])],
    dice,
  ));

  let defense: CheckResult | undefined;
  let defenseValue = dv;
  if (input.defenderDodges) {
    if (!canDodgeRanged(defender)) throw new RulesError('CANNOT_DODGE', `${defender.name} can’t dodge ranged attacks (needs REF ${DODGE_REF_THRESHOLD}+).`);
    defense = evasionCheck(defender, dice);
    defenseValue = defense.total; // replaces the range DV, even if lower
  }

  let hit = beats(attack.total, defenseValue);
  const margin = attack.total - defenseValue;
  const events: CombatEvent[] = [
    {
      type: 'attackResolved', visibility: 'public', attackerId: attacker.id, defenderId: defender.id,
      attack, defenseKind: defense ? 'dodge' : 'rangeDV', defenseValue, defense, hit, margin,
    },
    { type: 'ammoSpent', visibility: 'public', combatantId: attacker.id, weaponId: weapon.id, rounds: ammo },
  ];
  // --- Round 3 D --- Smart / Improved Smart ammo second attempt (rules in ammo.ts).
  const retry = hit ? null : smartRetry({
    attacker, defender, weapon, mode, attack, defense, defenseValue,
    redodge: () => evasionCheck(defender, dice),
  }, dice);
  if (retry) { hit = retry.hit; events.push(...retry.events); }
  // --- end Round 3 D ---

  let damage: DamageSpec | undefined;
  if (hit) {
    damage = mode === 'autofire'
      ? { source: 'autofire', diceCount: 2, multiplier: Math.min(margin, p.autofire!.cap), location: 'body', halveSP: false, ablation: 1, critTable: 'body' }
      : {
          source: 'ranged', diceCount: weapon.damageDiceOverride ?? p.damageDice, multiplier: 1,
          location: aimTarget === 'head' ? 'head' : 'body', halveSP: false, aimTarget, ablation: 1,
          critTable: aimTarget === 'head' ? 'head' : 'body',
        };
    damage = applyAmmo(damage, weapon.ammoType); // Track K
  }
  return { attack, defenseValue, defense, hit, margin, ammoSpent: ammo, damage, events };
}

export function describeRange(distance: number): string {
  const i = rangeBandIndex(distance);
  return i < 0 ? 'Beyond 800 m/yds' : `${RANGE_BAND_LABELS[i]} m/yds`;
}

// ----- Melee -----------------------------------------------------------------

export type MeleeKind =
  | { kind: 'weapon'; weapon: Weapon }
  | { kind: 'brawling' }
  | { kind: 'martialArts'; form: string };

export interface MeleeAttackInput {
  attacker: Combatant;
  defender: Combatant;
  with: MeleeKind;
  /** @interpretation Aimed Shots allowed for melee; Core wording should be checked. */
  aimTarget?: AimTarget;
  situational?: Modifier[];
  /**
   * When the defender can't Evade (e.g. Dismembered Leg, Unconscious), the
   * Core doesn't give a DV. The GM must supply one or the call throws.
   */
  gmDvIfDefenderCannotEvade?: number;
}

export function resolveMeleeAttack(input: MeleeAttackInput, dice: Dice): AttackOutcome {
  const { attacker, defender, aimTarget } = input;
  let skill: string;
  let diceCount: number;
  let halveSP: boolean;
  let source: DamageSpec['source'];

  switch (input.with.kind) {
    case 'weapon': {
      const p = profileOf(input.with.weapon);
      if (!p.melee) throw new RulesError('ILLEGAL_MODE', `${input.with.weapon.name} isn’t a melee weapon.`);
      skill = p.skill;
      diceCount = input.with.weapon.damageDiceOverride ?? p.damageDice;
      halveSP = true;
      source = 'melee';
      break;
    }
    case 'brawling':
      skill = 'Brawling';
      diceCount = unarmedDamageDice(attacker.stats.BODY);
      halveSP = false; // Brawling faces full SP
      source = 'brawling';
      break;
    case 'martialArts':
      skill = `Martial Arts (${input.with.form})`;
      diceCount = unarmedDamageDice(attacker.stats.BODY);
      halveSP = true;
      source = 'martialArts';
      break;
  }

  const attack = withFumbleRecovery(attacker, makeCheck(
    [{ label: 'DEX', value: effectiveStat(attacker, 'DEX') }, { label: skill, value: skillLevel(attacker, skill) }],
    [...standingModifiers(attacker, 'meleeAttack'), ...aimMods(aimTarget), ...(input.situational ?? [])],
    dice,
  ));

  let defense: CheckResult | undefined;
  let defenseValue: number;
  let defenseKind: 'evasion' | 'gmDV';
  if (canDodge(defender) && !defender.conditions.unconscious) {
    defense = evasionCheck(defender, dice);
    defenseValue = defense.total;
    defenseKind = 'evasion';
  } else {
    if (input.gmDvIfDefenderCannotEvade === undefined) {
      throw new RulesError('GM_RULING_REQUIRED', `${defender.name} can’t Evade. Set a DV for this attack.`);
    }
    defenseValue = input.gmDvIfDefenderCannotEvade;
    defenseKind = 'gmDV';
  }

  const hit = beats(attack.total, defenseValue);
  const margin = attack.total - defenseValue;
  const events: CombatEvent[] = [{
    type: 'attackResolved', visibility: 'public', attackerId: attacker.id, defenderId: defender.id,
    attack, defenseKind, defenseValue, defense, hit, margin,
  }];
  const damage: DamageSpec | undefined = hit
    ? { source, diceCount, multiplier: 1, location: aimTarget === 'head' ? 'head' : 'body', halveSP, aimTarget, ablation: 1, critTable: aimTarget === 'head' ? 'head' : 'body' }
    : undefined;
  return { attack, defenseValue, defense, hit, margin, ammoSpent: 0, damage, events };
}

// ----- Preview (no dice) -------------------------------------------------------

export interface RangedPreview {
  /** Attacker's STAT + skill. */
  base: number;
  modifiers: Modifier[];
  /** Range (or Autofire) DV for this distance. */
  dv: number;
  ammo: number;
  /** Defender's DEX + Evasion + standing modifiers, if they may dodge instead of taking the DV. */
  dodgeBase: number | null;
}

/**
 * What `resolveRangedAttack` would roll against, without rolling: for the
 * chance-to-hit readout. Throws the same RulesErrors. Kept in lockstep with
 * `resolveRangedAttack` by a test.
 */
export function previewRangedAttack(input: Omit<RangedAttackInput, 'defenderDodges'>): RangedPreview {
  const { attacker, defender, weapon, distance, aimTarget } = input;
  const mode = input.mode ?? 'single';
  const p = profileOf(weapon);
  if (p.melee) throw new RulesError('ILLEGAL_MODE', `${weapon.name} is a melee weapon.`);
  refuseDirectFire(weapon, p);
  const band = rangeBandIndex(distance);
  let dv: number | null | undefined;
  let skill: string;
  let ammo: number;
  if (mode === 'autofire') {
    if (!p.autofire) throw new RulesError('ILLEGAL_MODE', `${p.displayName} can't Autofire.`);
    if (aimTarget) throw new RulesError('ILLEGAL_MODE', 'Autofire can’t be an Aimed Shot.');
    ammo = AUTOFIRE_AMMO;
    skill = 'Autofire';
    dv = band < 0 ? null : AUTOFIRE_DV[p.autofire.row][band];
  } else {
    ammo = 1;
    skill = p.skill;
    dv = band < 0 ? null : RANGE_DV[p.rangeRow!][band];
  }
  if (dv == null) throw new RulesError('OUT_OF_RANGE', `${p.displayName}${mode === 'autofire' ? ' (Autofire)' : ''} can’t reach ${distance} m/yds.`);
  checkAmmo(weapon, ammo);
  const dodgeBase = canDodgeRanged(defender)
    ? effectiveStat(defender, 'DEX') + skillLevel(defender, 'Evasion') + standingModifiers(defender, 'other').reduce((s, m) => s + m.value, 0)
    : null;
  return {
    base: effectiveStat(attacker, 'REF') + skillLevel(attacker, skill),
    modifiers: [...standingModifiers(attacker, 'rangedAttack'), ...aimMods(aimTarget), ...smartAttackMods(attacker, weapon, aimTarget) /* Round 3 D */, ...(input.situational ?? [])],
    dv,
    ammo,
    dodgeBase,
  };
}
