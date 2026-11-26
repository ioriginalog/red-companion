/**
 * Round 4 R4: can this character attack with this weapon right now, and with
 * what standing situational modifiers? Pure; works on the authority's state or
 * on any viewer's projection (the attacker's sheet must be visible).
 *
 * Rules folded in: hands per weapon and arm injuries (Track K `wieldProblem`),
 * grapples (Round 3 X: −2 to Actions, no two-handed weapons, an Iron Grip stops
 * ranged attacks), and a lost Facedown (−2 against the winner).
 * Kept in lockstep with the authority's gates by test/round4.test.ts.
 */
import { FACEDOWN_PENALTY, GRAPPLE_PENALTY, HANDS, profileOf, wieldProblem, type Combatant, type Modifier, type Weapon } from '@cprc/rules-core';
import type { ExtrasState } from './types.js';

export interface AvailabilityView {
  actors: Record<string, { combatant?: Combatant } | undefined>;
  extras?: ExtrasState;
}

export interface AttackAvailability {
  ok: boolean;
  /** Why not (sentence case), when `ok` is false. */
  reason?: string;
  /** Situational modifiers the authority adds to this attack (Grappling, Lost Facedown). */
  modifiers: Modifier[];
}

export function attackAvailability(view: AvailabilityView, attackerId: string, weapon: Weapon | 'brawling', defenderId?: string): AttackAvailability {
  const c = view.actors[attackerId]?.combatant;
  if (!c) return { ok: false, reason: 'That character’s sheet isn’t visible.', modifiers: [] };
  if (c.conditions.dead || c.conditions.unconscious) return { ok: false, reason: `${c.name} can’t attack right now.`, modifiers: [] };
  const wield = wieldProblem(c, weapon);
  if (wield) return { ok: false, reason: wield, modifiers: [] };

  const modifiers: Modifier[] = [];
  const x = view.extras;
  const g = x?.grapples.find((v) => v.holderId === attackerId || v.heldId === attackerId);
  if (g) {
    const ranged = weapon !== 'brawling' && !profileOf(weapon).melee;
    if (ranged && g.heldId === attackerId && g.ironGrip) return { ok: false, reason: 'An Iron Grip stops ranged attacks.', modifiers: [] };
    if (weapon !== 'brawling' && HANDS[weapon.type] === 2) return { ok: false, reason: 'Two-handed weapons can’t be used while grappling.', modifiers: [] };
    modifiers.push({ label: 'Grappling', value: GRAPPLE_PENALTY });
  }
  if (defenderId && x?.facedowns.some((f) => f.status === 'fighting' && f.loserId === attackerId && f.winnerId === defenderId)) {
    modifiers.push({ label: 'Lost Facedown', value: FACEDOWN_PENALTY });
  }
  return { ok: true, modifiers };
}
