/** What a cover square looks like to the viewer (display only). */
import { cellKey, coverMaterial, DEFAULT_COVER_MATERIAL, terrainAt, type Cell } from '@cprc/rules-core';
import type { TacticalMap } from '@cprc/session';

export interface CoverInfo { name: string; hp: number; max: number }

export function coverAt(map: TacticalMap, c: Cell): CoverInfo | null {
  if (terrainAt(map, c) !== 'c') return null;
  const entry = map.cover?.[cellKey(c)];
  const mat = coverMaterial(entry?.material ?? DEFAULT_COVER_MATERIAL);
  return { name: mat.name, hp: entry?.hp ?? mat.hp, max: mat.hp };
}

/** GM: exact HP. Players: a damage state only (cover HP is a GM number). */
export function coverLabel(info: CoverInfo, isGm: boolean): string {
  if (isGm) return `${info.name} · ${info.hp}/${info.max} HP`;
  const f = info.hp / info.max;
  return f >= 1 ? 'Cover · Intact' : f > 0.5 ? 'Cover · Damaged' : 'Cover · Badly Damaged';
}
