/**
 * Token label layout. Pure, so it is unit-tested.
 *
 * - Labels fit within one square, so side-by-side tokens never overlap.
 * - Names that would truncate to the same text keep their distinctive ends
 *   ("Street Ganger" / "Street Ganger B" → "Street G…" / "Street…r B"), and
 *   identical names get an ordinal.
 * - A label sits below its token, moves above when the square below is
 *   occupied, and is hidden (shown on hover/focus) when both are taken.
 */
import type { Cell } from '@cprc/rules-core';

export const LABEL_CHARS = 10;

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const middle = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.ceil((n - 1) / 2))}…${s.slice(s.length - Math.floor((n - 1) / 2))}` : s);

/** Display labels per id, unique among the given tokens. */
export function tokenLabels(names: Record<string, string>, max = LABEL_CHARS): Record<string, string> {
  const ids = Object.keys(names).sort();
  const out: Record<string, string> = {};
  for (const id of ids) out[id] = cut(names[id]!, max);
  const groups = (f: (id: string) => string) => {
    const m = new Map<string, string[]>();
    for (const id of ids) { const k = f(id); m.set(k, [...(m.get(k) ?? []), id]); }
    return [...m.values()].filter((g) => g.length > 1);
  };
  // Different names that truncate alike: keep both ends.
  for (const g of groups((id) => out[id]!)) {
    if (new Set(g.map((id) => names[id])).size > 1) for (const id of g) out[id] = middle(names[id]!, max);
  }
  // Still identical (same name, or same ends): number them.
  for (const g of groups((id) => out[id]!)) {
    g.forEach((id, i) => { out[id] = `${cut(out[id]!.replace(/…$/, ''), max - 3)} ${i + 1}`; });
  }
  return out;
}

export type LabelSpot = 'below' | 'above' | 'hidden';

/** Where each token's label goes, given which squares hold tokens and which tokens show a badge above. */
export function labelSpots(tokens: Record<string, Cell>, badgeAbove: Set<string> = new Set()): Record<string, LabelSpot> {
  const occupied = new Set(Object.values(tokens).map((c) => `${c.x},${c.y}`));
  const out: Record<string, LabelSpot> = {};
  for (const [id, c] of Object.entries(tokens)) {
    if (!occupied.has(`${c.x},${c.y + 1}`)) out[id] = 'below';
    else if (!occupied.has(`${c.x},${c.y - 1}`) && !badgeAbove.has(id)) out[id] = 'above';
    else out[id] = 'hidden';
  }
  return out;
}
