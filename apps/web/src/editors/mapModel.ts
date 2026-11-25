/**
 * Map editor model: terrain painting, editor-local history, grid math and
 * JSON import/export. Pure; tested in apps/web/test/editors.test.ts.
 */
import type { Cell, Terrain } from '@cprc/rules-core';
import type { TacticalMap } from '@cprc/session';
import { safeImageUrl, slugify } from './actorModel.js';

export const TERRAINS: { code: Terrain; label: string; hint: string; color: string }[] = [
  { code: '.', label: 'Open', hint: 'Open floor', color: 'transparent' },
  { code: '#', label: 'Wall', hint: 'Blocks movement and sight', color: 'rgba(255,59,78,0.45)' },
  { code: 'c', label: 'Cover', hint: 'Crates, barriers, vehicles: block movement and sight', color: 'rgba(34,227,255,0.45)' },
  { code: '~', label: 'Difficult', hint: 'Costs 2 squares to enter; open to sight', color: 'rgba(255,212,0,0.4)' },
];
const VALID = new Set(['.', '#', 'c', '~']);

export const MAX_SQUARES = 10_000;
export const MAX_IMAGE_SIDE = 4096;

export interface GridFit {
  /** Squares across and down. */
  width: number;
  height: number;
  /** Image pixels kept after cropping to whole squares. */
  cropW: number;
  cropH: number;
}

/** Fit a grid of `cellPx` squares onto an image, cropping the remainder from the right and bottom. */
export function fitGrid(imageW: number, imageH: number, cellPx: number): GridFit {
  const c = Math.max(8, Math.round(cellPx));
  const width = Math.max(1, Math.floor(imageW / c));
  const height = Math.max(1, Math.floor(imageH / c));
  return { width, height, cropW: width * c, cropH: height * c };
}

/** Scale that keeps the long side at or under `max`. Never upscales. */
export function downscaleFactor(w: number, h: number, max = MAX_IMAGE_SIDE): number {
  return Math.min(1, max / Math.max(w, h));
}

export const blankCells = (w: number, h: number, t: Terrain = '.') => t.repeat(w * h);

export function idx(map: { width: number }, c: Cell) { return c.y * map.width + c.x; }

function setAt(cells: string[], width: number, height: number, c: Cell, t: Terrain) {
  if (c.x < 0 || c.y < 0 || c.x >= width || c.y >= height) return;
  cells[c.y * width + c.x] = t;
}

/** Square brush of `size` (1 = one square) centered as well as it can be on `at`. */
export function paintBrush(cells: string, width: number, height: number, at: Cell, size: number, t: Terrain): string {
  const arr = [...cells];
  const r0 = -Math.floor((size - 1) / 2);
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) setAt(arr, width, height, { x: at.x + r0 + dx, y: at.y + r0 + dy }, t);
  return arr.join('');
}

/** Paint every square on the line between two points (so fast drags leave no gaps). */
export function paintStroke(cells: string, width: number, height: number, from: Cell, to: Cell, size: number, t: Terrain): string {
  let out = cells;
  const n = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  for (let i = 0; i <= n; i++) {
    const f = n === 0 ? 0 : i / n;
    out = paintBrush(out, width, height, { x: Math.round(from.x + (to.x - from.x) * f), y: Math.round(from.y + (to.y - from.y) * f) }, size, t);
  }
  return out;
}

export function paintRect(cells: string, width: number, height: number, a: Cell, b: Cell, t: Terrain, outlineOnly = false): string {
  const arr = [...cells];
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (outlineOnly && x !== x0 && x !== x1 && y !== y0 && y !== y1) continue;
    setAt(arr, width, height, { x, y }, t);
  }
  return arr.join('');
}

/** 4-way flood fill of the region sharing the clicked square's terrain. */
export function floodFill(cells: string, width: number, height: number, at: Cell, t: Terrain): string {
  if (at.x < 0 || at.y < 0 || at.x >= width || at.y >= height) return cells;
  const arr = [...cells];
  const from = arr[at.y * width + at.x];
  if (from === t) return cells;
  const stack: Cell[] = [at];
  while (stack.length) {
    const c = stack.pop()!;
    if (c.x < 0 || c.y < 0 || c.x >= width || c.y >= height) continue;
    const i = c.y * width + c.x;
    if (arr[i] !== from) continue;
    arr[i] = t;
    stack.push({ x: c.x + 1, y: c.y }, { x: c.x - 1, y: c.y }, { x: c.x, y: c.y + 1 }, { x: c.x, y: c.y - 1 });
  }
  return arr.join('');
}

/** Resize keeping the overlapping top-left region. */
export function resizeCells(cells: string, oldW: number, oldH: number, w: number, h: number): string {
  let out = '';
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out += x < oldW && y < oldH ? cells[y * oldW + x] ?? '.' : '.';
  return out;
}

// ----- Editor-local undo/redo ----------------------------------------------------

export interface History { past: string[]; present: string; future: string[] }
export const LIMIT = 100;
export const historyOf = (present: string): History => ({ past: [], present, future: [] });
export function commit(h: History, next: string): History {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-LIMIT), present: next, future: [] };
}
export function undo(h: History): History {
  const prev = h.past[h.past.length - 1];
  return prev === undefined ? h : { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}
export function redo(h: History): History {
  const [next, ...rest] = h.future;
  return next === undefined ? h : { past: [...h.past, h.present], present: next, future: rest };
}

// ----- Maps ----------------------------------------------------------------------

export function newMap(opts: { name: string; width: number; height: number; cellPx: number; background?: string; taken: Iterable<string> }): TacticalMap {
  const id = uniqueMapId(opts.name, opts.taken);
  return {
    id, name: opts.name.trim() || 'Untitled Map', width: opts.width, height: opts.height, cellPx: opts.cellPx,
    cells: blankCells(opts.width, opts.height), sightRange: 30, tokens: {}, watches: {}, spotted: [],
    ...(opts.background ? { background: opts.background } : {}),
  };
}

export function uniqueMapId(name: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  const base = `map-${slugify(name)}`;
  if (!set.has(base)) return base;
  for (let n = 2; ; n++) if (!set.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Copy for the library: new id and name, no tokens or watches (those belong to a live scene). */
export function duplicateMap(m: TacticalMap, taken: Iterable<string>): TacticalMap {
  const name = `${m.name} Copy`;
  return { ...m, id: uniqueMapId(name, taken), name, tokens: {}, watches: {}, spotted: [] };
}

/** Tokens that would stand on a square the edit made impassable. */
export function tokensOnBlocked(m: TacticalMap): string[] {
  return Object.entries(m.tokens).filter(([, c]) => {
    const t = m.cells[c.y * m.width + c.x];
    return c.x >= m.width || c.y >= m.height || t === '#' || t === 'c';
  }).map(([id]) => id);
}

export const MAP_FILE_KIND = 'nsc.map';

export function exportMap(m: TacticalMap): string {
  const { tokens: _t, watches: _w, spotted: _s, ...rest } = m;
  return JSON.stringify({ kind: MAP_FILE_KIND, version: 1, map: { ...rest, tokens: {}, watches: {}, spotted: [] } }, null, 2);
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Validates and normalizes. Tokens are dropped: they belong to a live scene. Throws readable messages. */
export function importMap(text: string, taken: Iterable<string>): TacticalMap {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('That file isn’t valid JSON.'); }
  const m = isObj(data) && isObj(data.map) ? data.map : data;
  if (!isObj(m)) throw new Error('That file isn’t a map.');
  const { width, height, cells, cellPx, name, sightRange, background } = m;
  if (!Number.isInteger(width) || !Number.isInteger(height) || (width as number) < 1 || (height as number) < 1) throw new Error('The map needs whole-number width and height.');
  if ((width as number) * (height as number) > MAX_SQUARES) throw new Error(`Maps can have at most ${MAX_SQUARES.toLocaleString()} squares.`);
  if (typeof cells !== 'string' || cells.length !== (width as number) * (height as number) || [...cells].some((c) => !VALID.has(c))) {
    throw new Error('The terrain doesn’t match the map size.');
  }
  if (background !== undefined && (typeof background !== 'string' || !safeImageUrl(background))) throw new Error('The background image URL isn’t allowed.');
  const nm = typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : 'Imported Map';
  return {
    id: uniqueMapId(nm, taken), name: nm, width: width as number, height: height as number, cells,
    cellPx: typeof cellPx === 'number' && cellPx >= 8 ? cellPx : 64,
    sightRange: typeof sightRange === 'number' && sightRange > 0 ? Math.min(200, sightRange) : 30,
    tokens: {}, watches: {}, spotted: [],
    ...(typeof background === 'string' ? { background } : {}),
  };
}

/** Counts per terrain, for the editor's status line. */
export function terrainCounts(cells: string): Record<string, number> {
  const out: Record<string, number> = { '.': 0, '#': 0, c: 0, '~': 0 };
  for (const ch of cells) out[ch] = (out[ch] ?? 0) + 1;
  return out;
}

/**
 * Up to `count` open, unoccupied squares, nearest first to `near` (default:
 * the map's center), for dropping new tokens.
 */
export function freeSquares(m: TacticalMap, count: number, near?: Cell): Cell[] {
  const taken = new Set(Object.values(m.tokens).map((c) => `${c.x},${c.y}`));
  const start = near ?? { x: Math.floor(m.width / 2), y: Math.floor(m.height / 2) };
  const open = (c: Cell) => c.x >= 0 && c.y >= 0 && c.x < m.width && c.y < m.height && (m.cells[c.y * m.width + c.x] === '.' || m.cells[c.y * m.width + c.x] === '~');
  const out: Cell[] = [];
  const seen = new Set<string>([`${start.x},${start.y}`]);
  const queue: Cell[] = [start];
  while (queue.length && out.length < count) {
    const c = queue.shift()!;
    if (open(c) && !taken.has(`${c.x},${c.y}`)) out.push(c);
    for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const) {
      const n = { x: c.x + d[0], y: c.y + d[1] };
      const k = `${n.x},${n.y}`;
      if (seen.has(k) || n.x < 0 || n.y < 0 || n.x >= m.width || n.y >= m.height) continue;
      seen.add(k);
      queue.push(n);
    }
  }
  return out;
}
