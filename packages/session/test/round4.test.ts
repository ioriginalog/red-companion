import { describe, expect, it } from 'vitest';
import {
  getInjury, ICE_TEMPLATES, maxHP, scriptedDice,
  type Combatant, type CyberwareItem, type Dice, type NetArchitecture, type NetRig, type Stats, type Weapon,
} from '@cprc/rules-core';
import {
  applyEntry, attackAvailability, emptySession, handleIntent, projectEntry, projectState,
  type Actor, type Intent, type LogEntry, type NetOp, type SessionState, type TacticalMap, type Viewer,
} from '../src/index.js';

const BASE: Stats = { INT: 6, REF: 6, DEX: 6, TECH: 6, COOL: 6, WILL: 6, LUCK: 6, MOVE: 6, BODY: 6, EMP: 6 };
const PISTOL: Weapon = { id: 'pistol', name: 'Heavy Pistol', type: 'heavyPistol', ammo: { loaded: 8, capacity: 8 } };
const RIFLE: Weapon = { id: 'rifle', name: 'Assault Rifle', type: 'assaultRifle', ammo: { loaded: 25, capacity: 25 } };
function actor(id: string, side: 'pc' | 'npc', controller: string, over: Partial<Combatant> = {}, stats: Partial<Stats> = {}): Actor {
  const s = { ...BASE, ...stats };
  const max = maxHP(s.BODY, s.WILL);
  const combatant: Combatant = {
    id, name: id, side, stats: s, skills: { Handgun: 6, 'Shoulder Arms': 6, Evasion: 4 }, hp: { max, current: max },
    armor: [], criticalInjuries: [], deathSave: { accumulatedPenalty: 0 },
    conditions: { prone: false, unconscious: false, dead: false, stabilized: false }, ...over,
  };
  return { id, controller, weapons: [PISTOL, RIFLE], combatant };
}
const inj = (injuryId: string) => ({ injuryId, table: getInjury(injuryId).table, quickFixed: false });

const GM: Viewer = { role: 'gm' };
const P1: Viewer = { role: 'player', playerId: 'p1' };
const d10 = (...xs: number[]) => scriptedDice({ d10: xs });
const OPEN: TacticalMap = {
  id: 'm', name: 'Yard', width: 14, height: 7, cells: '.'.repeat(14 * 7), cellPx: 64, sightRange: 30,
  tokens: { solo: { x: 1, y: 3 }, ganger: { x: 12, y: 3 } }, watches: {}, spotted: [],
};

function table(start?: SessionState) {
  let state: SessionState = start ?? emptySession('s1');
  const log: LogEntry[] = [];
  let n = 0;
  const ctx = (dice: Dice) => ({ dice, now: () => '2077-01-01T00:00:00Z', newId: () => `id${++n}` });
  return {
    get state() { return state; },
    set state(s: SessionState) { state = s; },
    log,
    send(intent: Intent, by: Viewer, dice: Dice = scriptedDice({})) {
      const r = handleIntent(state, intent, by, ctx(dice));
      if (r.ok) { state = applyEntry(state, r.entry); log.push(r.entry); }
      return r;
    },
  };
}

/** solo (PC, REF 8, controlled by p1) acts first, then ganger (REF 5). */
function setup(solo: Partial<Combatant> = {}, ganger: Partial<Combatant> = {}) {
  const t = table();
  t.send({ type: 'addActor', actor: actor('solo', 'pc', 'p1', solo, { REF: 8 }) }, GM);
  t.send({ type: 'addActor', actor: actor('ganger', 'npc', 'gm', ganger, { REF: 5 }) }, GM);
  t.send({ type: 'setMap', map: OPEN }, GM);
  expect(t.send({ type: 'startEncounter', participants: [{ actorId: 'solo' }, { actorId: 'ganger' }] }, GM, d10(5, 3)).ok).toBe(true);
  expect(t.state.encounter.order).toEqual(['solo', 'ganger']);
  return t;
}
const hp = (t: ReturnType<typeof table>, id: string) => t.state.actors[id]!.combatant.hp.current;
const noHp = (events: unknown[]) => { for (const e of events) expect(JSON.stringify(e)).not.toMatch(/"hp(After|Before)"/); };

describe('Critical Injury automation', () => {
  it('Spinal Injury: no Action on the next Turn, Move still allowed', () => {
    const t = setup({ criticalInjuries: [inj('spinalInjury')], turnFlags: { loseAction: true } });
    expect(t.state.encounter.usage).toMatchObject({ actorId: 'solo', actionUsed: true });
    const types = t.log.at(-1)!.events.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['turnReminders', 'injuryEffect']));
    expect(t.state.actors.solo!.combatant.turnFlags).toBeUndefined();
    expect(t.send({ type: 'rangedAttack', attackerId: 'solo', defenderId: 'ganger', weaponId: 'pistol', distance: 1 }, P1)).toMatchObject({ ok: false, code: 'ACTION_USED' });
    expect(t.send({ type: 'moveToken', actorId: 'solo', to: { x: 3, y: 3 } }, P1).ok).toBe(true);
  });

  it('Broken Ribs: moving more than 4 m/yds re-inflicts 5 at the end of the Turn', () => {
    const t = setup({ criticalInjuries: [inj('brokenRibs')] });
    const before = hp(t, 'solo');
    t.send({ type: 'moveToken', actorId: 'solo', to: { x: 4, y: 3 } }, P1); // 3 squares = 6 m
    expect(t.send({ type: 'endTurn' }, P1).ok).toBe(true);
    expect(hp(t, 'solo')).toBe(before - 5);
    const ev = t.log.at(-1)!.events.filter((e) => e.type === 'injuryEffect');
    expect(ev).toMatchObject([{ effect: 'rebleed', injuryId: 'brokenRibs', damage: 5, visibility: 'public' }]);
  });

  it('does not bleed at 4 m/yds, and hides an NPC’s bleeding from players with no HP in the payload', () => {
    const t = setup({ criticalInjuries: [inj('brokenRibs')] }, { criticalInjuries: [inj('foreignObject')] });
    const before = hp(t, 'solo');
    t.send({ type: 'moveToken', actorId: 'solo', to: { x: 3, y: 3 } }, P1); // 2 squares = 4 m
    t.send({ type: 'endTurn' }, P1);
    expect(hp(t, 'solo')).toBe(before);
    const gBefore = hp(t, 'ganger');
    t.send({ type: 'moveToken', actorId: 'ganger', to: { x: 9, y: 3 } }, GM);
    t.send({ type: 'endTurn' }, GM);
    expect(hp(t, 'ganger')).toBe(gBefore - 5);
    const last = t.log.at(-1)!;
    noHp(last.events.filter((e) => e.type === 'injuryEffect' || e.type === 'turnReminders'));
    expect(projectEntry(last, P1, t.state).events.some((e) => e.type === 'injuryEffect')).toBe(false);
  });

  it('Damaged Ear: after running, no Move Action next Turn; a Run still works', () => {
    const t = setup({ criticalInjuries: [inj('damagedEar')] });
    t.send({ type: 'moveToken', actorId: 'solo', to: { x: 4, y: 3 } }, P1);
    t.send({ type: 'endTurn' }, P1);
    expect(t.state.actors.solo!.combatant.turnFlags?.noMove).toBe(true);
    t.send({ type: 'endTurn' }, GM); // Round 2, solo again
    expect(t.state.encounter.usage).toMatchObject({ actorId: 'solo', moveUsed: 6, moveBlocked: 6 });
    expect(t.send({ type: 'moveToken', actorId: 'solo', to: { x: 5, y: 3 } }, P1)).toMatchObject({ ok: false, code: 'NO_MOVEMENT' });
    expect(t.send({ type: 'moveToken', actorId: 'solo', to: { x: 5, y: 3 }, run: true }, P1).ok).toBe(true);
    // The blocked squares never count as walking: 1 square run, so no new lost Move.
    t.send({ type: 'endTurn' }, P1);
    expect(t.state.actors.solo!.combatant.turnFlags).toBeUndefined();
  });

  it('reminds the GM of a Prone, grappled or burning character at Turn start', () => {
    const t = setup({ conditions: { prone: true, unconscious: false, dead: false, stabilized: false } });
    const r = t.log.at(-1)!.events.find((e) => e.type === 'turnReminders');
    expect(r && r.type === 'turnReminders' && r.items.map((i) => i.key)).toEqual(['prone']);
  });
});

describe('speedware', () => {
  const sandy: CyberwareItem = { id: 'sv', name: 'Burst Rig', humanityLoss: 7, effects: [{ kind: 'speedware', mode: 'activated', initiative: 3 }] };
  const kz: CyberwareItem = { id: 'kz', name: 'Reflex Coil', humanityLoss: 7, effects: [{ kind: 'speedware', mode: 'passive', initiative: 2 }] };

  function withSpeedware() {
    const t = table();
    t.send({ type: 'addActor', actor: actor('solo', 'pc', 'p1', {}, { REF: 8 }) }, GM);
    t.send({ type: 'addActor', actor: actor('ganger', 'npc', 'gm', {}, { REF: 5 }) }, GM);
    expect(t.send({ type: 'installCyberware', actorId: 'solo', item: sandy, lossMode: 'none' }, GM).ok).toBe(true);
    return t;
  }

  it('only one piece of speedware can be installed', () => {
    const t = withSpeedware();
    expect(t.send({ type: 'installCyberware', actorId: 'solo', item: kz, lossMode: 'none' }, GM)).toMatchObject({ ok: false, code: 'INVALID' });
  });

  it('activated before a fight, it adds to Initiative; once per rest; lasts 20 Rounds', () => {
    const t = withSpeedware();
    expect(t.send({ type: 'activateSpeedware', actorId: 'solo' }, P1).ok).toBe(true);
    expect(t.send({ type: 'activateSpeedware', actorId: 'solo' }, P1)).toMatchObject({ ok: false, code: 'INVALID' });
    t.send({ type: 'startEncounter', participants: [{ actorId: 'solo' }, { actorId: 'ganger' }] }, GM, d10(1, 9)); // 8+1+3=12 vs 5+9=14
    expect(t.state.encounter.initiative).toEqual({ solo: 12, ganger: 14 });
    for (let i = 0; i < 38; i++) t.send({ type: 'endTurn' }, GM); // to the start of Round 20
    expect(t.state.encounter.round).toBe(20);
    expect(t.state.actors.solo!.combatant.speedware?.active).toBe(true);
    t.send({ type: 'endTurn' }, GM); t.send({ type: 'endTurn' }, GM); // Round 21
    expect(t.state.actors.solo!.combatant.speedware?.active).toBe(false);
    expect(t.log.at(-1)!.events.some((e) => e.type === 'speedwareChanged' && e.state === 'expired')).toBe(true);
    t.send({ type: 'endEncounter' }, GM);
    expect(t.send({ type: 'activateSpeedware', actorId: 'solo' }, P1)).toMatchObject({ ok: false, code: 'INVALID' }); // spent
    t.send({ type: 'rest', days: 1, care: 'home' }, GM);
    expect(t.send({ type: 'activateSpeedware', actorId: 'solo' }, P1).ok).toBe(true);
  });

  it('uses the Action in a fight, and refuses hostile payloads', () => {
    const t = withSpeedware();
    t.send({ type: 'startEncounter', participants: [{ actorId: 'solo' }, { actorId: 'ganger' }] }, GM, d10(5, 3));
    expect(t.send({ type: 'activateSpeedware', actorId: 'solo' }, P1).ok).toBe(true);
    expect(t.state.encounter.usage!.actionUsed).toBe(true);
    expect(t.send({ type: 'activateSpeedware', actorId: 'ganger' }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(t.send({ type: 'activateSpeedware', actorId: 42 } as unknown as Intent, P1)).toMatchObject({ ok: false });
    expect(t.send({ type: 'activateSpeedware', actorId: 'ganger' }, GM)).toMatchObject({ ok: false, code: 'INVALID' }); // none installed
  });
});

describe('Black ICE and Demon turns', () => {
  const ice = ICE_TEMPLATES[0]!;
  const ARCH: NetArchitecture = {
    id: 'lab', name: 'Lab Server', difficulty: 'standard', rootId: 'f1', virusDv: 8,
    floors: {
      f1: { id: 'f1', kind: 'blackIce', ice: [ice] },
      f2: { id: 'f2', kind: 'demon', demon: { name: 'Gatekeeper', rez: 10, interface: 4, netActions: 2 } },
    },
    children: { f1: ['f2'] },
    access: [{ mapId: 'm', cells: [{ x: 2, y: 3 }] }],
  };
  const RIG: NetRig = { interface: 3, deckName: 'Deck', slots: 7, programs: [] };
  const net = (t: ReturnType<typeof table>, op: NetOp | Record<string, unknown>, by: Viewer, dice?: Dice) => t.send({ type: 'net', op: op as NetOp }, by, dice);

  function runnerAtIce() {
    const t = table();
    t.send({ type: 'addActor', actor: actor('solo', 'pc', 'p1', {}, { REF: 8 }) }, GM);
    t.send({ type: 'addActor', actor: actor('ganger', 'npc', 'gm', {}, { REF: 5 }) }, GM);
    t.send({ type: 'setMap', map: OPEN }, GM);
    net(t, { op: 'saveArchitecture', architecture: ARCH }, GM);
    net(t, { op: 'setRig', actorId: 'solo', rig: RIG }, GM);
    net(t, { op: 'revealAccess', archId: 'lab', found: true }, GM);
    t.send({ type: 'startEncounter', participants: [{ actorId: 'solo' }, { actorId: 'ganger' }] }, GM, d10(5, 3));
    // Jack In lands on f1 (Black ICE): runner faster (3+9 vs 4+2).
    expect(net(t, { op: 'jackIn', actorId: 'solo', archId: 'lab' }, P1, d10(9, 2)).ok).toBe(true);
    return t;
  }

  it('prompts the GM (only) at the top of each Round and runs the ICE’s Turn in one click', () => {
    const t = runnerAtIce();
    t.send({ type: 'endTurn' }, P1);
    t.send({ type: 'endTurn' }, GM); // Round 2
    const last = t.log.at(-1)!;
    const threat = last.events.find((e) => e.type === 'netThreat');
    expect(threat).toMatchObject({ combatantId: 'solo', ice: [{ floorId: 'f1', index: 0 }] });
    expect(projectEntry(last, P1, t.state).events.some((e) => e.type === 'netThreat')).toBe(false);
    expect(net(t, { op: 'iceTurn', actorId: 'solo' }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    const before = hp(t, 'solo');
    // ICE ATK 4+9=13 vs Interface 3+2=5: hit; damage from its dice.
    expect(net(t, { op: 'iceTurn', actorId: 'solo' }, GM, scriptedDice({ d10: [9, 2], d6: [3, 3] })).ok).toBe(true);
    expect(hp(t, 'solo')).toBeLessThan(before);
  });

  it('a Demon spends up to its NET Actions on Zaps', () => {
    const t = runnerAtIce();
    // Derez the ICE so the runner can step down, using the GM's state edit for brevity.
    t.state = { ...t.state, netrun: { ...t.state.netrun!, runs: { solo: { ...t.state.netrun!.runs.solo!, ice: { f1: [0] } } } } };
    expect(net(t, { op: 'move', actorId: 'solo', toFloorId: 'f2' }, P1).ok).toBe(true);
    expect(net(t, { op: 'demonZap', actorId: 'solo', count: 3 }, GM)).toMatchObject({ ok: false, code: 'INVALID' }); // only 2
    expect(net(t, { op: 'demonZap', actorId: 'solo', count: 'x' } as Record<string, unknown>, GM)).toMatchObject({ ok: false, code: 'INVALID' });
    const before = hp(t, 'solo');
    // Zap 1: 4+8=12 vs 3+2=5 hit, 1d6=4. Zap 2: 4+2=6 vs 3+9=12 miss.
    expect(net(t, { op: 'demonZap', actorId: 'solo', count: 2 }, GM, scriptedDice({ d10: [8, 2, 2, 9], d6: [4] })).ok).toBe(true);
    expect(hp(t, 'solo')).toBe(before - 4);
    expect(net(t, { op: 'iceTurn', actorId: 'solo' }, GM)).toMatchObject({ ok: false, code: 'INVALID' }); // no ICE here
  });
});

describe('attackAvailability stays in lockstep with the authority', () => {
  const grappled = (s: SessionState, ironGrip = false): SessionState => ({
    ...s, extras: { grapples: [{ holderId: 'ganger', heldId: 'solo', chokes: 0, lastChokeRound: null, ironGrip }], facedowns: [], hits: [], movesUsed: [] },
  });
  const adjacentMap = (s: SessionState): SessionState => ({ ...s, map: { ...s.map!, tokens: { solo: { x: 1, y: 3 }, ganger: { x: 2, y: 3 } } } });
  const cases: { name: string; state: (s: SessionState) => SessionState; weapon: 'pistol' | 'rifle' }[] = [
    { name: 'free, two-handed rifle', state: (s) => s, weapon: 'rifle' },
    { name: 'broken arm, two-handed rifle', state: (s) => ({ ...s, actors: { ...s.actors, solo: { ...s.actors.solo!, combatant: { ...s.actors.solo!.combatant, criticalInjuries: [inj('brokenArm')] } } } }), weapon: 'rifle' },
    { name: 'broken arm, pistol', state: (s) => ({ ...s, actors: { ...s.actors, solo: { ...s.actors.solo!, combatant: { ...s.actors.solo!.combatant, criticalInjuries: [inj('brokenArm')] } } } }), weapon: 'pistol' },
    { name: 'grappled, rifle', state: (s) => grappled(adjacentMap(s)), weapon: 'rifle' },
    { name: 'grappled, pistol', state: (s) => grappled(adjacentMap(s)), weapon: 'pistol' },
    { name: 'iron grip, pistol', state: (s) => grappled(adjacentMap(s), true), weapon: 'pistol' },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const base = setup().state;
      const state = c.state(base);
      const view = projectState(state, P1);
      const w = state.actors.solo!.weapons.find((x) => x.id === c.weapon)!;
      const av = attackAvailability(view, 'solo', w, 'ganger');
      const r = handleIntent(state, { type: 'rangedAttack', attackerId: 'solo', defenderId: 'ganger', weaponId: c.weapon, distance: 2, defenderDodges: false }, P1, { dice: d10(5) });
      expect(r.ok).toBe(av.ok);
      if (!r.ok) expect(r.message).toBe(av.reason);
      else {
        const att = r.entry.events.find((e) => e.type === 'attackResolved');
        const mods = att && att.type === 'attackResolved' ? att.attack.modifiers.filter((m) => m.label === 'Grappling' || m.label === 'Lost Facedown') : [];
        expect(mods).toEqual(av.modifiers);
      }
    });
  }
});
