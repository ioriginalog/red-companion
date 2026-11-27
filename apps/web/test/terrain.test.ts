import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '@cprc/rules-core';
import type { TacticalMap } from '@cprc/session';
import { coverFamily, coverState, defaultTerrainStyle, knownSquares, rubbleFrom, terrainPlan } from '../src/map/terrain.js';
import { foldedZoomRect, zoomCoversToken } from '../src/map/zoomDock.js';

// 6 × 3: a wall column at x = 2, cover at (1,0) and (4,1), difficult at (5,2).
const ROWS = ['.c#...', '..#.c.', '..#..~'];
const map = (extra: Partial<TacticalMap> = {}): TacticalMap => ({
  id: 'm', name: 'M', cellPx: 10, width: 6, height: 3, cells: ROWS.join(''), sightRange: 10, tokens: {}, watches: {}, spotted: [], ...extra,
} as TacticalMap);
const all = () => true;

describe('terrain plan', () => {
  it('draws walls, cover, difficult ground for the GM', () => {
    const p = terrainPlan(map(), 10, all, { isGm: true });
    expect(p.walls.match(/M/g)).toHaveLength(3);
    expect(p.cover.map((c) => `${c.x},${c.y}`)).toEqual(['1,0', '4,1']);
    expect(p.difficult).toBe('M50,20h10v10h-10z');
    // Wall faces toward open squares on both sides: 3 squares × 2 sides.
    expect(p.wallEdges.match(/M/g)).toHaveLength(6);
  });

  it('cover by material, with a damage state (GM gets the fraction, players only the state)', () => {
    const m = map({ cover: { '1,0': { material: 'thinSteel', hp: 10 }, '4,1': { material: 'thickWood', hp: 20 } } });
    const gm = terrainPlan(m, 10, all, { isGm: true }).cover;
    expect(gm[0]).toMatchObject({ family: 'steel', thick: false, state: 'badly', frac: 10 / 25 });
    expect(gm[1]).toMatchObject({ family: 'wood', thick: true, state: 'intact', frac: 1 });
    const pl = terrainPlan(m, 10, all, { isGm: false }).cover;
    expect(pl[0]).toMatchObject({ state: 'badly' });
    expect(pl[0]).not.toHaveProperty('frac');
  });

  it('players only get squares the party knows', () => {
    // Party sees column 0 and 1 only; nothing explored.
    const vision = new Set(['0,0', '1,0', '0,1', '1,1', '0,2', '1,2']);
    const p = terrainPlan(map(), 10, knownSquares(map(), vision, false), { isGm: false });
    expect(p.cover.map((c) => `${c.x},${c.y}`)).toEqual(['1,0']);
    expect(p.difficult).toBe('');
    // The wall is seen from its open side only: its far edge never shows.
    expect(p.wallEdges).not.toContain('M30,');
    expect(p.wallEdges.match(/M/g)).toHaveLength(3);
    // Explored squares count too.
    const explored = '111111' + '000000' + '000001';
    const q = terrainPlan(map({ explored }), 10, knownSquares(map({ explored }), vision, false), { isGm: false });
    expect(q.difficult).toBe('M50,20h10v10h-10z');
    expect(q.cover).toHaveLength(1);
  });

  it('masked squares from the relay draw nothing', () => {
    const m = map({ cells: '.c#???' + '..#???' + '..#???' });
    const p = terrainPlan(m, 10, all, { isGm: false });
    expect(p.cover).toHaveLength(1);
    expect(p.difficult).toBe('');
  });

  it('destroyed cover becomes rubble while it stays open ground', () => {
    const ev = (x: number, y: number, destroyed: boolean) => ({ type: 'coverDamaged', at: { x, y }, material: 'Thick Wood', hpBefore: 5, hpAfter: destroyed ? 0 : 3, destroyed } as CombatEvent);
    // (1,0) was cover and is open now; (4,1) was destroyed but has been painted as cover again.
    const rows = ['......', '..#.c.', '..#..~'];
    const mm = map({ cells: rows.join('') });
    const r = rubbleFrom([ev(1, 0, true), ev(4, 1, true), ev(0, 2, false)], mm);
    expect([...r]).toEqual(['1,0']);
    const p = terrainPlan(mm, 10, all, { isGm: true, rubble: r });
    expect(p.rubble).toEqual([{ x: 1, y: 0 }]);
  });

  it('style and state helpers', () => {
    expect(defaultTerrainStyle({ background: '/a.webp' })).toBe('outline');
    expect(defaultTerrainStyle({})).toBe('full');
    expect(coverState(20, 20)).toBe('intact');
    expect(coverState(11, 20)).toBe('damaged');
    expect(coverState(10, 20)).toBe('badly');
    expect(coverFamily('thickBulletproofGlass')).toBe('glass');
    expect(coverFamily('thickPlaster')).toBe('plaster');
  });
});

describe('phone zoom button', () => {
  const vp = { w: 390, h: 600 };
  const box = { x: 0, y: 0, w: 390, h: 600 }; // 1 map px = 1 screen px
  it('steps aside when a token is under it, not otherwise', () => {
    const r = foldedZoomRect(vp);
    expect(r.x + r.w).toBeGreaterThan(380);
    // A 40 px square at (8,0): center (340, 20), under the button.
    expect(zoomCoversToken({ a: { x: 8, y: 0 } }, () => true, box, vp, 40)).toBe(true);
    expect(zoomCoversToken({ a: { x: 2, y: 3 } }, () => true, box, vp, 40)).toBe(false);
    // Tokens the viewer doesn't know don't count.
    expect(zoomCoversToken({ a: { x: 8, y: 0 } }, () => false, box, vp, 40)).toBe(false);
  });
});
