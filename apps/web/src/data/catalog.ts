/**
 * Rules packs on the GM's device: catalogs of cyberware and Programs the GM
 * imports from their own books. Stored in localStorage only; never in the
 * session log, never sent to players, never in this repository.
 */
import { useSyncExternalStore } from 'react';
import { EXAMPLE_CYBERWARE, packProgram, parseRulesPack, PROGRAM_TEMPLATES, type CatalogCyberware, type Program, type RulesPack } from '@cprc/rules-core';

const KEY = 'nsc.rulesPacks';
const listeners = new Set<() => void>();
let packs: RulesPack[] = load();

function load(): RulesPack[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown[];
    return raw.flatMap((p) => { const r = parseRulesPack(p); return r.ok ? [r.pack] : []; });
  } catch { return []; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(packs)); } catch { /* private mode: session only */ }
  for (const l of listeners) l();
}

export function getPacks(): RulesPack[] { return packs; }

/** Import a pack from JSON text. Replaces a pack with the same name. Returns an error sentence or null. */
export function importPackText(text: string): string | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return 'That file isn’t valid JSON.'; }
  const r = parseRulesPack(raw);
  if (!r.ok) return r.error;
  packs = [...packs.filter((p) => p.name !== r.pack.name), r.pack];
  save();
  return null;
}

export function removePack(name: string) {
  packs = packs.filter((p) => p.name !== name);
  save();
}

export function usePacks(): RulesPack[] {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, getPacks);
}

/** Catalog entries grouped for a picker: original examples first, then each pack. */
export interface CyberwareGroup { label: string; items: CatalogCyberware[] }
export function cyberwareGroups(list: RulesPack[]): CyberwareGroup[] {
  const examples: CatalogCyberware[] = EXAMPLE_CYBERWARE.map((x) => ({
    name: x.item.name, hlDice: x.item.hlDice ?? `${x.hlDice.count}d6`,
    ...(x.item.hlFixed !== undefined ? { hlFixed: x.item.hlFixed } : {}),
    ...(x.item.slot ? { slot: x.item.slot } : {}),
    ...(x.item.install ? { install: x.item.install } : {}),
    effects: x.item.effects, ...(x.item.notes ? { notes: x.item.notes } : {}),
  }));
  return [{ label: 'Examples (Original)', items: examples }, ...list.filter((p) => p.cyberware?.length).map((p) => ({ label: p.name, items: p.cyberware! }))];
}

/** Every Program the GM can give a deck: original starters plus imported ones. */
export function programCatalog(list: RulesPack[]): Program[] {
  const imported = list.flatMap((p) => (p.programs ?? []).map(packProgram));
  const seen = new Set<string>();
  return [...PROGRAM_TEMPLATES, ...imported].filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}
