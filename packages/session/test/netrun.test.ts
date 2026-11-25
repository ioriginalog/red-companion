import { TEST_PROGRAMS as PROGRAM_TEMPLATES } from './net-fixtures.js';
import { describe, expect, it } from 'vitest';
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
/** 1 Password (DV 6) → 2 File (DV 8) → {3 Black ICE → 4 Control Node (DV 8), 5 Password (DV 15) → 6 File} */
const ARCH: NetArchitecture = {
  id: 'lab', name: 'Lab Server', difficulty: 'standard', rootId: 'f1', virusDv: 8,
  floors: {
    f1: { id: 'f1', kind: 'password', dv: 6 },
    f2: { id: 'f2', kind: 'file', dv: 8, note: 'Payroll for the night shift' },
    f3: { id: 'f3', kind: 'blackIce', ice: [tripwire] },
    f4: { id: 'f4', kind: 'controlNode', dv: 8, note: 'Lab cameras' },
    f5: { id: 'f5', kind: 'password', dv: 15 },
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
const run = (t: ReturnType<typeof table>) => t.state.netrun!.runs.kes!;
const d10 = (...xs: number[]) => scriptedDice({ d10: xs });

describe('netrunning: validation and permissions', () => {
  it('rejects hostile and malformed payloads', () => {
    const t = setup();
    const bad: unknown[] = [
      null, 'x', { op: 'nope' }, { op: 'jackIn', actorId: 'kes' },
      { op: 'saveArchitecture', architecture: { ...ARCH, floors: { ...ARCH.floors, f1: { id: 'f1', kind: 'password', dv: 'abc' } } } },
      { op: 'saveArchitecture', architecture: { ...ARCH, children: { ...ARCH.children, f6: ['f1'] } } },
      { op: 'saveArchitecture', architecture: { ...ARCH, floors: { ...ARCH.floors, f3: { id: 'f3', kind: 'blackIce', ice: [{ ...tripwire, atk: 999 }] } } } },
      { op: 'saveArchitecture', architecture: { ...ARCH, name: 'x'.repeat(500) } },
      { op: 'setRig', actorId: 'kes', rig: { ...RIG, slots: 1 } },
      { op: 'setRig', actorId: 'kes', rig: { ...RIG, interface: 11 } },
      { op: 'setRig', actorId: 'kes', rig: { ...RIG, programs: [{ ...prog('armor'), rez: 99 }] } },
      { op: 'ability', actorId: 'kes', ability: 'teleport' },
      { op: 'iceAttack', actorId: 'kes', index: 1.5 },
    ];
    for (const op of bad) expect(t.net(op as NetOp, GM)).toMatchObject({ ok: false, code: 'INVALID' });
  });

  it('keeps prep and GM controls GM-only, and runners to their controllers', () => {
    const t = setup();
    expect(t.net({ op: 'setRig', actorId: 'kes', rig: RIG }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(t.net({ op: 'revealAccess', archId: 'lab', found: true }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    t.net({ op: 'revealAccess', archId: 'lab', found: true }, GM);
    expect(t.net({ op: 'jackIn', actorId: 'kes', archId: 'lab' }, P2)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
});

describe('netrunning: jacking in and moving', () => {
  it('needs a found architecture and an access point within 6 m with nothing in between', () => {
    const t = setup();
    expect(t.net({ op: 'jackIn', actorId: 'kes', archId: 'lab' }, P1)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    t.net({ op: 'revealAccess', archId: 'lab', found: true }, GM);
    t.send({ type: 'placeToken', actorId: 'kes', at: { x: 8, y: 4 } }, GM);
    expect(t.net({ op: 'jackIn', actorId: 'kes', archId: 'lab' }, P1)).toMatchObject({ ok: false, code: 'OUT_OF_REACH' });
    t.send({ type: 'placeToken', actorId: 'kes', at: { x: 2, y: 2 } }, GM);
    expect(t.net({ op: 'jackIn', actorId: 'kes', archId: 'lab' }, P1).ok).toBe(true);
    expect(run(t)).toMatchObject({ floorId: 'f1', revealed: ['f1'] });
  });

  it('blocks going below a Password until Backdoor beats its DV', () => {
    const t = setup();
    t.net({ op: 'revealAccess', archId: 'lab', found: true }, GM);
    t.net({ op: 'jackIn', actorId: 'kes', archId: 'lab' }, P1);
    expect(t.net({ op: 'move', actorId: 'kes', toFloorId: 'f2' }, P1)).toMatchObject({ ok: false, code: 'INVALID' });
    expect(t.net({ op: 'ability', actorId: 'kes', ability: 'backdoor' }, P1, d10(3)).ok).toBe(true); // 3 + 3 = 6, not > 6
    expect(run(t).passed).toEqual([]);
    // Worm (+2) must be running to help.
    t.net({ op: 'activate', actorId: 'kes', programId: 'worm', active: true }, P1);
    expect(t.net({ op: 'ability', actorId: 'kes', ability: 'backdoor' }, P1, d10(3)).ok).toBe(true); // 3 + 2 + 3 = 8
    expect(run(t).passed).toEqual(['f1']);
    expect(t.net({ op: 'move', actorId: 'kes', toFloorId: 'f2' }, P1).ok).toBe(true);
    expect(t.net({ op: 'move', actorId: 'kes', toFloorId: 'f6' }, P1)).toMatchObject({ ok: false, code: 'INVALID' });
  });
});

describe('netrunning: what players see', () => {
  it('shows only revealed floors, hides DVs and contents until earned, and hides other players’ runs', () => {
    const t = setup();
    t.net({ op: 'revealAccess', archId: 'lab', found: true }, GM);
    t.net({ op: 'jackIn', actorId: 'kes', archId: 'lab' }, P1);
    let v = projectState(t.state, P1).netrun!.runs.kes!;
    expect(Object.keys(v.floors)).toEqual(['f1']);
    expect(v.floors.f1!.dv).toBeUndefined();
    t.net({ op: 'ability', actorId: 'kes', ability: 'backdoor' }, P1, d10(9));
    t.net({ op: 'move', actorId: 'kes', toFloorId: 'f2' }, P1);
    v = projectState(t.state, P1).netrun!.runs.kes!;
    expect(v.floors.f1!.dv).toBe(6);
    expect(v.floors.f2!.note).toBeUndefined();
    t.net({ op: 'ability', actorId: 'kes', ability: 'eyeDee' }, P1, d10(9));
    const entry = projectEntry(t.log.at(-1)!, P1, t.state);
    expect(entry.patch.netrun!.runs.kes!.floors.f2!.note).toBe('Payroll for the night shift');
    // The architecture itself never reaches players.
    expect(JSON.stringify(projectState(t.state, P1).netrun)).not.toContain('Lab cameras');
    expect(projectState(t.state, P1).netrun!.full).toBeUndefined();
    expect(projectState(t.state, P2).netrun!.runs).toEqual({});
    expect(projectState(t.state, P2).netrun!.rigs).toEqual({});
    expect(projectState(t.state, GM).netrun!.full!.architectures.lab).toBeDefined();
  });

  it('keeps a hostile runner’s actions out of player logs', () => {
    const t = setup();
    t.net({ op: 'setRig', actorId: 'guard', rig: RIG }, GM);
    t.net({ op: 'jackIn', actorId: 'guard', archId: 'lab' }, GM);
    expect(projectEntry(t.log.at(-1)!, P1, t.state).events).toEqual([]);
  });

  it('Pathfinder maps breadth-first but not past a Password it can’t beat', () => {
    const r = freshRun(ARCH);
    expect(pathfinderReveal(ARCH, 'f1', 12, r.revealed)).toEqual(['f2', 'f3', 'f5', 'f4']);
    expect(pathfinderReveal(ARCH, 'f1', 20, r.revealed)).toEqual(['f2', 'f3', 'f5', 'f4', 'f6']);
    expect(pathfinderReveal(ARCH, 'f1', 2, r.revealed)).toEqual(['f2', 'f3']);
  });
});

describe('netrunning: Turn economy', () => {
  function inFight() {
    const t = setup();
    t.net({ op: 'revealAccess', archId: 'lab', found: true }, GM);
    t.send({ type: 'startEncounter', participants: [{ actorId: 'kes' }, { actorId: 'guard' }] }, GM, d10(9, 2));
    expect(t.state.encounter.order[0]).toBe('kes');
    return t;
  }
  it('gives Interface 3 two NET Actions, then stops', () => {
    const t = inFight();
    expect(t.net({ op: 'jackIn', actorId: 'kes', archId: 'lab' }, P1).ok).toBe(true);
    expect(projectState(t.state, P1).netrun!.runs.kes!.actionsLeft).toBe(1);
    expect(t.net({ op: 'ability', actorId: 'kes', ability: 'cloak' }, P1, d10(5)).ok).toBe(true);
    expect(t.net({ op: 'ability', actorId: 'kes', ability: 'cloak' }, P1, d10(5))).toMatchObject({ ok: false, code: 'ACTION_USED' });
  });
  it('makes NET Actions and a Meat Action exclusive', () => {
    const t = inFight();
    t.net({ op: 'jackIn', actorId: 'kes', archId: 'lab' }, P1);
    expect(t.send({ type: 'reload', actorId: 'kes', weaponId: 'pistol' }, P1)).toMatchObject({ ok: false, code: 'ACTION_USED' });
    const u = inFight();
    u.send({ type: 'reload', actorId: 'kes', weaponId: 'pistol' }, P1);
    expect(u.net({ op: 'jackIn', actorId: 'kes', archId: 'lab' }, P1)).toMatchObject({ ok: false, code: 'ACTION_USED' });
  });
  it('refuses out of Turn, refreshes next Turn', () => {
    const t = inFight();
    t.net({ op: 'jackIn', actorId: 'kes', archId: 'lab' }, P1);
    t.net({ op: 'ability', actorId: 'kes', ability: 'cloak' }, P1, d10(5));
    t.send({ type: 'endTurn' }, P1);
    expect(t.net({ op: 'ability', actorId: 'kes', ability: 'cloak' }, P1, d10(5))).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
    t.send({ type: 'endTurn' }, GM);
    expect(t.net({ op: 'ability', actorId: 'kes', ability: 'cloak' }, P1, d10(5)).ok).toBe(true);
  });
});

describe('netrunning: Black ICE', () => {
  /** Kes on f2 with f1 open, ready to step onto the Black ICE floor. */
  function atIce() {
    const t = setup();
    t.net({ op: 'revealAccess', archId: 'lab', found: true }, GM);
    t.net({ op: 'jackIn', actorId: 'kes', archId: 'lab' }, P1);
    t.net({ op: 'ability', actorId: 'kes', ability: 'backdoor' }, P1, d10(9));
    t.net({ op: 'move', actorId: 'kes', toFloorId: 'f2' }, P1);
    return t;
  }
  const hp = (t: ReturnType<typeof table>) => t.state.actors.kes!.combatant.hp.current;

  it('a faster ICE strikes first; brain damage ignores armor; Armor soaks 4', () => {
    const t = atIce();
    const before = hp(t);
    // Speed: Kes 3+2=5 vs ICE 4+5=9 → ICE first. Attack: 4+8=12 vs Interface 3+2=5 → hit. Damage 6+5=11.
    expect(t.net({ op: 'move', actorId: 'kes', toFloorId: 'f3' }, P1, scriptedDice({ d10: [2, 5, 8, 2], d6: [6, 5] })).ok).toBe(true);
    expect(hp(t)).toBe(before - 11);
    expect(t.state.actors.kes!.combatant.armor[0]!.currentSP).toBe(11);
    const types = t.log.at(-1)!.events.map((e) => (e.type === 'netAction' ? e.action : e.type));
    expect(types).toEqual(['arrive', 'speedCheck', 'iceAttack', 'brainDamage', 'woundStateChanged', 'gmRulingRequired']);

    const u = atIce();
    u.net({ op: 'activate', actorId: 'kes', programId: 'armor', active: true }, P1);
    u.net({ op: 'move', actorId: 'kes', toFloorId: 'f3' }, P1, scriptedDice({ d10: [2, 5, 8, 2], d6: [6, 5] }));
    expect(hp(u)).toBe(before - 7);
  });

  it('Shield eats the first hit of the run, then drops', () => {
    const t = atIce();
    const before = hp(t);
    t.net({ op: 'activate', actorId: 'kes', programId: 'shield', active: true }, P1);
    t.net({ op: 'move', actorId: 'kes', toFloorId: 'f3' }, P1, scriptedDice({ d10: [2, 5, 8, 2], d6: [6, 5] }));
    expect(hp(t)).toBe(before);
    expect(run(t).shieldSpent).toBe(true);
    expect(t.state.netrun!.rigs.kes!.programs.find((p) => p.id === 'shield')!.status).toBe('ready');
  });

  it('engaged runners can’t walk away; Sword derezzes; Programs run once a Round', () => {
    const t = atIce();
    // Kes faster: 3+9=12 vs 4+2=6.
    t.net({ op: 'move', actorId: 'kes', toFloorId: 'f3' }, P1, d10(9, 2));
    expect(projectState(t.state, P1).netrun!.runs.kes!.engaged).toBe(true);
    expect(t.net({ op: 'move', actorId: 'kes', toFloorId: 'f4' }, P1)).toMatchObject({ ok: false, code: 'INVALID' });
    // Sword: 3+1+8=12 vs DEF 2+2=4 → hit, 3d6 = 4+3+3 = 10 = REZ 10 → derezzed.
    expect(t.net({ op: 'program', actorId: 'kes', programId: 'sword', index: 0 }, P1, scriptedDice({ d10: [8, 2], d6: [4, 3, 3] })).ok).toBe(true);
    expect(run(t).ice.f3).toEqual([0]);
    expect(projectState(t.state, P1).netrun!.runs.kes!.engaged).toBe(false);
    expect(t.net({ op: 'move', actorId: 'kes', toFloorId: 'f4' }, P1).ok).toBe(true);
  });

  it('Zap does 1d6 REZ; Slide escapes on beating PER', () => {
    const t = atIce();
    t.net({ op: 'move', actorId: 'kes', toFloorId: 'f3' }, P1, d10(9, 2));
    t.net({ op: 'ability', actorId: 'kes', ability: 'zap', index: 0 }, P1, scriptedDice({ d10: [8, 2], d6: [4] }));
    expect(run(t).ice.f3).toEqual([6]);
    expect(t.net({ op: 'ability', actorId: 'kes', ability: 'slide', index: 0 }, P1)).toMatchObject({ ok: false, code: 'INVALID' }); // no destination
    // Slide: 3+8=11 vs PER 2+2=4 → away to f4 (Control Node, no ICE).
    expect(t.net({ op: 'ability', actorId: 'kes', ability: 'slide', index: 0, toFloorId: 'f4' }, P1, d10(8, 2)).ok).toBe(true);
    expect(run(t).floorId).toBe('f4');
    expect(t.net({ op: 'ability', actorId: 'kes', ability: 'control' }, P1, d10(9)).ok).toBe(true);
    expect(projectState(t.state, P1).netrun!.runs.kes!.floors.f4!.note).toBe('Lab cameras');
  });

  it('an unsafe Jack Out lets every live ICE they met bite', () => {
    const t = atIce();
    t.net({ op: 'move', actorId: 'kes', toFloorId: 'f3' }, P1, d10(9, 2));
    const before = hp(t);
    expect(t.net({ op: 'forceJackOut', actorId: 'kes' }, GM, scriptedDice({ d6: [2, 3] })).ok).toBe(true);
    expect(hp(t)).toBe(before - 5);
    expect(t.state.netrun!.runs.kes).toBeUndefined();
  });

  it('the GM can have ICE attack on its Turn', () => {
    const t = atIce();
    t.net({ op: 'move', actorId: 'kes', toFloorId: 'f3' }, P1, d10(9, 2));
    expect(t.net({ op: 'iceAttack', actorId: 'kes', index: 0 }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(t.net({ op: 'iceAttack', actorId: 'kes', index: 0 }, GM, scriptedDice({ d10: [2, 9] })).ok).toBe(true); // 6 vs 12: miss
  });
});

describe('netrunning: Scanner, Virus and 2070s Quickhacks', () => {
  it('Scanner finds access points within its result in squares', () => {
    const t = setup();
    t.send({ type: 'placeToken', actorId: 'kes', at: { x: 9, y: 4 } }, GM);
    t.net({ op: 'scan', actorId: 'kes' }, P1, d10(2)); // 5: (3,2) is 6 away
    expect(t.state.netrun!.found).toEqual([]);
    t.net({ op: 'scan', actorId: 'kes' }, P1, d10(4)); // 7
    expect(t.state.netrun!.found).toEqual(['lab']);
  });

  it('Virus only on a lowest floor', () => {
    const t = setup();
    t.net({ op: 'revealAccess', archId: 'lab', found: true }, GM);
    t.net({ op: 'jackIn', actorId: 'kes', archId: 'lab' }, P1);
    expect(t.net({ op: 'ability', actorId: 'kes', ability: 'virus' }, P1)).toMatchObject({ ok: false, code: 'INVALID' });
  });

  it('Quickhacks need the option, 50 m and sight of the target', () => {
    const t = setup();
    const q = { op: 'quickhack', actorId: 'kes', targetId: 'guard' } as const;
    expect(t.net(q, P1)).toMatchObject({ ok: false, code: 'INVALID' });
    t.net({ op: 'setOptions', quickhacks2070s: true }, GM);
    expect(t.net(q, P1).ok).toBe(true);
    t.send({ type: 'placeToken', actorId: 'guard', at: { x: 6, y: 2 } }, GM); // behind the wall from (2,2)
    expect(t.net(q, P1)).toMatchObject({ ok: false, code: 'NO_LINE_OF_SIGHT' });
  });
});
