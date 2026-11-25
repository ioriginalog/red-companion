/** Combat log line for Round 3 X events: the authority already wrote the sentence. */
import type { CombatEvent } from '@cprc/rules-core';

export function narrateExtras(e: CombatEvent): { text: string; tone: 'hit' | 'miss' | 'info' | 'bad' | 'good' } | null {
  if (e.type !== 'extraResolved') return null;
  return { text: e.text, tone: e.success === false ? 'miss' : e.success ? 'hit' : 'info' };
}
