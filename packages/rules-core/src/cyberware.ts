/**
 * Cyberware and Humanity.
 *
 * Humanity starts at EMP × 10. Installing cyberware costs Humanity Loss (rolled
 * per item or set by the GM). Current EMP = floor(Humanity / 10), so 44 → 4 and
 * 39 → 3 (Secondary). At 0 Humanity or below the character is a cyberpsycho and
 * goes to the GM (Secondary). Removing cyberware restores half its Humanity Loss,
 * rounded down (Secondary). Therapy: see `THERAPY`.
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

export function cyberwareMods(items: CyberwareItem[] | undefined): CombatMods {
  let m: CombatMods = {};
  for (const item of items ?? []) {
    for (const e of item.effects) {
      switch (e.kind) {
        case 'stat': m = mergeMods(m, { statBonuses: { [e.stat]: e.value } }); break;
        case 'skill': m = mergeMods(m, { skillBonuses: { [e.skill]: e.value } }); break;
        case 'initiative': m = mergeMods(m, { initiative: e.value }); break;
        case 'smartLink': m.smartLink = true; break;
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
  return next;
}

/** Null if valid, else the reason. */
export function cyberwareProblem(item: CyberwareItem): string | null {
  if (!item || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(item.id)) return 'Cyberware needs a short id (letters, digits, - or _).';
  if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80) return 'Cyberware needs a name (up to 80 characters).';
  if (item.slot !== undefined && (typeof item.slot !== 'string' || item.slot.length > 40)) return 'Slot name is too long.';
  if (!Number.isInteger(item.humanityLoss) || item.humanityLoss < 0 || item.humanityLoss > 100) return 'Humanity Loss must be a whole number from 0 to 100.';
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
    case 'smartLink': case 'interfacePlugs': case 'ignoreSeriouslyWounded': return null;
    default: return 'Unknown cyberware effect.';
  }
}

export interface CyberwareTemplate { item: Omit<CyberwareItem, 'id' | 'humanityLoss'>; hlDice: { count: number; bonus: number } }

/**
 * Original example items for the builder. Humanity Loss dice here are
 * EXAMPLES; set each item's loss from your book.
 */
export const EXAMPLE_CYBERWARE: CyberwareTemplate[] = [
  { item: { name: 'Neural Link', slot: 'Neuralware', effects: [], notes: 'Needed for chipware and interface plugs.' }, hlDice: { count: 1, bonus: 0 } },
  { item: { name: 'Interface Plugs', slot: 'Neuralware', effects: [{ kind: 'interfacePlugs' }], notes: 'Jack into a cyberdeck or machine.' }, hlDice: { count: 1, bonus: 0 } },
  { item: { name: 'Pain Editor', slot: 'Chipware', effects: [{ kind: 'ignoreSeriouslyWounded' }], notes: 'Ignore the Seriously Wounded penalty.' }, hlDice: { count: 4, bonus: 0 } },
  { item: { name: 'Targeting Scope', slot: 'Cyberoptics', effects: [{ kind: 'smartLink' }], notes: 'Lets Smart ammunition track.' }, hlDice: { count: 1, bonus: 0 } },
  { item: { name: 'Subdermal Armor', slot: 'Internal Body', effects: [{ kind: 'armor', location: 'body', sp: 11 }, { kind: 'armor', location: 'head', sp: 11 }], notes: 'Armor under the skin.' }, hlDice: { count: 4, bonus: 0 } },
  { item: { name: 'Enhanced Antibodies', slot: 'Internal Body', effects: [{ kind: 'healingMultiplier', value: 2 }], notes: 'Heal twice as fast resting.' }, hlDice: { count: 1, bonus: 0 } },
  { item: { name: 'Reflex Tuner', slot: 'Neuralware', effects: [{ kind: 'initiative', value: 1 }], notes: 'Example reflex booster.' }, hlDice: { count: 2, bonus: 0 } },
];
