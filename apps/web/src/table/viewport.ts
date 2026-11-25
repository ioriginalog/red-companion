/** Camera math for the map SVG's viewBox. Map units = pixels of the map image. */
export interface Box { x: number; y: number; w: number; h: number }

/** Whole map visible, matching the container's aspect ratio, centered. */
export function fitBox(mapW: number, mapH: number, aspect: number, pad = 0.02): Box {
  const pw = mapW * (1 + pad * 2);
  const ph = mapH * (1 + pad * 2);
  let w = pw, h = pw / aspect;
  if (h < ph) { h = ph; w = ph * aspect; }
  return { x: (mapW - w) / 2, y: (mapH - h) / 2, w, h };
}

/** Zoom by `factor` (>1 zooms in) keeping map point (px, py) under the cursor. */
export function zoomAt(b: Box, factor: number, px: number, py: number, minW: number, maxW: number): Box {
  const w = Math.min(maxW, Math.max(minW, b.w / factor));
  const k = w / b.w;
  const h = b.h * k;
  return { x: px - (px - b.x) * k, y: py - (py - b.y) * k, w, h };
}

export function panBy(b: Box, dx: number, dy: number): Box {
  return { ...b, x: b.x + dx, y: b.y + dy };
}

/** Keep at least a quarter of the view over the map. */
export function clampBox(b: Box, mapW: number, mapH: number): Box {
  const x = Math.min(mapW - b.w / 4, Math.max(-b.w * 0.75, b.x));
  const y = Math.min(mapH - b.h / 4, Math.max(-b.h * 0.75, b.y));
  return { ...b, x, y };
}

/** Resize the box to a new aspect ratio around its center. */
export function reaspect(b: Box, aspect: number): Box {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const area = b.w * b.h;
  const w = Math.sqrt(area * aspect), h = w / aspect;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}
