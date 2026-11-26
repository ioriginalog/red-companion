/**
 * Handouts and the GM journal. A handout is shared text (and an
 * optional image) the GM reveals to everyone or to chosen players; audience
 * 'gm' keeps it as a private journal page. Projection filters by audience.
 */
import type { CombatEvent } from '@cprc/rules-core';
import { SessionError } from './helpers.js';
import type { Handout, Intent, SessionState, StatePatch, Viewer } from './types.js';

export const HANDOUT_INTENTS: ReadonlySet<string> = new Set(['setHandout', 'removeHandout']);

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_HANDOUTS = 200;

function validImageUrl(u: unknown): string | undefined {
  if (u === undefined || u === null || u === '') return undefined;
  if (typeof u !== 'string' || u.length > 500) throw new SessionError('INVALID', 'Image link is too long.');
  // Same-origin paths (uploaded assets) or https links only.
  if (!/^\/(?!\/)[\w\-./%]+$/.test(u) && !/^https:\/\/[^\s"'<>]+$/.test(u)) throw new SessionError('INVALID', 'Use an uploaded image or an https link.');
  return u;
}

function validAudience(a: unknown): Handout['audience'] {
  if (a === 'all' || a === 'gm') return a;
  if (!Array.isArray(a) || a.length < 1 || a.length > 20) throw new SessionError('INVALID', 'Choose who sees the handout.');
  for (const x of a) if (typeof x !== 'string' || x.length < 1 || x.length > 64) throw new SessionError('INVALID', 'Choose who sees the handout.');
  return [...new Set(a as string[])];
}

/** Can this viewer read the handout? The GM reads everything. */
export function canReadHandout(h: Handout, viewer: Viewer): boolean {
  if (viewer.role === 'gm') return true;
  if (h.audience === 'all') return true;
  if (h.audience === 'gm') return false;
  return h.audience.includes(viewer.playerId);
}

export function visibleHandouts(all: Record<string, Handout>, viewer: Viewer): Record<string, Handout> {
  if (viewer.role === 'gm') return all;
  return Object.fromEntries(Object.entries(all).filter(([, h]) => canReadHandout(h, viewer)));
}

type HandoutIntent = Extract<Intent, { type: 'setHandout' | 'removeHandout' }>;

export function executeHandout(state: SessionState, intent: HandoutIntent, by: Viewer): { events: CombatEvent[]; patch: StatePatch } {
  if (by.role !== 'gm') throw new SessionError('FORBIDDEN', 'Only the GM can do that.');
  const all = state.handouts ?? {};
  if (intent.type === 'removeHandout') {
    if (typeof intent.id !== 'string' || !all[intent.id]) throw new SessionError('NOT_FOUND', 'No such handout.');
    const { [intent.id]: _gone, ...rest } = all;
    return { events: [], patch: { handouts: rest } };
  }
  const { id } = intent;
  if (typeof id !== 'string' || !ID.test(id)) throw new SessionError('INVALID', 'Handout id must be letters, numbers, - or _.');
  const title = typeof intent.title === 'string' ? intent.title.trim() : '';
  if (title.length < 1 || title.length > 120) throw new SessionError('INVALID', 'Give the handout a title (up to 120 characters).');
  if (typeof intent.body !== 'string' || intent.body.length > 20_000) throw new SessionError('INVALID', 'Handout text is too long (20,000 characters at most).');
  const imageUrl = validImageUrl(intent.imageUrl);
  const audience = validAudience(intent.audience);
  if (!all[id] && Object.keys(all).length >= MAX_HANDOUTS) throw new SessionError('INVALID', 'Too many handouts.');
  const h: Handout = { id, title, body: intent.body, audience, ...(imageUrl ? { imageUrl } : {}) };
  const events: CombatEvent[] = audience === 'gm'
    ? []
    : [{ type: 'handoutShared', visibility: 'public', id, title, ...(audience === 'all' ? {} : { audience: [...audience] }) }];
  return { events, patch: { handouts: { ...all, [id]: h } } };
}
