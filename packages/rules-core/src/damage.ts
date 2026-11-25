/**
 * Damage pipeline. Order matters; each step is numbered to match the docs.
 *
 *  1. Roll damage dice (× Autofire multiplier). Two or more 6s = Critical Injury.
 *  2. Pick SP for the location (head only on an Aimed Shot to the head).
 *     Highest piece counts. Melee weapons / Martial Arts count ceil(SP / 2).
 *  3. through = max(0, damage − counted SP).
 *  4. Aimed head shot: through × 2 (× 3 with Cracked Skull).
 *  5. Subtract from HP.
 *  6. If step 3 > 0: ablate EVERY worn piece in that location by 1 (its real SP, not the halved value).
 *  7. Aimed Shot side effects (held item drop, Broken Leg), only if step 3 > 0.
 *  8. Dice-triggered Critical Injury — happens even if armor stopped everything.
 *     +5 bonus damage straight to HP: no armor, no multiplier, no ablation.
 *  9. If the target was ALREADY Mortally Wounded and lost HP to this attack:
 *     one more Critical Injury, and Death Save Penalty +1.
 * 10. Emit Wound State change.
 */
import { CRIT_BONUS_DAMAGE } from './data/core.js';
import { CRIT_TABLES, type CriticalInjuryDef, getInjury } from './data/critical-injuries.js';
import type { Dice } from './dice.js';
import type { CombatEvent } from './events.js';
import { ablate, effectiveSP, hasInjury, headshotMultiplier, woundState } from './character.js';
import type { Combatant, CritTable, DamageRoll, DamageSpec } from './types.js';

export function rollDamage(spec: Pick<DamageSpec, 'diceCount' | 'multiplier'>, dice: Dice): DamageRoll {
  const rolled = Array.from({ length: spec.diceCount }, () => dice.d6());
  const sum = rolled.reduce((s, d) => s + d, 0);
  return {
    dice: rolled,
    multiplier: spec.multiplier,
    total: sum * spec.multiplier,
    critTriggered: rolled.filter((d) => d === 6).length >= 2,
  };
}

export interface DamageResult {
  target: Combatant;
  events: CombatEvent[];
  /** HP actually lost, including Critical Injury bonus damage. */
  hpLost: number;
}

export function applyDamage(target: Combatant, spec: DamageSpec, roll: DamageRoll, dice: Dice): DamageResult {
  const events: CombatEvent[] = [];
  const startHp = target.hp.current;
  const wsBefore = woundState(target.hp);
  const wasMortal = wsBefore === 'mortally';

  // Steps 2–5
  const spBefore = effectiveSP(target, spec.location);
  const spCounted = spec.halveSP ? Math.ceil(spBefore / 2) : spBefore;
  const penetrating = Math.max(0, roll.total - spCounted);
  const locationMultiplier = spec.aimTarget === 'head' ? headshotMultiplier(target) : 1;
  const through = penetrating * locationMultiplier;

  let t: Combatant = { ...target, hp: { ...target.hp, current: target.hp.current - through } };
  events.push({
    type: 'damageApplied', visibility: 'gm', targetId: t.id, location: spec.location,
    rawDamage: roll.total, spBefore, spCounted, through, locationMultiplier,
    hpBefore: startHp, hpAfter: t.hp.current,
  });

  // Step 6
  if (penetrating > 0) {
    const { armor, changes } = ablate(t.armor, spec.location, spec.ablation);
    t = { ...t, armor };
    if (changes.length) events.push({ type: 'armorAblated', visibility: 'public', targetId: t.id, location: spec.location, pieces: changes });
  }

  // Step 7
  if (penetrating > 0 && spec.aimTarget === 'heldItem') {
    events.push({ type: 'heldItemDropped', visibility: 'public', targetId: t.id, reason: 'aimedShot' });
  }
  if (penetrating > 0 && spec.aimTarget === 'leg' && !hasInjury(t, 'brokenLeg')) {
    // @interpretation Being "suffered", it carries the standard +5 bonus damage.
    t = inflict(t, getInjury('brokenLeg'), 'aimedLeg', [], events);
  }

  // Step 8
  if (roll.critTriggered) t = inflictRandom(t, spec.critTable, 'damageDice', dice, events);

  // Step 9 — @interpretation "damaged" = lost any HP to this attack (crit bonus included);
  // the state is checked BEFORE the attack, so the hit that drops you doesn't trigger it.
  if (wasMortal && t.hp.current < startHp) {
    t = inflictRandom(t, spec.critTable, 'mortallyWounded', dice, events);
    const from = t.deathSave.accumulatedPenalty;
    t = { ...t, deathSave: { accumulatedPenalty: from + 1 } };
    events.push({ type: 'deathSavePenaltyChanged', visibility: 'public', targetId: t.id, from, to: from + 1, reason: 'damagedWhileMortallyWounded' });
  }

  // @interpretation New damage interrupts natural healing (wounds "reopen").
  if (t.hp.current < startHp && t.conditions.stabilized) t = { ...t, conditions: { ...t.conditions, stabilized: false } };

  // Step 10
  const wsAfter = woundState(t.hp);
  if (wsAfter !== wsBefore) events.push({ type: 'woundStateChanged', visibility: 'public', targetId: t.id, from: wsBefore, to: wsAfter });

  return { target: t, events, hpLost: startHp - t.hp.current };
}

/**
 * Roll 2d6 on the table; reroll results the target already has (Quick-Fixed
 * ones included — they still have the injury). If every row is taken, emit
 * `critTableExhausted` and ask the GM; no bonus damage is applied.
 */
function inflictRandom(t: Combatant, table: CritTable, cause: 'damageDice' | 'mortallyWounded', dice: Dice, events: CombatEvent[]): Combatant {
  const defs = CRIT_TABLES[table];
  const owned = new Set(t.criticalInjuries.map((i) => i.injuryId));
  if (defs.every((d) => owned.has(d.id))) {
    events.push({ type: 'critTableExhausted', visibility: 'gm', targetId: t.id, table, cause });
    events.push({ type: 'gmRulingRequired', visibility: 'gm', reason: `${t.name} already has every ${table} Critical Injury.` });
    return t;
  }
  const rolls: [number, number][] = [];
  for (;;) {
    const a = dice.d6();
    const b = dice.d6();
    rolls.push([a, b]);
    const def = defs.find((d) => d.roll === a + b)!;
    if (!owned.has(def.id)) return inflict(t, def, cause, rolls, events);
  }
}

function inflict(t: Combatant, def: CriticalInjuryDef, cause: 'damageDice' | 'mortallyWounded' | 'aimedLeg', rolls: [number, number][], events: CombatEvent[]): Combatant {
  const next: Combatant = {
    ...t,
    hp: { ...t.hp, current: t.hp.current - CRIT_BONUS_DAMAGE },
    criticalInjuries: [...t.criticalInjuries, { injuryId: def.id, table: def.table, quickFixed: false }],
  };
  events.push({ type: 'criticalInjury', visibility: 'public', targetId: t.id, injuryId: def.id, table: def.table, cause, rolls, bonusDamage: CRIT_BONUS_DAMAGE, hpAfter: next.hp.current });
  if (def.effect.dropsHeldItem) events.push({ type: 'heldItemDropped', visibility: 'public', targetId: t.id, reason: 'criticalInjury' });
  return next;
}
