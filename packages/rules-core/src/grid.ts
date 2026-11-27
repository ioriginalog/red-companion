/**
 * Tactical grid: distance, line of sight, visibility and movement.
 *
 * RED plays on a grid where 1 square = 2 m/yds (Core Rulebook, combat
 * movement). Rulings made here (tagged in docs/rules-verification.md):
 *   - Diagonals cost 1 square (Chebyshev distance). Interpretation.
 *   - Line of sight is a ray between square centers. A ray that passes exactly
 *     through a corner is blocked only if BOTH squares beside the corner are
 *     opaque (so you can see past a single crate's corner). Interpretation.
 *   - Cover is binary, as in RED: a square behind an opaque square is not
 *     visible and cannot be targeted. There is no partial-cover modifier.
 *   - RED has no facing. Vision is 360°. Cones in the UI are for targeting
 *     and for the watch house rule, never for vision.
 *
 * Fog of war and attack legality both use `hasLineOfSight`, so a token a
 * player can see is always a token they can shoot at, and vice versa.
 */

export const METERS_PER_SQUARE = 2;

export interface Cell { x: number; y: number }

/**
 * Terrain codes, one character per square, row-major:
 *   '.' open floor
 *   '#' wall: blocks movement and sight, indestructible
 *   'c' cover: blocks movement and sight (crates, barriers, vehicles)
 *   '~' difficult: open to sight, costs 2 squares to enter. Interpretation.
 */
export type Terrain = '.' | '#' | 'c' | '~';

export interface GridMap {
  width: number;
  height: number;
  cells: string;
}

export const cellKey = (c: Cell) => `${c.x},${c.y}`;
export const parseKey = (k: string): Cell => {
  const [x, y] = k.split(',').map(Number);
  return { x: x!, y: y! };
};

export function inBounds(map: GridMap, c: Cell): boolean {
  return c.x >= 0 && c.y >= 0 && c.x < map.width && c.y < map.height;
}

export function terrainAt(map: GridMap, c: Cell): Terrain {
  if (!inBounds(map, c)) return '#';
  return (map.cells[c.y * map.width + c.x] ?? '#') as Terrain;
}

export const isOpaque = (map: GridMap, c: Cell) => {
  const t = terrainAt(map, c);
  return t === '#' || t === 'c';
};
export const isPassable = (map: GridMap, c: Cell) => !isOpaque(map, c);

/** Squares between two cells, diagonals counting 1. */
export function gridDistance(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Distance in m/yds, as fed to the range table. */
export function metersBetween(a: Cell, b: Cell): number {
  return gridDistance(a, b) * METERS_PER_SQUARE;
}

/**
 * Line of sight between square centers (Amanatides–Woo grid traversal).
 * The endpoints themselves never block, so a token standing in a doorway
 * square can see and be seen.
 */
export function hasLineOfSight(map: GridMap, a: Cell, b: Cell): boolean {
  if (a.x === b.x && a.y === b.y) return true;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  // Parametric distance (0..1 along the ray) to cross one full square.
  const tDeltaX = dx === 0 ? Infinity : 1 / Math.abs(dx);
  const tDeltaY = dy === 0 ? Infinity : 1 / Math.abs(dy);
  // Starting at the center, the first boundary is half a square away.
  let tMaxX = tDeltaX / 2;
  let tMaxY = tDeltaY / 2;
  let x = a.x;
  let y = a.y;
  const EPS = 1e-9;
  while (true) {
    if (Math.abs(tMaxX - tMaxY) < EPS) {
      // Exactly through a corner: blocked only if both side squares are opaque.
      if (isOpaque(map, { x: x + stepX, y }) && isOpaque(map, { x, y: y + stepY })) return false;
      x += stepX;
      y += stepY;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
    } else if (tMaxX < tMaxY) {
      x += stepX;
      tMaxX += tDeltaX;
    } else {
      y += stepY;
      tMaxY += tDeltaY;
    }
    if (x === b.x && y === b.y) return true;
    if (isOpaque(map, { x, y })) return false;
  }
}

/**
 * Every square visible from `from`, within `range` squares (Chebyshev).
 * Brute force over the range's bounding box on purpose: reusing
 * `hasLineOfSight` keeps fog and targeting provably identical.
 *
 * Memoized by terrain, origin and range (lighting and party vision ask the
 * same questions every time a token moves), so the result is shared:
 * treat it as read-only.
 */
export function visibleCells(map: GridMap, from: Cell, range = Infinity): ReadonlySet<string> {
  const key = `${map.width}|${from.x},${from.y}|${range}`;
  let byTerrain = visCache.get(map.cells);
  const hit = byTerrain?.get(key);
  if (hit) return hit;
  const out = new Set<string>();
  const r = Number.isFinite(range) ? Math.max(0, Math.floor(range)) : Math.max(map.width, map.height);
  const x0 = Math.max(0, from.x - r), x1 = Math.min(map.width - 1, from.x + r);
  const y0 = Math.max(0, from.y - r), y1 = Math.min(map.height - 1, from.y + r);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const c = { x, y };
      if (hasLineOfSight(map, from, c)) out.add(cellKey(c));
    }
  }
  if (!byTerrain) {
    // A few terrains at once (scene switches, map editor); oldest dropped first.
    if (visCache.size >= 4) visCache.delete(visCache.keys().next().value!);
    byTerrain = new Map();
    visCache.set(map.cells, byTerrain);
  }
  if (byTerrain.size >= 4000) byTerrain.clear();
  byTerrain.set(key, out);
  return out;
}

const visCache = new Map<string, Map<string, ReadonlySet<string>>>();

const DIRS: Cell[] = [
  { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
  { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: -1 },
];

export interface MoveOptions {
  /** Squares that cannot be entered or passed (enemy tokens). */
  blocked?: Set<string>;
  /** Squares that can be passed but not ended on (allied tokens). */
  occupied?: Set<string>;
}

interface Search { cost: Map<string, number>; parent: Map<string, string> }

/** Dijkstra over 8 directions; costs are 1 or 2, so a bucket queue is exact. */
function search(map: GridMap, from: Cell, budget: number, opts: MoveOptions): Search {
  const cost = new Map<string, number>([[cellKey(from), 0]]);
  const parent = new Map<string, string>();
  const buckets: Cell[][] = [[from]];
  for (let d = 0; d < buckets.length; d++) {
    for (const cur of buckets[d] ?? []) {
      if ((cost.get(cellKey(cur)) ?? Infinity) < d) continue;
      for (const dir of DIRS) {
        const n = { x: cur.x + dir.x, y: cur.y + dir.y };
        const k = cellKey(n);
        if (!inBounds(map, n) || !isPassable(map, n) || opts.blocked?.has(k)) continue;
        if (dir.x !== 0 && dir.y !== 0) {
          const s1 = { x: cur.x + dir.x, y: cur.y };
          const s2 = { x: cur.x, y: cur.y + dir.y };
          if (!isPassable(map, s1) && !isPassable(map, s2)) continue;
        }
        const nd = d + (terrainAt(map, n) === '~' ? 2 : 1);
        if (nd > budget || nd >= (cost.get(k) ?? Infinity)) continue;
        cost.set(k, nd);
        parent.set(k, cellKey(cur));
        (buckets[nd] ??= []).push(n);
      }
    }
  }
  return { cost, parent };
}

/**
 * Squares reachable with `budget` squares of movement, and their cost.
 * Diagonal steps may not squeeze between two impassable squares.
 */
export function reachableCells(map: GridMap, from: Cell, budget: number, opts: MoveOptions = {}): Map<string, number> {
  const { cost } = search(map, from, budget, opts);
  if (opts.occupied) for (const k of opts.occupied) if (k !== cellKey(from)) cost.delete(k);
  return cost;
}

/** Cheapest path (excluding `from`, including `to`), or null if `to` can't be reached within budget. */
export function findPath(map: GridMap, from: Cell, to: Cell, budget: number, opts: MoveOptions = {}): { path: Cell[]; cost: number } | null {
  const target = cellKey(to);
  if (opts.occupied?.has(target) && target !== cellKey(from)) return null;
  const { cost, parent } = search(map, from, budget, opts);
  const total = cost.get(target);
  if (total === undefined) return null;
  const path: Cell[] = [];
  for (let k: string | undefined = target; k && k !== cellKey(from); k = parent.get(k)) path.unshift(parseKey(k));
  return { path, cost: total };
}

/** Angle in degrees, 0 = east, clockwise (screen coordinates). */
export function bearing(a: Cell, b: Cell): number {
  return ((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 360) % 360;
}

/** Is `c` inside a cone from `apex` facing `facing`° with total width `arc`°? */
export function inCone(apex: Cell, facing: number, arc: number, c: Cell): boolean {
  if (apex.x === c.x && apex.y === c.y) return false;
  const diff = Math.abs(((bearing(apex, c) - facing + 540) % 360) - 180);
  return diff <= arc / 2 + 1e-9;
}
