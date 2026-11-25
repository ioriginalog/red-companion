import { describe, expect, it } from 'vitest';
import {
  bearing, cellKey, gridDistance, hasLineOfSight, inCone, metersBetween, reachableCells, visibleCells, type GridMap,
} from '../src/index.js';

/** Build a map from rows of terrain characters. */
const grid = (...rows: string[]): GridMap => ({ width: rows[0]!.length, height: rows.length, cells: rows.join('') });

describe('distance', () => {
  it('counts diagonals as one square, 2 m each', () => {
    expect(gridDistance({ x: 0, y: 0 }, { x: 3, y: 5 })).toBe(5);
    expect(metersBetween({ x: 0, y: 0 }, { x: 3, y: 5 })).toBe(10);
  });
});

describe('line of sight', () => {
  const m = grid(
    '.......',
    '...#...',
    '.......',
  );
  it('is blocked by an opaque square on the ray', () => {
    expect(hasLineOfSight(m, { x: 0, y: 1 }, { x: 6, y: 1 })).toBe(false);
  });
  it('is clear around the obstacle', () => {
    expect(hasLineOfSight(m, { x: 0, y: 0 }, { x: 6, y: 0 })).toBe(true);
  });
  it('is symmetric', () => {
    for (let ax = 0; ax < 7; ax++) for (let ay = 0; ay < 3; ay++) for (let bx = 0; bx < 7; bx++) for (let by = 0; by < 3; by++) {
      const a = { x: ax, y: ay }, b = { x: bx, y: by };
      expect(hasLineOfSight(m, a, b)).toBe(hasLineOfSight(m, b, a));
    }
  });
  it('lets a diagonal ray past a single corner but not between two', () => {
    const one = grid('.#', '..');
    expect(hasLineOfSight(one, { x: 0, y: 0 }, { x: 1, y: 1 })).toBe(true);
    const two = grid('.#', '#.');
    expect(hasLineOfSight(two, { x: 0, y: 0 }, { x: 1, y: 1 })).toBe(false);
  });
  it('treats cover like a wall (RED cover is binary)', () => {
    const c = grid('.c.');
    expect(hasLineOfSight(c, { x: 0, y: 0 }, { x: 2, y: 0 })).toBe(false);
  });
  it('never blocks on the endpoints themselves', () => {
    const c = grid('c.c');
    expect(hasLineOfSight(c, { x: 0, y: 0 }, { x: 2, y: 0 })).toBe(true);
  });
});

describe('visibleCells', () => {
  it('hides squares behind a wall and respects range', () => {
    const m = grid(
      '.....',
      '..#..',
      '.....',
    );
    const v = visibleCells(m, { x: 0, y: 1 });
    expect(v.has('4,1')).toBe(false);
    expect(v.has('2,0')).toBe(true); // peeks over the wall's corner
    expect(v.has('4,0')).toBe(false); // the ray clips the wall square itself
    expect(visibleCells(m, { x: 0, y: 1 }, 2).has('3,0')).toBe(false);
  });
});

describe('reachableCells', () => {
  const m = grid(
    '.....',
    '.###.',
    '.....',
  );
  it('paths around walls within the budget', () => {
    const r = reachableCells(m, { x: 0, y: 0 }, 4);
    expect(r.get('4,0')).toBe(4);
    expect(r.has('2,2')).toBe(true); // down the left side and across: 2 + 1 diagonal-saving = 2
    expect(r.has('4,2')).toBe(false); // needs 5
  });
  it('does not squeeze diagonally between two blockers', () => {
    const s = grid('.#', '#.');
    expect(reachableCells(s, { x: 0, y: 0 }, 5).has('1,1')).toBe(false);
  });
  it('costs 2 to enter difficult terrain', () => {
    expect(reachableCells(grid('.~.'), { x: 0, y: 0 }, 2).has('2,0')).toBe(false);
    expect(reachableCells(grid('.~.'), { x: 0, y: 0 }, 3).get('2,0')).toBe(3);
  });
  it('passes through allies but cannot stop on them, and never through enemies', () => {
    const line = grid('....');
    const ally = new Set([cellKey({ x: 1, y: 0 })]);
    const r = reachableCells(line, { x: 0, y: 0 }, 3, { occupied: ally });
    expect(r.has('1,0')).toBe(false);
    expect(r.get('2,0')).toBe(2);
    const r2 = reachableCells(line, { x: 0, y: 0 }, 3, { blocked: ally });
    expect(r2.has('2,0')).toBe(false);
  });
});

describe('cones', () => {
  it('measures bearing clockwise from east and tests membership', () => {
    expect(bearing({ x: 0, y: 0 }, { x: 0, y: 1 })).toBe(90);
    expect(inCone({ x: 0, y: 0 }, 0, 90, { x: 5, y: 2 })).toBe(true);
    expect(inCone({ x: 0, y: 0 }, 0, 90, { x: 1, y: 3 })).toBe(false);
    expect(inCone({ x: 0, y: 0 }, 350, 40, { x: 5, y: 0 })).toBe(true);
  });
});

describe('findPath', () => {
  it('returns the cheapest route and its cost', async () => {
    const { findPath } = await import('../src/index.js');
    const m = grid('...', '.#.', '...');
    const r = findPath(m, { x: 0, y: 1 }, { x: 2, y: 1 }, 10)!;
    expect(r.cost).toBe(2);
    expect(r.path).toHaveLength(2);
    expect(r.path.at(-1)).toEqual({ x: 2, y: 1 });
    expect(findPath(m, { x: 0, y: 1 }, { x: 2, y: 1 }, 1)).toBeNull();
  });
});
