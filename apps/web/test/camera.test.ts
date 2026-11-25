import { describe, expect, it } from 'vitest';
import { clampInside, comfortablyInside, fitMap, frameFocus, limitWidth, maxViewWidth, toStage } from '../src/table/layout/camera.js';
import { targetChips } from '../src/table/layout/TargetChips.js';
import type { ViewState } from '@cprc/session';

const S = 64, W = 24 * S, H = 16 * S;

describe('camera', () => {
  it('fit contains the whole map on desktop and fills the screen on phones', () => {
    const contain = fitMap(W, H, 390 / 600, false);
    expect(contain.w).toBeGreaterThanOrEqual(W);
    const cover = fitMap(W, H, 390 / 600, true);
    expect(cover.w).toBeLessThanOrEqual(W);
    expect(cover.h).toBeLessThanOrEqual(H * 1.05);
  });
  it('keeps squares at least the minimum size on screen', () => {
    // 390 px wide stage, 34 px squares → at most ~11.5 squares across.
    expect(maxViewWidth(S, 390, 34) / S).toBeCloseTo(390 / 34, 5);
    const b = frameFocus([{ x: 2 * S, y: 2 * S }, { x: 22 * S, y: 14 * S }], 0.65, S, { maxW: maxViewWidth(S, 390, 34), fallback: fitMap(W, H, 0.65, true), mapW: W, mapH: H });
    expect((390 / b.w) * S).toBeGreaterThanOrEqual(34 - 1e-9);
  });
  it('keeps the acting token in view when the pair cannot fit', () => {
    const a = { x: 2 * S + 32, y: 13 * S + 32 }, t = { x: 22 * S + 32, y: 2 * S + 32 };
    const b = frameFocus([a, t], 0.65, S, { maxW: 10 * S, fallback: fitMap(W, H, 0.65, true), mapW: W, mapH: H });
    expect(comfortablyInside(b, a, 0)).toBe(true);
  });
  it('frames both tokens when they fit', () => {
    const a = { x: 5 * S, y: 8 * S }, t = { x: 9 * S, y: 6 * S };
    const b = frameFocus([a, t], 1, S, { maxW: 20 * S, fallback: fitMap(W, H, 1, true), mapW: W, mapH: H });
    expect(comfortablyInside(b, a, 0) && comfortablyInside(b, t, 0)).toBe(true);
  });
  it('never leaves empty margin past a map edge it could cover', () => {
    const b = clampInside({ x: -300, y: H - 100, w: 600, h: 400 }, W, H);
    expect(b.x).toBe(0);
    expect(b.y + b.h).toBe(H);
    const big = clampInside({ x: 0, y: 0, w: W * 2, h: H }, W, H);
    expect(big.x).toBe(-W / 2);
  });
  it('limits width around the center and maps to stage pixels', () => {
    const b = limitWidth({ x: 0, y: 0, w: 1000, h: 500 }, 400, 2);
    expect(b).toEqual({ x: 300, y: 150, w: 400, h: 200 });
    expect(toStage(b, { w: 800, h: 400 }, { x: 500, y: 250 })).toEqual({ x: 400, y: 200 });
  });
});

describe('target chips', () => {
  const actor = (id: string, allegiance: 'party' | 'hostile', extra: object = {}) => ({
    id, controller: 'gm', public: { name: id, side: allegiance === 'party' ? 'pc' : 'npc', allegiance, woundState: 'unhurt', conditions: { prone: false, unconscious: false, dead: false, stabilized: false }, injuries: [] }, ...extra,
  });
  const view = {
    actors: { me: actor('me', 'party'), far: actor('far', 'hostile'), near: actor('near', 'hostile'), dead: actor('dead', 'hostile'), pal: actor('pal', 'party') },
    map: { tokens: { me: { x: 0, y: 0 }, far: { x: 9, y: 0 }, near: { x: 2, y: 1 }, dead: { x: 1, y: 1 }, pal: { x: 1, y: 0 } } },
  } as unknown as ViewState;
  (view.actors.dead as { public: { conditions: { dead: boolean } } }).public.conditions.dead = true;
  it('lists living opponents nearest first with chances', () => {
    const chips = targetChips(view, 'me', { near: 0.7 });
    expect(chips.map((c) => c.id)).toEqual(['near', 'far']);
    expect(chips[0]!.chance).toBe(0.7);
    expect(chips[1]!.chance).toBeNull();
    expect(chips[1]!.squares).toBe(9);
  });
});
