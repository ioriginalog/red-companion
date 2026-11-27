/**
 * Terrain on the Table: walls, cover by material with its damage state,
 * rubble where cover was destroyed, and difficult ground. Display only; the
 * plan (map/terrain.ts) already leaves out squares a player doesn't know.
 */
import { memo } from 'react';
import { COVER_STATE_LABEL, squareNoise, type CoverFamily, type TerrainCover, type TerrainPlan, type TerrainStyle } from './terrain.js';

export const COVER_COLORS: Record<CoverFamily, { fill: string; edge: string }> = {
  steel: { fill: '#55657f', edge: '#b9c9e6' },
  stone: { fill: '#685e55', edge: '#c2b39f' },
  concrete: { fill: '#575d68', edge: '#aab3c0' },
  wood: { fill: '#7a4c22', edge: '#e0a764' },
  glass: { fill: 'rgba(95, 224, 255, 0.22)', edge: '#8cf0ff' },
  plaster: { fill: '#8a8377', edge: '#efe6d6' },
};
const STATE_COLOR = { intact: '#3dff8a', damaged: '#ffd400', badly: '#ff3b4e' } as const;

function Texture({ f, x, y, w, h }: { f: CoverFamily; x: number; y: number; w: number; h: number }) {
  const line = { stroke: 'rgba(0, 0, 0, 0.35)', strokeWidth: 1.5 };
  switch (f) {
    case 'wood':
      return <>{[1, 2].map((i) => <line key={i} x1={x + 2} x2={x + w - 2} y1={y + (h * i) / 3} y2={y + (h * i) / 3} {...line} />)}</>;
    case 'steel':
      return <>
        <line x1={x + 3} y1={y + h - 3} x2={x + w - 3} y2={y + 3} stroke="rgba(255, 255, 255, 0.18)" strokeWidth={2} />
        {[[x + 5, y + 5], [x + w - 5, y + 5], [x + 5, y + h - 5], [x + w - 5, y + h - 5]].map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r={1.8} fill="rgba(255, 255, 255, 0.45)" />)}
      </>;
    case 'stone':
      return <>
        <line x1={x + 1} x2={x + w - 1} y1={y + h / 2} y2={y + h / 2} {...line} />
        <line x1={x + w * 0.4} x2={x + w * 0.4} y1={y + 1} y2={y + h / 2} {...line} />
        <line x1={x + w * 0.7} x2={x + w * 0.7} y1={y + h / 2} y2={y + h - 1} {...line} />
      </>;
    case 'concrete':
      return <>{[0.25, 0.6, 0.8, 0.4].map((u, i) => <circle key={i} cx={x + w * u} cy={y + h * [0.3, 0.7, 0.25, 0.55][i]!} r={1.4} fill="rgba(0, 0, 0, 0.4)" />)}</>;
    case 'glass':
      return <line x1={x + w * 0.2} y1={y + h * 0.75} x2={x + w * 0.55} y2={y + h * 0.2} stroke="rgba(255, 255, 255, 0.55)" strokeWidth={2} strokeLinecap="round" />;
    default:
      return null;
  }
}

/** A zigzag crack across the square; `n` picks the variant. */
function crack(c: TerrainCover, S: number, n: number): string {
  const x0 = c.x * S, y0 = c.y * S;
  const r = (i: number) => squareNoise(c.x, c.y, n * 10 + i);
  const pts: [number, number][] = [];
  const steps = 4;
  const fromTop = n % 2 === 0;
  for (let i = 0; i <= steps; i++) {
    const t = 0.15 + (0.7 * i) / steps;
    const j = (r(i) - 0.5) * 0.3;
    pts.push(fromTop ? [x0 + S * (0.3 + 0.4 * r(9) + j), y0 + S * t] : [x0 + S * t, y0 + S * (0.3 + 0.4 * r(9) + j)]);
  }
  return `M${pts.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join('L')}`;
}

function CoverSquare({ c, S, style }: { c: TerrainCover; S: number; style: TerrainStyle }) {
  const col = COVER_COLORS[c.family];
  const inset = c.thick ? S * 0.1 : S * 0.2;
  const x = c.x * S + inset, y = c.y * S + inset, w = S - inset * 2;
  const worn = c.state !== 'intact';
  return (
    <g data-cover={c.material} data-state={c.state} opacity={c.state === 'badly' ? 0.85 : 1}>
      <title>{`${c.name} Cover · ${COVER_STATE_LABEL[c.state]}`}</title>
      {style === 'full' ? (
        <>
          <rect x={x} y={y} width={w} height={w} rx={3} fill={col.fill} stroke={col.edge} strokeWidth={c.thick ? 2 : 1.5} />
          <Texture f={c.family} x={x} y={y} w={w} h={w} />
        </>
      ) : (
        <rect x={x} y={y} width={w} height={w} rx={3} fill="none" stroke={col.edge} strokeOpacity={0.6} strokeWidth={1.5} strokeDasharray={c.thick ? undefined : '5 4'} />
      )}
      {worn && <path d={crack(c, S, 0)} fill="none" stroke="#05070f" strokeWidth={3} strokeLinejoin="round" />}
      {worn && <path d={crack(c, S, 0)} fill="none" stroke={STATE_COLOR[c.state]} strokeWidth={1.2} strokeLinejoin="round" opacity={0.9} />}
      {c.state === 'badly' && <path d={crack(c, S, 1)} fill="none" stroke="#05070f" strokeWidth={3} strokeLinejoin="round" />}
      {c.state === 'badly' && <path d={crack(c, S, 1)} fill="none" stroke={STATE_COLOR.badly} strokeWidth={1.2} strokeLinejoin="round" />}
      {c.frac !== undefined && c.frac < 1 && (
        <>
          <rect x={c.x * S + 4} y={c.y * S + S - 8} width={S - 8} height={4} fill="rgba(3, 6, 20, 0.85)" />
          <rect x={c.x * S + 4} y={c.y * S + S - 8} width={(S - 8) * c.frac} height={4} fill={STATE_COLOR[c.state]} />
        </>
      )}
    </g>
  );
}

/** Broken debris over the square, opaque enough to cover crates painted on the art. */
function Rubble({ x, y, S }: { x: number; y: number; S: number }) {
  const cx = x * S + S / 2, cy = y * S + S / 2;
  const r = (i: number) => squareNoise(x, y, i);
  const blob = Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * Math.PI * 2;
    const d = S * (0.36 + r(i) * 0.1);
    return `${(cx + Math.cos(a) * d).toFixed(1)},${(cy + Math.sin(a) * d).toFixed(1)}`;
  });
  const chips = Array.from({ length: 6 }, (_, i) => {
    const px = x * S + S * (0.2 + r(20 + i) * 0.6), py = y * S + S * (0.2 + r(40 + i) * 0.6), k = S * (0.05 + r(60 + i) * 0.05);
    return `M${(px - k).toFixed(1)},${(py + k * 0.6).toFixed(1)}L${(px + k * 0.2).toFixed(1)},${(py - k).toFixed(1)}L${(px + k).toFixed(1)},${(py + k * 0.4).toFixed(1)}Z`;
  });
  return (
    <g data-rubble={`${x},${y}`}>
      <title>Destroyed Cover · Open Ground</title>
      <polygon points={blob.join(' ')} fill="rgba(9, 11, 22, 0.88)" stroke="rgba(150, 160, 190, 0.35)" strokeWidth={1} strokeDasharray="3 3" />
      {chips.map((d, i) => <path key={i} d={d} fill={i % 2 ? '#4b5164' : '#6a6f80'} stroke="#1a1e30" strokeWidth={0.8} />)}
    </g>
  );
}

export const TerrainLayer = memo(function TerrainLayer({ plan, S, style }: { plan: TerrainPlan; S: number; style: TerrainStyle }) {
  const full = style === 'full';
  return (
    <g className={`terrain terrain-${style}`} pointerEvents="none" aria-hidden>
      <defs>
        <pattern id="terrain-difficult" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
          <line x1="0" y1="0" x2="0" y2="10" stroke="#ffd400" strokeWidth="2" strokeOpacity="0.55" />
        </pattern>
        <pattern id="terrain-wall" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="16" stroke="#2c3874" strokeWidth="3" />
        </pattern>
      </defs>
      {plan.difficult && <path d={plan.difficult} fill="url(#terrain-difficult)" opacity={full ? 0.7 : 0.4} />}
      {full && plan.walls && <path d={plan.walls} fill="#1a2250" />}
      {full && plan.walls && <path d={plan.walls} fill="url(#terrain-wall)" />}
      {plan.wallEdges && <path d={plan.wallEdges} fill="none" stroke="#22e3ff" strokeOpacity={full ? 0.6 : 0.3} strokeWidth={full ? 2 : 1.5} strokeLinecap="square" />}
      {plan.rubble.map((c) => <Rubble key={`${c.x},${c.y}`} x={c.x} y={c.y} S={S} />)}
      {plan.cover.map((c) => <CoverSquare key={`${c.x},${c.y}`} c={c} S={S} style={style} />)}
    </g>
  );
});
