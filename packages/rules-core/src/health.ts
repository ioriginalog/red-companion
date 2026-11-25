/**
 * Death Saves and Stabilization.
 */
import { makeCheck } from './checks.js';
import { STABILIZE_DV } from './data/core.js';
import type { Dice } from './dice.js';
import { RulesError } from './errors.js';
import type { CombatEvent } from './events.js';
import { currentDeathSavePenalty, effectiveStat, skillLevel, standingModifiers, woundState } from './character.js';
import type { Combatant, Modifier } from './types.js';

/**
 * Death Save: roll 1d10 + current Death Save Penalty. Live if the total is
 * UNDER BODY (equal fails). A natural 10 always fails. No Critical Success or
 * Failure — this isn't a Skill Check. Every roll raises the penalty by 1.
 * One failure = dead.
 */
export function rollDeathSave(c: Combatant, dice: Dice): { combatant: Combatant; success: boolean; events: CombatEvent[] } {
  if (c.conditions.dead) throw new RulesError('INVALID_STATE', `${c.name} is already dead.`);
  if (woundState(c.hp) !== 'mortally') throw new RulesError('INVALID_STATE', `${c.name} isn’t Mortally Wounded.`);
  const penalty = currentDeathSavePenalty(c);
  const natural = dice.d10();
  const total = natural + penalty;
  const success = natural !== 10 && total < c.stats.BODY;
  const from = c.deathSave.accumulatedPenalty;
  let next: Combatant = { ...c, deathSave: { accumulatedPenalty: from + 1 } };
  const events: CombatEvent[] = [
    { type: 'deathSaveRolled', visibility: 'public', targetId: c.id, natural, penalty, total, body: c.stats.BODY, success },
    { type: 'deathSavePenaltyChanged', visibility: 'public', targetId: c.id, from, to: from + 1, reason: 'deathSaveRolled' },
  ];
  if (!success) {
    next = { ...next, conditions: { ...next.conditions, dead: true } };
    events.push({ type: 'died', visibility: 'public', targetId: c.id });
  }
  return { combatant: next, success, events };
}

/**
 * Stabilize: TECH + First Aid or Paramedic + 1d10 vs DV by Wound State
 * (Lightly 10, Seriously 13, Mortally 15). Takes an Action. Can target self.
 * Mortally Wounded success: HP set to 1, Unconscious for 1 minute, and the
 * accumulated Death Save Penalty resets (the Base penalty from injuries stays).
 */
export function stabilize(medic: Combatant, target: Combatant, skill: 'First Aid' | 'Paramedic', dice: Dice, situational: Modifier[] = []) {
  if (target.conditions.dead) throw new RulesError('INVALID_STATE', `${target.name} is dead.`);
  const ws = woundState(target.hp);
  if (ws === 'unhurt') throw new RulesError('INVALID_STATE', `${target.name} isn’t wounded.`);
  const dv = STABILIZE_DV[ws];
  const check = makeCheck(
    [{ label: 'TECH', value: effectiveStat(medic, 'TECH') }, { label: skill, value: skillLevel(medic, skill) }],
    [...standingModifiers(medic, 'other'), ...situational],
    dice,
  );
  const success = check.total > dv;
  const events: CombatEvent[] = [{ type: 'stabilizationAttempted', visibility: 'public', medicId: medic.id, targetId: target.id, check, dv, success }];
  let next = target;
  if (success) {
    const fromPenalty = target.deathSave.accumulatedPenalty;
    if (ws === 'mortally') {
      next = { ...target, hp: { ...target.hp, current: 1 }, deathSave: { accumulatedPenalty: 0 }, conditions: { ...target.conditions, stabilized: true, unconscious: true } };
      events.push({ type: 'stabilized', visibility: 'public', targetId: target.id, hpAfter: 1, unconscious: true });
      events.push({ type: 'woundStateChanged', visibility: 'public', targetId: target.id, from: 'mortally', to: woundState(next.hp) });
    } else {
      next = { ...target, deathSave: { accumulatedPenalty: 0 }, conditions: { ...target.conditions, stabilized: true } };
      events.push({ type: 'stabilized', visibility: 'public', targetId: target.id, hpAfter: target.hp.current, unconscious: false });
    }
    if (fromPenalty !== 0) events.push({ type: 'deathSavePenaltyChanged', visibility: 'public', targetId: target.id, from: fromPenalty, to: 0, reason: 'stabilized' });
  }
  return { combatant: next, success, check, dv, events };
}

/** What the UI must prompt for at the start of this combatant's Turn. */
export function turnStartChecklist(c: Combatant) {
  return {
    skipTurn: c.conditions.dead || c.conditions.unconscious,
    deathSaveRequired: !c.conditions.dead && woundState(c.hp) === 'mortally',
    mustGetUpBeforeMoving: c.conditions.prone,
  };
}
