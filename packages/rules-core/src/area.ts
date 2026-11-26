/**
 * Multi-target attacks: Shotgun Shells, Explosives, Suppressive Fire.
 *
 * Two-step flow, because the GM decides who's in the area (the engine has no map):
 *   1. resolveAreaAttack()  -> attack check, hit/miss, scatter flag.
 *   2. applyAreaDamage()    -> one damage roll, applied to each target the GM placed in the area.
 */
import { beats, makeCheck } from './checks.js';
import { AUTOFIRE_AMMO, RANGE_DV, SHOTGUN_SHELL, WEAPON_TYPES } from './data/core.js';
import { applyDamage, rollDamage } from './damage.js';
import type { Dice } from './dice.js';
import { RulesError } from './errors.js';
import type { CombatEvent } from './events.js';
import { canDodgeRanged, profileOf, rangeBandIndex, withFumbleRecovery } from './attack.js';
import { effectiveStat, skillLevel, standingModifiers } from './character.js';
import type { CheckResult, Combatant, DamageRoll, DamageSpec, Modifier, Weapon } from './types.js';

export type AreaKind =
  | { kind: 'shotgunShell'; weapon: Weapon }
  | { kind: 'launcher'; weapon: Weapon; distance: number }
  | { kind: 'thrownGrenade'; distance: number; damageDice: number };

export interface AreaAttackOutcome {
  attack: CheckResult;
  dv: number;
  hit: boolean;
  /** Explosive missed: the GM places it somewhere within the blast area of the intended square. */
  scattered: boolean;
  ammoSpent: number;
  damageDice: number;
  source: 'shotgunShell' | 'explosive';
  events: CombatEvent[];
}

export function resolveAreaAttack(attacker: Combatant, area: AreaKind, dice: Dice, situational: Modifier[] = []): AreaAttackOutcome {
  let dv: number;
  let stat: 'REF' | 'DEX';
  let skill: string;
  let damageDice: number;
  let ammoSpent = 0;
  let source: AreaAttackOutcome['source'] = 'explosive';

  if (area.kind === 'shotgunShell') {
    const p = profileOf(area.weapon);
    if (!p.canFireShells) throw new RulesError('ILLEGAL_MODE', `${p.displayName} can’t fire Shotgun Shells.`);
    if (area.weapon.ammo && area.weapon.ammo.loaded < 1) throw new RulesError('NOT_ENOUGH_AMMO', 'No shell loaded.');
    dv = SHOTGUN_SHELL.dv;
    stat = 'REF';
    skill = p.skill;
    damageDice = SHOTGUN_SHELL.damageDice;
    ammoSpent = 1;
    source = 'shotgunShell';
  } else {
    // @interpretation (secondary) Thrown grenades: DEX + Athletics against the Grenade Launcher row.
    const row = area.kind === 'launcher' ? profileOf(area.weapon).rangeRow : 'grenadeLauncher';
    if (area.kind === 'launcher' && row !== 'grenadeLauncher' && row !== 'rocketLauncher') {
      throw new RulesError('ILLEGAL_MODE', `${area.weapon.name} doesn’t fire explosives.`);
    }
    const band = rangeBandIndex(area.distance);
    const v = band < 0 ? null : RANGE_DV[row!][band];
    if (v == null) throw new RulesError('OUT_OF_RANGE', `Can’t reach ${area.distance} m/yds.`);
    dv = v;
    if (area.kind === 'launcher') {
      if (area.weapon.ammo && area.weapon.ammo.loaded < 1) throw new RulesError('NOT_ENOUGH_AMMO', 'Nothing loaded.');
      stat = 'REF';
      skill = WEAPON_TYPES[area.weapon.type].skill;
      damageDice = area.weapon.damageDiceOverride ?? WEAPON_TYPES[area.weapon.type].damageDice;
      ammoSpent = 1;
    } else {
      stat = 'DEX';
      skill = 'Athletics';
      damageDice = area.damageDice;
    }
  }

  const attack = withFumbleRecovery(attacker, makeCheck(
    [{ label: stat, value: effectiveStat(attacker, stat) }, { label: skill, value: skillLevel(attacker, skill) }],
    [...standingModifiers(attacker, 'rangedAttack'), ...situational],
    dice,
  )); // Fumble Recovery
  const hit = beats(attack.total, dv);
  const scattered = source === 'explosive' && !hit;
  return { attack, dv, hit, scattered, ammoSpent, damageDice, source, events: [] };
}

export interface AreaTarget {
  combatant: Combatant;
  /** Declared dodge (REF 8+ only). */
  dodges?: boolean;
  /** Explosives only: HP of the cover section between the target and the blast. */
  coverHp?: number;
}

export interface AreaTargetResult {
  targetId: string;
  dodge?: CheckResult;
  avoided: boolean;
  protectedByCover: boolean;
  coverDestroyed: boolean;
  target: Combatant;
  events: CombatEvent[];
}

/**
 * Damage is rolled ONCE and applied to every affected target separately
 * (each target's own armor, crits and ablation).
 *
 * @interpretation Dodging an area attack: DEX + Evasion + 1d10 vs the
 * attacker's check total, ties to the defender (the general rule). Some
 * references word the explosive dodge as "higher than"; GM may override.
 */
export function applyAreaDamage(
  outcome: Pick<AreaAttackOutcome, 'attack' | 'damageDice' | 'source'>,
  targets: AreaTarget[],
  dice: Dice,
): { roll: DamageRoll; results: AreaTargetResult[] } {
  const spec: DamageSpec = { source: outcome.source, diceCount: outcome.damageDice, multiplier: 1, location: 'body', halveSP: false, ablation: 1, critTable: 'body' };
  const roll = rollDamage(spec, dice);
  const results = targets.map((t): AreaTargetResult => {
    let dodge: CheckResult | undefined;
    if (t.dodges) {
      if (!canDodgeRanged(t.combatant)) throw new RulesError('CANNOT_DODGE', `${t.combatant.name} can’t dodge (needs REF 8+).`);
      dodge = makeCheck(
        [{ label: 'DEX', value: effectiveStat(t.combatant, 'DEX') }, { label: 'Evasion', value: skillLevel(t.combatant, 'Evasion') }],
        standingModifiers(t.combatant, 'other'),
        dice,
      );
      if (!beats(outcome.attack.total, dodge.total)) {
        return { targetId: t.combatant.id, dodge, avoided: true, protectedByCover: false, coverDestroyed: false, target: t.combatant, events: [] };
      }
    }
    if (outcome.source === 'explosive' && t.coverHp !== undefined) {
      if (roll.total < t.coverHp) {
        return { targetId: t.combatant.id, dodge, avoided: false, protectedByCover: true, coverDestroyed: false, target: t.combatant, events: [] };
      }
      // Cover is destroyed and gives no reduction.
      const r = applyDamage(t.combatant, spec, roll, dice);
      return { targetId: t.combatant.id, dodge, avoided: false, protectedByCover: false, coverDestroyed: true, target: r.target, events: r.events };
    }
    const r = applyDamage(t.combatant, spec, roll, dice);
    return { targetId: t.combatant.id, dodge, avoided: false, protectedByCover: false, coverDestroyed: false, target: r.target, events: r.events };
  });
  return { roll, results };
}

// ----- Suppressive Fire --------------------------------------------------------

/**
 * Suppressive Fire: 10 rounds. Everyone on foot, out of cover, in line of
 * sight within 25 m/yds (GM selects) rolls WILL + Concentration + 1d10 vs the
 * shooter's REF + Autofire + 1d10. Losers must use their next Move Action (and
 * Run if needed) to reach cover. Ties go to the target.
 */
export function resolveSuppressiveFire(attacker: Combatant, weapon: Weapon, targets: Combatant[], dice: Dice) {
  const p = profileOf(weapon);
  if (!p.autofire) throw new RulesError('ILLEGAL_MODE', `${p.displayName} can’t lay down Suppressive Fire.`);
  if (weapon.ammo && weapon.ammo.loaded < AUTOFIRE_AMMO) throw new RulesError('NOT_ENOUGH_AMMO', `Needs ${AUTOFIRE_AMMO} rounds.`);
  const attack = makeCheck(
    [{ label: 'REF', value: effectiveStat(attacker, 'REF') }, { label: 'Autofire', value: skillLevel(attacker, 'Autofire') }],
    standingModifiers(attacker, 'rangedAttack'),
    dice,
  );
  const results = targets.map((t) => {
    const resist = makeCheck(
      [{ label: 'WILL', value: t.stats.WILL }, { label: 'Concentration', value: skillLevel(t, 'Concentration') }],
      standingModifiers(t, 'other'),
      dice,
    );
    return { targetId: t.id, resist, mustSeekCover: beats(attack.total, resist.total) };
  });
  const events: CombatEvent[] = [
    { type: 'suppressiveFireResolved', visibility: 'public', attackerId: attacker.id, attack, results },
    { type: 'ammoSpent', visibility: 'public', combatantId: attacker.id, weaponId: weapon.id, rounds: AUTOFIRE_AMMO },
  ];
  return { attack, results, ammoSpent: AUTOFIRE_AMMO, events };
}

/** Damage to a 2×2 m/yd cover section. Excess is lost; it never carries to whoever's behind it. */
export function damageCover(coverHp: number, damage: number) {
  const hpAfter = Math.max(0, coverHp - damage);
  return { hpAfter, destroyed: hpAfter === 0 };
}
