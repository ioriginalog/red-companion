/**
 * Fog of war layers (display only; the relay already withholds hidden tokens).
 *  - dark: squares the party has never seen. Map art is hidden there.
 *  - dim: squares seen before but not visible now.
 * Maps without an explored record (older saves) treat every square as seen.
 */
import type { TacticalMap } from '@cprc/session';

export interface FogPaths { dim: string; dark: string }

export function fogPaths(map: Pick<TacticalMap, 'width' | 'height' | 'explored'>, vision: Set<string>, S: number): FogPaths {
  const known = map.explored && map.explored.length === map.width * map.height ? map.explored : null;
  let dim = '';
  let dark = '';
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    if (vision.has(`${x},${y}`)) continue;
    const sq = `M${x * S},${y * S}h${S}v${S}h${-S}z`;
    if (known && known[y * map.width + x] !== '1') dark += sq;
    else dim += sq;
  }
  return { dim, dark };
}
