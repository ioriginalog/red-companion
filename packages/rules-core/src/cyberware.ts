/**
 * Cyberware and Humanity.
 *
 * Humanity starts at EMP × 10 (the `base`). Installing cyberware costs Humanity
 * Loss: the item's fixed value at character creation, rolled afterward (GM may
 * choose fixed or none). Each installed item with Humanity Loss also lowers
 * maximum Humanity by 2 (borgware 4); only removing it restores that.
 * Current EMP = floor(Humanity / 10), so 44 → 4 and 39 → 3. At 0 Humanity or
 * below the character is a cyberpsycho and goes to the GM. Removing cyberware
 * restores half its Humanity Loss, rounded down (Secondary). Therapy: see
 * `THERAPY`; it can't raise Humanity above the maximum. (Statuses in
 * docs/rules-verification.md.)
 *
 * `applySystems` derives everything the engine reads (`mods`, cyberware armor,
 * EMP) from role and cyberware. Call it after any change to either.
 */
import { roleMods } from './roles.js';
import type { ArmorPiece, CombatMods, Combatant, CyberwareEffect, CyberwareItem, StatKey } from './types.js';

export const THERAPY = {
  standard: { name: 'Standard Therapy', dv: 15, minHumanity: 40 },
  extreme: { name: 'Extreme Therapy', dv: 17, maxHumanityBelow: 40 },
} as const;
/** Humanity recovered by successful therapy: 2d6 (Secondary). */
export const THERAPY_DICE = 2;

export type HumanityStatus = 'stable' | 'low' | 'critical' | 'cyberpsycho';
/** UI warning bands (not rules): low < 30, critical < 10, cyberpsycho ≤ 0. */
export function humanityStatus(h: { current: number }): HumanityStatus {
  if (h.current <= 0) return 'cyberpsycho';
  if (h.current < 10) return 'critical';
  if (h.current < 30) return 'low';
  return 'stable';
}

export const empFromHumanity = (current: number) => Math.max(0, Math.floor(current / 10));

const ARMOR_PREFIX = 'cw:';

function mergeMods(a: CombatMods, b: CombatMods): CombatMods {
  const out: CombatMods = { ...a, ...b };
  const sum = (k: 'attack' | 'initiative' | 'damageDeflection' | 'spotWeakness') => {
    const v = (a[k] ?? 0) + (b[k] ?? 0);
    if (v) out[k] = v; else delete out[k];
  };
  sum('attack'); sum('initiative'); sum('damageDeflection'); sum('spotWeakness');
  const skills = { ...(a.skillBonuses ?? {}) };
  for (const [k, v] of Object.entries(b.skillBonuses ?? {})) skills[k] = (skills[k] ?? 0) + v;
  if (Object.keys(skills).length) out.skillBonuses = skills; else delete out.skillBonuses;
  const stats: Partial<Record<StatKey, number>> = { ...(a.statBonuses ?? {}) };
  for (const [k, v] of Object.entries(b.statBonuses ?? {})) stats[k as StatKey] = (stats[k as StatKey] ?? 0) + (v ?? 0);
  if (Object.keys(stats).length) out.statBonuses = stats; else delete out.statBonuses;
  const hm = Math.max(a.healingMultiplier ?? 0, b.healingMultiplier ?? 0);
  if (hm) out.healingMultiplier = hm; else delete out.healingMultiplier;
  return out;
}

/** True if the item is speedware (only one piece may be installed). */
export const isSpeedware = (item: CyberwareItem) => item.effects.some((e) => e.kind === 'speedware');

export function cyberwareMods(items: CyberwareItem[] | undefined): CombatMods {
  let m: CombatMods = {};
  let speedwareSeen = false; // Speedware never stacks; only the first piece counts
  for (const item of items ?? []) {
    for (const e of item.effects) {
      switch (e.kind) {
        case 'speedware':
          if (speedwareSeen) break;
          speedwareSeen = true;
          if (e.mode === 'passive') m = mergeMods(m, { initiative: e.initiative });
          else m.activatedSpeedware = e.initiative;
          break;
        case 'stat': m = mergeMods(m, { statBonuses: { [e.stat]: e.value } }); break;
        case 'skill': m = mergeMods(m, { skillBonuses: { [e.skill]: e.value } }); break;
        case 'initiative': m = mergeMods(m, { initiative: e.value }); break;
        case 'smartLink': // legacy alias
        case 'targetingScope': m.targetingScope = true; break;
        case 'neuralLink': m.neuralLink = true; break;
        case 'subdermalGrip': m.subdermalGrip = true; break;
        case 'interfacePlugs': m.interfacePlugs = true; break;
        case 'healingMultiplier': m = mergeMods(m, { healingMultiplier: e.value }); break;
        case 'ignoreSeriouslyWounded': m.ignoreSeriouslyWounded = true; break;
        case 'armor': break;
      }
    }
  }
  return m;
}

/** Recompute derived data: mods, cyberware armor pieces (keeping their ablation), EMP. */
export function applySystems(c: Combatant): Combatant {
  const mods = mergeMods(roleMods(c.role), cyberwareMods(c.cyberware));
  const existing = new Map(c.armor.filter((p) => p.id.startsWith(ARMOR_PREFIX)).map((p) => [p.id, p]));
  const cyberArmor: ArmorPiece[] = [];
  for (const item of c.cyberware ?? []) {
    for (const e of item.effects) {
      if (e.kind !== 'armor') continue;
      const id = `${ARMOR_PREFIX}${item.id}:${e.location}`;
      const prev = existing.get(id);
      cyberArmor.push({ id, name: item.name, location: e.location, maxSP: e.sp, currentSP: prev ? Math.min(prev.currentSP, e.sp) : e.sp, penalty: 0 });
    }
  }
  const armor = [...c.armor.filter((p) => !p.id.startsWith(ARMOR_PREFIX)), ...cyberArmor];
  const next: Combatant = { ...c, armor };
  if (Object.keys(mods).length) next.mods = mods; else delete next.mods;
  if (c.humanity) next.stats = { ...c.stats, EMP: empFromHumanity(c.humanity.current) };
  if (c.humanity?.base !== undefined) {
    const max = humanityMax(c.humanity.base, c.cyberware);
    next.humanity = { ...c.humanity, max, current: Math.min(c.humanity.current, max) };
    next.stats = { ...next.stats, EMP: empFromHumanity(next.humanity.current) };
  }
  return next;
}

/** Null if valid, else the reason. */
export function cyberwareProblem(item: CyberwareItem): string | null {
  if (!item || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(item.id)) return 'Cyberware needs a short id (letters, digits, - or _).';
  if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80) return 'Cyberware needs a name (up to 80 characters).';
  if (item.slot !== undefined && (typeof item.slot !== 'string' || item.slot.length > 40)) return 'Slot name is too long.';
  if (!Number.isInteger(item.humanityLoss) || item.humanityLoss < 0 || item.humanityLoss > 100) return 'Humanity Loss must be a whole number from 0 to 100.';
  if (item.hlDice !== undefined && (typeof item.hlDice !== 'string' || !parseHlDice(item.hlDice))) return 'Humanity Loss dice must look like 2d6, 1d6/2 or 0.';
  if (item.hlFixed !== undefined && !small(item.hlFixed, 0, 100)) return 'Fixed Humanity Loss must be a whole number from 0 to 100.';
  if (item.borgware !== undefined && typeof item.borgware !== 'boolean') return 'Borgware must be true or false.';
  if (item.install !== undefined && !['mall', 'clinic', 'hospital', 'none'].includes(item.install)) return 'Install must be mall, clinic, hospital or none.';
  if (item.costEb !== undefined && !small(item.costEb, 0, 1_000_000)) return 'Cost must be a whole number of eb.';
  if (item.notes !== undefined && (typeof item.notes !== 'string' || item.notes.length > 2000)) return 'Notes are too long.';
  if (!Array.isArray(item.effects) || item.effects.length > 12) return 'Up to 12 effects per item.';
  for (const e of item.effects) {
    const p = effectProblem(e);
    if (p) return p;
  }
  return null;
}

const STATS = new Set(['INT', 'REF', 'DEX', 'TECH', 'COOL', 'WILL', 'LUCK', 'MOVE', 'BODY', 'EMP']);
const small = (n: unknown, lo: number, hi: number) => Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi;

function effectProblem(e: CyberwareEffect): string | null {
  switch (e?.kind) {
    case 'stat': return STATS.has(e.stat) && small(e.value, -5, 5) ? null : 'A STAT effect needs a STAT and a value from −5 to 5.';
    case 'skill': return typeof e.skill === 'string' && e.skill.length > 0 && e.skill.length <= 40 && small(e.value, -5, 5) ? null : 'A skill effect needs a skill and a value from −5 to 5.';
    case 'armor': return (e.location === 'body' || e.location === 'head') && small(e.sp, 1, 30) ? null : 'An armor effect needs head or body and SP 1–30.';
    case 'initiative': return small(e.value, -5, 5) ? null : 'An Initiative effect needs a value from −5 to 5.';
    case 'healingMultiplier': return small(e.value, 1, 4) ? null : 'A healing multiplier must be 1–4.';
    case 'speedware': return (e.mode === 'passive' || e.mode === 'activated') && small(e.initiative, 1, 5) ? null : 'Speedware needs passive or activated and an Initiative bonus from 1 to 5.';
    case 'smartLink': case 'targetingScope': case 'neuralLink': case 'subdermalGrip':
    case 'interfacePlugs': case 'ignoreSeriouslyWounded': return null;
    default: return 'Unknown cyberware effect.';
  }
}

// ----- Humanity Loss dice ---------------------------------------------------------------

export interface HlDice { count: number; halve: boolean; bonus: number }

/**
 * Parse Humanity Loss notation: "2d6", "4d6", "1d6/2" (halved, rounded up, so the
 * fixed value 2 is its average; Interpretation), "1d3" (same as 1d6/2), "2d6+1", "0".
 */
export function parseHlDice(s: string): HlDice | null {
  const t = s.replace(/\s+/g, '').toLowerCase();
  if (/^\d{1,2}$/.test(t)) return { count: 0, halve: false, bonus: Number(t) };
  const m = /^(\d{1,2})d(6|3)(\/2)?(?:\+(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const count = Number(m[1]);
  if (count < 1 || count > 10) return null;
  if (m[2] === '3' && m[3]) return null;
  return { count, halve: m[2] === '3' || !!m[3], bonus: Number(m[4] ?? 0) };
}

/** Roll Humanity Loss. Returns the d6 faces rolled and the total. */
export function rollHl(spec: HlDice, d6: () => number): { rolled: number[]; total: number } {
  const rolled = Array.from({ length: spec.count }, () => d6());
  const sum = rolled.reduce((a, b) => a + b, 0);
  return { rolled, total: (spec.halve ? Math.ceil(sum / 2) : sum) + spec.bonus };
}

/** Average Humanity Loss for a spec, rounded up: the usual fixed value. */
export const hlAverage = (spec: HlDice) => Math.ceil((spec.halve ? spec.count * 3.5 / 2 : spec.count * 3.5)) + spec.bonus;

// ----- Maximum Humanity ------------------------------------------------------------------

/** How much an installed item lowers maximum Humanity: 2, borgware 4, nothing if it costs no Humanity. */
export function maxHumanityPenalty(item: Pick<CyberwareItem, 'humanityLoss' | 'borgware' | 'hlDice' | 'hlFixed'>): number {
  const costs = item.humanityLoss > 0 || (item.hlFixed ?? 0) > 0 || (!!item.hlDice && item.hlDice.trim() !== '0');
  if (!costs) return 0;
  return item.borgware ? 4 : 2;
}

/** Maximum Humanity from the creation base and installed cyberware. */
export function humanityMax(base: number, items: CyberwareItem[] | undefined): number {
  return base - (items ?? []).reduce((s, i) => s + maxHumanityPenalty(i), 0);
}

/** Humanity for a character built at creation: fixed losses, max lowered per item; current never above max. */
export function creationHumanity(emp: number, items: CyberwareItem[]): { current: number; max: number; base: number } {
  const base = emp * 10;
  const max = humanityMax(base, items);
  const loss = items.reduce((s, i) => s + i.humanityLoss, 0);
  return { base, max, current: Math.min(max, base - loss) };
}

// ----- Examples --------------------------------------------------------------------------

export interface CyberwareTemplate { item: Omit<CyberwareItem, 'id' | 'humanityLoss'>; hlDice: { count: number; bonus: number } }

/**
 * ORIGINAL example items for the builder: this tool's own names, effects and
 * Humanity Loss. They are not the book's items or values. Import your book's
 * catalog as a rules pack (Characters tab → Rules Packs).
 */
export const EXAMPLE_CYBERWARE: CyberwareTemplate[] = [
  { item: { name: 'Spinal Relay (Example)', slot: 'Neuralware', hlDice: '2d6', hlFixed: 7, install: 'clinic', effects: [{ kind: 'neuralLink' }], notes: 'Example backbone link; counts as a Neural Link for prerequisites.' }, hlDice: { count: 2, bonus: 0 } },
  { item: { name: 'Jack Ports (Example)', slot: 'Neuralware', hlDice: '1d6', hlFixed: 4, install: 'clinic', effects: [{ kind: 'interfacePlugs' }], notes: 'Example ports for decks and smartguns.' }, hlDice: { count: 1, bonus: 0 } },
  { item: { name: 'Aim-Assist Optic (Example)', slot: 'Cyberoptics', hlDice: '1d6', hlFixed: 4, install: 'clinic', effects: [{ kind: 'targetingScope' }], notes: 'Example optic; works as a Targeting Scope.' }, hlDice: { count: 1, bonus: 0 } },
  { item: { name: 'Grip Pads (Example)', slot: 'Cyberarm', hlDice: '1d6', hlFixed: 4, install: 'clinic', effects: [{ kind: 'subdermalGrip' }], notes: 'Example palm contacts; works as a Subdermal Grip.' }, hlDice: { count: 1, bonus: 0 } },
  { item: { name: 'Dermal Plating (Example)', slot: 'Internal Body', hlDice: '3d6', hlFixed: 11, install: 'hospital', effects: [{ kind: 'armor', location: 'body', sp: 10 }, { kind: 'armor', location: 'head', sp: 10 }], notes: 'Example armor under the skin.' }, hlDice: { count: 3, bonus: 0 } },
  { item: { name: 'Pain Damper Chip (Example)', slot: 'Chipware', hlDice: '3d6', hlFixed: 11, install: 'none', effects: [{ kind: 'ignoreSeriouslyWounded' }], notes: 'Example chip: ignore the Seriously Wounded penalty.' }, hlDice: { count: 3, bonus: 0 } },
  { item: { name: 'Regen Gland (Example)', slot: 'Internal Body', hlDice: '1d6', hlFixed: 4, install: 'clinic', effects: [{ kind: 'healingMultiplier', value: 2 }], notes: 'Example: heal twice as fast resting.' }, hlDice: { count: 1, bonus: 0 } },
  { item: { name: 'Reflex Tuner (Example)', slot: 'Neuralware', hlDice: '2d6', hlFixed: 7, install: 'clinic', effects: [{ kind: 'initiative', value: 1 }], notes: 'Example reflex booster.' }, hlDice: { count: 2, bonus: 0 } },
];
