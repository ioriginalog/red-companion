/**
 * Phone zoom controls sit in the map's top-right corner. Folded, they're one
 * button; it steps aside while a token (or its name tag) is under it.
 */
import type { Cell } from '@cprc/rules-core';
import { toStage, type Viewport } from '../table/layout/camera.js';
import type { Box } from '../table/viewport.js';

export interface Rect { x: number; y: number; w: number; h: number }

/** The folded button's area on the stage, in CSS px (see .table.compact .zoom in styles.css), with a small margin. */
export function foldedZoomRect(vp: Viewport): Rect {
  const size = 38, inset = 8, margin = 4;
  return { x: vp.w - inset - size - margin, y: inset - margin, w: size + margin * 2, h: size + margin * 2 };
}

export function zoomCoversToken(tokens: Record<string, Cell>, shown: (id: string) => boolean, box: Box, vp: Viewport, S: number, rect = foldedZoomRect(vp)): boolean {
  if (box.w <= 0 || vp.w <= 0) return false;
  const k = vp.w / box.w;
  for (const [id, t] of Object.entries(tokens)) {
    if (!shown(id)) continue;
    const c = toStage(box, vp, { x: t.x * S + S / 2, y: t.y * S + S / 2 });
    // The token disc and its name tag below it.
    const left = c.x - S * 0.5 * k, right = c.x + S * 0.5 * k, top = c.y - S * 0.5 * k, bottom = c.y + S * 0.7 * k;
    if (right > rect.x && left < rect.x + rect.w && bottom > rect.y && top < rect.y + rect.h) return true;
  }
  return false;
}
