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
