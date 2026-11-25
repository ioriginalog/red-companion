/**
 * Cover with HP (Secondary, community references of the Core cover table).
 * Each 2 × 2 m/yd square of cover has its own HP and can be attacked. At 0 HP
 * it's destroyed; excess damage is lost and never reaches whoever hides behind
 * it. Cover is binary: no partial cover.
 * @interpretation Destroyed cover leaves open ground. Squares painted as cover
 * with no material use DEFAULT_COVER_MATERIAL (crates and the like).
 */
import type { Cell } from './grid.js';

export type CoverMaterialId =
  | 'thickSteel' | 'thinSteel' | 'thickStone' | 'thinStone' | 'thickBulletproofGlass' | 'thinBulletproofGlass'
  | 'thickConcrete' | 'thinConcrete' | 'thickWood' | 'thinWood' | 'thickPlaster';

export const COVER_MATERIALS: { id: CoverMaterialId; name: string; hp: number }[] = [
  { id: 'thickSteel', name: 'Thick Steel', hp: 50 },
  { id: 'thickStone', name: 'Thick Stone', hp: 40 },
  { id: 'thickBulletproofGlass', name: 'Thick Bulletproof Glass', hp: 30 },
  { id: 'thinSteel', name: 'Thin Steel', hp: 25 },
  { id: 'thickConcrete', name: 'Thick Concrete', hp: 25 },
  { id: 'thinStone', name: 'Thin Stone', hp: 20 },
  { id: 'thickWood', name: 'Thick Wood', hp: 20 },
  { id: 'thinBulletproofGlass', name: 'Thin Bulletproof Glass', hp: 15 },
  { id: 'thickPlaster', name: 'Thick Plaster, Foam or Plastic', hp: 15 },
  { id: 'thinConcrete', name: 'Thin Concrete', hp: 10 },
  { id: 'thinWood', name: 'Thin Wood', hp: 5 },
];
export const DEFAULT_COVER_MATERIAL: CoverMaterialId = 'thickWood';

export function coverMaterial(id: CoverMaterialId) {
  return COVER_MATERIALS.find((m) => m.id === id) ?? COVER_MATERIALS.find((m) => m.id === DEFAULT_COVER_MATERIAL)!;
}

/**
 * Squares a ray between two square centers passes through, excluding both
 * ends. A ray exactly through a corner yields both side squares as a `pair`
 * (it's blocked only if both are). Same traversal as `hasLineOfSight`.
 */
export type RayStep = { cell: Cell } | { pair: [Cell, Cell] };
export function raySteps(a: Cell, b: Cell): RayStep[] {
  const out: RayStep[] = [];
  if (a.x === b.x && a.y === b.y) return out;
  const dx = b.x - a.x, dy = b.y - a.y;
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const tdx = dx === 0 ? Infinity : 1 / Math.abs(dx);
  const tdy = dy === 0 ? Infinity : 1 / Math.abs(dy);
  let tx = tdx / 2, ty = tdy / 2, x = a.x, y = a.y;
  for (;;) {
    if (Math.abs(tx - ty) < 1e-9) {
      out.push({ pair: [{ x: x + sx, y }, { x, y: y + sy }] });
      x += sx; y += sy; tx += tdx; ty += tdy;
    } else if (tx < ty) { x += sx; tx += tdx; } else { y += sy; ty += tdy; }
    if (x === b.x && y === b.y) return out;
    out.push({ cell: { x, y } });
  }
}
