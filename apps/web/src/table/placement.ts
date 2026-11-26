/**
 * GM "Place by Clicking": actors waiting for the GM to tap a square on the
 * Table. Client-side only; each tap sends an ordinary placeToken.
 */
import { useSyncExternalStore } from 'react';

let queue: string[] = [];
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

export function queuePlacement(ids: string[]) {
  queue = [...queue.filter((q) => !ids.includes(q)), ...ids];
  emit();
  // Ask the GM shell to show the Table.
  window.dispatchEvent(new CustomEvent('nsc:show-tab', { detail: 'table' }));
}
export function shiftPlacement() { queue = queue.slice(1); emit(); }
export function clearPlacement() { queue = []; emit(); }
/** Drop ids that no longer exist (removed actors) or already have a token. */
export function prunePlacement(keep: (id: string) => boolean) {
  const next = queue.filter(keep);
  if (next.length !== queue.length) { queue = next; emit(); }
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const usePlacementQueue = () => useSyncExternalStore(subscribe, () => queue);
