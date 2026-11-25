/** Linked STAT for a skill. Single source of truth: data/skills.ts. Unknown skills: no STAT (GM's call). */
import type { StatKeyName } from '@cprc/session';
import { SKILL_STAT } from '../data/skills.js';

const LOWER = new Map(Object.entries(SKILL_STAT).map(([k, v]) => [k.toLowerCase(), v]));

export function linkedStat(skill: string): StatKeyName | undefined {
  return (SKILL_STAT[skill] ?? LOWER.get(skill.toLowerCase())) as StatKeyName | undefined;
}
