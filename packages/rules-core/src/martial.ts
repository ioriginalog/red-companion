/**
 * Martial Arts Special Moves.
 *
 * Status: Secondary (community references, checked against two summaries; confirm
 * in the Core book). Core lists four Forms with two moves each, plus a shared
 * Recovery move; the expanded Forms from later books are included as GM-prompt
 * moves (the engine rolls the check and states the effect; the GM applies it).
 *
 * Common rules:
 *   - A Special Move needs at least 1 level in that Form.
 *   - The check is DEX + Form + 1d10 vs DV 15 unless the move says otherwise.
 *   - "Action" moves use the Action; "attack" moves replace both Martial Arts
 *     attacks for the Turn; triggered moves are free, once per Turn each.
 *   - Recovery (all Forms): when taking the Get Up Action, beat DV 13 and it
 *     costs no Action.
 */
import { effectiveStat, skillLevel, standingModifiers } from './character.js';
import { makeCheck } from './checks.js';
import { getInjury } from './data/critical-injuries.js';
import { CRIT_BONUS_DAMAGE } from './data/core.js';
import type { Dice } from './dice.js';
import type { CombatEvent } from './events.js';
import { hpLoss } from './grapple.js';
import type { CheckResult, Combatant, Modifier, StatKey } from './types.js';

export const MARTIAL_RECOVERY_DV = 13;
export const SPECIAL_MOVE_DV = 15;
export const CORE_FORMS = ['Aikido', 'Judo', 'Karate', 'Taekwondo'] as const;

/** What must have happened this Turn (or Round) for a triggered move. */
export type MoveTrigger =
  | 'brawlAndMartialHitSameTarget'
  | 'meleeWeaponAndMartialHitSameTarget'
  | 'dodgedAllMeleeThisRound'
  | 'twoMartialHitsOnHolder'
  | 'holdingTarget';

export type MoveEffect =
  | { kind: 'takeItem' }
  | { kind: 'ironGrip' }
  | { kind: 'ablate'; amount: number }
  | { kind: 'throwAttacker' }
  | { kind: 'escapeAndInjure'; injury: string }
  | { kind: 'strikeInjury'; injury: string; headInjury: string }
  | { kind: 'flyingKick' }
  | { kind: 'prompt' };

export interface SpecialMove {
  id: string;
  form: string;
  name: string;
  /** One line, in our own words. */
  summary: string;
  /** triggered: free once per Turn; action: uses the Action; attack: replaces both attacks; prompt: GM applies. */
  kind: 'triggered' | 'action' | 'attack' | 'prompt';
  dv: number | null;
  requires?: Partial<Record<StatKey, number>>;
  minForm?: number;
  /** Squares moved this Turn before the move (Flying Kick). */
  minMoved?: number;
  trigger?: MoveTrigger;
  effect: MoveEffect;
  core: boolean;
}

const m = (x: Omit<SpecialMove, 'dv' | 'core'> & { dv?: number | null; core?: boolean }): SpecialMove => ({ dv: SPECIAL_MOVE_DV, core: false, ...x });

export const SPECIAL_MOVES: SpecialMove[] = [
  // ----- Core -----
  m({ id: 'aikido.disarm', form: 'Aikido', name: 'Disarming Combination', core: true, kind: 'triggered', trigger: 'brawlAndMartialHitSameTarget', effect: { kind: 'takeItem' },
    summary: 'After landing a Brawling and a Martial Arts hit on the same target this Turn, take one item they hold.' }),
  m({ id: 'aikido.ironGrip', form: 'Aikido', name: 'Iron Grip', core: true, kind: 'action', trigger: 'holdingTarget', effect: { kind: 'ironGrip' },
    summary: 'Tighten a hold: their escape attempts take −2 and they can’t make ranged attacks while held.' }),
  m({ id: 'judo.armorBreak', form: 'Judo', name: 'Armor Breaking Combination', core: true, kind: 'triggered', trigger: 'meleeWeaponAndMartialHitSameTarget', effect: { kind: 'ablate', amount: 2 },
    summary: 'After a melee weapon hit and a Martial Arts hit on the same target this Turn, their body armor loses 2 more SP.' }),
  m({ id: 'judo.counterThrow', form: 'Judo', name: 'Counter Throw', core: true, kind: 'action', trigger: 'dodgedAllMeleeThisRound', effect: { kind: 'throwAttacker' },
    summary: 'If every melee attack against you this Round missed, throw an adjacent attacker: BODY damage to HP and they fall Prone.' }),
  m({ id: 'karate.boneBreak', form: 'Karate', name: 'Bone Breaking Strike', core: true, kind: 'attack', dv: null, requires: { WILL: 8 }, effect: { kind: 'strikeInjury', injury: 'brokenRibs', headInjury: 'crackedSkull' },
    summary: 'One Martial Arts strike in place of both attacks; on a hit, add Broken Ribs (aimed at the head: Cracked Skull).' }),
  m({ id: 'karate.armorBlow', form: 'Karate', name: 'Armor Breaking Blow', core: true, kind: 'triggered', trigger: 'twoMartialHitsOnHolder', effect: { kind: 'escapeAndInjure', injury: 'brokenArm' },
    summary: 'While held, after two Martial Arts hits on whoever holds you, break free and leave them with a Broken Arm.' }),
  m({ id: 'taekwondo.pressurePoint', form: 'Taekwondo', name: 'Pressure Point Strike', core: true, kind: 'attack', dv: null, requires: { WILL: 8 }, effect: { kind: 'strikeInjury', injury: 'spinalInjury', headInjury: 'brainInjury' },
    summary: 'One Martial Arts strike in place of both attacks; on a hit, add Spinal Injury (aimed at the head: Brain Injury).' }),
  m({ id: 'taekwondo.flyingKick', form: 'Taekwondo', name: 'Flying Kick', core: true, kind: 'attack', dv: null, requires: { MOVE: 8 }, minMoved: 2, effect: { kind: 'flyingKick' },
    summary: 'After moving at least 4 m/yds this Turn, one Martial Arts strike in place of both attacks; on a hit the target also falls Prone.' }),
  // ----- Expanded Forms (GM applies the effect) -----
  m({ id: 'arasakaTe.counter', form: 'Arasaka-Te', name: 'Counter Strike', kind: 'prompt', effect: { kind: 'prompt' }, summary: 'When hit in melee: your next attack on that attacker is an Aimed Shot at only −5.' }),
  m({ id: 'arasakaTe.escape', form: 'Arasaka-Te', name: 'Escape Hold', kind: 'prompt', effect: { kind: 'prompt' }, summary: 'When grabbed: slip the hold.' }),
  m({ id: 'arnis.combo', form: 'Arnis', name: 'Coordinated Combination', kind: 'prompt', effect: { kind: 'prompt' }, summary: 'Two light or medium weapon hits on one target: add Torn Muscle.' }),
  m({ id: 'arnis.disarm', form: 'Arnis', name: 'Disarming Technique', kind: 'prompt', effect: { kind: 'prompt' }, summary: 'Every weapon attack on you missed: take the attacker’s weapon.' }),
  m({ id: 'boxing.knockout', form: 'Boxing', name: 'Knockout Punch', kind: 'prompt', requires: { BODY: 8 }, effect: { kind: 'prompt' }, summary: 'A head strike at −5 that adds Broken Jaw.' }),
  m({ id: 'boxing.combo', form: 'Boxing', name: 'Punch Combination', kind: 'prompt', effect: { kind: 'prompt' }, summary: 'Two Brawling hits: one more Brawling attack.' }),
  m({ id: 'capoeira.recovery', form: 'Capoeira', name: 'Rhythmic Recovery', kind: 'prompt', effect: { kind: 'prompt' }, summary: 'After a miss: a free Brawling attack.' }),
  m({ id: 'choyLiFut.sweep', form: 'Choy Li Fut', name: 'Sweeping Fist', kind: 'prompt', requires: { MOVE: 6 }, effect: { kind: 'prompt' }, summary: 'Two hits: a free Brawling attack on a different target.' }),
  m({ id: 'jujutsu.throw', form: 'Jujutsu', name: 'Throwing Technique', kind: 'prompt', requires: { WILL: 6 }, effect: { kind: 'prompt' }, summary: 'Two hits: throw the target without a grapple.' }),
  m({ id: 'kendo.cut', form: 'Kendo', name: 'Cut the Bullet', kind: 'prompt', requires: { WILL: 8 }, effect: { kind: 'prompt' }, summary: 'Armed with a blade and shot at: an opposed roll can negate the hit.' }),
  m({ id: 'kravMaga.punish', form: 'Krav Maga', name: 'Punishing Blow', kind: 'prompt', effect: { kind: 'prompt' }, summary: 'Every attack on you missed: a free Brawling attack.' }),
  m({ id: 'kungFu.stance', form: 'Kung Fu', name: 'Superior Stance', kind: 'prompt', dv: 17, minForm: 4, effect: { kind: 'prompt' }, summary: 'After a Martial Arts hit: move to the top of the Initiative order.' }),
  m({ id: 'muayThai.ferocity', form: 'Muay Thai', name: 'Conditioned Ferocity', kind: 'prompt', effect: { kind: 'prompt' }, summary: 'Brawling hits harder (+1d6, max 4d6) and +1 to hit.' }),
  m({ id: 'silat.leverage', form: 'Silat', name: 'Violent Leverage', kind: 'prompt', effect: { kind: 'prompt' }, summary: 'On starting a grapple: a free melee weapon attack.' }),
  m({ id: 'sumo.niramiai', form: 'Sumo', name: 'Niramiai', kind: 'prompt', requires: { COOL: 4 }, effect: { kind: 'prompt' }, summary: '+2 to your next Facedown.' }),
  m({ id: 'taiChi.joint', form: 'Tai Chi', name: 'Joint Manipulation', kind: 'prompt', effect: { kind: 'prompt' }, summary: 'An attacker who missed you loses the use of a hand.' }),
  m({ id: 'wrestling.choke', form: 'Wrestling', name: 'Chokehold', kind: 'prompt', effect: { kind: 'prompt' }, summary: 'While holding someone: a free Choke.' }),
  m({ id: 'wrestling.reversal', form: 'Wrestling', name: 'Reversal', kind: 'prompt', effect: { kind: 'prompt' }, summary: 'One on one while held: swap who holds whom.' }),
];

export const getMove = (id: string) => SPECIAL_MOVES.find((x) => x.id === id);
export const formSkill = (form: string) => `Martial Arts (${form})`;
export const formLevel = (c: Combatant, form: string) => skillLevel(c, formSkill(form));

/** Forms this character has at least one level in. */
export function knownForms(c: Combatant): string[] {
  return Object.entries(c.skills)
    .filter(([k, v]) => v > 0 && /^Martial Arts \((.+)\)$/.test(k))
    .map(([k]) => k.slice('Martial Arts ('.length, -1));
}

/** Null if the character may attempt the move, else why not. */
export function moveRequirementProblem(c: Combatant, move: SpecialMove): string | null {
  const lvl = formLevel(c, move.form);
  if (lvl < (move.minForm ?? 1)) return `${move.name} needs ${move.form} ${move.minForm ?? 1}+.`;
  for (const [stat, min] of Object.entries(move.requires ?? {})) {
    if (effectiveStat(c, stat as StatKey) < (min as number)) return `${move.name} needs ${stat} ${min}+.`;
  }
  return null;
}

/** DEX + Form + 1d10 with standing penalties. */
export function specialMoveCheck(c: Combatant, form: string, dice: Dice, extra: Modifier[] = []): CheckResult {
  return makeCheck(
    [{ label: 'DEX', value: effectiveStat(c, 'DEX') }, { label: form, value: formLevel(c, form) }],
    [...standingModifiers(c, 'other'), ...extra],
    dice,
  );
}

/**
 * Give a specific Critical Injury (special moves name theirs). Already owned:
 * nothing happens. The usual bonus damage ignores armor.
 */
export function inflictInjury(t: Combatant, injuryId: string, dice: Dice): { target: Combatant; events: CombatEvent[] } {
  const def = getInjury(injuryId);
  if (t.criticalInjuries.some((i) => i.injuryId === def.id)) return { target: t, events: [] };
  const withInjury: Combatant = { ...t, criticalInjuries: [...t.criticalInjuries, { injuryId: def.id, table: def.table, quickFixed: false }] };
  const loss = hpLoss(withInjury, CRIT_BONUS_DAMAGE, dice);
  const events: CombatEvent[] = [
    { type: 'criticalInjury', visibility: 'public', targetId: t.id, injuryId: def.id, table: def.table, cause: 'damageDice', rolls: [], bonusDamage: CRIT_BONUS_DAMAGE, hpAfter: loss.target.hp.current },
    ...loss.events,
  ];
  if (def.effect.dropsHeldItem) events.push({ type: 'heldItemDropped', visibility: 'public', targetId: t.id, reason: 'criticalInjury' });
  return { target: loss.target, events };
}
