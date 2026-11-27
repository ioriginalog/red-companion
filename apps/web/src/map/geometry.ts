/**
 * Drawing geometry in square units (1 = one square; fractions allowed),
 * shared by the annotation layer and the drawing tools.
 */
import type { Annotation, AnnotationColor } from '@cprc/session';

/** Neon palette for drawings and lights (CSS colors). */
export const NEON: Record<AnnotationColor, string> = {
  cyan: '#22e3ff', yellow: '#ffd400', magenta: '#ff2bd6', green: '#3dff8a', red: '#ff3b4e', white: '#e8eeff',
};
export const COLOR_NAME: Record<AnnotationColor, string> = {
  cyan: 'Cyan', yellow: 'Yellow', magenta: 'Magenta', green: 'Green', red: 'Red', white: 'White',
};
export const COLORS = Object.keys(NEON) as AnnotationColor[];

export interface Pt { x: number; y: number }

const pairs = (p: number[]): Pt[] => { const out: Pt[] = []; for (let i = 0; i + 1 < p.length; i += 2) out.push({ x: p[i]!, y: p[i + 1]! }); return out; };
export const pointsOf = (a: Pick<Annotation, 'points'>) => pairs(a.points);

const segDist = (p: Pt, a: Pt, b: Pt) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

/** Distance from `p` to the drawing's stroke (text: to its anchor box). */
export function distanceTo(a: Pick<Annotation, 'kind' | 'points' | 'text'>, p: Pt): number {
  const pts = pointsOf(a);
  switch (a.kind) {
    case 'path': {
      let d = Infinity;
      for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(p, pts[i - 1]!, pts[i]!));
      return d;
    }
    case 'line': return segDist(p, pts[0]!, pts[1]!);
    case 'rect': {
      const [a0, b0] = [pts[0]!, pts[1]!];
      const c = [{ x: a0.x, y: a0.y }, { x: b0.x, y: a0.y }, { x: b0.x, y: b0.y }, { x: a0.x, y: b0.y }];
      return Math.min(...c.map((q, i) => segDist(p, q, c[(i + 1) % 4]!)));
    }
    case 'circle': {
      const r = Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y);
      return Math.abs(Math.hypot(p.x - pts[0]!.x, p.y - pts[0]!.y) - r);
    }
    case 'text': {
      const w = Math.max(1, (a.text?.length ?? 1) * 0.28);
      const o = pts[0]!;
      const dx = Math.max(0, Math.abs(p.x - o.x) - w / 2), dy = Math.max(0, Math.abs(p.y - o.y) - 0.3);
      return Math.hypot(dx, dy);
    }
  }
}

/** Topmost drawing within `tol` squares of `p` that `may` allows. */
export function hitAnnotation(list: Annotation[], p: Pt, tol: number, may: (a: Annotation) => boolean): Annotation | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const a = list[i]!;
    if (may(a) && distanceTo(a, p) <= tol) return a;
  }
  return null;
}

/** Thin a freehand stroke to at most `max` points (keeps the ends). */
export function thin(points: Pt[], max: number): Pt[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]!);
}

export const flat = (pts: Pt[]) => pts.flatMap((q) => [Math.round(q.x * 100) / 100, Math.round(q.y * 100) / 100]);

/** Short random id for new drawings and lights. */
export const newMarkId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
