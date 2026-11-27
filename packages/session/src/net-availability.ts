/**
 * What a netrunner can do right now, and why not. One pure function
 * (`netAvailability`) used by both the authority (which refuses with the same
 * reason) and the runner's NetPanel (which disables the button and shows it),
 * kept in lockstep by a test.
 *
 * Input comes from either the GM's full state (`netAvailInputFromState`) or a
 * player's projected view (`netAvailInputFromView`); both carry only what the
 * rules need.
 */
import {
  gridDistance, hasLineOfSight, isEngaged, isLowestFloor, JACK_IN_RANGE_SQUARES, netActionsFor, parentOf,
  type Cell, type GridMap, type NetFloorKind,
} from '@cprc/rules-core';
import type { NetState } from './netrun-types.js';
import type { SessionState, ViewState } from './types.js';

export type NetActionKey =
  | 'jackIn' | 'jackOut' | 'move' | 'descend' | 'backdoor' | 'eyeDee' | 'control' | 'virus'
  | 'pathfinder' | 'cloak' | 'slide' | 'zap' | 'program' | 'activate' | 'scan' | 'quickhack';

export interface NetAvail { ok: boolean; reason?: string; code?: 'ACTION_USED' | 'INVALID' | 'OUT_OF_REACH' }

export interface NetAvailInput {
  gm: boolean;
  /** The runner is the current actor of a running encounter (Turn economy applies). */
  tracked: boolean;
  actionUsed: boolean;
  netUsed: number;
  netMax: number;
  /** Not jacked in: is a found access point within Jack In range? null = no map (GM's call). */
  accessInReach: boolean | null;
  quickhacks: boolean;
  floor: null | {
    kind: NetFloorKind;
    passed: boolean;
    identified: boolean;
    controlled: boolean;
    /** Ways down from here, revealed or not. */
    exitsDown: number;
    hasParent: boolean;
    engaged: boolean;
    canSlide: boolean;
    virusPlaced: boolean;
  };
}

const yes: NetAvail = { ok: true };
const no = (reason: string, code: NetAvail['code'] = 'INVALID'): NetAvail => ({ ok: false, reason, code });

/** Turn economy for one NET Action (players only; the GM is recorded, never refused). */
function netEconomy(i: NetAvailInput, cost = 1): NetAvail {
  if (i.gm || !i.tracked) return yes;
  if (i.actionUsed && i.netUsed === 0) return no('Already took a Meat Action this Turn.', 'ACTION_USED');
  if (i.netUsed + cost > i.netMax) return no('No NET Actions left this Turn.', 'ACTION_USED');
  return yes;
}

const both = (a: NetAvail, b: NetAvail) => (a.ok ? b : a);

export function netAvailability(i: NetAvailInput): Record<NetActionKey, NetAvail> {
  const f = i.floor;
  const inRun = (then: () => NetAvail): NetAvail => (f ? then() : no('Not jacked in.'));
  const notEngaged = (): NetAvail => (f && f.engaged ? no('Engaged: Slide away, derez it, or jack out.') : yes);
  const meat: NetAvail = i.gm || !i.tracked || !i.actionUsed ? yes : no('Already used the Action this Turn.', 'ACTION_USED');
  return {
    jackIn: f ? no('Already jacked in.')
      : !i.gm && i.accessInReach === false ? no('Get within 6 m/yds of an access point, with nothing in between.', 'OUT_OF_REACH')
      : netEconomy(i),
    jackOut: inRun(() => netEconomy(i)),
    move: inRun(() => both(notEngaged(), netEconomy(i))),
    descend: inRun(() => (f!.exitsDown === 0 ? no('This is the bottom of the branch.')
      : f!.kind === 'password' && !f!.passed ? no('Backdoor the Password first.')
      : both(notEngaged(), netEconomy(i)))),
    backdoor: inRun(() => (f!.kind !== 'password' ? no('There’s no Password on this floor.') : f!.passed ? no('This Password is already open.') : netEconomy(i))),
    eyeDee: inRun(() => (f!.kind !== 'file' ? no('There’s no File on this floor.') : f!.identified ? no('This File is already identified.') : netEconomy(i))),
    control: inRun(() => (f!.kind !== 'controlNode' ? no('There’s no Control Node on this floor.') : f!.controlled ? no('You already control this node.') : netEconomy(i))),
    virus: inRun(() => (f!.exitsDown > 0 ? no('A Virus can only go on a lowest floor.') : netEconomy(i))),
    pathfinder: inRun(() => netEconomy(i)),
    cloak: inRun(() => netEconomy(i)),
    slide: inRun(() => (!f!.engaged ? no('Slide only works while engaged with Black ICE.') : !f!.canSlide ? no('Only one Slide per Turn.') : netEconomy(i))),
    zap: inRun(() => (!f!.engaged ? no('Nothing here to Zap.') : netEconomy(i))),
    program: inRun(() => (!f!.engaged ? no('No Black ICE or Demon here to attack.') : netEconomy(i))),
    activate: inRun(() => netEconomy(i)),
    scan: meat,
    quickhack: !i.quickhacks ? no('Quickhacks are off. The GM can turn on the 2070s options.') : netEconomy(i),
  };
}

// ----- Input builders ---------------------------------------------------------------

const turnKeyOf = (enc: SessionState['encounter']) => (enc.active ? `${enc.round}:${enc.turnIndex}` : 'free');

function reach(map: GridMap | null | undefined, at: Cell | undefined, access: { mapId: string; cells: Cell[] }[], mapId: string | undefined): boolean | null {
  if (!map || !at || !mapId) return null;
  return access.some((x) => x.mapId === mapId && x.cells.some((c) => gridDistance(at, c) <= JACK_IN_RANGE_SQUARES && hasLineOfSight(map, at, c)));
}

/** From the GM's full state (authority side). `interfaceRank` is the runner's effective Interface. */
export function netAvailInputFromState(state: SessionState, net: NetState, actorId: string, gm: boolean, interfaceRank: number, archId?: string): NetAvailInput {
  const enc = state.encounter;
  const tracked = enc.active && enc.order[enc.turnIndex] === actorId;
  const usage = tracked && enc.usage?.actorId === actorId ? enc.usage : null;
  const t = net.turns?.[actorId];
  const netUsed = t && t.turn === turnKeyOf(enc) ? t.used : 0;
  const run = net.runs[actorId];
  const arch = run ? net.architectures[run.archId] : undefined;
  const map = state.map;
  const found = Object.values(net.architectures).filter((a) => (gm || net.found.includes(a.id)) && (!archId || a.id === archId));
  const accessInReach = run ? null : found.length === 0 ? false
    : (() => {
      const r = found.map((a) => reach(map, map?.tokens[actorId], a.access, map?.id));
      return r.some((x) => x === true) ? true : r.every((x) => x === null) ? null : false;
    })();
  const floor = run && arch ? (() => {
    const fl = arch.floors[run.floorId]!;
    const key = turnKeyOf(enc);
    return {
      kind: fl.kind,
      passed: run.passed.includes(fl.id),
      identified: run.identified.includes(fl.id),
      controlled: run.controlled.includes(fl.id),
      exitsDown: isLowestFloor(arch, fl.id) ? 0 : (arch.children[fl.id] ?? []).length,
      hasParent: parentOf(arch, fl.id) !== null,
      engaged: isEngaged(run),
      canSlide: isEngaged(run) && !(key !== 'free' && run.slidTurn === key),
      virusPlaced: run.virusDv !== null,
    };
  })() : null;
  return {
    gm, tracked, actionUsed: !!usage?.actionUsed, netUsed, netMax: netActionsFor(interfaceRank),
    accessInReach, quickhacks: net.quickhacks2070s, floor,
  };
}

/** From a projected view (runner's own data only). */
export function netAvailInputFromView(view: ViewState, actorId: string, gm: boolean, archId?: string): NetAvailInput | null {
  const nv = view.netrun;
  const rig = nv?.rigs[actorId];
  if (!nv || !rig) return null;
  const enc = view.encounter;
  const tracked = enc.active && enc.order[enc.turnIndex] === actorId;
  const usage = tracked && enc.usage?.actorId === actorId ? enc.usage : null;
  const run = nv.runs[actorId];
  const netMax = netActionsFor(rig.interface);
  const netUsed = run && run.actionsLeft !== null ? netMax - run.actionsLeft : nv.turnUsed?.[actorId] ?? 0;
  const map = view.map;
  const jackable = nv.jackable.filter((a) => !archId || a.id === archId);
  const accessInReach = run ? null : jackable.length === 0 ? false
    : (() => {
      const r = jackable.map((a) => reach(map, map?.tokens[actorId], a.access, map?.id));
      return r.some((x) => x === true) ? true : r.every((x) => x === null) ? null : false;
    })();
  const here = run ? run.floors[run.floorId] : undefined;
  const floor = run && here ? {
    kind: here.kind, passed: here.passed, identified: here.identified, controlled: here.controlled,
    exitsDown: here.exitsDown ?? 0,
    hasParent: Object.values(run.floors).some((f) => f.children.includes(run.floorId)),
    engaged: run.engaged, canSlide: run.canSlide, virusPlaced: run.virusPlaced,
  } : null;
  return { gm, tracked, actionUsed: !!usage?.actionUsed, netUsed, netMax, accessInReach, quickhacks: nv.quickhacks2070s, floor };
}
