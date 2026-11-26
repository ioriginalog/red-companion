/** Pure helpers for the log panel. */
import type { FeedItem } from '../net.js';

/**
 * Entries the viewer should still see: anything past the current log head
 * was undone by the GM (a truncate rewinds `view.seq`), so it drops out (#16).
 * Items without a seq (local notes) always stay.
 */
export function liveFeed(feed: FeedItem[], headSeq: number): FeedItem[] {
  return feed.filter((f) => typeof f.seq !== 'number' || f.seq <= headSeq);
}

/** Within this many pixels of the bottom counts as "reading the newest". */
export const STICK_PX = 48;
export const isNearBottom = (el: { scrollTop: number; scrollHeight: number; clientHeight: number }) =>
  el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX;
