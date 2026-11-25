/**
 * Netrunning intents (`{ type: 'net', op }`), run by the authority on the GM
 * device. Every payload is validated here: the op arrives from an untrusted
 * client as `unknown`.
 *
 * Turn economy (Secondary): on their Turn a runner takes either a Meat Action
 * or all their NET Actions (netActionsFor(Interface)), plus the Move Action.
 * Players are held to it; the GM is recorded but never refused.
 */
import {
  architectureProblem, brainDamage, depthOf, floorTitle, freshRun, gridDistance, hasLineOfSight, isEngaged,
  isLowestFloor, JACK_IN_RANGE_SQUARES, liveIce, neighborsOf, netActionsFor, netCheck, parentOf,
  pathfinderReveal, programHitBy, QUICKHACK_RANGE_SQUARES, RESTART_COST, rollNetDice, statCheck, woundState, interfaceRank,
  type CheckResult, type CombatEvent, type Dice, type IceStats, type NetArchitecture, type NetDifficulty, type NetFloor,
  type NetRig, type NetRun, type Program,
} from '@cprc/rules-core';
import { controls, currentActorId, getActor, SessionError, usageFor, visibilityFor } from './helpers.js';
import type { NetFloorView, NetOp, NetRunView, NetState, NetView } from './netrun-types.js';
import type { Actor, Encounter, SessionState, StatePatch, Viewer } from './types.js';

type Result = { events: CombatEvent[]; patch: StatePatch };

export const emptyNet = (): NetState => ({ quickhacks2070s: false, architectures: {}, rigs: {}, runs: {}, found: [] });

// ----- Validation ------------------------------------------------------------------

const bad = (msg: string): never => { throw new SessionError('INVALID', msg); };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const int = (v: unknown, lo: number, hi: number, what: string): number =>
  (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : bad(`${what} must be a whole number from ${lo} to ${hi}.`));
const str = (v: unknown, max: number, what: string, min = 1): string =>
  (typeof v === 'string' && v.trim().length >= min && v.length <= max ? v : bad(`${what} must be text up to ${max} characters.`));
const optStr = (v: unknown, max: number, what: string): string | undefined => (v === undefined || v === '' ? undefined : str(v, max, what));
const id = (v: unknown, what: string): string =>
  (typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(v) ? v : bad(`${what} isn’t a valid id.`));
const oneOf = <T extends string>(v: unknown, opts: readonly T[], what: string): T =>
  (typeof v === 'string' && (opts as readonly string[]).includes(v) ? (v as T) : bad(`${what} isn’t one of ${opts.join(', ')}.`));
const bool = (v: unknown, what: string): boolean => (typeof v === 'boolean' ? v : bad(`${what} must be true or false.`));

const DIFFICULTIES: readonly NetDifficulty[] = ['basic', 'standard', 'uncommon', 'advanced'];
const FLOOR_KINDS = ['password', 'file', 'controlNode', 'blackIce', 'demon', 'empty'] as const;
const ABILITIES = ['backdoor', 'cloak', 'control', 'eyeDee', 'pathfinder', 'slide', 'virus', 'zap'] as const;
const BOOSTABLE = ['backdoor', 'cloak', 'control', 'eyeDee', 'pathfinder', 'scanner', 'slide', 'virus', 'zap', 'speed'] as const;

function vDice(v: unknown, what: string) {
  if (!isObj(v)) return bad(`${what} needs dice.`);
  return { count: int(v.count, 1, 10, `${what} dice`), sides: 6 as const };
}

function vIce(v: unknown): IceStats {
  if (!isObj(v)) return bad('ICE must be an object.');
  const effect = optStr(v.effect, 200, 'ICE effect');
  return {
    name: str(v.name, 40, 'ICE name'), kind: oneOf(v.kind, ['antiPersonnel', 'antiProgram'] as const, 'ICE kind'),
    per: int(v.per, 0, 30, 'PER'), spd: int(v.spd, 0, 30, 'SPD'), atk: int(v.atk, 0, 30, 'ATK'), def: int(v.def, 0, 30, 'DEF'),
    rez: int(v.rez, 1, 200, 'REZ'), damage: vDice(v.damage, 'ICE'), ...(effect ? { effect } : {}),
  };
}

function vFloor(v: unknown, key: string): NetFloor {
  if (!isObj(v)) return bad('Each floor must be an object.');
  const fid = id(v.id, 'Floor');
  if (fid !== key) bad('Floor ids must match their keys.');
  const kind = oneOf(v.kind, FLOOR_KINDS, 'Floor kind');
  const label = optStr(v.label, 40, 'Floor label');
  const note = optStr(v.note, 500, 'Floor note');
  const f: NetFloor = { id: fid, kind, ...(label ? { label } : {}), ...(note ? { note } : {}) };
  if (kind === 'password' || kind === 'file' || kind === 'controlNode') f.dv = int(v.dv, 1, 40, 'DV');
  if (kind === 'blackIce') {
    if (!Array.isArray(v.ice) || v.ice.length < 1 || v.ice.length > 3) bad('A Black ICE floor holds one to three ICE.');
    f.ice = (v.ice as unknown[]).map(vIce);
  }
  if (kind === 'demon') {
    const d = isObj(v.demon) ? v.demon : bad('A Demon floor needs its Demon.');
    f.demon = { name: str(d.name, 40, 'Demon name'), rez: int(d.rez, 1, 200, 'Demon REZ'), interface: int(d.interface, 1, 10, 'Demon Interface'), netActions: int(d.netActions, 1, 6, 'Demon NET Actions') };
  }
  return f;
}

export function validateArchitecture(v: unknown): NetArchitecture {
  if (!isObj(v)) return bad('The architecture must be an object.');
  if (!isObj(v.floors) || !isObj(v.children)) return bad('The architecture needs floors and links.');
  const floorEntries = Object.entries(v.floors);
  if (floorEntries.length < 1 || floorEntries.length > 60) bad('An architecture has 1 to 60 floors.');
  const floors: Record<string, NetFloor> = {};
  for (const [k, f] of floorEntries) floors[id(k, 'Floor')] = vFloor(f, k);
  const children: Record<string, string[]> = {};
  for (const [k, kids] of Object.entries(v.children)) {
    if (!Array.isArray(kids) || kids.length > 4) bad('A floor branches into at most four floors.');
    if ((kids as unknown[]).length) children[id(k, 'Floor')] = (kids as unknown[]).map((c) => id(c, 'Floor'));
  }
  if (!Array.isArray(v.access) || v.access.length > 10) bad('Access points must be a list (up to 10 maps).');
  const access = (v.access as unknown[]).map((a) => {
    if (!isObj(a) || !Array.isArray(a.cells) || a.cells.length > 20) return bad('Each access entry lists up to 20 squares.');
    return {
      mapId: id(a.mapId, 'Map'),
      cells: (a.cells as unknown[]).map((c) => (isObj(c) ? { x: int(c.x, 0, 999, 'x'), y: int(c.y, 0, 999, 'y') } : bad('Bad square.'))),
    };
  });
  const arch: NetArchitecture = {
    id: id(v.id, 'Architecture'), name: str(v.name, 60, 'Architecture name'), difficulty: oneOf(v.difficulty, DIFFICULTIES, 'Difficulty'),
    rootId: id(v.rootId, 'First floor'), floors, children, access, virusDv: int(v.virusDv, 1, 40, 'Virus DV'),
  };
  const problem = architectureProblem(arch);
  if (problem) bad(problem);
  return arch;
}

function vProgram(v: unknown): Program {
  if (!isObj(v)) return bad('Each Program must be an object.');
  const cls = oneOf(v.class, ['booster', 'defender', 'attacker'] as const, 'Program class');
  const maxRez = int(v.maxRez, 1, 50, 'Program max REZ');
  const summary = optStr(v.summary, 200, 'Program summary');
  const p: Program = {
    id: id(v.id, 'Program'), name: str(v.name, 40, 'Program name'), class: cls,
    atk: int(v.atk, 0, 10, 'Program ATK'), def: int(v.def, 0, 10, 'Program DEF'),
    rez: int(v.rez, 0, maxRez, 'Program REZ'), maxRez,
    status: oneOf(v.status, ['ready', 'active', 'derezzed', 'destroyed'] as const, 'Program status'),
    ...(summary ? { summary } : {}),
  };
  if (cls === 'attacker') {
    p.target = oneOf(v.target, ['ice', 'netrunner'] as const, 'Attacker target');
    p.damage = vDice(v.damage, 'Program');
  }
  if (cls === 'booster') {
    const b = isObj(v.boost) ? v.boost : bad('A Booster needs its boost.');
    p.boost = { ability: oneOf(b.ability, BOOSTABLE, 'Boosted ability'), amount: int(b.amount, 1, 6, 'Boost') };
  }
  if (cls === 'defender') {
    if (v.brainReduce !== undefined) p.brainReduce = int(v.brainReduce, 0, 10, 'Brain damage reduction');
    if (v.shield !== undefined) p.shield = bool(v.shield, 'Shield');
  }
  if (v.usedTurn !== undefined) p.usedTurn = str(v.usedTurn, 40, 'Turn');
  return p;
}

export function validateRig(v: unknown): NetRig {
  if (!isObj(v)) return bad('The rig must be an object.');
  const slots = int(v.slots, 1, 13, 'Program slots');
  if (!Array.isArray(v.programs) || v.programs.length > slots) bad(`The deck holds at most ${slots} Programs.`);
  const programs = (v.programs as unknown[]).map(vProgram);
  if (new Set(programs.map((p) => p.id)).size !== programs.length) bad('Program ids must be unique.');
  return { interface: int(v.interface, 1, 10, 'Interface'), deckName: str(v.deckName, 40, 'Deck name'), slots, programs };
}

/** Parse an untrusted op. Shape only; rules are checked when it runs. */
export function parseNetOp(v: unknown): NetOp {
  if (!isObj(v)) return bad('Missing netrunning operation.');
  const actorId = () => id(v.actorId, 'Actor');
  switch (v.op) {
    case 'saveArchitecture': return { op: 'saveArchitecture', architecture: validateArchitecture(v.architecture) };
    case 'deleteArchitecture': return { op: 'deleteArchitecture', archId: id(v.archId, 'Architecture') };
    case 'setRig': return { op: 'setRig', actorId: actorId(), rig: v.rig === null ? null : validateRig(v.rig) };
    case 'setOptions': return { op: 'setOptions', quickhacks2070s: bool(v.quickhacks2070s, 'Quickhacks') };
    case 'revealAccess': return { op: 'revealAccess', archId: id(v.archId, 'Architecture'), found: bool(v.found, 'Found') };
    case 'iceAttack': return { op: 'iceAttack', actorId: actorId(), index: int(v.index, 0, 2, 'ICE') };
    case 'forceJackOut': return { op: 'forceJackOut', actorId: actorId() };
    case 'jackIn': return { op: 'jackIn', actorId: actorId(), archId: id(v.archId, 'Architecture') };
    case 'jackOut': return { op: 'jackOut', actorId: actorId() };
    case 'move': return { op: 'move', actorId: actorId(), toFloorId: id(v.toFloorId, 'Floor') };
    case 'ability': {
      const ability = oneOf(v.ability, ABILITIES, 'Ability');
      return {
        op: 'ability', actorId: actorId(), ability,
        ...(v.index !== undefined ? { index: int(v.index, -1, 2, 'Target') } : {}),
        ...(v.toFloorId !== undefined ? { toFloorId: id(v.toFloorId, 'Floor') } : {}),
      };
    }
    case 'program': return { op: 'program', actorId: actorId(), programId: id(v.programId, 'Program'), index: int(v.index, -1, 2, 'Target') };
    case 'activate': return { op: 'activate', actorId: actorId(), programId: id(v.programId, 'Program'), active: bool(v.active, 'Active') };
    case 'scan': return { op: 'scan', actorId: actorId() };
    case 'quickhack': return { op: 'quickhack', actorId: actorId(), targetId: id(v.targetId, 'Target') };
    default: return bad('Unknown netrunning operation.');
  }
}

// ----- Execution -------------------------------------------------------------------

const turnKey = (s: SessionState) => (s.encounter.active ? `${s.encounter.round}:${s.encounter.turnIndex}` : 'free');

interface Ctx {
  state: SessionState;
  by: Viewer;
  dice: Dice;
  net: NetState;
  actors: Record<string, Actor>;
  events: CombatEvent[];
  encounter?: Encounter;
  touchedActors: Set<string>;
}

function gmOnly(by: Viewer) {
  if (by.role !== 'gm') throw new SessionError('FORBIDDEN', 'Only the GM can do that.');
}

function say(c: Ctx, a: Actor, action: string, text: string, extra: Partial<Extract<CombatEvent, { type: 'netAction' }>> = {}) {
  c.events.push({ type: 'netAction', visibility: visibilityFor(a), combatantId: a.id, action, text, ...extra });
}

// --- Track K --- The Netrunner Role rank is the source of truth for Interface.
// The rig's own Interface is the fallback for characters without the Netrunner Role.
export function withRoleInterface(a: Actor | undefined, rig: NetRig): NetRig {
  const rank = a ? interfaceRank(a.combatant) : 0;
  return rank > 0 && rank !== rig.interface ? { ...rig, interface: rank } : rig;
}
// --- end Track K ---

/** The runner must be yours and, in an encounter, it must be their Turn. */
function requireRunner(c: Ctx, actorId: string): { a: Actor; rig: NetRig } {
  const a = getActor(c.state, actorId);
  if (!controls(c.by, a)) throw new SessionError('FORBIDDEN', `You don’t control ${a.combatant.name}.`);
  if (c.by.role !== 'gm') {
    if (c.state.encounter.active && currentActorId(c.state) !== actorId) throw new SessionError('NOT_YOUR_TURN', `It isn’t ${a.combatant.name}’s Turn.`);
    if (c.state.encounter.deathSaveRequiredFor === actorId) throw new SessionError('DEATH_SAVE_FIRST', `${a.combatant.name} must roll a Death Save first.`);
  }
  const cond = a.combatant.conditions;
  if (cond.dead || cond.unconscious) throw new SessionError('INVALID', `${a.combatant.name} can’t run the NET right now.`);
  const rig = c.net.rigs[actorId];
  if (!rig) throw new SessionError('INVALID', `${a.combatant.name} has no cyberdeck set up.`);
  return { a, rig: withRoleInterface(a, rig) }; // Track K
}

/**
 * Spend NET Actions. In an encounter, a Turn is either a Meat Action or the
 * NET Actions, so the first NET Action uses up the Action.
 */
function spendNet(c: Ctx, a: Actor, rig: NetRig, cost: number) {
  const u = usageFor(c.state, a.id);
  if (!u) return;
  const key = turnKey(c.state);
  const t = c.net.turns?.[a.id];
  const used = t && t.turn === key ? t.used : 0;
  const max = netActionsFor(rig.interface);
  if (c.by.role !== 'gm') {
    if (u.actionUsed && used === 0) throw new SessionError('ACTION_USED', `${a.combatant.name} already took a Meat Action this Turn.`);
    if (used + cost > max) throw new SessionError('ACTION_USED', `${a.combatant.name} has ${max - used} NET Action${max - used === 1 ? '' : 's'} left this Turn.`);
  }
  c.net = { ...c.net, turns: { ...(c.net.turns ?? {}), [a.id]: { turn: key, used: used + cost } } };
  c.encounter = { ...(c.encounter ?? c.state.encounter), usage: { ...u, actionUsed: true } };
}

function getRun(c: Ctx, a: Actor): { run: NetRun; arch: NetArchitecture } {
  const run = c.net.runs[a.id];
  if (!run) throw new SessionError('INVALID', `${a.combatant.name} isn’t jacked in.`);
  const arch = c.net.architectures[run.archId];
  if (!arch) throw new SessionError('INVALID', 'That architecture no longer exists.');
  return { run, arch };
}

const setRun = (c: Ctx, actorId: string, run: NetRun | null) => {
  const runs = { ...c.net.runs };
  if (run) runs[actorId] = run; else delete runs[actorId];
  c.net = { ...c.net, runs };
};
const setRig = (c: Ctx, actorId: string, rig: NetRig) => { c.net = { ...c.net, rigs: { ...c.net.rigs, [actorId]: rig } }; };
const setProgram = (rig: NetRig, p: Program): NetRig => ({ ...rig, programs: rig.programs.map((x) => (x.id === p.id ? p : x)) });

/** Within Jack In range of one of the architecture's access points on the current map? */
function inAccessRange(c: Ctx, a: Actor, arch: NetArchitecture): boolean | null {
  const map = c.state.map;
  const at = map?.tokens[a.id];
  if (!map || !at) return null;
  const here = arch.access.find((x) => x.mapId === map.id);
  if (!here) return false;
  return here.cells.some((cell) => gridDistance(at, cell) <= JACK_IN_RANGE_SQUARES && hasLineOfSight(map, at, cell));
}

function damageRunner(c: Ctx, a: Actor, raw: number, source: string) {
  const rig = c.net.rigs[a.id]!;
  const run = c.net.runs[a.id] ?? null;
  const r = brainDamage(rig, run, raw);
  if (r.shieldUsedId) {
    const s = rig.programs.find((p) => p.id === r.shieldUsedId)!;
    setRig(c, a.id, setProgram(rig, { ...s, status: 'ready' }));
    if (run) setRun(c, a.id, { ...run, shieldSpent: true });
    say(c, a, 'shield', `${a.combatant.name}’s Shield absorbs ${source}.`, { amount: 0 });
    return;
  }
  const cur = c.actors[a.id]!;
  const hp = { ...cur.combatant.hp, current: cur.combatant.hp.current - r.taken };
  const before = woundState(cur.combatant.hp);
  const after = woundState(hp);
  c.actors[a.id] = { ...cur, combatant: { ...cur.combatant, hp } };
  c.touchedActors.add(a.id);
  say(c, a, 'brainDamage', `${a.combatant.name} takes ${r.taken} brain damage from ${source}${r.reducedBy ? ` (${r.reducedBy} stopped)` : ''}.`, { amount: r.taken });
  if (before !== after) c.events.push({ type: 'woundStateChanged', visibility: visibilityFor(a), targetId: a.id, from: before, to: after });
}

function damagePrograms(c: Ctx, a: Actor, amount: number, source: string) {
  const rig = c.net.rigs[a.id]!;
  const target = programHitBy(rig);
  if (!target) { say(c, a, 'programDamage', `${source} finds no Program to hit.`); return; }
  const rez = Math.max(0, target.rez - amount);
  // Anti-program Black ICE destroys what it derezzes (Secondary).
  setRig(c, a.id, setProgram(rig, { ...target, rez, status: rez === 0 ? 'destroyed' : target.status }));
  say(c, a, 'programDamage', rez === 0 ? `${source} destroys ${target.name}.` : `${source} hits ${target.name} for ${amount} REZ.`, { amount });
}

/** A Black ICE's effect lands on the runner. */
function iceBites(c: Ctx, a: Actor, ice: IceStats) {
  const dice = rollNetDice(ice.damage, c.dice);
  const total = dice.reduce((s, d) => s + d, 0);
  if (ice.kind === 'antiPersonnel') damageRunner(c, a, total, ice.name);
  else damagePrograms(c, a, total, ice.name);
  if (ice.effect) c.events.push({ type: 'gmRulingRequired', visibility: 'gm', reason: `${ice.name} hit ${a.combatant.name}: ${ice.effect}` });
}

/** Black ICE ATK + 1d10 vs Interface + 1d10; ties go to the runner (defender). */
function iceAttacks(c: Ctx, a: Actor, floor: NetFloor, index: number) {
  const ice = floor.ice![index]!;
  const atk = statCheck(`${ice.name} ATK`, ice.atk, c.dice);
  const def = statCheck('Interface', withRoleInterface(a, c.net.rigs[a.id]!).interface, c.dice); // Track K
  const hit = atk.total > def.total;
  say(c, a, 'iceAttack', `${ice.name} attacks ${a.combatant.name}: ${atk.total} vs ${def.total}. ${hit ? 'Hit.' : 'Miss.'}`, { check: atk, vs: def, success: hit });
  if (hit) iceBites(c, a, ice);
}

/** Arriving on a floor reveals it; live Black ICE makes a Speed Check, and a faster ICE strikes first. */
function arrive(c: Ctx, a: Actor, arch: NetArchitecture, run: NetRun, floorId: string) {
  const floor = arch.floors[floorId]!;
  let r: NetRun = { ...run, floorId, revealed: run.revealed.includes(floorId) ? run.revealed : [...run.revealed, floorId] };
  const live = liveIce(r, floorId);
  if (live.length && !r.encountered.includes(floorId)) r = { ...r, encountered: [...r.encountered, floorId] };
  setRun(c, a.id, r);
  say(c, a, 'arrive', `${a.combatant.name} reaches floor ${depthOf(arch, floorId)}: ${floorTitle(floor)}.`);
  for (const i of live) {
    const ice = floor.ice![i]!;
    const me = netCheck(withRoleInterface(a, c.net.rigs[a.id]!), 'speed', c.dice); // Track K
    const it = statCheck(`${ice.name} SPD`, ice.spd, c.dice);
    const iceFirst = it.total >= me.total;
    say(c, a, 'speedCheck', `Speed Check against ${ice.name}: ${me.total} vs ${it.total}. ${iceFirst ? `${ice.name} strikes first.` : `${a.combatant.name} is faster.`}`, { check: me, vs: it, success: !iceFirst });
    if (iceFirst) iceAttacks(c, a, floor, i);
  }
  if ((r.demonRez[floorId] ?? 0) > 0) c.events.push({ type: 'gmRulingRequired', visibility: 'gm', reason: `${a.combatant.name} reached the Demon ${floor.demon!.name}. Run its NET Actions.` });
}

/** Unsafe: every live Black ICE the runner met bites on the way out (Secondary). */
function jackOut(c: Ctx, a: Actor, unsafe: boolean) {
  const { run, arch } = getRun(c, a);
  if (unsafe) {
    say(c, a, 'jackOut', `${a.combatant.name} is torn out of ${arch.name}. Every live Black ICE they met strikes.`);
    for (const fid of run.encountered) for (const i of liveIce(run, fid)) iceBites(c, a, arch.floors[fid]!.ice![i]!);
  } else say(c, a, 'jackOut', `${a.combatant.name} jacks out of ${arch.name} safely.`);
  setRun(c, a.id, null);
}

function canStepTo(c: Ctx, arch: NetArchitecture, run: NetRun, to: string, a: Actor) {
  if (!neighborsOf(arch, run.floorId).includes(to)) throw new SessionError('INVALID', 'You can only move one floor up or down.');
  const here = arch.floors[run.floorId]!;
  const goingDown = parentOf(arch, to) === run.floorId;
  if (goingDown && here.kind === 'password' && !run.passed.includes(here.id)) {
    throw new SessionError('INVALID', `${a.combatant.name} must Backdoor this Password first.`);
  }
}

function targetOn(c: Ctx, arch: NetArchitecture, run: NetRun, index: number | undefined): { kind: 'ice'; i: number; ice: IceStats } | { kind: 'demon' } {
  const floor = arch.floors[run.floorId]!;
  if (index === -1 || (index === undefined && (run.demonRez[floor.id] ?? 0) > 0 && !liveIce(run, floor.id).length)) {
    if ((run.demonRez[floor.id] ?? 0) <= 0) throw new SessionError('INVALID', 'No live Demon here.');
    return { kind: 'demon' };
  }
  const i = index ?? liveIce(run, floor.id)[0];
  if (i === undefined || !floor.ice?.[i] || (run.ice[floor.id]?.[i] ?? 0) <= 0) throw new SessionError('INVALID', 'No live Black ICE there.');
  return { kind: 'ice', i, ice: floor.ice[i]! };
}

function hitTarget(c: Ctx, a: Actor, arch: NetArchitecture, run: NetRun, t: ReturnType<typeof targetOn>, rolled: number[], by: string) {
  const damage = rolled.reduce((s, x) => s + x, 0);
  const fid = run.floorId;
  if (t.kind === 'ice') {
    const rez = [...(run.ice[fid] ?? [])];
    rez[t.i] = Math.max(0, rez[t.i]! - damage);
    setRun(c, a.id, { ...run, ice: { ...run.ice, [fid]: rez } });
    say(c, a, 'rezDamage', rez[t.i] === 0 ? `${by} derezzes ${t.ice.name}.` : `${by} deals ${damage} REZ to ${t.ice.name} (${rez[t.i]} left).`, { amount: damage, dice: rolled });
  } else {
    const left = Math.max(0, (run.demonRez[fid] ?? 0) - damage);
    setRun(c, a.id, { ...run, demonRez: { ...run.demonRez, [fid]: left } });
    const name = arch.floors[fid]!.demon!.name;
    say(c, a, 'rezDamage', left === 0 ? `${by} derezzes ${name}.` : `${by} deals ${damage} REZ to ${name} (${left} left).`, { amount: damage, dice: rolled });
  }
}

/** Contested attack on ICE or a Demon: Interface (+ Program ATK) + 1d10 vs DEF (Demon: Interface) + 1d10. */
function contest(c: Ctx, rig: NetRig, arch: NetArchitecture, run: NetRun, t: ReturnType<typeof targetOn>, extra: { label: string; value: number }[]) {
  const mine = netCheck(rig, 'zap', c.dice, extra);
  const theirs = t.kind === 'ice'
    ? statCheck(`${t.ice.name} DEF`, t.ice.def, c.dice)
    : statCheck(`${arch.floors[run.floorId]!.demon!.name} Interface`, arch.floors[run.floorId]!.demon!.interface, c.dice);
  return { mine, theirs, hit: mine.total > theirs.total };
}

function abilityCheck(c: Ctx, a: Actor, rig: NetRig, ability: 'backdoor' | 'eyeDee' | 'control' | 'virus', dv: number, label: string): { check: CheckResult; ok: boolean } {
  const check = netCheck(rig, ability, c.dice);
  const ok = check.total > dv;
  say(c, a, ability, `${a.combatant.name} tries ${label}: ${check.total} vs DV ${dv}. ${ok ? 'Success.' : 'Failure.'}`, { check, dv, success: ok });
  return { check, ok };
}

export function executeNet(state: SessionState, rawOp: unknown, by: Viewer, dice: Dice): Result {
  const op = parseNetOp(rawOp);
  const c: Ctx = { state, by, dice, net: state.netrun ?? emptyNet(), actors: { ...state.actors }, events: [], touchedActors: new Set() };
  const key = turnKey(state);

  switch (op.op) {
    // ----- GM -----
    case 'saveArchitecture': {
      gmOnly(by);
      const arch = op.architecture;
      if (Object.values(c.net.runs).some((r) => r.archId === arch.id)) throw new SessionError('INVALID', 'Jack everyone out of this architecture before editing it.');
      c.net = { ...c.net, architectures: { ...c.net.architectures, [arch.id]: arch } };
      break;
    }
    case 'deleteArchitecture': {
      gmOnly(by);
      if (!c.net.architectures[op.archId]) throw new SessionError('NOT_FOUND', 'No such architecture.');
      if (Object.values(c.net.runs).some((r) => r.archId === op.archId)) throw new SessionError('INVALID', 'Jack everyone out of this architecture first.');
      const { [op.archId]: _gone, ...architectures } = c.net.architectures;
      c.net = { ...c.net, architectures, found: c.net.found.filter((f) => f !== op.archId) };
      break;
    }
    case 'setRig': {
      gmOnly(by);
      getActor(state, op.actorId);
      if (op.rig === null) {
        if (c.net.runs[op.actorId]) throw new SessionError('INVALID', 'Jack out before removing the cyberdeck.');
        const { [op.actorId]: _r, ...rigs } = c.net.rigs;
        c.net = { ...c.net, rigs };
      } else setRig(c, op.actorId, op.rig);
      break;
    }
    case 'setOptions':
      gmOnly(by);
      c.net = { ...c.net, quickhacks2070s: op.quickhacks2070s };
      break;
    case 'revealAccess': {
      gmOnly(by);
      if (!c.net.architectures[op.archId]) throw new SessionError('NOT_FOUND', 'No such architecture.');
      const found = c.net.found.filter((f) => f !== op.archId);
      c.net = { ...c.net, found: op.found ? [...found, op.archId] : found };
      break;
    }
    case 'iceAttack': {
      gmOnly(by);
      const a = getActor(state, op.actorId);
      const { run, arch } = getRun(c, a);
      const floor = arch.floors[run.floorId]!;
      if (!floor.ice?.[op.index] || (run.ice[floor.id]?.[op.index] ?? 0) <= 0) throw new SessionError('INVALID', 'No live Black ICE there.');
      iceAttacks(c, a, floor, op.index);
      break;
    }
    case 'forceJackOut': {
      gmOnly(by);
      jackOut(c, getActor(state, op.actorId), true);
      break;
    }

    // ----- Runner -----
    case 'jackIn': {
      const { a, rig } = requireRunner(c, op.actorId);
      if (c.net.runs[a.id]) throw new SessionError('INVALID', `${a.combatant.name} is already jacked in.`);
      const arch = c.net.architectures[op.archId];
      if (!arch || (by.role !== 'gm' && !c.net.found.includes(arch.id))) throw new SessionError('NOT_FOUND', 'You haven’t found that architecture.');
      const range = inAccessRange(c, a, arch);
      if (range === false && by.role !== 'gm') throw new SessionError('OUT_OF_REACH', `${a.combatant.name} must be within 6 m/yds of an access point, with nothing in between.`);
      spendNet(c, a, rig, 1);
      say(c, a, 'jackIn', `${a.combatant.name} jacks in to ${arch.name}.`);
      arrive(c, a, arch, freshRun(arch), arch.rootId);
      break;
    }
    case 'jackOut': {
      const { a, rig } = requireRunner(c, op.actorId);
      const { arch } = getRun(c, a);
      spendNet(c, a, rig, 1);
      // Leaving access-point range while jacked in makes any Jack Out unsafe (Secondary).
      jackOut(c, a, inAccessRange(c, a, arch) === false);
      break;
    }
    case 'move': {
      const { a, rig } = requireRunner(c, op.actorId);
      const { run, arch } = getRun(c, a);
      if (isEngaged(run)) throw new SessionError('INVALID', `${a.combatant.name} is engaged. Slide away, derez it, or jack out.`);
      canStepTo(c, arch, run, op.toFloorId, a);
      spendNet(c, a, rig, 1);
      arrive(c, a, arch, run, op.toFloorId);
      break;
    }
    case 'ability': {
      const { a, rig } = requireRunner(c, op.actorId);
      const { run, arch } = getRun(c, a);
      const floor = arch.floors[run.floorId]!;
      switch (op.ability) {
        case 'backdoor': {
          if (floor.kind !== 'password') throw new SessionError('INVALID', 'There’s no Password on this floor.');
          if (run.passed.includes(floor.id)) throw new SessionError('INVALID', 'This Password is already open.');
          spendNet(c, a, rig, 1);
          const { ok } = abilityCheck(c, a, rig, 'backdoor', floor.dv!, 'Backdoor');
          if (ok) setRun(c, a.id, { ...run, passed: [...run.passed, floor.id] });
          break;
        }
        case 'eyeDee': {
          if (floor.kind !== 'file') throw new SessionError('INVALID', 'There’s no File on this floor.');
          if (run.identified.includes(floor.id)) throw new SessionError('INVALID', 'This File is already identified.');
          spendNet(c, a, rig, 1);
          const { ok } = abilityCheck(c, a, rig, 'eyeDee', floor.dv!, 'Eye-Dee');
          if (ok) {
            setRun(c, a.id, { ...run, identified: [...run.identified, floor.id] });
            if (floor.note) say(c, a, 'fileContents', `File contents: ${floor.note}`);
          }
          break;
        }
        case 'control': {
          if (floor.kind !== 'controlNode') throw new SessionError('INVALID', 'There’s no Control Node on this floor.');
          if (run.controlled.includes(floor.id)) throw new SessionError('INVALID', 'You already control this node.');
          spendNet(c, a, rig, 1);
          const { ok } = abilityCheck(c, a, rig, 'control', floor.dv!, 'Control');
          if (ok) {
            setRun(c, a.id, { ...run, controlled: [...run.controlled, floor.id] });
            c.events.push({ type: 'gmRulingRequired', visibility: 'gm', reason: `${a.combatant.name} controls ${floorTitle(floor)}${floor.note ? ` (${floor.note})` : ''}. Each device they operate costs a NET Action.` });
            if (floor.note) say(c, a, 'controlNode', `Now controlling: ${floor.note}`);
          }
          break;
        }
        case 'virus': {
          if (!isLowestFloor(arch, floor.id)) throw new SessionError('INVALID', 'A Virus can only go on a lowest floor.');
          spendNet(c, a, rig, 1);
          const { check, ok } = abilityCheck(c, a, rig, 'virus', arch.virusDv, 'Virus');
          if (ok) {
            setRun(c, a.id, { ...run, virusDv: check.total });
            c.events.push({ type: 'gmRulingRequired', visibility: 'gm', reason: `${a.combatant.name} planted a Virus (DV ${check.total} to remove). Agree on up to two lasting changes.` });
          }
          break;
        }
        case 'pathfinder': {
          spendNet(c, a, rig, 1);
          const check = netCheck(rig, 'pathfinder', c.dice);
          const found = pathfinderReveal(arch, run.floorId, check.total, run.revealed);
          setRun(c, a.id, { ...run, revealed: [...run.revealed, ...found] });
          say(c, a, 'pathfinder', `${a.combatant.name} runs Pathfinder (${check.total}) and maps ${found.length} new floor${found.length === 1 ? '' : 's'}.`, { check, amount: found.length });
          break;
        }
        case 'cloak': {
          spendNet(c, a, rig, 1);
          const check = netCheck(rig, 'cloak', c.dice);
          setRun(c, a.id, { ...run, cloakDv: check.total });
          say(c, a, 'cloak', `${a.combatant.name} cloaks their tracks (DV ${check.total} to find them).`, { check });
          break;
        }
        case 'slide': {
          if (!isEngaged(run)) throw new SessionError('INVALID', 'Slide only works while engaged with Black ICE.');
          if (key !== 'free' && run.slidTurn === key) throw new SessionError('INVALID', 'Only one Slide per Turn.');
          const t = targetOn(c, arch, run, op.index);
          if (t.kind === 'demon') throw new SessionError('INVALID', 'You can’t Slide away from a Demon.');
          if (!op.toFloorId) throw new SessionError('INVALID', 'Pick the floor to Slide to.');
          canStepTo(c, arch, run, op.toFloorId, a);
          spendNet(c, a, rig, 1);
          const mine = netCheck(rig, 'slide', c.dice);
          const theirs = statCheck(`${t.ice.name} PER`, t.ice.per, c.dice);
          const ok = mine.total > theirs.total;
          say(c, a, 'slide', `${a.combatant.name} tries to Slide past ${t.ice.name}: ${mine.total} vs ${theirs.total}. ${ok ? 'Away.' : 'Caught.'}`, { check: mine, vs: theirs, success: ok });
          const slid = { ...c.net.runs[a.id]!, slidTurn: key };
          if (ok) {
            // Leave every ICE on this floor behind: mark them as no longer engaging by moving.
            arrive(c, a, arch, slid, op.toFloorId);
          } else setRun(c, a.id, slid);
          break;
        }
        case 'zap': {
          const t = targetOn(c, arch, run, op.index);
          spendNet(c, a, rig, 1);
          const r = contest(c, rig, arch, run, t, []);
          const name = t.kind === 'ice' ? t.ice.name : floor.demon!.name;
          say(c, a, 'zap', `${a.combatant.name} Zaps ${name}: ${r.mine.total} vs ${r.theirs.total}. ${r.hit ? 'Hit.' : 'Miss.'}`, { check: r.mine, vs: r.theirs, success: r.hit });
          if (r.hit) {
            hitTarget(c, a, arch, c.net.runs[a.id]!, t, rollNetDice({ count: 1, sides: 6 }, c.dice), 'Zap');
          }
          break;
        }
      }
      break;
    }
    case 'program': {
      const { a, rig } = requireRunner(c, op.actorId);
      const { run, arch } = getRun(c, a);
      const p = rig.programs.find((x) => x.id === op.programId);
      if (!p) throw new SessionError('NOT_FOUND', 'No such Program on this deck.');
      if (p.class !== 'attacker' || p.target !== 'ice') throw new SessionError('INVALID', `${p.name} can’t attack Black ICE.`);
      if (p.status === 'destroyed' || p.status === 'derezzed') throw new SessionError('INVALID', `${p.name} is ${p.status}.`);
      if (key !== 'free' && p.usedTurn === key) throw new SessionError('INVALID', `${p.name} already ran this Round.`);
      const t = targetOn(c, arch, run, op.index);
      spendNet(c, a, rig, 1);
      const r = contest(c, rig, arch, run, t, [{ label: p.name, value: p.atk }]);
      const name = t.kind === 'ice' ? t.ice.name : arch.floors[run.floorId]!.demon!.name;
      say(c, a, 'program', `${a.combatant.name} runs ${p.name} at ${name}: ${r.mine.total} vs ${r.theirs.total}. ${r.hit ? 'Hit.' : 'Miss.'}`, { check: r.mine, vs: r.theirs, success: r.hit });
      setRig(c, a.id, setProgram(rig, { ...p, usedTurn: key }));
      if (r.hit && p.damage) hitTarget(c, a, arch, c.net.runs[a.id]!, t, rollNetDice(p.damage, c.dice), p.name);
      break;
    }
    case 'activate': {
      const { a, rig } = requireRunner(c, op.actorId);
      getRun(c, a);
      const p = rig.programs.find((x) => x.id === op.programId);
      if (!p) throw new SessionError('NOT_FOUND', 'No such Program on this deck.');
      if (p.class === 'attacker') throw new SessionError('INVALID', 'Attackers run straight from the deck; you don’t switch them on.');
      if (p.status === 'destroyed') throw new SessionError('INVALID', `${p.name} is destroyed.`);
      if (op.active) {
        if (p.status === 'active') throw new SessionError('INVALID', `${p.name} is already running.`);
        const restart = p.status === 'derezzed';
        spendNet(c, a, rig, restart ? RESTART_COST : 1);
        setRig(c, a.id, setProgram(c.net.rigs[a.id]!, { ...p, status: 'active', rez: restart ? p.maxRez : p.rez }));
        say(c, a, 'activate', restart ? `${a.combatant.name} restarts ${p.name}.` : `${a.combatant.name} activates ${p.name}.`);
      } else {
        if (p.status !== 'active') throw new SessionError('INVALID', `${p.name} isn’t running.`);
        spendNet(c, a, rig, 1);
        setRig(c, a.id, setProgram(c.net.rigs[a.id]!, { ...p, status: 'ready' }));
        say(c, a, 'activate', `${a.combatant.name} shuts down ${p.name}.`);
      }
      break;
    }
    case 'scan': {
      const { a, rig } = requireRunner(c, op.actorId);
      // Scanner is a Meat Action, not a NET Action.
      const u = usageFor(state, a.id);
      if (u) {
        if (u.actionUsed && by.role !== 'gm') throw new SessionError('ACTION_USED', `${a.combatant.name} has already used their Action this Turn.`);
        c.encounter = { ...state.encounter, usage: { ...u, actionUsed: true } };
      }
      const check = netCheck(rig, 'scanner', dice);
      const map = state.map;
      const at = map?.tokens[a.id];
      if (!map || !at) {
        say(c, a, 'scanner', `${a.combatant.name} scans for access points (${check.total}).`, { check });
        c.events.push({ type: 'gmRulingRequired', visibility: 'gm', reason: `${a.combatant.name} rolled ${check.total} on Scanner. Tell them which access points they find.` });
        break;
      }
      // Interpretation: finds access points on this map within (result) squares.
      const newly = Object.values(c.net.architectures)
        .filter((arch) => !c.net.found.includes(arch.id))
        .filter((arch) => arch.access.some((x) => x.mapId === map.id && x.cells.some((cell) => gridDistance(at, cell) <= check.total)))
        .map((arch) => arch.id);
      c.net = { ...c.net, found: [...c.net.found, ...newly] };
      say(c, a, 'scanner', newly.length
        ? `${a.combatant.name}’s Scanner (${check.total}) finds ${newly.map((x) => c.net.architectures[x]!.name).join(', ')}.`
        : `${a.combatant.name}’s Scanner (${check.total}) finds nothing new.`, { check, amount: newly.length });
      break;
    }
    case 'quickhack': {
      if (!c.net.quickhacks2070s) throw new SessionError('INVALID', 'Quickhacks are off. The GM can turn on the 2070s options.');
      const { a, rig } = requireRunner(c, op.actorId);
      const target = getActor(state, op.targetId);
      const map = state.map;
      const from = map?.tokens[a.id];
      const to = map?.tokens[target.id];
      if (!map || !from || !to) throw new SessionError('INVALID', 'Both need to be on the map.');
      if (gridDistance(from, to) > QUICKHACK_RANGE_SQUARES) throw new SessionError('OUT_OF_REACH', 'Quickhacks reach 50 m/yds.');
      if (!hasLineOfSight(map, from, to)) throw new SessionError('NO_LINE_OF_SIGHT', `${a.combatant.name} needs to see the target.`);
      spendNet(c, a, rig, 1);
      say(c, a, 'quickhack', `${a.combatant.name} jacks in to ${target.combatant.name}’s neuroport.`);
      c.events.push({ type: 'gmRulingRequired', visibility: 'gm', reason: `Quickhack link from ${a.combatant.name} to ${target.combatant.name}. Resolve the quickhack from the Mission Kit.` });
      break;
    }
  }

  const patch: StatePatch = { netrun: c.net };
  if (c.encounter) patch.encounter = c.encounter;
  if (c.touchedActors.size) patch.actors = Object.fromEntries([...c.touchedActors].map((x) => [x, c.actors[x]!]));
  return { events: c.events, patch };
}

// ----- Projection ------------------------------------------------------------------

function runView(state: SessionState, net: NetState, actorId: string, run: NetRun): NetRunView | null {
  const arch = net.architectures[run.archId];
  if (!arch) return null;
  const known = new Set(run.revealed);
  const floors: Record<string, NetFloorView> = {};
  for (const fid of run.revealed) {
    const f = arch.floors[fid];
    if (!f) continue;
    const passed = run.passed.includes(fid);
    const identified = run.identified.includes(fid);
    const controlled = run.controlled.includes(fid);
    floors[fid] = {
      id: fid, kind: f.kind, ...(f.label ? { label: f.label } : {}), depth: depthOf(arch, fid),
      children: (arch.children[fid] ?? []).filter((k) => known.has(k)),
      ...(passed || identified || controlled ? { dv: f.dv } : {}),
      ...((identified && f.kind === 'file') || (controlled && f.kind === 'controlNode') ? (f.note ? { note: f.note } : {}) : {}),
      passed, identified, controlled,
      ...(f.ice ? { ice: f.ice.map((i, n) => ({ name: i.name, kind: i.kind, rez: run.ice[fid]?.[n] ?? 0, maxRez: i.rez })) } : {}),
      ...(f.demon ? { demon: { name: f.demon.name, rez: run.demonRez[fid] ?? 0, maxRez: f.demon.rez } } : {}),
    };
  }
  const rig = net.rigs[actorId];
  const key = turnKey(state);
  const t = net.turns?.[actorId];
  const isCurrent = state.encounter.active && currentActorId(state) === actorId;
  return {
    actorId, archId: arch.id, archName: arch.name, floorId: run.floorId, floors, rootId: arch.rootId,
    actionsLeft: isCurrent && rig ? netActionsFor(withRoleInterface(state.actors[actorId], rig).interface) - (t && t.turn === key ? t.used : 0) : null, // Track K
    engaged: isEngaged(run), cloakDv: run.cloakDv, virusPlaced: run.virusDv !== null,
    canSlide: isEngaged(run) && !(key !== 'free' && run.slidTurn === key),
  };
}

/** Players: only their own runners, revealed floors and found architectures. GM: everything. */
export function projectNet(state: SessionState, viewer: Viewer): NetView | undefined {
  const net = state.netrun;
  if (!net) return undefined;
  const mine = (actorId: string) => viewer.role === 'gm' || state.actors[actorId]?.controller === viewer.playerId;
  const runs: Record<string, NetRunView> = {};
  for (const [aid, run] of Object.entries(net.runs)) {
    if (!mine(aid)) continue;
    const v = runView(state, net, aid, run);
    if (v) runs[aid] = v;
  }
  const rigs = Object.fromEntries(Object.entries(net.rigs).filter(([aid]) => mine(aid)));
  const jackable = Object.values(net.architectures)
    .filter((a) => viewer.role === 'gm' || net.found.includes(a.id))
    .map((a) => ({ id: a.id, name: a.name, access: a.access }));
  return { quickhacks2070s: net.quickhacks2070s, rigs, runs, jackable, ...(viewer.role === 'gm' ? { full: net } : {}) };
}
