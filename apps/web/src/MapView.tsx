import { useMemo, useRef, useState } from 'react';
import { bearing, cellKey, findPath, type Cell } from '@cprc/rules-core';
import type { ViewState } from '@cprc/session';
import { isFriendly, moveRings, occupancy, partyVision, watchCells, wedgePath, type Attack } from './tactics.js';
import { pct } from './odds.js';

export type MapMode = 'move' | 'watch' | 'place';

interface Props {
  view: ViewState;
  isGm: boolean;
  /** Actor whose options are drawn (move rings, targeting cone). */
  actingId: string | null;
  canAct: boolean;
  targetId: string | null;
  attack: Attack | null;
  /** Hit chance per visible enemy, for badges. */
  chances: Record<string, number | null>;
  mode: MapMode;
  partyFog: boolean;
  onCell: (c: Cell, opts: { run: boolean }) => void;
  onToken: (id: string) => void;
  onWatchFacing: (deg: number) => void;
}

const COLOR = { party: 'var(--party)', ally: 'var(--ally)', neutral: 'var(--neutral)', hostile: 'var(--hostile)' } as const;

export function MapView(p: Props) {
  const { view, actingId, mode } = p;
  const map = view.map!;
  const S = map.cellPx;
  const W = map.width * S;
  const H = map.height * S;
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Cell | null>(null);

  const vision = useMemo(() => partyVision(view), [view.map, view.actors]);
  const showFog = !p.isGm || p.partyFog;
  const rings = useMemo(() => (actingId && p.canAct ? moveRings(view, actingId) : null), [view, actingId, p.canAct]);
  const actingAt = actingId ? map.tokens[actingId] : undefined;

  const fogPath = useMemo(() => {
    if (!showFog) return '';
    let d = '';
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      if (!vision.has(`${x},${y}`)) d += `M${x * S},${y * S}h${S}v${S}h${-S}z`;
    }
    return d;
  }, [vision, showFog, map.width, map.height, S]);

  const cellAt = (ev: React.PointerEvent): Cell | null => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const pt = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
    const c = { x: Math.floor(pt.x / S), y: Math.floor(pt.y / S) };
    return c.x >= 0 && c.y >= 0 && c.x < map.width && c.y < map.height ? c : null;
  };

  const path = useMemo(() => {
    if (!hover || !actingAt || mode !== 'move' || !rings) return null;
    const k = cellKey(hover);
    if (!rings.move.has(k) && !rings.run.has(k)) return null;
    return findPath(map, actingAt, hover, 999, occupancy(view, actingId!))?.path ?? null;
  }, [hover, actingAt, mode, rings, map, view, actingId]);

  const watchPreview = mode === 'watch' && hover && actingAt && (hover.x !== actingAt.x || hover.y !== actingAt.y)
    ? { facing: bearing(actingAt, hover), arc: 90, range: map.sightRange }
    : null;
  const previewCells = useMemo(() => (watchPreview && actingAt ? watchCells(map, actingAt, watchPreview) : null), [watchPreview?.facing, actingAt, map]);

  const center = (c: Cell) => ({ x: c.x * S + S / 2, y: c.y * S + S / 2 });
  const target = p.targetId ? map.tokens[p.targetId] : undefined;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${map.name} tactical map`}
      onPointerMove={(e) => setHover(cellAt(e))}
      onPointerLeave={() => setHover(null)}
      onClick={(e) => {
        const c = cellAt(e as unknown as React.PointerEvent);
        if (!c) return;
        if (mode === 'watch' && actingAt) { if (c.x !== actingAt.x || c.y !== actingAt.y) p.onWatchFacing(bearing(actingAt, c)); return; }
        const tok = Object.entries(map.tokens).find(([, t]) => t.x === c.x && t.y === c.y);
        if (tok && mode !== 'place') { p.onToken(tok[0]); return; }
        p.onCell(c, { run: !!rings?.run.has(cellKey(c)) });
      }}
    >
      <defs>
        {Object.keys(map.tokens).map((id) => (
          <clipPath key={id} id={`clip-${id}`}><circle cx={0} cy={0} r={S * 0.4} /></clipPath>
        ))}
        <linearGradient id="cone" x1="0" x2="1">
          <stop offset="0" stopColor="#22e3ff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#22e3ff" stopOpacity="0.08" />
        </linearGradient>
        <filter id="glow"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        <filter id="gray"><feColorMatrix type="saturate" values="0" /></filter>
      </defs>

      {map.background ? <image href={map.background} x={0} y={0} width={W} height={H} preserveAspectRatio="none" /> : <rect width={W} height={H} fill="#0b1230" />}

      {/* Grid */}
      <g stroke="rgba(120,160,255,0.13)" strokeWidth={1}>
        {Array.from({ length: map.width + 1 }, (_, x) => <line key={`x${x}`} x1={x * S} y1={0} x2={x * S} y2={H} />)}
        {Array.from({ length: map.height + 1 }, (_, y) => <line key={`y${y}`} x1={0} y1={y * S} x2={W} y2={y * S} />)}
      </g>

      {/* Movement rings: cyan = Move, yellow = Run (uses the Action). */}
      {rings && mode === 'move' && (
        <g>
          {[...rings.run.keys()].map((k) => { const [x, y] = k.split(',').map(Number); return <rect key={k} x={x! * S + 2} y={y! * S + 2} width={S - 4} height={S - 4} fill="rgba(255,212,0,0.13)" stroke="rgba(255,212,0,0.5)" strokeWidth={1} />; })}
          {[...rings.move.keys()].map((k) => { const [x, y] = k.split(',').map(Number); return <rect key={k} x={x! * S + 2} y={y! * S + 2} width={S - 4} height={S - 4} fill="rgba(34,227,255,0.16)" stroke="rgba(34,227,255,0.6)" strokeWidth={1} />; })}
        </g>
      )}

      {/* Watch cones: magenta for the party; hostile watches only reach the GM. */}
      {Object.entries(map.watches).map(([id, w]) => {
        const at = map.tokens[id];
        const a = view.actors[id];
        if (!at || !a) return null;
        const c = center(at);
        const col = isFriendly(a) ? '#ff2bd6' : '#ff3b4e';
        return (
          <g key={`w-${id}`} pointerEvents="none">
            {[...watchCells(map, at, w)].map((k) => { const [x, y] = k.split(',').map(Number); return <rect key={k} x={x! * S} y={y! * S} width={S} height={S} fill={col} opacity={0.12} />; })}
            <path d={wedgePath(c.x, c.y, w.facing, w.arc, w.range * S)} fill="none" stroke={col} strokeWidth={2} strokeDasharray="10 8" opacity={0.8} className="march" />
          </g>
        );
      })}
      {watchPreview && previewCells && actingAt && (
        <g pointerEvents="none">
          {[...previewCells].map((k) => { const [x, y] = k.split(',').map(Number); return <rect key={k} x={x! * S} y={y! * S} width={S} height={S} fill="#ff2bd6" opacity={0.2} />; })}
          <path d={wedgePath(center(actingAt).x, center(actingAt).y, watchPreview.facing, 90, watchPreview.range * S)} fill="none" stroke="#ff2bd6" strokeWidth={3} />
        </g>
      )}

      {/* Fog of war */}
      {showFog && <path d={fogPath} fill={p.isGm ? 'rgba(2,4,14,0.5)' : 'rgba(2,4,14,0.78)'} pointerEvents="none" />}

      {/* Path preview */}
      {path && actingAt && (
        <polyline
          points={[actingAt, ...path].map((c) => `${center(c).x},${center(c).y}`).join(' ')}
          fill="none" stroke={rings?.run.has(cellKey(path[path.length - 1]!)) ? '#ffd400' : '#22e3ff'} strokeWidth={4} strokeDasharray="2 10" strokeLinecap="round" pointerEvents="none"
        />
      )}

      {/* Targeting cone */}
      {actingAt && target && p.attack && (() => {
        const a = center(actingAt), b = center(target);
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const half = Math.max(5, (Math.atan2(S * 0.55, dist) * 180) / Math.PI);
        const facing = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
        const blocked = !p.attack.ok;
        return (
          <g pointerEvents="none">
            <path d={wedgePath(a.x, a.y, facing, half * 2, dist + S * 0.45)} fill={blocked ? 'rgba(255,43,214,0.18)' : 'url(#cone)'} transform={`rotate(0)`} />
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={blocked ? '#ff2bd6' : '#22e3ff'} strokeWidth={2} strokeDasharray="8 6" className="march" />
            <circle cx={b.x} cy={b.y} r={S * 0.5} fill="none" stroke={blocked ? '#ff2bd6' : '#ffd400'} strokeWidth={3} filter="url(#glow)" />
          </g>
        );
      })()}

      {/* Tokens */}
      {Object.entries(map.tokens).map(([id, at]) => {
        const a = view.actors[id];
        if (!a) return null;
        const c = center(at);
        const active = view.encounter.active && view.encounter.order[view.encounter.turnIndex] === id;
        const col = active ? 'var(--yellow)' : COLOR[a.public.allegiance];
        const dead = a.public.conditions.dead;
        const chance = p.chances[id];
        const ws = a.public.woundState;
        return (
          <g key={id} transform={`translate(${c.x},${c.y})`} style={{ cursor: 'pointer' }}>
            {active && <circle r={S * 0.5} fill="none" stroke="var(--yellow)" strokeWidth={3} className="pulse" filter="url(#glow)" />}
            <circle r={S * 0.44} fill="#070b1f" stroke={col} strokeWidth={4} />
            {a.public.portrait
              ? <image href={a.public.portrait} x={-S * 0.4} y={-S * 0.4} width={S * 0.8} height={S * 0.8} clipPath={`url(#clip-${id})`} filter={dead ? 'url(#gray)' : undefined} opacity={dead ? 0.6 : 1} />
              : <text textAnchor="middle" dy="0.35em" fontFamily="Barlow Condensed" fontWeight={700} fontSize={S * 0.42} fill={col}>{a.public.name.slice(0, 1)}</text>}
            {dead && <path d={`M${-S * 0.3},${-S * 0.3}L${S * 0.3},${S * 0.3}M${S * 0.3},${-S * 0.3}L${-S * 0.3},${S * 0.3}`} stroke="var(--red)" strokeWidth={5} />}
            {ws !== 'unhurt' && !dead && <circle cx={S * 0.32} cy={-S * 0.32} r={7} fill={ws === 'mortally' ? 'var(--red)' : ws === 'seriously' ? '#ff8a00' : 'var(--yellow)'} stroke="#000" strokeWidth={2} />}
            <g transform={`translate(0,${S * 0.58})`}>
              <rect x={-S * 0.62} y={-9} width={S * 1.24} height={17} rx={2} fill="rgba(3,6,20,0.85)" stroke={col} strokeWidth={1} />
              <text textAnchor="middle" dy="0.32em" fontFamily="Barlow Condensed" fontWeight={700} fontSize={13} fill="#fff" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {a.public.name.length > 12 ? `${a.public.name.slice(0, 11)}…` : a.public.name}
              </text>
            </g>
            {chance != null && (
              <g transform={`translate(0,${-S * 0.66})`}>
                <rect x={-24} y={-11} width={48} height={20} rx={3} fill={p.targetId === id ? '#ffd400' : 'rgba(10,16,48,0.92)'} stroke="#ffd400" strokeWidth={1.5} />
                <text textAnchor="middle" dy="0.33em" fontFamily="Barlow Condensed" fontWeight={700} fontSize={15} fill={p.targetId === id ? '#111' : '#ffd400'}>{pct(chance)}</text>
              </g>
            )}
          </g>
        );
      })}

      {hover && mode !== 'watch' && <rect x={hover.x * S} y={hover.y * S} width={S} height={S} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={2} pointerEvents="none" />}
    </svg>
  );
}
