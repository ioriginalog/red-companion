/**
 * What this viewer must answer before play can go on: a Death Save, a dodge,
 * a damage roll, a watch, or a blast dodge. Pure, so the phone dock, the
 * desktop bar and the sheet all agree on it.
 */
import type { Intent, ViewState } from '@cprc/session';

export interface RequiredChoice { label: string; tone: 'yellow' | 'plain'; intent: Intent }
export interface Required {
  /** Stable per prompt, so the sheet opens once per prompt and not on every render. */
  key: string;
  title: string;
  /** One-tap answers shown in the dock. Empty = answer it in the panel. */
  choices: RequiredChoice[];
}

/**
 * `me` is the viewer's controller id ('gm' or a player id). The GM is asked
 * only about characters the GM runs, never on a player's behalf.
 */
export function requiredPrompt(view: ViewState, me: string): Required | null {
  const ownsId = (id: string | null | undefined) => !!id && view.actors[id]?.controller === me;
  const p = view.pending;
  if (p?.kind === 'awaitingDodge' && ownsId(p.defenderId)) {
    return {
      key: `dodge:${p.id}`, title: 'Incoming Fire',
      choices: [
        { label: 'Dodge', tone: 'yellow', intent: { type: 'respondDodge', pendingId: p.id, dodge: true } },
        { label: 'Take the DV', tone: 'plain', intent: { type: 'respondDodge', pendingId: p.id, dodge: false } },
      ],
    };
  }
  if (p?.kind === 'awaitingDamage' && ownsId(p.attackerId)) {
    return { key: `dmg:${p.id}`, title: 'Hit', choices: [{ label: 'Roll Damage', tone: 'yellow', intent: { type: 'rollDamage', pendingId: p.id } }] };
  }
  if (p?.kind === 'awaitingWatch' && ownsId(p.watcherId)) {
    // Firing needs a weapon pick: answer it in the panel; holding fire is one tap.
    return { key: `watch:${p.id}`, title: 'Watch Triggered', choices: [{ label: 'Hold Fire', tone: 'plain', intent: { type: 'declineWatch', pendingId: p.id } }] };
  }
  if (p?.kind === 'awaitingAreaDodge') {
    const mineUndecided = Object.entries(p.decisions).filter(([id, d]) => d === null && ownsId(id)).map(([id]) => id);
    if (mineUndecided.length === 1) {
      const id = mineUndecided[0]!;
      return {
        key: `area:${p.id}:${id}`, title: 'Blast Incoming',
        choices: [
          { label: 'Dodge', tone: 'yellow', intent: { type: 'respondAreaDodge', pendingId: p.id, actorId: id, dodge: true } },
          { label: 'Take It', tone: 'plain', intent: { type: 'respondAreaDodge', pendingId: p.id, actorId: id, dodge: false } },
        ],
      };
    }
    if (mineUndecided.length > 1) return { key: `area:${p.id}`, title: 'Blast Incoming', choices: [] };
  }
  const ds = view.encounter.active ? view.encounter.deathSaveRequiredFor : null;
  if (ds && ownsId(ds)) {
    return { key: `ds:${view.encounter.round}:${ds}`, title: 'Death Save', choices: [{ label: 'Roll Death Save', tone: 'yellow', intent: { type: 'deathSave', actorId: ds } }] };
  }
  return null;
}
