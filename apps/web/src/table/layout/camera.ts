/**
 * Camera framing for the tactical map (map units = pixels of the map image).
 * Pure functions so they can be unit-tested; MapView animates between boxes.
 */
import type { Box } from '../viewport.js';

/**
 * Keep a programmatic view on the map: no empty margin past an edge when the
 * view is smaller than the map in that direction, centered when it's larger.
 * (Manual panning uses the looser clampBox.)
 */
export function clampInside(b: Box, mapW: number, mapH: number): Box {
  const x = b.w >= mapW ? (mapW - b.w) / 2 : Math.min(mapW - b.w, Math.max(0, b.x));
  const y = b.h >= mapH ? (mapH - b.h) / 2 : Math.min(mapH - b.h, Math.max(0, b.y));
  return { ...b, x, y };
}

export interface Viewport { w: number; h: number }
export interface Pt { x: number; y: number }

/**
 * Fit the whole map. `cover` fills the viewport using the tighter dimension
 * (no empty bands, edges may crop); otherwise the whole map is contained.
 */
export function fitMap(mapW: number, mapH: number, aspect: number, cover: boolean, pad = 0.02): Box {
  const pw = mapW * (1 + pad * 2);
  const ph = mapH * (1 + pad * 2);
  let w: number, h: number;
  if (cover) {
    // Fill: the box is no larger than the map in either direction.
    w = Math.min(pw, ph * aspect);
    h = w / aspect;
  } else {
    w = pw; h = pw / aspect;
    if (h < ph) { h = ph; w = ph * aspect; }
  }
  return { x: (mapW - w) / 2, y: (mapH - h) / 2, w, h };
}

/** Widest view (map units) that keeps a square at least `minPx` on screen. */
export function maxViewWidth(cellPx: number, viewportPx: number, minPx: number): number {
  return minPx > 0 ? (viewportPx / minPx) * cellPx : Infinity;
}

/**
 * Frame the action: every point in `focus` (map units, square centers) with
 * `padCells` of margin, no tighter than `minCells` squares across, and no wider
 * than `maxW` (so tokens stay readable). If the points can't all fit, the first
 * point (the acting token) stays on screen and the view leans toward the rest.
 */
export function frameFocus(
  focus: Pt[], aspect: number, cellPx: number, opts: { maxW: number; fallback: Box; padCells?: number; minCells?: number; mapW: number; mapH: number },
): Box {
  if (!focus.length) return clampInside(limitWidth(opts.fallback, opts.maxW, aspect), opts.mapW, opts.mapH);
  const pad = (opts.padCells ?? 1.6) * cellPx;
  const minW = (opts.minCells ?? 7) * cellPx;
  const xs = focus.map((p) => p.x), ys = focus.map((p) => p.y);
  const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad;
  const y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
  let w = Math.max(x1 - x0, (y1 - y0) * aspect, minW);
  // Never zoom out past the whole-map fit (it only adds empty space).
  w = Math.min(w, Math.max(opts.fallback.w, minW));
  let cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  if (w > opts.maxW) {
    w = opts.maxW;
    // Keep the anchor (acting token) inside the middle 70% while leaning toward the group's center.
    const a = focus[0]!;
    const h = w / aspect;
    cx = clamp(cx, a.x - w * 0.35, a.x + w * 0.35);
    cy = clamp(cy, a.y - h * 0.35, a.y + h * 0.35);
  }
  const h = w / aspect;
  return clampInside({ x: cx - w / 2, y: cy - h / 2, w, h }, opts.mapW, opts.mapH);
}

/** Shrink a box (around its center) so it's no wider than `maxW`. */
export function limitWidth(b: Box, maxW: number, aspect: number): Box {
  if (b.w <= maxW) return b;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const w = maxW, h = w / aspect;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** True when the point sits inside the inner `inset` fraction of the box. */
export function comfortablyInside(b: Box, p: Pt, inset = 0.12): boolean {
  return p.x > b.x + b.w * inset && p.x < b.x + b.w * (1 - inset) && p.y > b.y + b.h * inset && p.y < b.y + b.h * (1 - inset);
}

/** Same zoom, panned so `p` is centered. */
export function centerOn(b: Box, p: Pt, mapW: number, mapH: number): Box {
  return clampInside({ ...b, x: p.x - b.w / 2, y: p.y - b.h / 2 }, mapW, mapH);
}

export function lerpBox(a: Box, b: Box, t: number): Box {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t };
}

export const easeOut = (t: number) => 1 - (1 - t) ** 3;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Map units → pixels inside the map stage (box aspect always equals the stage's). */
export function toStage(b: Box, vp: Viewport, p: Pt): Pt {
  return { x: ((p.x - b.x) / b.w) * vp.w, y: ((p.y - b.y) / b.h) * vp.h };
}
