import { TEST_PROGRAMS as PROGRAM_TEMPLATES } from './net-fixtures.js';
import { describe, expect, it } from 'vitest';
import { netAvailability, netAvailInputFromState, netAvailInputFromView, type NetActionKey } from '../src/index.js';
import {
  freshRun, maxHP, pathfinderReveal, scriptedDice, ICE_TEMPLATES,
  type Combatant, type Dice, type NetArchitecture, type NetRig, type Stats,
} from '@cprc/rules-core';
import {
  applyEntry, emptySession, handleIntent, projectEntry, projectState,
  type Actor, type Intent, type LogEntry, type NetOp, type SessionState, type TacticalMap, type Viewer,
} from '../src/index.js';

const BASE: Stats = { INT: 6, REF: 6, DEX: 6, TECH: 6, COOL: 6, WILL: 6, LUCK: 6, MOVE: 6, BODY: 6, EMP: 6 };
function actor(id: string, side: 'pc' | 'npc', controller: string): Actor {
  const max = maxHP(BASE.BODY, BASE.WILL);
  const combatant: Combatant = {
    id, name: id, side, stats: BASE, skills: { Handgun: 6 }, hp: { max, current: max },
    armor: [{ id: 'jack', name: 'Light Armorjack', location: 'body', maxSP: 11, currentSP: 11, penalty: 0 }],
    criticalInjuries: [], deathSave: { accumulatedPenalty: 0 },
    conditions: { prone: false, unconscious: false, dead: false, stabilized: false },
  };
  return { id, controller, weapons: [{ id: 'pistol', name: 'Heavy Pistol', type: 'heavyPistol', ammo: { loaded: 7, capacity: 8 } }], combatant };
}

const GM: Viewer = { role: 'gm' };
const P1: Viewer = { role: 'player', playerId: 'p1' };
const P2: Viewer = { role: 'player', playerId: 'p2' };

const MAP: TacticalMap = {
  id: 'm', name: 'Lab', width: 10, height: 5, cells: ['..........', '..........', '.....#....', '.....#....', '..........'].join(''),
  cellPx: 64, sightRange: 30, tokens: { kes: { x: 2, y: 2 }, guard: { x: 8, y: 0 } }, watches: {}, spotted: [],
};

const tripwire = ICE_TEMPLATES[0]!; // per 2 spd 4 atk 4 def 2 rez 10, 2d6 anti-personnel
/** 1 Password (DV 6) → 2 File (DV 8) → {3 Black ICE → 4 Control Node (DV 8), 5 Password (DV 10) → 6 File} */
const ARCH: NetArchitecture = {
  id: 'lab', name: 'Lab Server', difficulty: 'standard', rootId: 'f1', virusDv: 8,
  floors: {
    f1: { id: 'f1', kind: 'password', dv: 6 },
    f2: { id: 'f2', kind: 'file', dv: 8, note: 'Payroll for the night shift' },
    f3: { id: 'f3', kind: 'blackIce', ice: [tripwire] },
    f4: { id: 'f4', kind: 'controlNode', dv: 8, note: 'Lab cameras' },
    f5: { id: 'f5', kind: 'password', dv: 10 },
    f6: { id: 'f6', kind: 'file', dv: 10, note: 'Secret' },
  },
  children: { f1: ['f2'], f2: ['f3', 'f5'], f3: ['f4'], f5: ['f6'] },
  access: [{ mapId: 'm', cells: [{ x: 3, y: 2 }] }],
};

const prog = (id: string) => ({ ...PROGRAM_TEMPLATES.find((p) => p.id === id)! });
const RIG: NetRig = { interface: 3, deckName: 'Street Deck', slots: 7, programs: [prog('armor'), prog('shield'), prog('sword'), prog('worm')] };

function table() {
  let state: SessionState = emptySession('s1');
  const log: LogEntry[] = [];
  let n = 0;
  const ctx = (dice: Dice) => ({ dice, now: () => '2077-01-01T00:00:00Z', newId: () => `id${++n}` });
  return {
    get state() { return state; },
    log,
    send(intent: Intent, by: Viewer, dice: Dice = scriptedDice({})) {
      const r = handleIntent(state, intent, by, ctx(dice));
      if (r.ok) { state = applyEntry(state, r.entry); log.push(r.entry); }
      return r;
    },
    net(op: NetOp | Record<string, unknown>, by: Viewer, dice?: Dice) {
      return this.send({ type: 'net', op: op as NetOp }, by, dice);
    },
  };
}

function setup() {
  const t = table();
  t.send({ type: 'addActor', actor: actor('kes', 'pc', 'p1') }, GM);
  t.send({ type: 'addActor', actor: actor('guard', 'npc', 'gm') }, GM);
  t.send({ type: 'setMap', map: MAP }, GM);
  expect(t.net({ op: 'saveArchitecture', architecture: ARCH }, GM).ok).toBe(true);
  expect(t.net({ op: 'setRig', actorId: 'kes', rig: RIG }, GM).ok).toBe(true);
  return t;
}

const many = () => scriptedDice({ d10: Array(40).fill(9), d6: Array(40).fill(3) });

/** Ops whose parameters are fully determined by the floor, so availability must match exactly. */
const EXACT: Partial<Record<NetActionKey, Record<string, unknown>>> = {
  jackIn: { op: 'jackIn', actorId: 'kes', archId: 'lab' },
  jackOut: { op: 'jackOut', actorId: 'kes' },
  descend: { op: 'descend', actorId: 'kes', branch: 0 },
  backdoor: { op: 'ability', actorId: 'kes', ability: 'backdoor' },
  eyeDee: { op: 'ability', actorId: 'kes', ability: 'eyeDee' },
  control: { op: 'ability', actorId: 'kes', ability: 'control' },
  virus: { op: 'ability', actorId: 'kes', ability: 'virus' },
  pathfinder: { op: 'ability', actorId: 'kes', ability: 'pathfinder' },
  cloak: { op: 'ability', actorId: 'kes', ability: 'cloak' },
  scan: { op: 'scan', actorId: 'kes' },
  quickhack: { op: 'quickhack', actorId: 'kes', targetId: 'guard' },
};
/** Ops with a free parameter: only "unavailable ⇒ refused" must hold. */
const SOUND: Partial<Record<NetActionKey, Record<string, unknown>>> = {
  move: { op: 'move', actorId: 'kes', toFloorId: 'f1' },
  zap: { op: 'ability', actorId: 'kes', ability: 'zap', index: 0 },
  slide: { op: 'ability', actorId: 'kes', ability: 'slide', index: 0, toFloorId: 'f2' },
  program: { op: 'program', actorId: 'kes', programId: 'sword', index: 0 },
  activate: { op: 'activate', actorId: 'kes', programId: 'armor', active: true },
};

function encounterAtKes() {
  const t = setup();
  t.net({ op: 'revealAccess', archId: 'lab', found: true }, GM);
  t.send({ type: 'startEncounter', participants: [{ actorId: 'kes' }, { actorId: 'guard' }] }, GM, scriptedDice({ d10: [9, 1] }));
  expect(t.state.encounter.order[t.state.encounter.turnIndex]).toBe('kes');
  return t;
}

function check(t: ReturnType<typeof table>, label: string) {
  const net = t.state.netrun!;
  const avail = netAvailability(netAvailInputFromState(t.state, net, 'kes', false, net.rigs.kes!.interface));
  // The player's view computes the same answers.
  const viewAvail = netAvailability(netAvailInputFromView(projectState(t.state, P1), 'kes', false)!);
  for (const k of Object.keys(avail) as NetActionKey[]) expect([label, k, viewAvail[k].ok]).toEqual([label, k, avail[k].ok]);
  for (const [k, op] of Object.entries(EXACT) as [NetActionKey, Record<string, unknown>][]) {
    const r = handleIntent(t.state, { type: 'net', op: op as NetOp }, P1, { dice: many(), now: () => 'x', newId: () => 'id' });
    expect([label, k, r.ok]).toEqual([label, k, avail[k].ok]);
  }
  for (const [k, op] of Object.entries(SOUND) as [NetActionKey, Record<string, unknown>][]) {
    if (avail[k].ok) continue;
    const r = handleIntent(t.state, { type: 'net', op: op as NetOp }, P1, { dice: many(), now: () => 'x', newId: () => 'id' });
    expect([label, k, r.ok]).toEqual([label, k, false]);
  }
  return avail;
}

describe('NET availability stays in lockstep with the authority', () => {
  it('before jacking in, on your Turn', () => {
    const t = encounterAtKes();
    const a = check(t, 'offline');
    expect(a.jackIn.ok).toBe(true);
    expect(a.virus.ok).toBe(false);
  });
  it('after a Meat Action, Jack In is unavailable with a reason', () => {
    const t = encounterAtKes();
    expect(t.send({ type: 'reload', actorId: 'kes', weaponId: 'pistol' }, P1).ok).toBe(true);
    const a = check(t, 'meat');
    expect(a.jackIn).toMatchObject({ ok: false, code: 'ACTION_USED' });
    expect(a.jackIn.reason).toMatch(/Meat Action/);
  });
  it('on a Password floor: Backdoor yes; Virus, Eye-Dee and going down no', () => {
    const t = encounterAtKes();
    expect(t.net({ op: 'jackIn', actorId: 'kes', archId: 'lab' }, P1).ok).toBe(true);
    const a = check(t, 'f1');
    expect(a.backdoor.ok).toBe(true);
    expect(a.virus).toMatchObject({ ok: false });
    expect(a.descend.ok).toBe(false);
  });
  it('out of NET Actions after two', () => {
    const t = encounterAtKes();
    t.net({ op: 'jackIn', actorId: 'kes', archId: 'lab' }, P1);
    expect(t.net({ op: 'ability', actorId: 'kes', ability: 'backdoor' }, P1, many()).ok).toBe(true);
    const a = check(t, 'spent');
    expect(a.pathfinder).toMatchObject({ ok: false, code: 'ACTION_USED' });
  });
  it('on a lowest floor outside combat, Virus is available', () => {
    const t = setup();
    t.net({ op: 'revealAccess', archId: 'lab', found: true }, GM);
    t.net({ op: 'jackIn', actorId: 'kes', archId: 'lab' }, P1);
    for (const step of [['ability', 'backdoor'], ['descend', 0], ['descend', 1], ['ability', 'backdoor'], ['descend', 0]] as const) {
      const op = step[0] === 'ability' ? { op: 'ability', actorId: 'kes', ability: step[1] } : { op: 'descend', actorId: 'kes', branch: step[1] };
      const r = t.net(op, P1, many());
      expect([step, t.state.netrun?.runs.kes?.floorId, r.ok ? 'ok' : (r as { message: string }).message]).toEqual([step, t.state.netrun?.runs.kes?.floorId, 'ok']);
    }
    expect(t.state.netrun!.runs.kes!.floorId).toBe('f6');
    const a = check(t, 'f6');
    expect(a.virus.ok).toBe(true);
    expect(a.eyeDee.ok).toBe(true);
  });
  it('engaged with Black ICE: moving is allowed (the ICE follows), and so are Slide and Zap', () => {
    const t = setup();
    t.net({ op: 'revealAccess', archId: 'lab', found: true }, GM);
    t.net({ op: 'jackIn', actorId: 'kes', archId: 'lab' }, P1);
    t.net({ op: 'ability', actorId: 'kes', ability: 'backdoor' }, P1, many());
    t.net({ op: 'descend', actorId: 'kes', branch: 0 }, P1);
    expect(t.net({ op: 'descend', actorId: 'kes', branch: 0 }, P1, many()).ok).toBe(true);
    expect(t.state.netrun!.runs.kes!.floorId).toBe('f3');
    const a = check(t, 'engaged');
    expect(a.move.ok).toBe(true);
    expect(a.descend.ok).toBe(true);
    expect(a.slide.ok).toBe(true);
    expect(a.zap.ok).toBe(true);
  });
});
