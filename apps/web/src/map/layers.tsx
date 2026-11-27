/**
 * SVG layers for the tactical map: light levels, light sources, drawings and
 * the incoming area attack. Each is memoized on its own inputs so camera
 * moves and hover don't rebuild them.
 */
import { memo, useMemo } from 'react';
import { lightPosition, type Annotation, type LightLevel, type LightSource, type TacticalMap } from '@cprc/session';
import { NEON, pointsOf } from './geometry.js';
import type { PendingArea } from './pendingArea.js';

const sq = (x: number, y: number, S: number) => `M${x * S},${y * S}h${S}v${S}h${-S}z`;

/**
 * Shading for dim and dark squares. `scope` 'map' shades the whole map (the
 * GM's own view); 'vision' only the squares in `vision` (fog covers the rest).
 * Dark squares a token sees anyway (Low Light, IR) get a green night-vision tint.
 */
export const LightingLayer = memo(function LightingLayer({ map, levels, vision, scope, S, nightEyes }: {
  map: Pick<TacticalMap, 'width' | 'height' | 'ambient'>; levels: Map<string, LightLevel> | null; vision: Set<string>; scope: 'map' | 'vision'; S: number;
  /** Someone in the party has Low Light or IR: tint the dark squares they see. */
  nightEyes: boolean;
}) {
  const paths = useMemo(() => {
    if (!levels) return null;
    const ambient = map.ambient ?? 'bright';
    let dim = '', dark = '', night = '';
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      const k = `${x},${y}`;
      const seen = vision.has(k);
      if (scope === 'vision' && !seen) continue;
      const lvl = levels.get(k) ?? ambient;
      if (lvl === 'dim') dim += sq(x, y, S);
      else if (lvl === 'dark') { dark += sq(x, y, S); if (seen && scope === 'vision' && nightEyes) night += sq(x, y, S); }
    }
    return { dim, dark, night };
  }, [levels, vision, scope, S, map.width, map.height, map.ambient, nightEyes]);
  if (!paths) return null;
  return (
    <g pointerEvents="none" className="light-layer">
      {paths.dim && <path d={paths.dim} fill="rgba(3,6,24,0.34)" />}
      {paths.dark && <path d={paths.dark} fill={scope === 'map' ? 'rgba(2,4,16,0.52)' : 'rgba(2,4,16,0.6)'} />}
      {paths.night && <path d={paths.night} fill="rgba(61,255,138,0.10)" />}
    </g>
  );
});

/** Light sources: a glow and a bulb; the selected one shows its bright and dim reach. */
export const LightsLayer = memo(function LightsLayer({ map, lights, S, selected, editable }: {
  map: TacticalMap; lights: Record<string, LightSource> | undefined; S: number; selected: string | null; editable: boolean;
}) {
  const list = Object.values(lights ?? {});
  if (!list.length) return null;
  return (
    <g pointerEvents="none" className="lights-layer">
      <defs>
        {Object.entries(NEON).map(([name, col]) => (
          <radialGradient key={name} id={`lg-${name}`}>
            <stop offset="0" stopColor={col} stopOpacity="0.30" />
            <stop offset="0.55" stopColor={col} stopOpacity="0.10" />
            <stop offset="1" stopColor={col} stopOpacity="0" />
          </radialGradient>
        ))}
      </defs>
      {list.map((l) => {
        const at = lightPosition(map, l);
        if (!at) return null;
        const cx = at.x * S + S / 2, cy = at.y * S + S / 2;
        const color = l.color ?? 'yellow';
        const col = NEON[color];
        const sel = selected === l.id;
        const reach = l.bright + l.dim;
        return (
          <g key={l.id}>
            {l.on && <circle cx={cx} cy={cy} r={(reach + 0.5) * S} fill={`url(#lg-${color})`} />}
            {sel && (
              <>
                <rect x={cx - (l.bright + 0.5) * S} y={cy - (l.bright + 0.5) * S} width={(2 * l.bright + 1) * S} height={(2 * l.bright + 1) * S} fill="none" stroke={col} strokeWidth={2} strokeDasharray="8 6" />
                <rect x={cx - (reach + 0.5) * S} y={cy - (reach + 0.5) * S} width={(2 * reach + 1) * S} height={(2 * reach + 1) * S} fill="none" stroke={col} strokeOpacity={0.5} strokeWidth={2} strokeDasharray="3 7" />
              </>
            )}
            {(editable || !l.attachedTo) && (
              <g transform={`translate(${l.attachedTo ? cx + S * 0.3 : cx},${l.attachedTo ? cy - S * 0.3 : cy})`}>
                <circle r={S * (l.attachedTo ? 0.12 : 0.17)} fill={l.on ? col : '#0a1030'} stroke={sel ? '#fff' : col} strokeWidth={sel ? 3 : 2} filter={l.on ? 'url(#glow)' : undefined} />
                {!l.on && <line x1={-S * 0.12} y1={-S * 0.12} x2={S * 0.12} y2={S * 0.12} stroke={col} strokeWidth={2} />}
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
});

/** Map drawings. GM-only ones are dashed so the GM can tell them apart. */
export const AnnotationLayer = memo(function AnnotationLayer({ list, S, selected, isGm, offset }: {
  list: Annotation[]; S: number; selected: string | null; isGm: boolean; offset: { id: string; dx: number; dy: number } | null;
}) {
  if (!list.length) return null;
  return (
    <g pointerEvents="none" className="annotations">
      {list.map((a) => {
        const col = NEON[a.color];
        const o = offset?.id === a.id ? offset : null;
        const pts = pointsOf(a).map((q) => ({ x: (q.x + (o?.dx ?? 0)) * S, y: (q.y + (o?.dy ?? 0)) * S }));
        const dash = isGm && a.visibility === 'gm' ? '10 6' : undefined;
        const common = { stroke: col, strokeWidth: 3, fill: 'none', strokeDasharray: dash, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, filter: 'url(#glow)' };
        const sel = selected === a.id;
        let shape: React.ReactNode = null;
        switch (a.kind) {
          case 'path': shape = <polyline points={pts.map((q) => `${q.x},${q.y}`).join(' ')} {...common} />; break;
          case 'line': shape = <line x1={pts[0]!.x} y1={pts[0]!.y} x2={pts[1]!.x} y2={pts[1]!.y} {...common} />; break;
          case 'rect': shape = <rect x={Math.min(pts[0]!.x, pts[1]!.x)} y={Math.min(pts[0]!.y, pts[1]!.y)} width={Math.abs(pts[1]!.x - pts[0]!.x)} height={Math.abs(pts[1]!.y - pts[0]!.y)} {...common} fill={`${col}14`} />; break;
          case 'circle': shape = <circle cx={pts[0]!.x} cy={pts[0]!.y} r={Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y)} {...common} fill={`${col}14`} />; break;
          case 'text': shape = (
            <text x={pts[0]!.x} y={pts[0]!.y} textAnchor="middle" dominantBaseline="central" className="ann-text" fill={col} stroke="#02040e" strokeWidth={5} paintOrder="stroke"
              strokeDasharray={undefined} opacity={dash ? 0.85 : 1}>{a.text}</text>
          ); break;
        }
        return (
          <g key={a.id} className={sel ? 'ann sel' : 'ann'}>
            {shape}
            {sel && pts.map((q, i) => (a.kind === 'path' && i > 0 && i < pts.length - 1 ? null : <circle key={i} cx={q.x} cy={q.y} r={5} fill="#fff" stroke={col} strokeWidth={2} />))}
          </g>
        );
      })}
    </g>
  );
});

/** The landing square and blast area (or shell cone) of an incoming area attack. */
export const PendingAreaLayer = memo(function PendingAreaLayer({ area, S, part, mapW }: { area: PendingArea; S: number; part: 'area' | 'label'; mapW: number }) {
  const cx = area.at.x * S + S / 2, cy = area.at.y * S + S / 2;
  const col = area.kind === 'scatter' ? '#dce6ff' : '#ff7a00';
  const box = area.kind === 'blast' || area.kind === 'scatter';
  if (part === 'label') {
    // Beside the area (right side, or left at the map's edge), drawn over the tokens.
    const half = box ? 2.5 : 0.5;
    const right = (area.at.x + 0.5 + half) * S + 100;
    const x = right + 92 < mapW ? right : (area.at.x + 0.5 - half) * S - 100;
    return (
      <g pointerEvents="none" transform={`translate(${x},${cy})`} aria-hidden>
        <rect x={-92} y={-13} width={184} height={24} rx={3} fill="rgba(3,6,20,0.92)" stroke={col} />
        <text textAnchor="middle" dy="0.35em" className="svg-label" fill={col}>{area.label}</text>
      </g>
    );
  }
  return (
    <g pointerEvents="none" className="pending-area" aria-hidden>
      {area.cells.map((c) => {
        const k = `${c.x},${c.y}`;
        const fill = area.kind === 'scatter' ? 'rgba(220,230,255,0.10)' : area.hit.has(k) ? 'rgba(255,110,0,0.34)' : 'url(#hatch)';
        return <rect key={k} x={c.x * S} y={c.y * S} width={S} height={S} fill={fill} />;
      })}
      {box && <rect x={(area.at.x - 2) * S} y={(area.at.y - 2) * S} width={S * 5} height={S * 5} fill="none" stroke={col} strokeWidth={4} strokeDasharray={area.kind === 'scatter' ? '12 8' : undefined} className="march" />}
      <circle cx={cx} cy={cy} r={S * 0.42} fill="none" stroke={col} strokeWidth={3} className="pulse" />
      <path d={`M${cx - S * 0.3},${cy}H${cx + S * 0.3}M${cx},${cy - S * 0.3}V${cy + S * 0.3}`} stroke={col} strokeWidth={3} />
    </g>
  );
});
