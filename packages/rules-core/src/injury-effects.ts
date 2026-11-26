/**
 * Automated Critical Injury effects that play out over Turns (Round 4).
 *
 * - Spinal Injury: no Action on the injured character's next Turn (a Move Action
 *   is still allowed). Set when the injury lands; spent at the start of the next
 *   Turn. A Quick Fix before then cancels it. Easy Mode.
 * - Broken Ribs and Foreign Object (body or head): at the end of any Turn in
 *   which the character moved more than 4 m/yds on foot, they take the
 *   injury's bonus damage (5) again, straight to HP. Each such injury bleeds
 *   separately. Easy Mode (body), Secondary (head).
 *   @interpretation Distance is the Turn's movement cost in squares × 2 m/yds,
 *   so difficult terrain counts double; tokens on the map move on foot. Re-bleed
 *   damage doesn't trigger the Mortally Wounded extra crit (it isn't an attack).
 * - Damaged Ear and Lost Ear: after a Turn moving more than 4 m/yds on foot,
 *   no Move Action on the next Turn. Secondary.
 *
 * Events carry no HP figures, so they're safe to show players for NPCs.
 */
import { activeInjuries, woundState } from './character.js';
import { CRIT_BONUS_DAMAGE } from './data/core.js';
import type { CriticalInjuryDef } from './data/critical-injuries.js';
import type { CombatEvent, TurnReminder } from './events.js';
import type { Combatant } from './types.js';

export const REBLEED_THRESHOLD_METERS = 4;
/** Activated speedware lasts one minute = 20 Rounds of 3 seconds (Secondary). */
export const SPEEDWARE_ROUNDS = 20;

/** Call when a Critical Injury lands: queue its next-Turn effect. */
export function onInjuryGained(c: Combatant, def: CriticalInjuryDef): Combatant {
  if (!def.effect.loseActionNextTurn) return c;
  return { ...c, turnFlags: { ...(c.turnFlags ?? {}), loseAction: true } };
}

/**
 * End of the character's Turn. `metersMoved` = movement this Turn on foot.
 * Applies re-bleeds and queues the ear injuries' lost Move Action.
 */
export function endOfTurnInjuries(c: Combatant, metersMoved: number): { combatant: Combatant; events: CombatEvent[] } {
  if (c.conditions.dead || metersMoved <= REBLEED_THRESHOLD_METERS) return { combatant: c, events: [] };
  const active = activeInjuries(c);
  const bleeds = active.filter((d) => d.effect.rebleedOnMove);
  const ear = active.some((d) => d.effect.noMoveAfterMove);
  if (!bleeds.length && !ear) return { combatant: c, events: [] };
  const events: CombatEvent[] = [];
  let next = c;
  if (bleeds.length) {
    const before = woundState(c.hp);
    const damage = bleeds.length * CRIT_BONUS_DAMAGE;
    next = { ...next, hp: { ...next.hp, current: next.hp.current - damage }, conditions: { ...next.conditions, stabilized: false } };
    for (const d of bleeds) events.push({ type: 'injuryEffect', visibility: 'public', targetId: c.id, injuryId: d.id, effect: 'rebleed', damage: CRIT_BONUS_DAMAGE });
    const after = woundState(next.hp);
    if (before !== after) events.push({ type: 'woundStateChanged', visibility: 'public', targetId: c.id, from: before, to: after });
  }
  if (ear) {
    next = { ...next, turnFlags: { ...(next.turnFlags ?? {}), noMove: true } };
    const d = active.find((x) => x.effect.noMoveAfterMove)!;
    events.push({ type: 'injuryEffect', visibility: 'public', targetId: c.id, injuryId: d.id, effect: 'noMove' });
  }
  return { combatant: next, events };
}

/**
 * Start of the character's Turn: spend queued one-Turn effects.
 * A lost Action only applies while an untreated (not Quick-Fixed) injury still calls for it.
 */
export function startOfTurnInjuries(c: Combatant): { combatant: Combatant; loseAction: boolean; noMove: boolean; events: CombatEvent[] } {
  const f = c.turnFlags;
  if (!f || (!f.loseAction && !f.noMove)) return { combatant: c, loseAction: false, noMove: false, events: [] };
  const active = activeInjuries(c);
  const spinal = f.loseAction ? active.find((d) => d.effect.loseActionNextTurn) : undefined;
  const ear = f.noMove ? active.find((d) => d.effect.noMoveAfterMove) : undefined;
  const { turnFlags: _spent, ...rest } = c;
  const events: CombatEvent[] = [];
  if (spinal) events.push({ type: 'injuryEffect', visibility: 'public', targetId: c.id, injuryId: spinal.id, effect: 'lostAction' });
  if (ear) events.push({ type: 'injuryEffect', visibility: 'public', targetId: c.id, injuryId: ear.id, effect: 'noMove' });
  return { combatant: rest, loseAction: !!spinal, noMove: !!ear, events };
}

/**
 * Turn-start checklist in our own words. `extra` adds session-level items
 * (grapples). Situational injury effects the engine can't apply are listed too.
 */
export function turnReminders(c: Combatant, extra: TurnReminder[] = []): TurnReminder[] {
  const out: TurnReminder[] = [];
  if (c.conditions.dead) return out;
  if (woundState(c.hp) === 'mortally') out.push({ key: 'deathSave', text: `${c.name} rolls a Death Save before acting.` });
  if (c.conditions.prone) out.push({ key: 'prone', text: `${c.name} is Prone and must get up before moving.` });
  if (c.turnFlags?.loseAction && activeInjuries(c).some((d) => d.effect.loseActionNextTurn)) {
    out.push({ key: 'lostAction', text: `${c.name} has no Action this Turn (Spinal Injury); a Move Action is still allowed.` });
  }
  if (c.turnFlags?.noMove && activeInjuries(c).some((d) => d.effect.noMoveAfterMove)) {
    out.push({ key: 'noMove', text: `${c.name} has no Move Action this Turn (ear injury).` });
  }
  if ((c.onFire ?? 0) > 0) out.push({ key: 'onFire', text: `${c.name} is On Fire and can spend an Action to put it out.` });
  if (c.speedware?.active) out.push({ key: 'speedware', text: `${c.name}’s speedware is on (${c.speedware.roundsLeft} ${c.speedware.roundsLeft === 1 ? 'Round' : 'Rounds'} left).` });
  out.push(...extra);
  for (const d of activeInjuries(c)) {
    for (const s of d.effect.situational ?? []) out.push({ key: 'injury', text: `${d.name}: ${s}.` });
    if (d.effect.rebleedOnMove) out.push({ key: 'injury', text: `${d.name}: moving more than 4 m/yds this Turn reopens it (5 damage).` });
    if (d.effect.noMoveAfterMove) out.push({ key: 'injury', text: `${d.name}: moving more than 4 m/yds costs next Turn’s Move Action.` });
  }
  return out;
}

/** Initiative bonus from activated speedware while it's on. */
export function activeSpeedwareBonus(c: Combatant): number {
  return c.speedware?.active ? (c.mods?.activatedSpeedware ?? 0) : 0;
}
