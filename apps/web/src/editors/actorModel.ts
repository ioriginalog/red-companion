/**
 * Character builder model: a flat, form-friendly draft that converts to and
 * from a session Actor. Pure; tested in apps/web/test/editors.test.ts.
 */
import {
  ammoProblem, applySystems, ARMOR_TYPES, creationHumanity, cyberwareProblem, humanityMax, maxHP, roleProblem, seriouslyWoundedThreshold, smartWeaponProblem, WEAPON_TYPES,
  type AmmoTypeId, type ArmorPiece, type Combatant, type CyberwareItem, type GearItem, type HitLocation, type RoleState, type Stats, type Weapon, type WeaponType,
} from '@cprc/rules-core';
import type { Actor, Allegiance } from '@cprc/session';

export type ArmorChoice = { kind: 'none' } | { kind: 'type'; typeId: string } | { kind: 'custom'; name: string; sp: number; penalty: number };

export interface WeaponDraft {
  id: string;
  name: string;
  type: WeaponType;
  /** Blank (null) for weapons without a magazine. */
  capacity: number | null;
  rofOverride: 1 | 2 | null;
  damageDiceOverride: number | null;
  ammoType?: AmmoTypeId;
  smartgunLink?: boolean;
  smart?: 'built' | 'rebuild';
  tech2070s?: 'power' | 'tech';
  quality?: 'poor' | 'excellent';
}

export interface ActorDraft {
  id: string;
  name: string;
  allegiance: Allegiance;
  controller: string;
  portrait: string | null;
  stats: Stats;
  skills: Record<string, number>;
  weapons: WeaponDraft[];
  armor: { head: ArmorChoice; body: ArmorChoice };
  notes: string;
  /** GM-only notes (never sent to players). */
  gmNotes: string;
  /** Role and rank (Combat Awareness / Medicine allocations live here). */
  role: RoleState | null;
  cyberware: CyberwareItem[];
  gear: GearItem[];
}

/** Actor with its notes: `notes` is shown to anyone with the full sheet, `gmNotes` to the GM only. */
export type ActorWithNotes = Actor & { notes?: string; gmNotes?: string };

export const STAT_MIN = 1;
export const STAT_MAX = 10;
export const SKILL_MAX = 10;

export const DEFAULT_STATS: Stats = { INT: 5, REF: 5, DEX: 5, TECH: 5, COOL: 5, WILL: 5, LUCK: 5, MOVE: 5, BODY: 5, EMP: 5 };

export function slugify(name: string): string {
  const s = name.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
  return s.slice(0, 32) || 'actor';
}

/**
 * A fresh, opaque id not in `taken` (`a-` + 10 random base-36 characters).
 * Ids reach players for visible characters, so they must not reveal a name,
 * a template or a count. `_base` is kept for call-site readability.
 */
export function uniqueId(_base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  for (;;) {
    const bytes = new Uint8Array(10);
    globalThis.crypto.getRandomValues(bytes);
    const id = `a-${Array.from(bytes, (b) => (b % 36).toString(36)).join('')}`;
    if (!set.has(id)) return id;
  }
}

/** Numbered names for bulk spawns: "Thug 1", "Thug 2", … skipping names already used. */
export function numberedNames(base: string, count: number, taken: Iterable<string>): string[] {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  const out: string[] = [];
  for (let n = 1; out.length < count; n++) {
    const name = `${base} ${n}`;
    if (!used.has(name.toLowerCase())) out.push(name);
  }
  return out;
}

export function emptyDraft(): ActorDraft {
  return {
    id: '', name: '', allegiance: 'hostile', controller: 'gm', portrait: null, stats: { ...DEFAULT_STATS },
    skills: { Evasion: 2, Perception: 2 }, weapons: [], armor: { head: { kind: 'none' }, body: { kind: 'none' } }, notes: '', gmNotes: '',
    role: null, cyberware: [], gear: [],
  };
}

export function derived(stats: Stats) {
  const max = maxHP(stats.BODY, stats.WILL);
  return {
    maxHp: max,
    /** Seriously Wounded when HP is below this. */
    seriouslyBelow: seriouslyWoundedThreshold(max),
    deathSaveUnder: stats.BODY,
    moveMeters: stats.MOVE * 2,
  };
}

export function defaultCapacity(type: WeaponType): number | null {
  const p = WEAPON_TYPES[type];
  if (p.melee) return null;
  switch (type) {
    case 'mediumPistol': return 12;
    case 'heavyPistol': return 8;
    case 'veryHeavyPistol': return 8;
    case 'smg': return 30;
    case 'heavySmg': return 40;
    case 'shotgun': return 4;
    case 'assaultRifle': return 25;
    case 'sniperRifle': return 4;
    case 'bowsAndCrossbows': return 1;
    case 'grenadeLauncher': return 2;
    case 'rocketLauncher': return 1;
    case 'grenade': return 3;
    default: return null;
  }
}

export function newWeaponDraft(type: WeaponType, existing: WeaponDraft[]): WeaponDraft {
  return {
    id: uniqueId(type, existing.map((w) => w.id)),
    name: WEAPON_TYPES[type].displayName,
    type, capacity: defaultCapacity(type), rofOverride: null, damageDiceOverride: null,
  };
}

function armorPiece(location: HitLocation, c: ArmorChoice, prev?: ArmorPiece): ArmorPiece | null {
  if (c.kind === 'none') return null;
  const spec = c.kind === 'type'
    ? (() => { const t = ARMOR_TYPES.find((a) => a.id === c.typeId); return t ? { name: t.displayName, sp: t.sp, penalty: t.penalty } : null; })()
    : { name: c.name.trim() || 'Custom Armor', sp: clamp(c.sp, 0, 30), penalty: clamp(c.penalty, -6, 0) };
  if (!spec) return null;
  const name = location === 'head' && c.kind === 'type' ? `${spec.name} Helmet` : spec.name;
  const sameMax = prev && prev.maxSP === spec.sp;
  return { id: location, name, location, maxSP: spec.sp, currentSP: sameMax ? prev.currentSP : spec.sp, penalty: spec.penalty };
}

function armorChoice(p: ArmorPiece | undefined): ArmorChoice {
  if (!p) return { kind: 'none' };
  const base = p.name.replace(/ Helmet$/, '');
  const t = ARMOR_TYPES.find((a) => a.displayName === base && a.sp === p.maxSP && a.penalty === p.penalty);
  return t ? { kind: 'type', typeId: t.id } : { kind: 'custom', name: p.name, sp: p.maxSP, penalty: p.penalty };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n) ? n : lo)));

export function draftFromActor(a: ActorWithNotes): ActorDraft {
  const c = a.combatant;
  return {
    id: a.id,
    name: c.name,
    allegiance: a.allegiance ?? (c.side === 'pc' ? 'party' : 'hostile'),
    controller: a.controller,
    portrait: a.portrait ?? null,
    // Starting EMP: Humanity's maximum is EMP × 10 at creation.
    stats: { ...c.stats, ...(c.humanity ? { EMP: Math.round(humanityBaseOf(c) / 10) } : {}) },
    skills: { ...c.skills },
    weapons: a.weapons.map((w) => ({
      id: w.id, name: w.name, type: w.type, capacity: w.ammo?.capacity ?? null,
      rofOverride: w.rofOverride ?? null, damageDiceOverride: w.damageDiceOverride ?? null,
      ...(w.ammoType && w.ammoType !== 'basic' ? { ammoType: w.ammoType } : {}),
      ...(w.smartgunLink ? { smartgunLink: true } : {}),
      ...(w.smart ? { smart: w.smart } : {}),
      ...(w.tech2070s ? { tech2070s: w.tech2070s } : {}),
      ...(w.quality && w.quality !== 'standard' ? { quality: w.quality } : {}),
    })),
    armor: {
      head: armorChoice(c.armor.find((p) => p.location === 'head' && !p.id.startsWith('cw:'))),
      body: armorChoice(c.armor.find((p) => p.location === 'body' && !p.id.startsWith('cw:'))),
    },
    notes: a.notes ?? '',
    gmNotes: a.gmNotes ?? '',
    role: c.role ? { ...c.role } : null,
    cyberware: (c.cyberware ?? []).map((i) => ({ ...i, effects: i.effects.map((e) => ({ ...e })) })),
    gear: (c.gear ?? []).map((g) => ({ ...g })),
  };
}

export interface BuildOptions {
  /** Existing actor to update: keeps current HP, injuries, Death Save penalty, conditions, ammo and armor ablation. */
  previous?: Actor;
  /** Ignore `previous` health and gear state: full HP, fresh armor and magazines, no injuries. */
  resetState?: boolean;
}

export function actorFromDraft(d: ActorDraft, opts: BuildOptions = {}): ActorWithNotes {
  const prev = opts.resetState ? undefined : opts.previous;
  const stats = Object.fromEntries(Object.entries(d.stats).map(([k, v]) => [k, clamp(v, STAT_MIN, STAT_MAX)])) as Stats;
  const max = maxHP(stats.BODY, stats.WILL);
  const pc = prev?.combatant;
  // Keep damage taken: same wounds, new ceiling.
  const current = pc ? Math.min(max, pc.hp.current + (max - pc.hp.max) * (pc.hp.current === pc.hp.max ? 1 : 0)) : max;
  const skills = Object.fromEntries(Object.entries(d.skills).filter(([, v]) => v > 0).map(([k, v]) => [k, clamp(v, 0, SKILL_MAX)]));
  const weapons: Weapon[] = d.weapons.map((w) => {
    const old = prev?.weapons.find((x) => x.id === w.id);
    const capacity = w.capacity === null || WEAPON_TYPES[w.type].melee ? null : clamp(w.capacity, 1, 200);
    const loaded = capacity === null ? 0 : old?.ammo ? Math.min(old.ammo.loaded, capacity) : capacity;
    return {
      id: w.id, name: w.name.trim() || WEAPON_TYPES[w.type].displayName, type: w.type,
      ...(capacity !== null ? { ammo: { loaded, capacity } } : {}),
      ...(w.rofOverride ? { rofOverride: w.rofOverride } : {}),
      ...(w.damageDiceOverride ? { damageDiceOverride: clamp(w.damageDiceOverride, 1, 10) } : {}),
      ...(w.ammoType && w.ammoType !== 'basic' && capacity !== null ? { ammoType: w.ammoType } : {}),
      ...(w.smartgunLink ? { smartgunLink: true } : {}),
      ...(w.smart ? { smart: w.smart } : {}),
      ...(w.tech2070s ? { tech2070s: w.tech2070s } : {}),
      ...(w.quality && !(w.quality === 'excellent' && w.type === 'bowsAndCrossbows') ? { quality: w.quality } : {}),
    };
  });
  const armor = (['body', 'head'] as const)
    .map((loc) => armorPiece(loc, d.armor[loc], pc?.armor.find((p) => p.location === loc && !p.id.startsWith('cw:'))))
    .filter((p): p is ArmorPiece => p !== null)
    // Keep cyberware armor's ablation; applySystems rebuilds the pieces from the cyberware list.
    .concat((pc?.armor ?? []).filter((p) => p.id.startsWith('cw:')));
  const id = d.id;
  const actor: ActorWithNotes = {
    id,
    controller: d.allegiance === 'party' ? d.controller || 'gm' : 'gm',
    allegiance: d.allegiance,
    weapons,
    ...(d.portrait ? { portrait: d.portrait } : {}),
    ...(d.notes.trim() ? { notes: d.notes.trim() } : {}),
    ...(d.gmNotes.trim() ? { gmNotes: d.gmNotes.trim() } : {}),
    combatant: {
      id,
      name: d.name.trim() || 'Unnamed',
      side: d.allegiance === 'party' ? 'pc' : 'npc',
      stats,
      skills,
      hp: { max, current },
      armor,
      criticalInjuries: pc?.criticalInjuries ?? [],
      deathSave: pc?.deathSave ?? { accumulatedPenalty: 0 },
      conditions: pc?.conditions ?? { prone: false, unconscious: false, dead: false, stabilized: false },
      ...(pc?.flags ? { flags: pc.flags } : {}),
      ...(d.role ? { role: { ...d.role } } : {}),
      ...(d.cyberware.length ? { cyberware: d.cyberware.map((i) => ({ ...i })) } : {}),
      humanity: humanityFor(stats.EMP, d.cyberware, pc),
      ...(d.gear.length ? { gear: d.gear.map((g) => ({ ...g })) } : {}),
      ...(pc?.onFire ? { onFire: pc.onFire } : {}),
    },
  };
  actor.combatant = applySystems(actor.combatant);
  return actor;
}

/** Creation Humanity (EMP × 10) of an existing combatant; older saves derive it from max. */
export function humanityBaseOf(c: Combatant): number {
  if (!c.humanity) return c.stats.EMP * 10;
  return c.humanity.base ?? c.humanity.max - humanityMax(0, c.cyberware);
}

/**
 * Humanity at creation: base EMP × 10, maximum lowered 2 per item with
 * Humanity Loss (4 borgware), current = base − losses (never above max).
 * Editing an existing character keeps whatever else moved it (therapy, GM
 * changes) by applying only the difference the edit makes.
 */
export function humanityFor(emp: number, cyberware: CyberwareItem[], prev?: Combatant): { current: number; max: number; base: number } {
  const next = creationHumanity(emp, cyberware);
  if (!prev?.humanity) return next;
  const before = creationHumanity(Math.round(humanityBaseOf(prev) / 10), prev.cyberware ?? []);
  const current = Math.min(next.max, prev.humanity.current + (next.current - before.current));
  return { ...next, current };
}

/** Problems that should stop a save. Sentence case for display. */
export function validateDraft(d: ActorDraft): string[] {
  const out: string[] = [];
  if (!d.name.trim()) out.push('Give the character a name.');
  if (d.weapons.some((w) => !(w.type in WEAPON_TYPES))) out.push('A weapon has an unknown type.');
  for (const w of d.weapons) {
    const p = w.type in WEAPON_TYPES ? smartWeaponProblem({ id: w.id, name: w.name, type: w.type, ...(w.smartgunLink ? { smartgunLink: true } : {}), ...(w.smart ? { smart: w.smart } : {}), ...(w.tech2070s ? { tech2070s: w.tech2070s } : {}) }) : null;
    if (p) out.push(`${w.name || 'A weapon'}: ${p}`);
  }
  const ids = d.weapons.map((w) => w.id);
  if (new Set(ids).size !== ids.length) out.push('Two weapons share an id.');
  if (d.role) { const p = roleProblem(d.role); if (p) out.push(p); }
  for (const i of d.cyberware) { const p = cyberwareProblem(i); if (p) out.push(`${i.name || 'Cyberware'}: ${p}`); }
  const cwIds = d.cyberware.map((i) => i.id);
  if (new Set(cwIds).size !== cwIds.length) out.push('Two cyberware items share an id.');
  for (const w of d.weapons) {
    if (w.ammoType && w.ammoType !== 'basic') {
      const p = ammoProblem({ id: w.id, name: w.name, type: w.type }, w.ammoType);
      if (p) out.push(p);
    }
  }
  return out;
}

// ----- JSON import/export ------------------------------------------------------

export const ACTOR_FILE_KIND = 'nsc.actors';

export function exportActors(actors: Actor[]): string {
  return JSON.stringify({ kind: ACTOR_FILE_KIND, version: 1, actors }, null, 2);
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Accepts our export file, a bare actor, or an array of actors. Throws with a readable message. */
export function importActors(text: string): ActorWithNotes[] {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('That file isn’t valid JSON.'); }
  const list = isObj(data) && Array.isArray(data.actors) ? data.actors : Array.isArray(data) ? data : [data];
  return list.map((raw, i) => {
    if (!isObj(raw) || !isObj(raw.combatant) || typeof raw.id !== 'string' || !Array.isArray(raw.weapons)) {
      throw new Error(`Entry ${i + 1} isn’t a character.`);
    }
    const c = raw.combatant;
    if (typeof c.name !== 'string' || !isObj(c.stats) || !isObj(c.hp)) throw new Error(`Entry ${i + 1} is missing its name, STATs or HP.`);
    for (const w of raw.weapons) {
      if (!isObj(w) || typeof w.type !== 'string' || !(w.type in WEAPON_TYPES)) throw new Error(`Entry ${i + 1} has an unknown weapon type.`);
    }
    if (typeof raw.portrait === 'string' && !safeImageUrl(raw.portrait)) throw new Error(`Entry ${i + 1} has a portrait URL that isn’t allowed.`);
    // Rebuild through the draft so every field is normalized.
    const draft = draftFromActor({ ...(raw as unknown as ActorWithNotes), combatant: { ...(raw as unknown as Actor).combatant, id: raw.id } });
    return actorFromDraft(draft, { previous: raw as unknown as Actor });
  });
}

/** Same-origin paths, our uploads, or inline images. No remote hosts (CSP would block them anyway). */
export function safeImageUrl(u: string): boolean {
  return /^\/(?!\/)[\w./-]+$/.test(u) || /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(u) || u.startsWith('blob:');
}
