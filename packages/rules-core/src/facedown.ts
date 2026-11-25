/**
 * Facedowns. Status: Secondary (community references).
 *   Both sides roll COOL + Reputation + 1d10. Higher total wins; a tie means
 *   nobody blinks and nothing happens. The loser chooses: back down (walk away
 *   or concede), or fight on at −2 to all Actions against that opponent until
 *   the fight is decided.
 * Interpretation: a Facedown costs no Action; "until the fight is decided" ends
 * when the GM (or the winner) closes it.
 */
import { effectiveStat, standingModifiers } from './character.js';
import { makeCheck } from './checks.js';
import type { Dice } from './dice.js';
import type { CheckResult, Combatant } from './types.js';

export const FACEDOWN_PENALTY = -2;

export const reputationOf = (c: Combatant) => Math.max(0, Math.min(10, c.reputation ?? 0));

export function facedownCheck(c: Combatant, dice: Dice): CheckResult {
  return makeCheck(
    [{ label: 'COOL', value: effectiveStat(c, 'COOL') }, { label: 'Reputation', value: reputationOf(c) }],
    standingModifiers(c, 'other'),
    dice,
  );
}

export interface FacedownResult { a: CheckResult; b: CheckResult; winner: 'a' | 'b' | null }

export function resolveFacedown(a: Combatant, b: Combatant, dice: Dice): FacedownResult {
  const ca = facedownCheck(a, dice);
  const cb = facedownCheck(b, dice);
  return { a: ca, b: cb, winner: ca.total === cb.total ? null : ca.total > cb.total ? 'a' : 'b' };
}
