/**
 * Shields and human shields (Secondary: a community Armor and Cover summary).
 *
 * - A shield takes one hand; equipping or dropping it is an Action.
 * - Raised, it blocks attacks from attackers its holder can see: the holder
 *   can't dodge those, a ranged attack can still miss, and a hit goes into the
 *   shield's HP (the whole hit; damage past 0 is lost, like cover). At 0 HP
 *   it's destroyed but stays in hand until dropped.
 * - A human shield is a character held in a Grapple, equipped with an Action
 *   by the holder (who isn't already holding a shield). It blocks ranged
 *   attacks except head Aimed Shots, never melee. It can't dodge while held,
 *   and takes the hit as if hit directly. Dead, it becomes a shield with HP
 *   equal to their BODY.
 *
 * Interpretations: explosives and other area attacks aren't blocked; a raised
 * shield still lets its holder roll the usual melee defense (the rules give no
 * DV for an undodged melee attack); raising or lowering a shield is free.
 * The example shields below are ORIGINAL (own names and numbers).
 */
import type { DamageSpec, ShieldState } from './types.js';

export interface ShieldTemplate { id: string; name: string; hp: number; summary: string }

/** Original examples, not book items. */
export const SHIELD_TEMPLATES: ShieldTemplate[] = [
  { id: 'riot-slab', name: 'Polymer Riot Slab', hp: 12, summary: 'Original. A clear riot board, light enough for one arm.' },
  { id: 'door-panel', name: 'Salvaged Car Door', hp: 18, summary: 'Original. Heavy, ugly, and it stops a lot.' },
  { id: 'fold-shield', name: 'Folding Ballistic Wing', hp: 8, summary: 'Original. Collapses into a briefcase.' },
];

const RANGED: ReadonlySet<DamageSpec['source']> = new Set(['ranged', 'autofire', 'shotgunShell']);
const MELEE: ReadonlySet<DamageSpec['source']> = new Set(['melee', 'brawling', 'martialArts']);

/** Does a raised (non-human) shield block this hit? */
export const shieldBlocks = (spec: Pick<DamageSpec, 'source'>): boolean => RANGED.has(spec.source) || MELEE.has(spec.source);

/** Does a human shield block this hit? Ranged only, and not a head Aimed Shot. */
export const humanShieldBlocks = (spec: Pick<DamageSpec, 'source' | 'aimTarget'>): boolean => RANGED.has(spec.source) && spec.aimTarget !== 'head';

/** A raised shield with HP left. */
export const shieldUp = (s: ShieldState | undefined): s is ShieldState => !!s && s.raised && s.hp > 0;

/** The whole hit goes into the shield; anything past 0 HP is lost. */
export function absorb(s: ShieldState, damage: number): { shield: ShieldState; absorbed: number; destroyed: boolean } {
  const hp = Math.max(0, s.hp - Math.max(0, damage));
  return { shield: { ...s, hp }, absorbed: Math.min(s.hp, Math.max(0, damage)), destroyed: hp === 0 };
}

/** Null if valid, else the reason. */
export function shieldProblem(v: unknown): string | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'A shield must be an object.';
  const s = v as Record<string, unknown>;
  if (typeof s.name !== 'string' || !s.name.trim() || s.name.length > 60) return 'A shield needs a name (up to 60 characters).';
  if (!Number.isInteger(s.maxHp) || (s.maxHp as number) < 1 || (s.maxHp as number) > 100) return 'Shield HP must be a whole number from 1 to 100.';
  if (!Number.isInteger(s.hp) || (s.hp as number) < 0 || (s.hp as number) > (s.maxHp as number)) return 'Shield HP must be from 0 to its maximum.';
  if (typeof s.raised !== 'boolean') return 'Raised must be true or false.';
  if (s.body !== undefined && typeof s.body !== 'boolean') return 'Body must be true or false.';
  const extra = Object.keys(s).filter((k) => !['name', 'hp', 'maxHp', 'raised', 'body'].includes(k));
  return extra.length ? `Unknown shield field ${extra[0]!.slice(0, 20)}.` : null;
}
