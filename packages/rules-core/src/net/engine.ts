/**
 * Netrunning engine: pure functions over the net data model.
 * The session layer (packages/session/src/netrun.ts) sequences them into intents.
 */
import { makeCheck } from '../checks.js';
import type { Dice } from '../dice.js';
import type { CheckResult } from '../types.js';
import type { IceRef, InterfaceAbility, NetArchitecture, NetDice, NetFloor, NetRig, NetRun, Program } from './types.js';

// ----- Architecture graph --------------------------------------------------------

export function parentOf(arch: NetArchitecture, id: string): string | null {
  for (const [p, kids] of Object.entries(arch.children)) if (kids.includes(id)) return p;
  return null;
}

export const childrenOf = (arch: NetArchitecture, id: string): string[] => arch.children[id] ?? [];

/** Floors you can step to: up one, or down into any branch. */
export function neighborsOf(arch: NetArchitecture, id: string): string[] {
  const p = parentOf(arch, id);
  return [...(p ? [p] : []), ...childrenOf(arch, id)];
}

/** Floor number, counting the root as 1. */
export function depthOf(arch: NetArchitecture, id: string): number {
  let d = 1;
  for (let p = parentOf(arch, id); p; p = parentOf(arch, p)) d++;
  return d;
}

/** A lowest floor ends its branch (no children). Viruses go here. */
export const isLowestFloor = (arch: NetArchitecture, id: string) => childrenOf(arch, id).length === 0;

/** Breadth-first order from `from` downward. */
export function floorsBelow(arch: NetArchitecture, from: string): string[] {
  const out: string[] = [];
  const queue = [...childrenOf(arch, from)];
  while (queue.length) {
    const id = queue.shift()!;
    out.push(id);
    queue.push(...childrenOf(arch, id));
  }
  return out;
}

/**
 * Structural check for GM-authored architectures. Returns a sentence describing
 * the first problem, or null. Field bounds are validated by the session layer.
 */
export function architectureProblem(arch: NetArchitecture): string | null {
  const ids = Object.keys(arch.floors);
  if (!arch.floors[arch.rootId]) return 'The first floor is missing.';
  const seen = new Set<string>();
  const stack = [arch.rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) return 'Floors can’t loop back on themselves.';
    seen.add(id);
    for (const k of childrenOf(arch, id)) {
      if (!arch.floors[k]) return `Floor ${k} is linked but doesn’t exist.`;
      stack.push(k);
    }
  }
  if (seen.size !== ids.length) return 'Every floor must hang below the first floor.';
  for (const id of Object.keys(arch.children)) if (!arch.floors[id]) return `Floor ${id} has children but doesn’t exist.`;
  for (const f of Object.values(arch.floors)) {
    if ((f.kind === 'password' || f.kind === 'file' || f.kind === 'controlNode') && typeof f.dv !== 'number') return `${floorTitle(f)} needs a DV.`;
    if (f.kind === 'blackIce' && !f.ice?.length) return 'A Black ICE floor needs at least one ICE.';
    if (f.kind === 'demon' && !f.demon) return 'A Demon floor needs its Demon.';
  }
  return null;
}

export function floorTitle(f: NetFloor): string {
  const kind = { password: 'Password', file: 'File', controlNode: 'Control Node', blackIce: 'Black ICE', demon: 'Demon', empty: 'Empty Floor' }[f.kind];
  return f.label ? `${kind}: ${f.label}` : kind;
}

// ----- Checks -------------------------------------------------------------------

export function activePrograms(rig: NetRig): Program[] {
  return rig.programs.filter((p) => p.status === 'active');
}

/** Sum of active Booster bonuses for an ability (Boosters of the same kind stack). */
export function boostFor(rig: NetRig, ability: InterfaceAbility | 'speed'): number {
  return activePrograms(rig).reduce((s, p) => s + (p.class === 'booster' && p.boost?.ability === ability ? p.boost.amount : 0), 0);
}

/** Interface + Program boosts + 1d10. */
export function netCheck(rig: NetRig, ability: InterfaceAbility | 'speed', dice: Dice, extraBase: { label: string; value: number }[] = []): CheckResult {
  const boost = boostFor(rig, ability);
  return makeCheck([{ label: 'Interface', value: rig.interface }, ...extraBase], boost ? [{ label: 'Programs', value: boost }] : [], dice);
}

/** A flat stat + 1d10 (Black ICE SPD/ATK/DEF/PER, Demon Interface). */
export function statCheck(label: string, value: number, dice: Dice): CheckResult {
  return makeCheck([{ label, value }], [], dice);
}

export function rollNetDice(d: NetDice, dice: Dice): number[] {
  return Array.from({ length: d.count }, () => dice.d6());
}

/**
 * Pathfinder (Interpretation of the reveal rule): reveal floors below the
 * runner in breadth-first order, at most `total` of them, never past a
 * Password whose DV beats the roll (that Password itself is shown).
 */
export function pathfinderReveal(arch: NetArchitecture, from: string, total: number, already: readonly string[]): string[] {
  const known = new Set(already);
  const out: string[] = [];
  const queue = [...childrenOf(arch, from)];
  let budget = Math.max(0, total);
  while (queue.length && budget > 0) {
    const id = queue.shift()!;
    const f = arch.floors[id]!;
    if (!known.has(id)) { out.push(id); known.add(id); }
    budget--;
    const blocks = f.kind === 'password' && (f.dv ?? 0) > total;
    if (!blocks) queue.push(...childrenOf(arch, id));
  }
  return out;
}

/**
 * Brain damage: HP loss that ignores armor and never causes Critical Injuries.
 * An active Shield negates the first hit of the run; active Armor-type
 * Defenders reduce it; only the best one counts (Interpretation).
 */
export function brainDamage(rig: NetRig, run: NetRun | null, raw: number): { taken: number; reducedBy: number; shieldUsedId: string | null } {
  const active = activePrograms(rig);
  const shield = active.find((p) => p.class === 'defender' && p.shield);
  if (shield && run && !run.shieldSpent) return { taken: 0, reducedBy: raw, shieldUsedId: shield.id };
  const reduce = active.reduce((m, p) => Math.max(m, p.class === 'defender' ? p.brainReduce ?? 0 : 0), 0);
  const taken = Math.max(0, raw - reduce);
  return { taken, reducedBy: raw - taken, shieldUsedId: null };
}

/** Anti-program damage lands on the first rezzed Program in deck order (Interpretation; the GM can redirect). */
export function programHitBy(rig: NetRig): Program | null {
  return rig.programs.find((p) => p.status === 'active') ?? rig.programs.find((p) => p.status === 'ready') ?? null;
}

export function freshRun(arch: NetArchitecture): NetRun {
  const ice: Record<string, number[]> = {};
  const demonRez: Record<string, number> = {};
  for (const f of Object.values(arch.floors)) {
    if (f.ice?.length) ice[f.id] = f.ice.map((i) => i.rez);
    if (f.demon) demonRez[f.id] = f.demon.rez;
  }
  return {
    archId: arch.id, floorId: arch.rootId, revealed: [arch.rootId], passed: [], identified: [], controlled: [],
    ice, demonRez, encountered: [], cloakDv: null, virusDv: null, shieldSpent: false, slidTurn: null,
  };
}

export const iceKey = (home: string, index: number) => `${home}:${index}`;

/** The floor a Black ICE is on now (its home unless it chased the runner away). */
export const iceLocation = (run: NetRun, home: string, index: number): string => run.iceAt?.[iceKey(home, index)] ?? home;

/**
 * Every Black ICE on a floor for this run, live or derezzed: the floor's own
 * ICE first (in floor order), then ICE that followed the runner here. Op
 * indices ("attack ICE #i") count in this list.
 */
export function iceOn(run: NetRun, floorId: string): IceRef[] {
  const own: IceRef[] = [];
  const visitors: IceRef[] = [];
  for (const [home, rezList] of Object.entries(run.ice)) {
    rezList.forEach((rez, index) => {
      if (iceLocation(run, home, index) !== floorId) return;
      (home === floorId ? own : visitors).push({ home, index, rez });
    });
  }
  visitors.sort((a, b) => (a.home === b.home ? a.index - b.index : a.home < b.home ? -1 : 1));
  return [...own, ...visitors];
}

/** Live Black ICE on a floor for this run. */
export function liveIce(run: NetRun, floorId: string): IceRef[] {
  return iceOn(run, floorId).filter((r) => r.rez > 0);
}

/** Engaged = standing on a floor with live Black ICE or a live Demon. */
export function isEngaged(run: NetRun): boolean {
  return liveIce(run, run.floorId).length > 0 || (run.demonRez[run.floorId] ?? 0) > 0;
}

/**
 * Black ICE chases (Secondary): once it has met a runner it follows them from
 * floor to floor until it's derezzed, slid away from, or the runner jacks out.
 * Moves every live ICE on `from` to `to`, except `left` (the ICE a successful
 * Slide leaves behind, lying in wait there). Demons stay put.
 */
export function chase(run: NetRun, from: string, to: string, left?: IceRef): { run: NetRun; followers: IceRef[] } {
  const followers = liveIce(run, from).filter((r) => !left || r.home !== left.home || r.index !== left.index);
  if (!followers.length) return { run, followers };
  const iceAt = { ...(run.iceAt ?? {}) };
  for (const f of followers) {
    if (f.home === to) delete iceAt[iceKey(f.home, f.index)];
    else iceAt[iceKey(f.home, f.index)] = to;
  }
  return { run: { ...run, iceAt }, followers };
}
