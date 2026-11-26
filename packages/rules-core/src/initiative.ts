/**
 * Initiative = REF (after armor penalty) + 1d10 + bonuses (e.g. Solo Combat Awareness).
 * Ties: the tied combatants reroll (d10 only) until the order is settled.
 *
 * @interpretation Initiative is a roll, not a Skill Check, so a natural 10/1
 * doesn't add/subtract another die. Flip `explodeCrits` if your table rules otherwise.
 */
import { rollD10 } from './checks.js';
import type { Dice } from './dice.js';
import type { CombatEvent } from './events.js';
import { effectiveStat } from './character.js';
import { activeSpeedwareBonus } from './injury-effects.js'; // Round 4 R4
import type { Combatant } from './types.js';

export interface InitiativeEntry {
  combatantId: string;
  base: number;
  roll: number;
  total: number;
  tiebreaks: number[];
}

export function rollInitiative(
  participants: { combatant: Combatant; bonus?: number }[],
  dice: Dice,
  opts: { explodeCrits?: boolean } = {},
): { order: InitiativeEntry[]; events: CombatEvent[] } {
  const entries: InitiativeEntry[] = participants.map(({ combatant, bonus = 0 }) => {
    const base = effectiveStat(combatant, 'REF') + bonus + (combatant.mods?.initiative ?? 0) // Track K: Initiative Reaction, cyberware
      + activeSpeedwareBonus(combatant); // Round 4 R4: activated speedware while on
    const roll = opts.explodeCrits ? rollD10(dice).value : dice.d10();
    return { combatantId: combatant.id, base, roll, total: base + roll, tiebreaks: [] };
  });

  // Group by total, then resolve each tied group by rerolling until distinct.
  const resolve = (group: InitiativeEntry[], depth: number): InitiativeEntry[] => {
    if (group.length <= 1) return group;
    for (const e of group) e.tiebreaks[depth] = dice.d10();
    const buckets = new Map<number, InitiativeEntry[]>();
    for (const e of group) buckets.set(e.tiebreaks[depth]!, [...(buckets.get(e.tiebreaks[depth]!) ?? []), e]);
    return [...buckets.entries()].sort((a, b) => b[0] - a[0]).flatMap(([, g]) => resolve(g, depth + 1));
  };

  const byTotal = new Map<number, InitiativeEntry[]>();
  for (const e of entries) byTotal.set(e.total, [...(byTotal.get(e.total) ?? []), e]);
  const order = [...byTotal.entries()].sort((a, b) => b[0] - a[0]).flatMap(([, g]) => resolve(g, 0));

  return { order, events: [{ type: 'initiativeRolled', visibility: 'public', entries: order }] };
}
