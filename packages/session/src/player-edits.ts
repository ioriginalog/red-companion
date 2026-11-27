/**
 * Players edit their own character's notes and gear (never stats,
 * skills, HP, weapons or cyberware). The GM may use it too. Payloads are
 * validated here; the shared validator passes this intent type through.
 */
import type { CombatEvent } from '@cprc/rules-core';
import { GEAR_LINK, type OwnedGearItem } from './gear.js';
import { SessionError } from './helpers.js';
import type { Intent, SessionState, StatePatch, Viewer } from './types.js';

export type EditOwnSheetIntent = Extract<Intent, { type: 'editOwnSheet' }>;
export const PLAYER_EDIT_INTENTS: ReadonlySet<string> = new Set(['editOwnSheet']);

const MAX_NOTES = 8000;
const MAX_GEAR = 100;

function cleanGear(v: unknown): OwnedGearItem[] {
  if (!Array.isArray(v)) throw new SessionError('INVALID', 'Gear must be a list.');
  if (v.length > MAX_GEAR) throw new SessionError('INVALID', `At most ${MAX_GEAR} gear items.`);
  return v.map((raw, i) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SessionError('INVALID', `Gear item ${i + 1} is malformed.`);
    const g = raw as Record<string, unknown>;
    const name = typeof g.name === 'string' ? g.name.trim() : '';
    if (name.length < 1 || name.length > 80) throw new SessionError('INVALID', `Gear item ${i + 1} needs a name (up to 80 characters).`);
    if (!Number.isInteger(g.qty) || (g.qty as number) < 0 || (g.qty as number) > 9999) throw new SessionError('INVALID', `${name}: quantity must be a whole number from 0 to 9,999.`);
    if (g.notes !== undefined && (typeof g.notes !== 'string' || g.notes.length > 500)) throw new SessionError('INVALID', `${name}: notes are limited to 500 characters.`);
    const notes = typeof g.notes === 'string' ? g.notes.trim() : '';
    if (g.item !== undefined && (typeof g.item !== 'string' || !GEAR_LINK.test(g.item))) throw new SessionError('INVALID', `${name}: unknown catalog item.`);
    return { name, qty: g.qty as number, ...(notes ? { notes } : {}), ...(typeof g.item === 'string' ? { item: g.item } : {}) };
  });
}

/** Totals of catalog-linked gear (shields and drugs a character carries). */
function linkedTotals(gear: OwnedGearItem[] | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const g of gear ?? []) if (g.item) out.set(g.item, (out.get(g.item) ?? 0) + g.qty);
  return out;
}

export function executePlayerEdit(state: SessionState, intent: EditOwnSheetIntent, by: Viewer): { events: CombatEvent[]; patch: StatePatch } {
  if (typeof intent.actorId !== 'string') throw new SessionError('INVALID', 'Which character?');
  const a = state.actors[intent.actorId];
  if (!a) throw new SessionError('NOT_FOUND', 'No such character.');
  if (by.role !== 'gm' && a.controller !== by.playerId) throw new SessionError('FORBIDDEN', `You don’t control ${a.combatant.name}.`);
  const keys = Object.keys(intent).filter((k) => k !== 'type' && k !== 'actorId');
  const allowed = new Set(['notes', 'gear']);
  const extra = keys.find((k) => !allowed.has(k));
  if (extra) throw new SessionError('FORBIDDEN', 'Players can change only their notes and gear.');
  if (intent.notes === undefined && intent.gear === undefined) throw new SessionError('INVALID', 'Nothing to change.');
  if (intent.notes !== undefined && (typeof intent.notes !== 'string' || intent.notes.length > MAX_NOTES)) {
    throw new SessionError('INVALID', `Notes are limited to ${MAX_NOTES.toLocaleString('en-US')} characters.`);
  }
  const gear = intent.gear === undefined ? undefined : cleanGear(intent.gear);
  // Catalog shields and drugs come from the GM: a player may use them up or drop them, never add more.
  if (gear && by.role !== 'gm') {
    const had = linkedTotals(a.combatant.gear as OwnedGearItem[] | undefined);
    for (const [item, n] of linkedTotals(gear)) {
      if (n > (had.get(item) ?? 0)) throw new SessionError('FORBIDDEN', 'Only the GM can add catalog shields or drugs to a character’s gear.');
    }
  }
  const notes = intent.notes === undefined ? a.notes : intent.notes.trim() || undefined;
  const { notes: _old, ...rest } = a;
  const next = {
    ...rest,
    ...(notes ? { notes } : {}),
    combatant: gear === undefined ? a.combatant : { ...a.combatant, gear },
  };
  return { events: [], patch: { actors: { [a.id]: next } } };
}
