/**
 * The Start of Turn card, from the current state: the acting character's
 * conditions, wound state, injuries, grapples and the encounter's Turn usage.
 * It updates as the Turn goes (heal them out of Mortally Wounded and the Death
 * Save line goes; stand up and Prone goes).
 *
 * One item can't be read back from state: a Spinal Injury's lost Action (the
 * flag is spent when the Turn starts). That one comes from the reminder the
 * authority logged for this Turn, and only while the Action is still spent.
 */
import { turnReminders, type CombatEvent, type TurnReminder } from '@cprc/rules-core';
import type { ViewState } from '@cprc/session';

/** Intents that start a Turn. Entries may omit intentType for players (hidden content). */
const TURN_STARTERS = new Set(['endTurn', 'startEncounter', 'delayTurn', 'removeFromInitiative']);

export interface FeedLike { seq: number; intentType?: string; events: CombatEvent[] }

/** Feed index of the newest entry that started a Turn (-1: none in the feed). */
export function lastTurnStart(feed: readonly FeedLike[]): number {
  for (let i = feed.length - 1; i >= 0; i--) if (TURN_STARTERS.has(feed[i]!.intentType ?? '')) return i;
  return -1;
}

/**
 * Reminders for `currentId` right now. `sinceSeq`: the seq of the entry that
 * started this Turn, when the caller saw it happen; otherwise the feed is
 * searched for the last Turn start.
 */
export function startOfTurnItems(view: ViewState, currentId: string | null, feed: readonly FeedLike[], sinceSeq?: number | null): TurnReminder[] {
  const enc = view.encounter;
  if (!enc.active || !currentId || enc.order[enc.turnIndex] !== currentId) return [];
  const a = view.actors[currentId];
  const c = a?.combatant;
  if (!a || a.placeholder || !c || a.public.conditions.dead) return [];
  const name = a.public.name;
  const usage = enc.usage?.actorId === currentId ? enc.usage : null;

  // Session-level: grapples between characters this viewer knows.
  const extra: TurnReminder[] = [];
  const g = view.extras?.grapples.find((x) => x.holderId === currentId || x.heldId === currentId);
  if (g) {
    const other = view.actors[g.holderId === currentId ? g.heldId : g.holderId]?.public.name ?? 'someone';
    extra.push({
      key: 'grappled',
      text: g.heldId === currentId
        ? `${name} is held by ${other}: can’t move, −2 to Actions, no two-handed weapons.`
        : `${name} is holding ${other}: −2 to Actions, no two-handed weapons.`,
    });
  }

  // The rules list from the live combatant (turn flags are spent by now), with this viewer's name for it.
  const base = turnReminders({ ...c, name, turnFlags: undefined }, extra)
    // The Death Save line follows the encounter: it goes once the save is rolled or they're healed.
    .filter((r) => r.key !== 'deathSave');
  const out: TurnReminder[] = [];
  if (enc.deathSaveRequiredFor === currentId) out.push({ key: 'deathSave', text: `${name} rolls a Death Save before acting.` });

  // A lost Action, from this Turn's logged reminder, while the Action is still spent.
  if (usage?.actionUsed) {
    let from = -1;
    if (sinceSeq != null) from = feed.findIndex((f) => f.seq >= sinceSeq);
    else from = lastTurnStart(feed);
    if (from >= 0) {
      const logged = feed.slice(from).flatMap((f) => f.events)
        .filter((e): e is Extract<CombatEvent, { type: 'turnReminders' }> => e.type === 'turnReminders' && e.combatantId === currentId).at(-1);
      const lost = logged?.items.find((r) => r.key === 'lostAction');
      if (lost) out.push({ key: 'lostAction', text: `${name} has no Action this Turn (Spinal Injury); a Move Action is still allowed.` });
    }
  }
  // An ear injury's lost Move Action shows in the usage as blocked squares.
  if ((usage?.moveBlocked ?? 0) > 0) out.push({ key: 'noMove', text: `${name} has no Move Action this Turn (ear injury).` });
  out.push(...base);
  // Same rule as the authority: injuries alone don't make a card.
  return out.some((r) => r.key !== 'injury') ? out : [];
}
