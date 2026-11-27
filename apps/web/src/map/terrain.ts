/**
 * The Table's terrain layer, as data: walls, cover by material with a damage
 * state, destroyed cover (rubble) and difficult ground, from `map.cells` and
 * `map.cover`. Pure; drawn by TerrainLayer.
 *
 * Players only get squares the party knows (seen now, or explored before), so
 * the layer never outlines rooms they haven't found. The GM gets every square.
 */
import { cellKey, coverMaterial, DEFAULT_COVER_MATERIAL, type Cell, type CombatEvent, type CoverMaterialId } from '@cprc/rules-core';
import type { TacticalMap } from '@cprc/session';

export type CoverFamily = 'steel' | 'stone' | 'concrete' | 'wood' | 'glass' | 'plaster';
export type CoverState = 'intact' | 'damaged' | 'badly';

export interface TerrainCover extends Cell {
  material: CoverMaterialId;
  name: string;
  family: CoverFamily;
  thick: boolean;
  state: CoverState;
  /** HP left as a fraction of full. GM only: players get the damage state, never the number. */
  frac?: number;
}

export interface TerrainPlan {
  /** One path of wall squares (fill). */
  walls: string;
  /** Wall edges that face open or cover squares (stroke). */
  wallEdges: string;
  cover: TerrainCover[];
  /** One path of difficult-ground squares. */
  difficult: string;
  /** Destroyed cover squares, now open ground. */
  rubble: Cell[];
}

/** Full: solid walls and cover blocks (maps without art). Outline: a light trace over painted art. */
export type TerrainStyle = 'full' | 'outline';

export function coverFamily(id: CoverMaterialId): CoverFamily {
  if (/Steel$/.test(id)) return 'steel';
  if (/Stone$/.test(id)) return 'stone';
  if (/Concrete$/.test(id)) return 'concrete';
  if (/Wood$/.test(id)) return 'wood';
  if (/Glass$/.test(id)) return 'glass';
  return 'plaster';
}

/** Same thresholds as the hover label (table/cover.ts): full, over half, half or less. */
export function coverState(hp: number, max: number): CoverState {
  const f = max > 0 ? hp / max : 1;
  return f >= 1 ? 'intact' : f > 0.5 ? 'damaged' : 'badly';
}

export const COVER_STATE_LABEL: Record<CoverState, string> = { intact: 'Intact', damaged: 'Damaged', badly: 'Badly Damaged' };

/**
 * Which squares this viewer may see terrain on. GM: all. Players: what the
 * party sees now plus what it has explored. Without an explored record, only
 * what it sees now.
 */
export function knownSquares(map: Pick<TacticalMap, 'width' | 'height' | 'explored'>, vision: Set<string>, isGm: boolean): (x: number, y: number) => boolean {
  if (isGm) return () => true;
  const ex = map.explored && map.explored.length === map.width * map.height ? map.explored : null;
  return (x, y) => vision.has(`${x},${y}`) || (!!ex && ex[y * map.width + x] === '1');
}

/**
 * Cover squares destroyed this session, from the log, that are still open
 * ground (the GM may have painted new cover there since).
 */
export function rubbleFrom(events: Iterable<CombatEvent>, map: Pick<TacticalMap, 'width' | 'height' | 'cells'>): Set<string> {
  const out = new Set<string>();
  for (const e of events) {
    if (e.type !== 'coverDamaged' || !e.destroyed) continue;
    const { x, y } = e.at;
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
    const t = map.cells[y * map.width + x];
    if (t === '.' || t === '~') out.add(cellKey(e.at));
  }
  return out;
}

export function terrainPlan(
  map: Pick<TacticalMap, 'width' | 'height' | 'cells' | 'cover'>,
  S: number,
  known: (x: number, y: number) => boolean,
  opts: { isGm: boolean; rubble?: Set<string> },
): TerrainPlan {
  const { width: W, height: H, cells } = map;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? null : cells[y * W + x] ?? '.');
  let walls = '';
  let wallEdges = '';
  let difficult = '';
  const cover: TerrainCover[] = [];
  const rubble: Cell[] = [];
  // A wall face is seen from the open square next to it, even when the wall square itself isn't.
  const open = (nx: number, ny: number) => { const n = at(nx, ny); return n !== null && n !== '#' && known(nx, ny); };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = at(x, y);
    const px = x * S, py = y * S;
    if (t === '#') {
      if (!known(x, y) && !open(x, y - 1) && !open(x, y + 1) && !open(x - 1, y) && !open(x + 1, y)) continue;
      walls += `M${px},${py}h${S}v${S}h${-S}z`;
      // Edges only where a wall meets a known non-wall square (never along unknown ones).
      if (open(x, y - 1)) wallEdges += `M${px},${py}h${S}`;
      if (open(x, y + 1)) wallEdges += `M${px},${py + S}h${S}`;
      if (open(x - 1, y)) wallEdges += `M${px},${py}v${S}`;
      if (open(x + 1, y)) wallEdges += `M${px + S},${py}v${S}`;
    } else if (!known(x, y)) {
      continue;
    } else if (t === 'c') {
      const entry = map.cover?.[`${x},${y}`];
      const id = entry?.material ?? DEFAULT_COVER_MATERIAL;
      const mat = coverMaterial(id);
      const hp = Math.max(0, Math.min(mat.hp, entry?.hp ?? mat.hp));
      cover.push({
        x, y, material: mat.id, name: mat.name, family: coverFamily(mat.id), thick: !/^thin/.test(mat.id),
        state: coverState(hp, mat.hp), ...(opts.isGm ? { frac: hp / mat.hp } : {}),
      });
    } else {
      if (t === '~') difficult += `M${px},${py}h${S}v${S}h${-S}z`;
      if (opts.rubble?.has(`${x},${y}`)) rubble.push({ x, y });
    }
  }
  return { walls, wallEdges, cover, difficult, rubble };
}

/** Default style: solid on blank maps, a light outline over painted art. */
export function defaultTerrainStyle(map: Pick<TacticalMap, 'background'>): TerrainStyle {
  return map.background ? 'outline' : 'full';
}

/** Small deterministic noise per square so rubble and cracks don't repeat in lockstep. */
export function squareNoise(x: number, y: number, i: number): number {
  let h = (x * 374761393 + y * 668265263 + i * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
