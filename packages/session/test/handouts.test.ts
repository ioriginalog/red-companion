import { describe, expect, it } from 'vitest';
import { scriptedDice } from '@cprc/rules-core';
import {
  applyEntry, applyProjectedEntry, emptySession, emptyView, handleIntent, projectEntry, projectState,
  type Intent, type SessionState, type Viewer,
} from '../src/index.js';

const GM: Viewer = { role: 'gm' };
const P1: Viewer = { role: 'player', playerId: 'p1' };
const P2: Viewer = { role: 'player', playerId: 'p2' };

function table() {
  let state: SessionState = emptySession('s');
  const entries: ReturnType<typeof handleIntent>[] = [];
  return {
    get state() { return state; },
    entries,
    send(i: Intent, by: Viewer = GM) {
      const r = handleIntent(state, i, by, { dice: scriptedDice({}), now: () => 't', newId: () => 'x' });
      if (r.ok) state = applyEntry(state, r.entry);
      entries.push(r);
      return r;
    },
  };
}

const ho = (over: Partial<Extract<Intent, { type: 'setHandout' }>> = {}): Intent =>
  ({ type: 'setHandout', id: 'h1', title: 'Job Brief', body: 'Meet the fixer at the noodle stand.', audience: 'all', ...over }) as Intent;

describe('handouts', () => {
  it('only the GM can set or remove handouts', () => {
    const t = table();
    expect(t.send(ho(), P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(t.send(ho()).ok).toBe(true);
    expect(t.send({ type: 'removeHandout', id: 'h1' }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(t.send({ type: 'removeHandout', id: 'h1' }).ok).toBe(true);
    expect(t.state.handouts).toEqual({});
  });

  it('filters by audience for players and announces only shared ones', () => {
    const t = table();
    t.send(ho({ id: 'pub' }));
    t.send(ho({ id: 'journal', title: 'GM Notes', audience: 'gm' }));
    t.send(ho({ id: 'secret', title: 'For Alice', audience: ['p1'] }));
    expect(Object.keys(projectState(t.state, GM).handouts!)).toEqual(['pub', 'journal', 'secret']);
    expect(Object.keys(projectState(t.state, P1).handouts!)).toEqual(['pub', 'secret']);
    expect(Object.keys(projectState(t.state, P2).handouts!)).toEqual(['pub']);
    // Journal pages make no log noise; targeted shares carry an audience.
    const evs = t.entries.map((r) => (r.ok ? r.entry.events : []));
    expect(evs[1]).toEqual([]);
    expect(evs[2]![0]).toMatchObject({ type: 'handoutShared', audience: ['p1'] });
  });

  it('projected entries carry only readable handouts, and players can replay them', () => {
    const t = table();
    t.send(ho({ id: 'secret', audience: ['p1'] }));
    const entry = (t.entries[0] as { ok: true; entry: Parameters<typeof projectEntry>[0] }).entry;
    const p2 = projectEntry(entry, P2, t.state);
    expect(p2.patch.handouts).toEqual({});
    expect(p2.events).toEqual([]);
    const p1 = projectEntry(entry, P1, t.state);
    const v = applyProjectedEntry(emptyView('s'), p1);
    expect(v.handouts!.secret!.title).toBe('Job Brief');
  });

  it('rejects hostile payloads', () => {
    const t = table();
    const bad: Intent[] = [
      ho({ id: '../etc' }), ho({ id: '' }), ho({ title: '' }), ho({ title: 'x'.repeat(121) }),
      ho({ body: 'x'.repeat(20_001) }), ho({ body: 42 as unknown as string }),
      ho({ imageUrl: 'javascript:alert(1)' }), ho({ imageUrl: '//evil.example/x.png' }), ho({ imageUrl: 'http://plain.example/x.png' }),
      ho({ audience: [] }), ho({ audience: 'everyone' as unknown as 'all' }), ho({ audience: [7 as unknown as string] }),
    ];
    for (const i of bad) expect(t.send(i)).toMatchObject({ ok: false, code: 'INVALID' });
    expect(t.send(ho({ imageUrl: '/u/s/abc.webp' })).ok).toBe(true);
    expect(t.send(ho({ id: 'h2', imageUrl: 'https://example.com/a.png' })).ok).toBe(true);
    expect(t.send({ type: 'removeHandout', id: 'nope' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});
