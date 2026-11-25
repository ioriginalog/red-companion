/**
 * Rules packs: GM-supplied catalogs (cyberware, Programs) loaded at runtime.
 *
 * The repository ships only original example items. A GM who owns the books
 * can import a pack with the official names and values; packs live on the GM's
 * device, never in this repository. Validation here is strict so a bad file
 * can't put nonsense into the engine.
 */
import { cyberwareProblem, hlAverage, parseHlDice } from '../cyberware.js';
import type { CyberwareEffect, CyberwareItem } from '../types.js';
import type { InterfaceAbility, Program } from '../net/types.js';

export const RULES_PACK_FORMAT = 'nsc-rules-pack';

/** Catalog entry: an installable item without an id or a rolled loss yet. */
export interface CatalogCyberware {
  name: string;
  slot?: string;
  /** As written: "2d6", "1d6/2", "0". */
  hlDice: string;
  /** Fixed value used at character creation. Defaults to the dice average. */
  hlFixed?: number;
  install?: 'mall' | 'clinic' | 'hospital' | 'none';
  costEb?: number;
  borgware?: boolean;
  effects?: CyberwareEffect[];
  notes?: string;
}

export interface RulesPack {
  format: typeof RULES_PACK_FORMAT;
  version: 1;
  /** Shown in the pack list, e.g. "Core Cyberware (My Book)". */
  name: string;
  /** Optional source note, e.g. book and page range. */
  source?: string;
  cyberware?: CatalogCyberware[];
  programs?: Omit<Program, 'status' | 'rez'>[];
}

const ABILITIES: ReadonlySet<string> = new Set<InterfaceAbility | 'speed'>(['backdoor', 'cloak', 'control', 'eyeDee', 'pathfinder', 'scanner', 'slide', 'virus', 'zap', 'speed']);
const isInt = (n: unknown, lo: number, hi: number) => Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi;
const isStr = (s: unknown, max: number) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
const isObj = (o: unknown): o is Record<string, unknown> => !!o && typeof o === 'object' && !Array.isArray(o);

/** Turn a catalog entry into an installable item (fixed loss by default). */
export function catalogToItem(entry: CatalogCyberware, id: string, loss: number = entry.hlFixed ?? hlAverage(parseHlDice(entry.hlDice)!)): CyberwareItem {
  return {
    id, name: entry.name, humanityLoss: loss, effects: (entry.effects ?? []).map((e) => ({ ...e })),
    hlDice: entry.hlDice,
    ...(entry.hlFixed !== undefined ? { hlFixed: entry.hlFixed } : { hlFixed: hlAverage(parseHlDice(entry.hlDice)!) }),
    ...(entry.slot ? { slot: entry.slot } : {}),
    ...(entry.install ? { install: entry.install } : {}),
    ...(entry.costEb !== undefined ? { costEb: entry.costEb } : {}),
    ...(entry.borgware ? { borgware: true } : {}),
    ...(entry.notes ? { notes: entry.notes } : {}),
  };
}

function programProblem(p: unknown, i: number): string | null {
  const at = `Program ${i + 1}`;
  if (!isObj(p)) return `${at} isn’t an object.`;
  if (!isStr(p.id, 40) || !/^[A-Za-z0-9_-]+$/.test(p.id as string)) return `${at} needs a short id.`;
  if (!isStr(p.name, 60)) return `${at} needs a name.`;
  if (!['booster', 'defender', 'attacker'].includes(p.class as string)) return `${at}: class must be booster, defender or attacker.`;
  if (p.target !== undefined && p.target !== 'ice' && p.target !== 'netrunner') return `${at}: target must be ice or netrunner.`;
  if (!isInt(p.atk, 0, 10) || !isInt(p.def, 0, 10)) return `${at}: ATK and DEF must be 0–10.`;
  if (!isInt(p.maxRez, 1, 50)) return `${at}: REZ must be 1–50.`;
  if (p.boost !== undefined && (!isObj(p.boost) || !ABILITIES.has(p.boost.ability as string) || !isInt(p.boost.amount, 1, 10))) return `${at}: boost needs an Interface Ability and an amount 1–10.`;
  if (p.brainReduce !== undefined && !isInt(p.brainReduce, 1, 20)) return `${at}: brain damage reduction must be 1–20.`;
  if (p.shield !== undefined && typeof p.shield !== 'boolean') return `${at}: shield must be true or false.`;
  if (p.damage !== undefined && (!isObj(p.damage) || !isInt(p.damage.count, 1, 10) || p.damage.sides !== 6)) return `${at}: damage must be 1–10 d6.`;
  if (p.summary !== undefined && (typeof p.summary !== 'string' || p.summary.length > 300)) return `${at}: summary is too long.`;
  return null;
}

/** Validate an imported pack. Returns the pack or a sentence-case reason. */
export function parseRulesPack(raw: unknown): { ok: true; pack: RulesPack } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (!isObj(raw) || raw.format !== RULES_PACK_FORMAT) return fail('That isn’t a rules pack (format must be "nsc-rules-pack").');
  if (raw.version !== 1) return fail('Unsupported rules pack version.');
  if (!isStr(raw.name, 80)) return fail('The pack needs a name (up to 80 characters).');
  if (raw.source !== undefined && (typeof raw.source !== 'string' || raw.source.length > 200)) return fail('Source note is too long.');
  const cyber = raw.cyberware ?? [];
  const progs = raw.programs ?? [];
  if (!Array.isArray(cyber) || cyber.length > 500) return fail('Cyberware must be a list of up to 500 items.');
  if (!Array.isArray(progs) || progs.length > 200) return fail('Programs must be a list of up to 200 items.');
  if (!cyber.length && !progs.length) return fail('The pack has no cyberware or Programs.');
  const cyberware: CatalogCyberware[] = [];
  for (const [i, e] of cyber.entries()) {
    const at = `Cyberware ${i + 1}`;
    if (!isObj(e)) return fail(`${at} isn’t an object.`);
    if (typeof e.hlDice !== 'string' || !parseHlDice(e.hlDice)) return fail(`${at}: Humanity Loss dice must look like 2d6, 1d6/2 or 0.`);
    const entry = e as unknown as CatalogCyberware;
    const problem = cyberwareProblem(catalogToItem(entry, `pack-${i}`));
    if (problem) return fail(`${at} (${String(e.name ?? '?')}): ${problem}`);
    cyberware.push({
      name: entry.name, hlDice: entry.hlDice,
      ...(entry.slot ? { slot: entry.slot } : {}),
      ...(entry.hlFixed !== undefined ? { hlFixed: entry.hlFixed } : {}),
      ...(entry.install ? { install: entry.install } : {}),
      ...(entry.costEb !== undefined ? { costEb: entry.costEb } : {}),
      ...(entry.borgware ? { borgware: true } : {}),
      ...(entry.effects?.length ? { effects: entry.effects.map((x) => ({ ...x })) } : {}),
      ...(entry.notes ? { notes: entry.notes } : {}),
    });
  }
  const programs: RulesPack['programs'] = [];
  for (const [i, p] of progs.entries()) {
    const problem = programProblem(p, i);
    if (problem) return fail(problem);
    const q = p as Omit<Program, 'status' | 'rez'>;
    programs.push({ ...q });
  }
  return {
    ok: true,
    pack: {
      format: RULES_PACK_FORMAT, version: 1, name: (raw.name as string).trim(),
      ...(raw.source ? { source: raw.source as string } : {}),
      ...(cyberware.length ? { cyberware } : {}),
      ...(programs.length ? { programs } : {}),
    },
  };
}

/** A ready-to-install Program from a pack entry. */
export const packProgram = (p: Omit<Program, 'status' | 'rez'>): Program => ({ ...p, rez: p.maxRez, status: 'ready' });
