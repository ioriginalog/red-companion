/**
 * Grab, Grapple, Choke, Throw and Escape (RED Core melee options).
 *
 * Status (community references; check against the Core book):
 *   - Grab: an Action. Attacker DEX + Brawling + 1d10 vs defender DEX + Brawling + 1d10;
 *     ties go to the defender. Winner picks: start a Grapple, or take an item the
 *     target holds. Secondary.
 *   - While grappled: both sides −2 to all Actions; neither can use two-handed
 *     weapons; the held character can't take the Move Action; the holder may let go
 *     at any time for free. Secondary.
 *   - Escape: an Action by the held character (or a third party): same opposed check
 *     against the holder. Secondary.
 *   - Choke: an Action by the holder; BODY damage straight to HP (armor ignored).
 *     It can't drop the target below 1 HP: they fall Unconscious instead. Three
 *     Choke Actions on consecutive Rounds knock the target out regardless. Secondary.
 *   - Throw: an Action by the holder; BODY damage straight to HP; the Grapple ends
 *     and the target is Prone. Secondary.
 * Interpretation: "straight to HP" still counts as damage for Wound State, the
 * Mortally Wounded extra crit and Damage Deflection.
 */
import { effectiveStat, skillLevel, standingModifiers } from './character.js';
import { beats, makeCheck } from './checks.js';
import { applyDamage } from './damage.js';
import type { Dice } from './dice.js';
import type { CombatEvent } from './events.js';
import type { CheckResult, Combatant, DamageSpec, Modifier } from './types.js';

export const GRAPPLE_PENALTY = -2;
export const CHOKE_KNOCKOUT_ROUNDS = 3;

/** DEX + Brawling + 1d10 with the character's standing penalties. */
export function brawlCheck(c: Combatant, dice: Dice, extra: Modifier[] = []): CheckResult {
  return makeCheck(
    [{ label: 'DEX', value: effectiveStat(c, 'DEX') }, { label: 'Brawling', value: skillLevel(c, 'Brawling') }],
    [...standingModifiers(c, 'other'), ...extra],
    dice,
  );
}

export interface Contest { attack: CheckResult; defense: CheckResult; attackerWins: boolean }

/** Opposed Brawling checks; ties go to the defender. */
export function opposedBrawl(attacker: Combatant, defender: Combatant, dice: Dice, attackMods: Modifier[] = [], defenseMods: Modifier[] = []): Contest {
  const attack = brawlCheck(attacker, dice, attackMods);
  const defense = brawlCheck(defender, dice, defenseMods);
  return { attack, defense, attackerWins: beats(attack.total, defense.total) };
}

const DIRECT: DamageSpec = { source: 'brawling', diceCount: 0, multiplier: 1, location: 'body', halveSP: false, ablation: 0, critTable: 'body' };

export interface HpLoss { target: Combatant; events: CombatEvent[]; knockedOut: boolean; lost: number }

/**
 * Damage that skips armor (Choke, Throw, crit bonus from special moves).
 * `floorAtOne`: can't take the target below 1 HP; if it would, they fall Unconscious.
 */
export function hpLoss(target: Combatant, amount: number, dice: Dice, opts: { floorAtOne?: boolean } = {}): HpLoss {
  if (!Number.isInteger(amount) || amount < 0) throw new Error('hpLoss: amount must be a whole number ≥ 0');
  let dmg = amount;
  let knockedOut = false;
  if (opts.floorAtOne) {
    const room = Math.max(0, target.hp.current - 1);
    if (dmg >= target.hp.current) knockedOut = true;
    dmg = Math.min(dmg, room);
  }
  let next = target;
  let events: CombatEvent[] = [];
  if (dmg > 0) {
    // Armor is set aside so nothing is stopped or ablated, then put back.
    const r = applyDamage({ ...target, armor: [] }, DIRECT, { dice: [], multiplier: 1, total: dmg, critTriggered: false }, dice);
    next = { ...r.target, armor: target.armor };
    events = r.events.filter((e) => e.type !== 'armorAblated');
  }
  if (knockedOut && !next.conditions.unconscious) next = { ...next, conditions: { ...next.conditions, unconscious: true } };
  return { target: next, events, knockedOut, lost: target.hp.current - next.hp.current };
}

/** Choke damage for this holder. */
export const chokeDamage = (holder: Combatant) => Math.max(0, effectiveStat(holder, 'BODY'));
/** Throw damage for this holder. */
export const throwDamage = (holder: Combatant) => Math.max(0, effectiveStat(holder, 'BODY'));
