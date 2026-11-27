/**
 * GM drawing and lighting tools on the table map (and players' temporary
 * marks when the GM allows them). Owns the tool state and the pointer
 * gestures; MapView asks it first and falls back to pan/move when a gesture
 * isn't one of these.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MAX_PATH_POINTS, isLive, lightPosition, type Annotation, type AnnotationColor, type Intent, type LightSource, type TacticalMap } from '@cprc/session';
import type { Cell } from '@cprc/rules-core';
import { flat, hitAnnotation, newMarkId, thin, type Pt } from './geometry.js';

export type DrawShape = 'select' | 'path' | 'line' | 'rect' | 'circle' | 'text';
export type ToolPanel = 'draw' | 'light' | null;

type Gesture =
  | { kind: 'shape'; shape: Exclude<DrawShape, 'select' | 'text'>; pts: Pt[] }
  | { kind: 'moveAnn'; id: string; start: Pt; moved: boolean }
  | { kind: 'moveLight'; id: string; start: Cell; moved: boolean };

export interface MapTools {
  panel: ToolPanel;
  setPanel: (p: ToolPanel) => void;
  shape: DrawShape;
  setShape: (s: DrawShape) => void;
  color: AnnotationColor;
  setColor: (c: AnnotationColor) => void;
  visibility: 'gm' | 'all';
  setVisibility: (v: 'gm' | 'all') => void;
  label: string;
  setLabel: (t: string) => void;
  selAnn: string | null;
  setSelAnn: (id: string | null) => void;
  selLight: string | null;
  setSelLight: (id: string | null) => void;
  /** Drawings this viewer sees now (expired marks hidden by the local clock). */
  annotations: Annotation[];
  /** The drawing in progress, for the preview. */
  draft: Annotation | null;
  /** Move preview for the selected drawing. */
  annOffset: { id: string; dx: number; dy: number } | null;
  /** Move preview for a dragged light. */
  lightDrag: { id: string; at: Cell } | null;
  mayDraw: boolean;
  /** True when the tools own the gesture (MapView skips pan/move/click). */
  down: (p: Pt, c: Cell | null) => boolean;
  move: (p: Pt, c: Cell | null) => boolean;
  up: (p: Pt, c: Cell | null) => boolean;
  removeSelected: () => void;
  act: (i: Intent) => boolean;
  hint: string | null;
}

export function useMapTools({ map, isGm, me, act }: { map: TacticalMap; isGm: boolean; me: string; act?: (i: Intent) => boolean }): MapTools {
  const [panel, setPanelState] = useState<ToolPanel>(null);
  const [shape, setShape] = useState<DrawShape>('path');
  const [color, setColor] = useState<AnnotationColor>('cyan');
  const [visibility, setVisibility] = useState<'gm' | 'all'>('all');
  const [label, setLabel] = useState('');
  const [selAnn, setSelAnn] = useState<string | null>(null);
  const [selLight, setSelLight] = useState<string | null>(null);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [annOffset, setAnnOffset] = useState<MapTools['annOffset']>(null);
  const [lightDrag, setLightDrag] = useState<MapTools['lightDrag']>(null);
  const [hint, setHint] = useState<string | null>(null);
  const g = useRef<Gesture | null>(null);
  const send = useCallback((i: Intent) => (act ? act(i) : false), [act]);
  const mayDraw = isGm || !!map.drawRules?.playersMayDraw;

  // Re-render once a second while players' marks are counting down, so they vanish on time.
  const [now, setNow] = useState(() => new Date().toISOString());
  const expiring = Object.values(map.annotations ?? {}).some((a) => a.expiresAt);
  useEffect(() => {
    if (!expiring) return;
    const t = window.setInterval(() => setNow(new Date().toISOString()), 1000);
    return () => window.clearInterval(t);
  }, [expiring]);
  const annotations = useMemo(() => Object.values(map.annotations ?? {}).filter((a) => isLive(a, now)), [map.annotations, now]);

  const setPanel = (p: ToolPanel) => { setPanelState(p); setSelAnn(null); setSelLight(null); setDraft(null); g.current = null; };
  // Players lose the tools when the GM turns drawing off.
  useEffect(() => { if (!mayDraw && panel === 'draw') setPanel(null); }, [mayDraw]); // eslint-disable-line react-hooks/exhaustive-deps
  // Selection disappears with its drawing or light.
  useEffect(() => { if (selAnn && !annotations.some((a) => a.id === selAnn)) setSelAnn(null); }, [annotations, selAnn]);
  useEffect(() => { if (selLight && !map.lights?.[selLight]) setSelLight(null); }, [map.lights, selLight]);

  const mine = (a: Annotation) => isGm || a.by === me;
  const clampPt = (p: Pt): Pt => ({ x: Math.min(map.width, Math.max(0, p.x)), y: Math.min(map.height, Math.max(0, p.y)) });
  const draftOf = (s: Exclude<DrawShape, 'select' | 'text'>, pts: Pt[]): Annotation => ({ id: 'draft', kind: s, points: flat(pts), color, visibility: isGm ? visibility : 'all', by: me });

  const lightAt = (c: Cell): LightSource | null => {
    for (const l of Object.values(map.lights ?? {})) { const at = lightPosition(map, l); if (at && at.x === c.x && at.y === c.y) return l; }
    return null;
  };

  const down = (p0: Pt, c: Cell | null): boolean => {
    const p = clampPt(p0);
    if (panel === 'draw' && mayDraw) {
      if (shape === 'select') {
        const hit = hitAnnotation(annotations, p, 0.35, mine);
        setSelAnn(hit?.id ?? null);
        if (!hit) return false;
        g.current = { kind: 'moveAnn', id: hit.id, start: p, moved: false };
        return true;
      }
      if (shape === 'text') {
        const text = label.trim();
        if (!text) { setHint('Type the label first, then tap where it goes.'); return true; }
        const id = newMarkId('t');
        if (send({ type: 'annotate', op: { op: 'add', annotation: { id, kind: 'text', points: flat([p]), color, text: text.slice(0, 80), visibility: isGm ? visibility : 'all' } } })) setSelAnn(null);
        return true;
      }
      g.current = { kind: 'shape', shape, pts: shape === 'path' ? [p] : [p, p] };
      setDraft(draftOf(shape, shape === 'path' ? [p, p] : [p, p]));
      return true;
    }
    if (panel === 'light' && isGm && c) {
      const l = lightAt(c);
      if (l) {
        setSelLight(l.id);
        if (!l.attachedTo) g.current = { kind: 'moveLight', id: l.id, start: c, moved: false };
        return true;
      }
      if (Object.keys(map.lights ?? {}).length >= 64) { setHint('Up to 64 lights per map.'); return true; }
      const id = newMarkId('l');
      if (send({ type: 'light', op: { op: 'upsert', light: { id, at: c, bright: 2, dim: 2, on: true, color: 'yellow' } } })) setSelLight(id);
      return true;
    }
    return false;
  };

  const move = (p0: Pt, c: Cell | null): boolean => {
    const st = g.current;
    if (!st) return false;
    const p = clampPt(p0);
    if (st.kind === 'shape') {
      if (st.shape === 'path') {
        const last = st.pts[st.pts.length - 1]!;
        if (Math.hypot(p.x - last.x, p.y - last.y) >= 0.12) st.pts.push(p);
        setDraft(draftOf('path', st.pts.length > 1 ? st.pts : [st.pts[0]!, p]));
      } else {
        st.pts[1] = p;
        setDraft(draftOf(st.shape, st.pts));
      }
      return true;
    }
    if (st.kind === 'moveAnn') {
      const dx = p.x - st.start.x, dy = p.y - st.start.y;
      if (Math.hypot(dx, dy) > 0.1) st.moved = true;
      if (st.moved) setAnnOffset({ id: st.id, dx, dy });
      return true;
    }
    if (c && (c.x !== st.start.x || c.y !== st.start.y)) { st.moved = true; setLightDrag({ id: st.id, at: c }); }
    return true;
  };

  const up = (p0: Pt, c: Cell | null): boolean => {
    const st = g.current;
    g.current = null;
    if (!st) return false;
    const p = clampPt(p0);
    if (st.kind === 'shape') {
      setDraft(null);
      let pts = st.shape === 'path' ? st.pts : [st.pts[0]!, p];
      const span = Math.max(...pts.map((q) => Math.hypot(q.x - pts[0]!.x, q.y - pts[0]!.y)));
      if (span < 0.25) return true; // a tap, not a drawing
      if (st.shape === 'path') pts = thin(pts, MAX_PATH_POINTS);
      send({ type: 'annotate', op: { op: 'add', annotation: { id: newMarkId('d'), kind: st.shape, points: flat(pts), color, visibility: isGm ? visibility : 'all' } } });
      return true;
    }
    if (st.kind === 'moveAnn') {
      setAnnOffset(null);
      const dx = Math.round((p.x - st.start.x) * 100) / 100, dy = Math.round((p.y - st.start.y) * 100) / 100;
      if (st.moved && (dx || dy)) send({ type: 'annotate', op: { op: 'move', id: st.id, dx, dy } });
      return true;
    }
    setLightDrag(null);
    const l = map.lights?.[st.id];
    if (st.moved && l && c && (c.x !== st.start.x || c.y !== st.start.y)) send({ type: 'light', op: { op: 'upsert', light: { ...l, at: c } } });
    return true;
  };

  const removeSelected = () => {
    if (selAnn) { send({ type: 'annotate', op: { op: 'remove', id: selAnn } }); setSelAnn(null); }
    else if (selLight && isGm) { send({ type: 'light', op: { op: 'remove', id: selLight } }); setSelLight(null); }
  };

  // Hints fade on their own.
  useEffect(() => { if (!hint) return; const t = window.setTimeout(() => setHint(null), 2600); return () => window.clearTimeout(t); }, [hint]);

  return {
    panel, setPanel, shape, setShape, color, setColor, visibility, setVisibility, label, setLabel,
    selAnn, setSelAnn, selLight, setSelLight, annotations, draft, annOffset, lightDrag, mayDraw,
    down, move, up, removeSelected, act: send, hint,
  };
}
