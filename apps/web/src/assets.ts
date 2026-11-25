/**
 * Image preparation in the browser (canvas) and upload to the relay's Assets
 * API. When the API isn't there yet (404) or fails, falls back to an inline
 * data URL for small images and a local object URL for big ones, so the
 * editors stay usable. Object URLs only work on this device until reload.
 */
import { client } from './net.js';
import { downscaleFactor, MAX_IMAGE_SIDE } from './editors/mapModel.js';

export async function loadImage(src: Blob | string): Promise<HTMLImageElement> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try {
    await img.decode();
  } catch {
    throw new Error('That file couldn’t be read as an image.');
  }
  return img;
}

function canvasOf(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('This browser can’t process images.');
  ctx.imageSmoothingQuality = 'high';
  return { c, ctx };
}

async function toBlob(c: HTMLCanvasElement, type = 'image/webp', quality = 0.85): Promise<Blob> {
  const b = await new Promise<Blob | null>((r) => c.toBlob(r, type, quality));
  if (b && b.type === type) return b;
  // Safari can't encode WebP: fall back to JPEG.
  const j = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.88));
  if (!j) throw new Error('The image couldn’t be encoded.');
  return j;
}

/** Downscaled size of an image so the long side is ≤ 4096 px. */
export function scaledSize(img: HTMLImageElement, max = MAX_IMAGE_SIDE) {
  const f = downscaleFactor(img.naturalWidth, img.naturalHeight, max);
  return { w: Math.round(img.naturalWidth * f), h: Math.round(img.naturalHeight * f), factor: f };
}

/**
 * Map background: downscale to ≤ 4096 px, then crop to `cropW × cropH`
 * (whole squares) from the top-left.
 */
export async function prepareMapImage(img: HTMLImageElement, cropW: number, cropH: number): Promise<Blob> {
  const { factor } = scaledSize(img);
  const { c, ctx } = canvasOf(cropW, cropH);
  ctx.drawImage(img, 0, 0, cropW / factor, cropH / factor, 0, 0, cropW, cropH);
  return toBlob(c, 'image/webp', 0.82);
}

export interface SquareCrop { cx: number; cy: number; size: number }

/** Portrait: square crop (in natural pixels) scaled to 256 × 256 WebP. */
export async function preparePortrait(img: HTMLImageElement, crop: SquareCrop, out = 256): Promise<Blob> {
  const { c, ctx } = canvasOf(out, out);
  ctx.drawImage(img, crop.cx - crop.size / 2, crop.cy - crop.size / 2, crop.size, crop.size, 0, 0, out, out);
  return toBlob(c, 'image/webp', 0.86);
}

const blobToDataUrl = (b: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(new Error('The image couldn’t be read.'));
  r.readAsDataURL(b);
});

/** Inline data URLs ride inside log entries; keep them well under the relay's 512 KB message cap. */
const INLINE_LIMIT = 200 * 1024;

export interface Stored { url: string; where: 'relay' | 'inline' | 'local' }

export async function storeImage(blob: Blob): Promise<Stored> {
  try {
    const url = await client.uploadAsset(blob, blob.type);
    if (url) return { url, where: 'relay' };
  } catch {
    // Fall through to a fallback below.
  }
  if (blob.size <= INLINE_LIMIT) return { url: await blobToDataUrl(blob), where: 'inline' };
  return { url: URL.createObjectURL(blob), where: 'local' };
}

/** Download text as a file. */
export function downloadText(filename: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Open a file picker and resolve with the chosen file (or null). */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
