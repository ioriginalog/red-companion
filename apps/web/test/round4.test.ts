import { describe, expect, it } from 'vitest';
import { scriptedDice } from '@cprc/rules-core';
import { applyEntry, emptySession, handleIntent, projectState, type Intent, type SessionState } from '@cprc/session';
import { SKILL_STAT } from '../src/data/skills.js';
import { demoIntents } from '../src/demo.js';
import { extrasPreview, previewAttack } from '../src/tactics.js';

function demo(): SessionState {
  let s = emptySession('t');
  for (const i of demoIntents()) {
    const r = handleIntent(s, i, { role: 'gm' }, { dice: scriptedDice({}) });
    if (!r.ok) throw new Error(r.message);
    s = applyEntry(s, r.entry);
  }
  return s;
}
const run = (s: SessionState, i: Intent) => handleIntent(s, i, { role: 'gm' }, { dice: scriptedDice({ d10: [5, 5, 5, 5], d6: [3, 3, 3, 3] }) });

describe('Martial Arts Forms (#7)', () => {
  it('lists each Form as its own DEX skill the engine can read', () => {
    expect(SKILL_STAT['Martial Arts (Judo)']).toBe('DEX');
    expect(SKILL_STAT['Martial Arts (Aikido)']).toBe('DEX');
    expect(SKILL_STAT['Martial Arts']).toBeUndefined();
  });
});

describe('grapple-aware attack preview (#11)', () => {
  function grappled() {
    let s = demo();
    // Put the ganger next to Vex, then have Vex hold them.
    const r = run(s, { type: 'placeToken', actorId: 'ganger-a', at: { x: s.map!.tokens.vex!.x + 1, y: s.map!.tokens.vex!.y } });
    if (!r.ok) throw new Error(r.message);
    s = applyEntry(s, r.entry);
    return { ...s, extras: { grapples: [{ holderId: 'vex', heldId: 'ganger-a', chokes: 0, lastChokeRound: null, ironGrip: false }], facedowns: [], hits: [], movesUsed: [] } } as SessionState;
  }
  it('refuses two-handed weapons with the authority’s own reason', () => {
    const s = grappled();
    const v = projectState(s, { role: 'gm' });
    const ar = v.actors.vex!.weapons!.find((w) => w.type === 'assaultRifle')!;
    const pv = previewAttack(v, 'vex', 'ganger-a', ar, 'single');
    expect(pv.ok).toBe(false);
    const auth = run(s, { type: 'rangedAttack', attackerId: 'vex', defenderId: 'ganger-a', weaponId: ar.id, distance: 2 });
    expect(auth.ok).toBe(false);
    expect(!pv.ok && pv.reason).toBe(!auth.ok && auth.message);
  });
  it('adds the −2 the authority adds for one-handed weapons', () => {
    const s = grappled();
    const v = projectState(s, { role: 'gm' });
    const pistol = v.actors.vex!.weapons!.find((w) => w.type === 'heavyPistol')!;
    const mods = extrasPreview(v, 'vex', 'ganger-a', pistol, false);
    expect(mods).toEqual([{ label: 'Grappling', value: -2 }]);
    const pv = previewAttack(v, 'vex', 'ganger-a', pistol, 'single');
    expect(pv.ok && pv.modifiers.some((m) => m.label === 'Grappling' && m.value === -2)).toBe(true);
  });
  it('adds nothing when nobody is grappling', () => {
    const v = projectState(demo(), { role: 'gm' });
    expect(extrasPreview(v, 'vex', 'ganger-a', 'brawling', true)).toEqual([]);
  });
});

describe('area attack odds stay in lockstep with the engine (#13)', async () => {
  const { resolveAreaAttack } = await import('@cprc/rules-core');
  const { areaOdds } = await import('../src/table/area.js');
  const s = demo();
  const lt = s.actors.lt!;
  it.each([
    ['launcher at 14 m', 'blast' as const, 14, 'launcher' as const],
    ['thrown grenade at 10 m', 'blast' as const, 10, 'thrownGrenade' as const],
  ])('%s', (_l, kind, dist, engineKind) => {
    const w = engineKind === 'launcher' ? lt.weapons.find((x) => x.type === 'grenadeLauncher')! : { id: 'g', name: 'Grenade', type: 'grenade' as const };
    const o = areaOdds(lt.combatant, w, kind, dist);
    const area = engineKind === 'launcher' ? { kind: 'launcher' as const, weapon: w, distance: dist } : { kind: 'thrownGrenade' as const, distance: dist, damageDice: 6 };
    const out = resolveAreaAttack(lt.combatant, area, scriptedDice({ d10: [5], d6: [] }));
    expect(out.attack.total).toBe(o.base + o.modifiers.reduce((a, m) => a + m.value, 0) + 5);
    expect(out.dv).toBe(o.dv);
  });
});

describe('log helpers (#16, #17, #20, #21)', async () => {
  const { liveFeed, isNearBottom } = await import('../src/table/feed.js');
  const { damageMath, deathSaveMath, narrate } = await import('../src/narrate.js');
  const { signed, num } = await import('../src/table/format.js');
  it('drops entries past the log head (undone by the GM)', () => {
    const f = [1, 2, 3].map((seq) => ({ seq, by: 'gm', intentType: 'chat', events: [] }));
    expect(liveFeed(f, 2).map((x) => x.seq)).toEqual([1, 2]);
  });
  it('treats the last 48 px as the bottom', () => {
    expect(isNearBottom({ scrollTop: 560, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
    expect(isNearBottom({ scrollTop: 100, scrollHeight: 1000, clientHeight: 400 })).toBe(false);
  });
  it('groups dice before a multiplier and shows the Death Save roll', () => {
    expect(damageMath([1, 2], 4)).toBe('(1 + 2) × 4');
    expect(damageMath([3], 2)).toBe('3 × 2');
    expect(damageMath([1, 2], 1)).toBe('1 + 2');
    expect(deathSaveMath({ natural: 4, penalty: 1, total: 5, body: 6 })).toBe('4 + 1 penalty = 5 vs BODY 6 (needs under).');
    expect(deathSaveMath({ natural: 4 })).toBe('');
  });
  it('uses a real minus sign', () => {
    expect(signed(-2)).toBe('−2');
    expect(signed(3)).toBe('+3');
    expect(num(-4)).toBe('−4');
  });
  it('prints no numbers from redacted events', () => {
    const name = () => 'Ganger';
    const hit = narrate({ type: 'damageApplied', visibility: 'public', targetId: 'g', location: 'body', rawDamage: 9, redacted: true } as never, name)!;
    expect(hit.text).not.toMatch(/\d/);
    const ds = narrate({ type: 'deathSaveRolled', visibility: 'public', targetId: 'g', natural: 3, success: true, redacted: true } as never, name)!;
    expect(ds.text).not.toMatch(/\d/);
  });
});

describe('placement (#12)', async () => {
  const { freeSquares } = await import('../src/editors/mapModel.js');
  it('can avoid squares (the party’s sight) when placing', () => {
    const m = { id: 'm', name: 'M', width: 3, height: 1, cells: '...', cellPx: 64, sightRange: 10, tokens: {}, watches: {}, spotted: [] };
    expect(freeSquares(m, 1, { x: 0, y: 0 }, new Set(['0,0', '1,0']))).toEqual([{ x: 2, y: 0 }]);
  });
});

describe('initiative names (#19)', async () => {
  const { initLabel } = await import('../src/table/panels.js');
  it('is never empty', () => {
    const v = projectState(demo(), { role: 'gm' });
    expect(initLabel(v.actors.vex!, true, false)).toBe('Vex, Party, Unhurt, Acting Now');
  });
});

describe('exploration fog', async () => {
  const { fogPaths } = await import('../src/table/fog.js');
  const { mergeExplored } = await import('@cprc/session');
  it('darkens never-seen squares and dims seen-before ones', () => {
    const map = { width: 3, height: 1, explored: '110' };
    const f = fogPaths(map, new Set(['0,0']), 10);
    expect(f.dim).toBe('M10,0h10v10h-10z');
    expect(f.dark).toBe('M20,0h10v10h-10z');
  });
  it('treats every square as seen on maps without a record', () => {
    expect(fogPaths({ width: 2, height: 1 }, new Set(), 10).dark).toBe('');
  });
  it('accumulates what the party sees, and returns the same string when nothing is new', () => {
    const m = { width: 3, height: 1, explored: '100' } as Parameters<typeof mergeExplored>[0];
    const next = mergeExplored(m, new Set(['2,0']))!;
    expect(next).toBe('101');
    expect(mergeExplored({ ...m, explored: next }, new Set(['0,0']))).toBe(next);
  });
  it('is recorded when a map loads and grows as the party moves', () => {
    const s = demo();
    const ex = s.map!.explored!;
    expect(ex).toHaveLength(24 * 16);
    expect(ex).toContain('1');
    expect(ex).toContain('0');
  });
});
