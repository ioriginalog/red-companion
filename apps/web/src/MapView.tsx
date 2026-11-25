import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bearing, cellKey, findPath, gridDistance, hasLineOfSight, type Cell } from '@cprc/rules-core';
import type { Signal, ViewState } from '@cprc/session';
import { isFriendly, moveRings, occupancy, partyVision, watchCells, wedgePath, type Attack } from './tactics.js';
import { pct } from './odds.js';
import { PING_MS, type Signals } from './net.js';
import { blastCells, shellCells, tokensIn, type AreaKind } from './table/area.js';
import { clampBox, fitBox, panBy, reaspect, zoomAt, type Box } from './table/viewport.js';
import { EFFECT_MS, type Effect } from './table/effects.js';

export type MapMode = 'move' | 'watch' | 'place' | 'ruler' | 'area' | 'reveal';

interface Props {
  view: ViewState;
  isGm: boolean;
  actingId: string | null;
  canAct: boolean;
  targetId: string | null;
  attack: Attack | null;
  chances: Record<string, number | null>;
  mode: MapMode;
  areaKind: AreaKind | null;
  partyFog: boolean;
  focusId: string | null;
  highlight: string[];
  /** Broadcast this viewer's cursor. Off for the GM by default: hovering hidden tokens would reveal them. */
  shareCursor: boolean;
  signals: Signals;
  effects: Effect[];
  nameOf: (from: string) => string;
  canDrag: (id: string) => boolean;
  onCell: (c: Cell, opts: { run: boolean }) => void;
  onToken: (id: string) => void;
  onTokenContext: (id: string) => void;
  onDrop: (id: string, c: Cell, opts: { run: boolean }) => void;
  onWatchFacing: (deg: number) => void;
  onArea: (at: Cell) => void;
  onReveal: (cells: string[], add: boolean) => void;
  onSignal: (s: Signal) => void;
}

const COLOR = { party: 'var(--party)', ally: 'var(--ally)', neutral: 'var(--neutral)', hostile: 'var(--hostile)' } as const;
const SIGNAL_COLORS = ['#22e3ff', '#3dff8a', '#b46bff', '#ff9d2b', '#ff2bd6', '#7cf'];
const colorFor = (from: string) => (from === 'me' ? '#ffd400' : from === 'gm' ? '#ff2bd6' : SIGNAL_COLORS[[...from].reduce((s, c) => s + c.charCodeAt(0), 0) % SIGNAL_COLORS.length]!);

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; box: Box; moved: boolean; cell: Cell | null }
  | { kind: 'drag'; id: string; start: Cell; moved: boolean }
  | { kind: 'pinch'; dist: number; box: Box; mid: { x: number; y: number } }
  | { kind: 'ruler'; from: Cell }
  | { kind: 'reveal'; add: boolean; cells: Set<string> };

export function MapView(p: Props) {
  const { view, actingId, mode } = p;
  const map = view.map!;
  const S = map.cellPx;
  const W = map.width * S;
  const H = map.height * S;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [aspect, setAspect] = useState(1.5);
  const [box, setBox] = useState<Box>(() => fitBox(W, H, 1.5));
  const [hover, setHover] = useState<Cell | null>(null);
  const [dragTo, setDragTo] = useState<{ id: string; at: Cell } | null>(null);
  const [ruler, setRuler] = useState<{ from: Cell; to: Cell } | null>(null);
  const [revealDraft, setRevealDraft] = useState<{ add: boolean; cells: Set<string> } | null>(null);
  const [, setTick] = useState(0);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const longPress = useRef<number | null>(null);
  const consumed = useRef(false);

  // Track the container's aspect so the viewBox never letterboxes.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const r = e!.contentRect;
      if (r.width < 10 || r.height < 10) return;
      const a = r.width / r.height;
      setAspect(a);
      setBox((b) => reaspect(b, a));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fit = useCallback(() => setBox(fitBox(W, H, aspect)), [W, H, aspect]);
  // Refit when a new map loads.
  useEffect(() => { fit(); }, [map.id, W, H]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-render while time-based overlays (pings, effects) are alive.
  const alive = p.signals.pings.length > 0 || p.effects.length > 0;
  useEffect(() => {
    if (!alive) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 250);
    return () => window.clearInterval(t);
  }, [alive]);

  // Leaving ruler mode clears your shared measurement.
  useEffect(() => {
    if (mode !== 'ruler' && ruler) { setRuler(null); p.onSignal({ kind: 'measure', from: ruler.from, to: null }); }
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const vision = useMemo(() => partyVision(view), [view.map, view.actors]);
  const showFog = !p.isGm || p.partyFog;
  const rings = useMemo(() => (actingId && p.canAct ? moveRings(view, actingId) : null), [view, actingId, p.canAct]);
  const actingAt = actingId ? map.tokens[actingId] : undefined;
  const revealed = useMemo(() => new Set(map.lighting?.revealed ?? []), [map.lighting]);

  const fogPath = useMemo(() => {
    if (!showFog) return '';
    let d = '';
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      if (!vision.has(`${x},${y}`)) d += `M${x * S},${y * S}h${S}v${S}h${-S}z`;
    }
    return d;
  }, [vision, showFog, map.width, map.height, S]);

  const toMap = (clientX: number, clientY: number) => {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return null;
    return new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
  };
  const cellAtClient = (clientX: number, clientY: number): Cell | null => {
    const pt = toMap(clientX, clientY);
    if (!pt) return null;
    const c = { x: Math.floor(pt.x / S), y: Math.floor(pt.y / S) };
    return c.x >= 0 && c.y >= 0 && c.x < map.width && c.y < map.height ? c : null;
  };
  const tokenAt = (c: Cell | null) => (c ? Object.entries(map.tokens).find(([, t]) => t.x === c.x && t.y === c.y)?.[0] ?? null : null);
  const runAt = (c: Cell) => !!rings?.run.has(cellKey(c));

  // Wheel zoom (non-passive so the page doesn't scroll).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const pt = toMap(e.clientX, e.clientY);
      if (!pt) return;
      const factor = Math.exp(-e.deltaY * 0.0015);
      setBox((b) => clampBox(zoomAt(b, factor, pt.x, pt.y, S * 4, W * 2.5), W, H));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }); // rebinding each render keeps S/W/H fresh; cheap

  const zoomButton = (factor: number) => setBox((b) => clampBox(zoomAt(b, factor, b.x + b.w / 2, b.y + b.h / 2, S * 4, W * 2.5), W, H));

  const click = (c: Cell) => {
    if (mode === 'watch' && actingAt) { if (c.x !== actingAt.x || c.y !== actingAt.y) p.onWatchFacing(bearing(actingAt, c)); return; }
    if (mode === 'area') { p.onArea(c); return; }
    const tok = tokenAt(c);
    if (tok && mode !== 'place') { p.onToken(tok); return; }
    p.onCell(c, { run: runAt(c) });
  };

  const clearLong = () => { if (longPress.current) { window.clearTimeout(longPress.current); longPress.current = null; } };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button === 2) return;
    svgRef.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    consumed.current = false;
    if (pointers.current.size === 2) {
      clearLong();
      const [a, b] = [...pointers.current.values()];
      const mid = toMap((a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
      gesture.current = { kind: 'pinch', dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), box, mid: mid ? { x: mid.x, y: mid.y } : { x: box.x + box.w / 2, y: box.y + box.h / 2 } };
      return;
    }
    const c = cellAtClient(e.clientX, e.clientY);
    if (e.altKey && c) { p.onSignal({ kind: 'ping', at: c }); consumed.current = true; return; }
    clearLong();
    if (c) {
      longPress.current = window.setTimeout(() => {
        consumed.current = true;
        gesture.current = null;
        p.onSignal({ kind: 'ping', at: c });
      }, 550);
    }
    const tok = tokenAt(c);
    if (mode === 'ruler' && c) { gesture.current = { kind: 'ruler', from: c }; setRuler({ from: c, to: c }); return; }
    if (mode === 'reveal' && p.isGm && c) {
      const add = !revealed.has(cellKey(c));
      const cells = new Set([cellKey(c)]);
      gesture.current = { kind: 'reveal', add, cells };
      setRevealDraft({ add, cells });
      return;
    }
    if (tok && c && (mode === 'move' || mode === 'place') && p.canDrag(tok)) { gesture.current = { kind: 'drag', id: tok, start: c, moved: false }; return; }
    gesture.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, box, moved: false, cell: c };
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const c = cellAtClient(e.clientX, e.clientY);
    if (!hover || !c || hover.x !== c.x || hover.y !== c.y) {
      setHover(c);
      if (p.shareCursor) p.onSignal({ kind: 'cursor', at: c });
    }
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch' && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      setBox(clampBox(zoomAt(g.box, d / g.dist, g.mid.x, g.mid.y, S * 4, W * 2.5), W, H));
      return;
    }
    if (g.kind === 'pan') {
      const rect = svgRef.current!.getBoundingClientRect();
      const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
      if (!g.moved && Math.hypot(dx, dy) > 6) { g.moved = true; clearLong(); }
      if (g.moved) setBox(clampBox(panBy(g.box, (-dx * g.box.w) / rect.width, (-dy * g.box.h) / rect.height), W, H));
      return;
    }
    if (!c) return;
    if (g.kind === 'drag') {
      if (c.x !== g.start.x || c.y !== g.start.y) { g.moved = true; clearLong(); }
      setDragTo(g.moved ? { id: g.id, at: c } : null);
    } else if (g.kind === 'ruler') {
      clearLong();
      setRuler({ from: g.from, to: c });
      p.onSignal({ kind: 'measure', from: g.from, to: c });
    } else if (g.kind === 'reveal') {
      clearLong();
      g.cells.add(cellKey(c));
      setRevealDraft({ add: g.add, cells: new Set(g.cells) });
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    clearLong();
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    const c = cellAtClient(e.clientX, e.clientY);
    if (g?.kind === 'pinch') { if (pointers.current.size < 2) gesture.current = null; return; }
    gesture.current = null;
    setDragTo(null);
    if (consumed.current) { consumed.current = false; setRevealDraft(null); return; }
    if (!g) return;
    if (g.kind === 'pan') { if (!g.moved && g.cell) click(g.cell); return; }
    if (g.kind === 'drag') {
      if (g.moved && c && (c.x !== g.start.x || c.y !== g.start.y)) p.onDrop(g.id, c, { run: runAt(c) });
      else click(g.start);
      return;
    }
    if (g.kind === 'ruler') {
      if (c && c.x === g.from.x && c.y === g.from.y) { setRuler(null); p.onSignal({ kind: 'measure', from: g.from, to: null }); }
      return;
    }
    if (g.kind === 'reveal') { p.onReveal([...g.cells], g.add); setRevealDraft(null); }
  };

  const dragPath = useMemo(() => {
    const from = dragTo ? map.tokens[dragTo.id] : null;
    if (!dragTo || !from) return null;
    return findPath(map, from, dragTo.at, 999, occupancy(view, dragTo.id))?.path ?? null;
  }, [dragTo, map, view]);

  const hoverPath = useMemo(() => {
    if (dragTo || !hover || !actingAt || mode !== 'move' || !rings) return null;
    const k = cellKey(hover);
    if (!rings.move.has(k) && !rings.run.has(k)) return null;
    return findPath(map, actingAt, hover, 999, occupancy(view, actingId!))?.path ?? null;
  }, [hover, actingAt, mode, rings, map, view, actingId, dragTo]);
  const path = dragPath ?? hoverPath;
  const pathFrom = dragTo ? map.tokens[dragTo.id] : actingAt;

  const watchPreview = mode === 'watch' && hover && actingAt && (hover.x !== actingAt.x || hover.y !== actingAt.y)
    ? { facing: bearing(actingAt, hover), arc: 90, range: map.sightRange }
    : null;
  const previewCells = useMemo(() => (watchPreview && actingAt ? watchCells(map, actingAt, watchPreview) : null), [watchPreview?.facing, actingAt, map]); // eslint-disable-line react-hooks/exhaustive-deps

  const template = useMemo(() => {
    if (mode !== 'area' || !hover || !p.areaKind || !actingAt) return null;
    if (p.areaKind === 'blast') {
      const b = blastCells(map, hover);
      return { kind: 'blast' as const, all: b.all, hit: b.hit, ids: tokensIn(map.tokens, b.hit), clear: hasLineOfSight(map, actingAt, hover) };
    }
    const hit = shellCells(map, actingAt, hover);
    return { kind: 'shell' as const, all: [] as Cell[], hit, ids: tokensIn(map.tokens, hit, actingId ?? undefined), clear: true };
  }, [mode, hover, p.areaKind, actingAt, map, actingId]);

  const center = (c: Cell) => ({ x: c.x * S + S / 2, y: c.y * S + S / 2 });
  const target = p.targetId ? map.tokens[p.targetId] : undefined;
  const now = Date.now();
  const highlight = new Set([...p.highlight, ...(template?.ids ?? [])]);

  const cellRects = (keys: Iterable<string>, fill: string, extra: React.SVGProps<SVGRectElement> = {}) =>
    [...keys].map((k) => { const [x, y] = k.split(',').map(Number); return <rect key={k} x={x! * S} y={y! * S} width={S} height={S} fill={fill} {...extra} />; });

  const measureLabel = (a: Cell, b: Cell) => { const sq = gridDistance(a, b); return `${sq} sq · ${sq * 2} m`; };

  return (
    <div className="mapstage" ref={wrapRef}>
      <svg
        ref={svgRef}
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${map.name} tactical map`}
        className={`mode-${mode}${gesture.current?.kind === 'pan' && (gesture.current as { moved: boolean }).moved ? ' panning' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={(e) => { pointers.current.delete(e.pointerId); gesture.current = null; clearLong(); setDragTo(null); }}
        onPointerLeave={() => { setHover(null); if (p.shareCursor) p.onSignal({ kind: 'cursor', at: null }); }}
        onContextMenu={(e) => {
          e.preventDefault();
          const tok = tokenAt(cellAtClient(e.clientX, e.clientY));
          if (tok) p.onTokenContext(tok);
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
          <pattern id="hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="12" height="12" fill="rgba(255,212,0,0.08)" /><line x1="0" y1="0" x2="0" y2="12" stroke="rgba(255,212,0,0.45)" strokeWidth="3" />
          </pattern>
        </defs>

        <rect x={-W} y={-H} width={W * 3} height={H * 3} fill="#03050f" />
        {map.background ? <image href={map.background} x={0} y={0} width={W} height={H} preserveAspectRatio="none" /> : <rect width={W} height={H} fill="#0b1230" />}

        <g stroke="rgba(120,160,255,0.13)" strokeWidth={1}>
          {Array.from({ length: map.width + 1 }, (_, x) => <line key={`x${x}`} x1={x * S} y1={0} x2={x * S} y2={H} />)}
          {Array.from({ length: map.height + 1 }, (_, y) => <line key={`y${y}`} x1={0} y1={y * S} x2={W} y2={y * S} />)}
        </g>

        {/* Movement rings: cyan = Move, yellow = Run (uses the Action). */}
        {rings && (mode === 'move' || dragTo) && (
          <g pointerEvents="none">
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
              {cellRects(watchCells(map, at, w), col, { opacity: 0.12 })}
              <path d={wedgePath(c.x, c.y, w.facing, w.arc, w.range * S)} fill="none" stroke={col} strokeWidth={2} strokeDasharray="10 8" opacity={0.8} className="march" />
            </g>
          );
        })}
        {watchPreview && previewCells && actingAt && (
          <g pointerEvents="none">
            {cellRects(previewCells, '#ff2bd6', { opacity: 0.2 })}
            <path d={wedgePath(center(actingAt).x, center(actingAt).y, watchPreview.facing, 90, watchPreview.range * S)} fill="none" stroke="#ff2bd6" strokeWidth={3} />
          </g>
        )}

        {/* GM lighting: revealed squares, and the reveal brush. */}
        {p.isGm && (mode === 'reveal' || p.partyFog) && revealed.size > 0 && <g pointerEvents="none">{cellRects(revealed, 'rgba(255,212,0,0.10)', { stroke: 'rgba(255,212,0,0.35)', strokeWidth: 1 })}</g>}
        {revealDraft && <g pointerEvents="none">{cellRects(revealDraft.cells, revealDraft.add ? 'rgba(255,212,0,0.35)' : 'rgba(255,59,78,0.35)')}</g>}

        {/* Area template */}
        {template && (
          <g pointerEvents="none">
            {template.kind === 'blast' && hover && (
              <>
                {template.all.map((c) => <rect key={cellKey(c)} x={c.x * S} y={c.y * S} width={S} height={S} fill={template.hit.has(cellKey(c)) ? 'rgba(255,120,0,0.32)' : 'url(#hatch)'} />)}
                <rect x={(hover.x - 2) * S} y={(hover.y - 2) * S} width={S * 5} height={S * 5} fill="none" stroke={template.clear ? '#ffd400' : '#ff2bd6'} strokeWidth={3} strokeDasharray="12 6" className="march" />
                <circle cx={center(hover).x} cy={center(hover).y} r={S * 0.2} fill={template.clear ? '#ffd400' : '#ff2bd6'} />
              </>
            )}
            {template.kind === 'shell' && cellRects(template.hit, 'rgba(255,120,0,0.32)', { stroke: 'rgba(255,212,0,0.6)', strokeWidth: 1 })}
          </g>
        )}

        {showFog && <path d={fogPath} fill={p.isGm ? 'rgba(2,4,14,0.5)' : 'rgba(2,4,14,0.78)'} pointerEvents="none" />}

        {path && pathFrom && (
          <g pointerEvents="none">
            <polyline
              points={[pathFrom, ...path].map((c) => `${center(c).x},${center(c).y}`).join(' ')}
              fill="none" stroke={runAt(path[path.length - 1]!) ? '#ffd400' : '#22e3ff'} strokeWidth={4} strokeDasharray="2 10" strokeLinecap="round"
            />
            {dragTo && (() => {
              const g = center(dragTo.at);
              return <circle cx={g.x} cy={g.y} r={S * 0.44} fill="rgba(7,11,31,0.6)" stroke={runAt(dragTo.at) ? '#ffd400' : '#22e3ff'} strokeWidth={3} strokeDasharray="8 5" />;
            })()}
            {dragTo && (() => {
              const end = center(path[path.length - 1]!);
              const cost = path.length;
              return (
                <g transform={`translate(${end.x},${end.y - S * 0.75})`}>
                  <rect x={-34} y={-12} width={68} height={22} rx={3} fill="rgba(3,6,20,0.92)" stroke={runAt(path[path.length - 1]!) ? '#ffd400' : '#22e3ff'} />
                  <text textAnchor="middle" dy="0.35em" className="svg-label">{`${cost} sq · ${cost * 2} m`}</text>
                </g>
              );
            })()}
          </g>
        )}

        {actingAt && target && p.attack && mode !== 'area' && (() => {
          const a = center(actingAt), b = center(target);
          const dist = Math.hypot(b.x - a.x, b.y - a.y);
          const half = Math.max(5, (Math.atan2(S * 0.55, dist) * 180) / Math.PI);
          const facing = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
          const blocked = !p.attack.ok;
          return (
            <g pointerEvents="none">
              <path d={wedgePath(a.x, a.y, facing, half * 2, dist + S * 0.45)} fill={blocked ? 'rgba(255,43,214,0.18)' : 'url(#cone)'} />
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={blocked ? '#ff2bd6' : '#22e3ff'} strokeWidth={2} strokeDasharray="8 6" className="march" />
              <circle cx={b.x} cy={b.y} r={S * 0.5} fill="none" stroke={blocked ? '#ff2bd6' : '#ffd400'} strokeWidth={3} filter="url(#glow)" />
            </g>
          );
        })()}

        {/* Tokens */}
        {Object.entries(map.tokens).map(([id, at0]) => {
          const a = view.actors[id];
          if (!a) return null;
          const at = dragTo?.id === id ? at0 : at0;
          const c = center(at);
          const active = view.encounter.active && view.encounter.order[view.encounter.turnIndex] === id;
          const col = active ? 'var(--yellow)' : COLOR[a.public.allegiance];
          const dead = a.public.conditions.dead;
          const chance = p.chances[id];
          const ws = a.public.woundState;
          const dragging = dragTo?.id === id;
          return (
            <g key={id} transform={`translate(${c.x},${c.y})`} className={`token${dead ? ' dead' : ''}${p.canDrag(id) ? ' draggable' : ''}`} opacity={dragging ? 0.45 : 1}>
              {active && <circle r={S * 0.5} fill="none" stroke="var(--yellow)" strokeWidth={3} className="pulse" filter="url(#glow)" />}
              {highlight.has(id) && <circle r={S * 0.56} fill="none" stroke="#ff7a00" strokeWidth={4} className="pulse" />}
              {p.focusId === id && <circle r={S * 0.54} fill="none" stroke="#fff" strokeWidth={2} strokeDasharray="6 4" className="march" />}
              <circle r={S * 0.44} fill="#070b1f" stroke={col} strokeWidth={4} />
              {a.public.portrait
                ? <image href={a.public.portrait} x={-S * 0.4} y={-S * 0.4} width={S * 0.8} height={S * 0.8} clipPath={`url(#clip-${id})`} filter={dead ? 'url(#gray)' : undefined} opacity={dead ? 0.55 : 1} />
                : <text textAnchor="middle" dy="0.35em" fontFamily="Barlow Condensed" fontWeight={700} fontSize={S * 0.42} fill={col}>{a.public.name.slice(0, 1)}</text>}
              {dead && <path d={`M${-S * 0.3},${-S * 0.3}L${S * 0.3},${S * 0.3}M${S * 0.3},${-S * 0.3}L${-S * 0.3},${S * 0.3}`} stroke="var(--red)" strokeWidth={5} />}
              {ws !== 'unhurt' && !dead && <circle cx={S * 0.32} cy={-S * 0.32} r={7} fill={ws === 'mortally' ? 'var(--red)' : ws === 'seriously' ? '#ff8a00' : 'var(--yellow)'} stroke="#000" strokeWidth={2} />}
              {a.public.conditions.prone && !dead && <text x={-S * 0.36} y={-S * 0.24} className="svg-tag">Prone</text>}
              <g transform={`translate(0,${S * 0.58})`}>
                <rect x={-S * 0.62} y={-9} width={S * 1.24} height={17} rx={2} fill="rgba(3,6,20,0.85)" stroke={col} strokeWidth={1} />
                <text textAnchor="middle" dy="0.32em" className="svg-name">
                  {a.public.name.length > 12 ? `${a.public.name.slice(0, 11)}…` : a.public.name}
                </text>
              </g>
              {chance != null && mode !== 'area' && (
                <g transform={`translate(0,${-S * 0.66})`}>
                  <rect x={-24} y={-11} width={48} height={20} rx={3} fill={p.targetId === id ? '#ffd400' : 'rgba(10,16,48,0.92)'} stroke="#ffd400" strokeWidth={1.5} />
                  <text textAnchor="middle" dy="0.33em" fontFamily="Barlow Condensed" fontWeight={700} fontSize={15} fill={p.targetId === id ? '#111' : '#ffd400'}>{pct(chance)}</text>
                </g>
              )}
            </g>
          );
        })}

        {/* Effects */}
        <g pointerEvents="none">
          {p.effects.filter((f) => now - f.t < EFFECT_MS && now >= f.t).map((f) => {
            if (f.kind === 'tracer') {
              const a = center(f.from), b = center(f.to);
              return (
                <g key={f.id}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={f.hit ? '#ffd400' : '#9ab'} strokeWidth={3} className="fx-tracer" />
                  <circle cx={a.x} cy={a.y} r={S * 0.3} fill="#fff6b0" className="fx-flash" />
                </g>
              );
            }
            if (f.kind === 'float') {
              const c = center(f.at);
              return (
                <g key={f.id} transform={`translate(${c.x},${c.y - S * 0.3})`}>
                  <text textAnchor="middle" className={`fx-float fx-${f.tone}`}>{f.text}</text>
                </g>
              );
            }
            if (f.kind === 'flash') {
              const c = center(f.at);
              return <circle key={f.id} cx={c.x} cy={c.y} r={S * 0.6} fill="none" stroke={f.color} strokeWidth={6} className="fx-ring" />;
            }
            const c = center(f.at);
            return <circle key={f.id} cx={c.x} cy={c.y} r={Math.max(1, f.radius) * S} fill="rgba(255,140,0,0.35)" stroke="#ffd400" strokeWidth={4} className="fx-blast" />;
          })}
        </g>

        {/* Shared signals */}
        <g pointerEvents="none">
          {p.signals.pings.filter((g) => now - g.t < PING_MS).map((g) => {
            const c = center(g.at);
            const col = colorFor(g.from);
            return (
              <g key={g.id} transform={`translate(${c.x},${c.y})`}>
                <circle r={S * 0.5} fill="none" stroke={col} strokeWidth={4} className="fx-ping" />
                <circle r={S * 0.5} fill="none" stroke={col} strokeWidth={3} className="fx-ping delay" />
                <text y={-S * 0.8} textAnchor="middle" className="svg-label" fill={col}>{p.nameOf(g.from)}</text>
              </g>
            );
          })}
          {Object.entries({ ...p.signals.measures, ...(ruler ? { me: ruler } : {}) }).map(([from, m]) => {
            if (from === 'me' && !ruler) return null;
            const a = center(m.from), b = center(m.to);
            const col = colorFor(from);
            return (
              <g key={`m-${from}`}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={col} strokeWidth={4} strokeDasharray="14 8" />
                <circle cx={a.x} cy={a.y} r={6} fill={col} />
                <circle cx={b.x} cy={b.y} r={8} fill="none" stroke={col} strokeWidth={3} />
                <g transform={`translate(${(a.x + b.x) / 2},${(a.y + b.y) / 2 - 18})`}>
                  <rect x={-50} y={-13} width={100} height={24} rx={3} fill="rgba(3,6,20,0.92)" stroke={col} />
                  <text textAnchor="middle" dy="0.35em" className="svg-label">{measureLabel(m.from, m.to)}</text>
                </g>
              </g>
            );
          })}
          {Object.entries(p.signals.cursors).filter(([from, c]) => from !== 'me' && now - c.t < 15_000).map(([from, c]) => {
            const pt = center(c.at);
            const col = colorFor(from);
            return (
              <g key={`c-${from}`} transform={`translate(${pt.x + S * 0.25},${pt.y + S * 0.25})`}>
                <path d="M0,0 L0,22 L6,16 L11,26 L15,24 L10,14 L18,14 Z" fill={col} stroke="#000" strokeWidth={1.5} />
                <text x={20} y={30} className="svg-label" fill={col}>{p.nameOf(from)}</text>
              </g>
            );
          })}
        </g>

        {hover && mode !== 'watch' && mode !== 'area' && <rect x={hover.x * S} y={hover.y * S} width={S} height={S} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={2} pointerEvents="none" />}
      </svg>
      <div className="zoom" role="group" aria-label="Map zoom">
        <button className="btn" onClick={() => zoomButton(1.25)} aria-label="Zoom In" title="Zoom In">+</button>
        <button className="btn" onClick={() => zoomButton(0.8)} aria-label="Zoom Out" title="Zoom Out">−</button>
        <button className="btn" onClick={fit} title="Fit Map to Screen">Fit</button>
      </div>
    </div>
  );
}
