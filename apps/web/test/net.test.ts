import { describe, expect, it } from 'vitest';
import type { LogEntry } from '@cprc/session';
import { reconcileLogs } from '../src/net.js';

const e = (seq: number, id = `e${seq}`): LogEntry => ({ seq, id, at: 't', by: 'gm', intent: { type: 'endTurn' }, events: [], patch: {} });

describe('GM offline reconciliation (critic #3)', () => {
  it('appends the local tail when the relay holds a prefix of the local log', () => {
    expect(reconcileLogs([e(1), e(2)], [e(1), e(2), e(3), e(4)])).toEqual({ kind: 'append', tail: [e(3), e(4)] });
    expect(reconcileLogs([e(1)], [e(1)])).toEqual({ kind: 'append', tail: [] });
  });
  it('adopts the relay log and counts dropped local entries when histories diverge', () => {
    expect(reconcileLogs([e(1), e(2, 'other')], [e(1), e(2), e(3)])).toEqual({ kind: 'adopt', dropped: 2 });
  });
  it('adopts a relay that moved ahead without losing anything', () => {
    expect(reconcileLogs([e(1), e(2), e(3)], [e(1)])).toEqual({ kind: 'adopt', dropped: 0 });
    expect(reconcileLogs([e(1)], [])).toEqual({ kind: 'adopt', dropped: 0 });
  });
});

describe('GM cache and feeds (round 3 #6, #13)', async () => {
  const { restoreFromCache, memoryKV, cacheKey } = await import('../src/persist.js');
  const { feedFromLog, feedFromHistory, FEED_CAP } = await import('../src/net.js');
  const { applyEntry, emptySession, handleIntent } = await import('@cprc/session');
  const { scriptedDice } = await import('@cprc/rules-core');

  function realLog(n: number) {
    let s = emptySession('s1');
    const log: LogEntry[] = [];
    for (let i = 0; i < n; i++) {
      const r = handleIntent(s, { type: 'chat', text: `line ${i}` }, { role: 'gm' }, { dice: scriptedDice({}) });
      if (!r.ok) throw new Error(r.message);
      s = applyEntry(s, r.entry);
      log.push(r.entry);
    }
    return log;
  }

  it('restores a cached log that replays, for the same session only', async () => {
    const log = realLog(3);
    const kv = memoryKV();
    await kv.set(cacheKey('s1'), { sessionId: 's1', log, synced: 2, savedAt: 1 });
    const r = restoreFromCache(await kv.get(cacheKey('s1')), 's1');
    expect(r?.log).toHaveLength(3);
    expect(r?.state.seq).toBe(3);
    expect(r?.synced).toBe(2);
    expect(restoreFromCache(await kv.get(cacheKey('s1')), 'other')).toBeNull();
    expect(restoreFromCache(null, 's1')).toBeNull();
    expect(restoreFromCache({ sessionId: 's1', log: [{ ...log[1], seq: 9 }], synced: 0 }, 's1')).toBeNull(); // doesn't replay
    expect(restoreFromCache({ sessionId: 's1', log, synced: 99 }, 's1')?.synced).toBe(3); // clamped
  });

  it('a GM tab reopened after going offline syncs its cached tail (cache + reconcile)', async () => {
    const log = realLog(4);
    const cached = restoreFromCache({ sessionId: 's1', log, synced: 2, savedAt: 1 }, 's1')!;
    // The relay only ever got the first two entries.
    expect(reconcileLogs(log.slice(0, 2), cached.log)).toEqual({ kind: 'append', tail: log.slice(2) });
    // Another device moved the session on: the relay wins, our tail is reported as dropped.
    const other = realLog(3).map((e) => ({ ...e, id: `x${e.seq}` }));
    expect(reconcileLogs(other, cached.log)).toEqual({ kind: 'adopt', dropped: 4 });
  });

  it('builds feeds from the whole GM log and from player history, capped', () => {
    const log = realLog(3);
    expect(feedFromLog(log).map((f) => f.seq)).toEqual([1, 2, 3]);
    expect(feedFromLog(log)[0]!.intentType).toBe('chat');
    const many = Array.from({ length: FEED_CAP + 5 }, (_, i) => ({ seq: i + 1, by: 'gm', intentType: 'chat', events: log[0]!.events }));
    expect(feedFromHistory(many)).toHaveLength(FEED_CAP);
    expect(feedFromHistory(undefined)).toEqual([]);
    expect(feedFromHistory([{ seq: 1, by: 'gm', intentType: 'endTurn', events: [] }])).toEqual([]);
  });
});
