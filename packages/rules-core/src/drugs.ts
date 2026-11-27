/**
 * Street drugs (Secondary: community Player Handbook, Drugs and Addiction).
 *
 * - Dosing is an Action (with an airhypo), on yourself or a willing target.
 * - The primary effect starts at once and lasts the drug's duration. Another
 *   dose before it ends restarts the duration; effects don't stack.
 * - When it wears off: WILL + Resist Torture/Drugs + 1d10 against the drug's
 *   DV. Fail and the user is addicted: the secondary effect (usually a STAT
 *   penalty) lasts until their next dose of that drug or a cure (therapy).
 *   Each addiction counts on its own. A wear-off with an addiction already in
 *   place rolls again but can't add a second one.
 *
 * Interpretations: the GM ends each dose (game time isn't tracked); hostile
 * dosing with an airhypo is a GM prompt. The drugs below are ORIGINAL to this
 * tool (own names, effects and numbers); add the book's as custom drugs.
 */
import type { CombatMods, Combatant, DrugDef, DrugEffect, DrugsState, StatKey } from './types.js';

export const DRUG_SKILL = 'Resist Torture/Drugs';

const fx = (note: string, stats?: DrugEffect['stats']): DrugEffect => ({ note, ...(stats ? { stats } : {}) });

/** Original examples, not book drugs. */
export const DRUG_TEMPLATES: DrugDef[] = [
  { id: 'glimmer', name: 'Glimmer', duration: '1 hour', addictionDv: 13,
    effect: fx('Hands go steady and the world slows a little.', { REF: 1 }),
    secondary: fx('Jittery and short-sighted without it.', { REF: -1, INT: -1 }) },
  { id: 'brickwall', name: 'Brickwall', duration: '30 minutes', addictionDv: 15,
    effect: fx('Pain fades to static; the GM may ignore one Wound State penalty.', { BODY: 1 }),
    secondary: fx('Everything aches.', { BODY: -1, MOVE: -1 }) },
  { id: 'nightjar', name: 'Nightjar', duration: '6 hours', addictionDv: 11,
    effect: fx('Wide awake; no sleep needed while it lasts.', { INT: 1 }),
    secondary: fx('Foggy and irritable.', { COOL: -1 }) },
];

const STATS: readonly StatKey[] = ['INT', 'REF', 'DEX', 'TECH', 'COOL', 'WILL', 'LUCK', 'MOVE', 'BODY', 'EMP'];

export const emptyDrugs = (): DrugsState => ({ active: [], addictions: [] });

/** Dose: start (or restart) the primary effect. */
export function dose(state: DrugsState | undefined, drug: DrugDef): { drugs: DrugsState; redose: boolean } {
  const s = state ?? emptyDrugs();
  const redose = s.active.some((d) => d.id === drug.id);
  return { drugs: { ...s, active: [...s.active.filter((d) => d.id !== drug.id), drug] }, redose };
}

/** Wear off: the caller rolls the check; `beat` says whether it beat the DV. */
export function wearOff(state: DrugsState, drugId: string, beat: boolean): { drugs: DrugsState; addicted: boolean; drug: DrugDef | null } {
  const drug = state.active.find((d) => d.id === drugId) ?? null;
  if (!drug) return { drugs: state, addicted: false, drug };
  const active = state.active.filter((d) => d.id !== drugId);
  const already = state.addictions.some((d) => d.id === drugId);
  const addicted = !beat && !already;
  return { drugs: { active, addictions: addicted ? [...state.addictions, drug] : state.addictions }, addicted, drug };
}

export function cure(state: DrugsState, drugId: string): DrugsState {
  return { ...state, addictions: state.addictions.filter((d) => d.id !== drugId) };
}

/** STAT changes now in force: active primary effects, plus each addiction whose drug isn't active. */
export function drugMods(c: Pick<Combatant, 'drugs'>): CombatMods {
  const s = c.drugs;
  if (!s) return {};
  const bonus: Partial<Record<StatKey, number>> = {};
  const add = (e: DrugEffect) => { for (const [k, v] of Object.entries(e.stats ?? {})) bonus[k as StatKey] = (bonus[k as StatKey] ?? 0) + (v ?? 0); };
  for (const d of s.active) add(d.effect);
  for (const d of s.addictions) if (!s.active.some((x) => x.id === d.id)) add(d.secondary);
  const nonzero = Object.fromEntries(Object.entries(bonus).filter(([, v]) => v !== 0));
  return Object.keys(nonzero).length ? { statBonuses: nonzero } : {};
}

function effectProblem(v: unknown, what: string): string | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return `${what} must be an object.`;
  const e = v as Record<string, unknown>;
  if (typeof e.note !== 'string' || e.note.length > 300) return `${what} needs a note (up to 300 characters).`;
  if (e.stats !== undefined) {
    if (typeof e.stats !== 'object' || e.stats === null || Array.isArray(e.stats)) return `${what} STATs must be an object.`;
    for (const [k, n] of Object.entries(e.stats)) {
      if (!STATS.includes(k as StatKey)) return `${what}: unknown STAT.`;
      if (!Number.isInteger(n) || (n as number) < -5 || (n as number) > 5) return `${what}: STAT changes run from −5 to +5.`;
    }
  }
  return Object.keys(e).some((k) => k !== 'note' && k !== 'stats') ? `${what} has an unknown field.` : null;
}

/** Null if valid, else the reason. */
export function drugProblem(v: unknown): string | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'A drug must be an object.';
  const d = v as Record<string, unknown>;
  if (typeof d.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(d.id)) return 'A drug needs a short id (letters, digits, - or _).';
  if (typeof d.name !== 'string' || !d.name.trim() || d.name.length > 60) return 'A drug needs a name (up to 60 characters).';
  if (typeof d.duration !== 'string' || d.duration.length > 40) return 'Duration must be text up to 40 characters.';
  if (!Number.isInteger(d.addictionDv) || (d.addictionDv as number) < 1 || (d.addictionDv as number) > 40) return 'Addiction DV must be a whole number from 1 to 40.';
  const p = effectProblem(d.effect, 'Effect') ?? effectProblem(d.secondary, 'Secondary effect');
  if (p) return p;
  return Object.keys(d).some((k) => !['id', 'name', 'duration', 'addictionDv', 'effect', 'secondary'].includes(k)) ? 'A drug has an unknown field.' : null;
}

export function drugsStateProblem(v: unknown): string | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'Drugs must be an object.';
  const s = v as Record<string, unknown>;
  for (const k of ['active', 'addictions'] as const) {
    if (!Array.isArray(s[k]) || (s[k] as unknown[]).length > 20) return 'Drug lists hold up to 20 entries.';
    for (const d of s[k] as unknown[]) { const p = drugProblem(d); if (p) return p; }
  }
  return Object.keys(s).some((k) => k !== 'active' && k !== 'addictions') ? 'Drugs have an unknown field.' : null;
}
