import { describe, expect, it } from 'vitest';
import { maxHP, scriptedDice, type Combatant, type Dice, type Stats, type Weapon } from '@cprc/rules-core';
import {
  applyEntry, emptySession, handleIntent, projectEntry, projectState,
  type Actor, type Allegiance, type Intent, type LogEntry, type SessionState, type TacticalMap, type Viewer,
} from '../src/index.js';

const BASE: Stats = { INT: 6, REF: 6, DEX: 6, TECH: 6, COOL: 6, WILL: 6, LUCK: 6, MOVE: 6, BODY: 6, EMP: 6 };
const W = (id: string, type: Weapon['type'], capacity?: number): Weapon => (capacity ? { id, name: id, type, ammo: { loaded: capacity, capacity } } : { id, name: id, type });
function actor(id: string, side: 'pc' | 'npc', controller: string, stats: Partial<Stats> = {}, allegiance?: Allegiance): Actor {
  const s = { ...BASE, ...stats };
  const max = maxHP(s.BODY, s.WILL);
  const combatant: Combatant = {
    id, name: id, side, stats: s,
    skills: { Handgun: 6, 'Heavy Weapons': 6, 'Shoulder Arms': 6, Autofire: 4, Evasion: 4, Perception: 5 },
    hp: { max, current: max }, armor: [], criticalInjuries: [], deathSave: { accumulatedPenalty: 0 },
    conditions: { prone: false, unconscious: false, dead: false, stabilized: false },
  };
  return {
    id, controller, combatant, ...(allegiance ? { allegiance } : {}),
    weapons: [W('pistol', 'heavyPistol', 8), W('gl', 'grenadeLauncher', 2), W('shotgun', 'shotgun', 4), W('smg', 'smg', 30)],
  };
}

const GM: Viewer = { role: 'gm' };
const P1: Viewer = { role: 'player', playerId: 'p1' };
const P2: Viewer = { role: 'player', playerId: 'p2' };
const P3: Viewer = { role: 'player', playerId: 'p3' };
const TWOS = (n = 40) => Array<number>(n).fill(2); // no crits

//                   0123456789AB
const ROWS = ['............',
              '............',
              '............',
              '.......#....',
              '............',
              '............',
              '............'];
const MAP: TacticalMap = {
  id: 'yard', name: 'Yard', width: 12, height: 7, cells: ROWS.join(''), cellPx: 64, sightRange: 30,
  tokens: { solo: { x: 1, y: 3 }, ganger: { x: 6, y: 2 }, rook: { x: 5, y: 4 }, thug: { x: 8, y: 3 } }, watches: {}, spotted: [],
};

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
    last: () => log.at(-1)!,
  };
}

function setup() {
  const t = table();
  t.send({ type: 'addActor', actor: actor('solo', 'pc', 'p1', { REF: 8 }) }, GM);
  t.send({ type: 'addActor', actor: actor('doc', 'pc', 'p2') }, GM);
  t.send({ type: 'addActor', actor: actor('ganger', 'npc', 'gm', { REF: 5 }) }, GM);
  t.send({ type: 'addActor', actor: actor('rook', 'npc', 'gm', { REF: 6 }, 'ally') }, GM);
  t.send({ type: 'addActor', actor: actor('thug', 'npc', 'gm', { REF: 5 }) }, GM);
  expect(t.send({ type: 'setMap', map: MAP }, GM).ok).toBe(true);
  t.send({ type: 'startEncounter', participants: [{ actorId: 'solo' }, { actorId: 'ganger' }] }, GM, scriptedDice({ d10: [5, 3] }));
  expect(t.state.encounter.order[0]).toBe('solo');
  return t;
}
const eventsFor = (t: ReturnType<typeof table>, v: Viewer) => projectEntry(t.last(), v, t.state).events;

describe('rollCheck', () => {
  it('rolls STAT + skill + standing modifiers + 1d10 against a DV', () => {
    const t = setup();
    expect(t.send({ type: 'rollCheck', actorId: 'solo', label: 'Spot the Ambush', stat: 'INT', skill: 'Perception', dv: 15 }, P1, scriptedDice({ d10: [4] })).ok).toBe(true);
    const e = t.last().events[0]!;
    expect(e).toMatchObject({ type: 'checkRolled', by: 'p1', combatantId: 'solo', dv: 15, success: false });
    expect(e.type === 'checkRolled' && e.check.total).toBe(6 + 5 + 4);
  });
  it('lets anyone roll a raw base with no character, and refuses STATs without one', () => {
    const t = setup();
    expect(t.send({ type: 'rollCheck', label: 'Luck', base: 7 }, P2, scriptedDice({ d10: [3] })).ok).toBe(true);
    expect(t.send({ type: 'rollCheck', label: 'Spot', stat: 'INT' }, P2)).toMatchObject({ ok: false, code: 'INVALID' });
    expect(t.send({ type: 'rollCheck', label: 'Nothing' }, P2)).toMatchObject({ ok: false, code: 'INVALID' });
  });
  it('refuses rolls for characters you don’t control', () => {
    const t = setup();
    expect(t.send({ type: 'rollCheck', actorId: 'solo', label: 'Spot', stat: 'INT' }, P2)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
  it('keeps private GM rolls from players, and private player rolls from other players', () => {
    const t = setup();
    t.send({ type: 'rollCheck', actorId: 'solo', label: 'Secret Perception', stat: 'INT', skill: 'Perception', private: true }, GM, scriptedDice({ d10: [5] }));
    expect(t.last().events[0]!.audience).toEqual(['gm']);
    expect(eventsFor(t, P1)).toEqual([]);
    expect(eventsFor(t, GM)).toHaveLength(1);
    t.send({ type: 'rollCheck', actorId: 'solo', label: 'Hidden Roll', base: 5, private: true }, P1, scriptedDice({ d10: [5] }));
    expect(eventsFor(t, P1)).toHaveLength(1);
    expect(eventsFor(t, P2)).toEqual([]);
  });
  it('redacts the numbers of a public NPC check', () => {
    const t = setup();
    t.send({ type: 'rollCheck', actorId: 'rook', label: 'Brawl', stat: 'BODY' }, GM, scriptedDice({ d10: [5] }));
    const e = eventsFor(t, P1)[0]!;
    expect(e.type === 'checkRolled' && e.check.redacted).toBe(true);
  });
  it('works out of Turn order and while an attack is pending', () => {
    const t = setup();
    t.send({ type: 'moveToken', actorId: 'solo', to: { x: 2, y: 2 } }, P1);
    expect(t.send({ type: 'rangedAttack', attackerId: 'solo', defenderId: 'ganger', weaponId: 'pistol', distance: 1 }, P1, scriptedDice({ d10: [9] })).ok).toBe(true);
    expect(t.state.pending?.kind).toBe('awaitingDamage');
    expect(t.send({ type: 'rollCheck', actorId: 'doc', label: 'Cool Under Fire', stat: 'COOL' }, P2, scriptedDice({ d10: [5] })).ok).toBe(true);
    expect(t.send({ type: 'chat', text: 'Nice shot.' }, P2).ok).toBe(true);
    expect(t.send({ type: 'rollDice', label: 'Table', dice: { count: 1, sides: 10, bonus: 0 } }, GM, scriptedDice({ d10: [5] })).ok).toBe(true);
  });
});

describe('rollDice', () => {
  it('rolls d6 or d10 with a bonus', () => {
    const t = setup();
    t.send({ type: 'rollDice', label: 'Damage', dice: { count: 3, sides: 6, bonus: 2 } }, P1, scriptedDice({ d6: [1, 2, 3] }));
    expect(t.last().events[0]).toMatchObject({ type: 'diceRolled', by: 'p1', dice: [1, 2, 3], total: 8, sides: 6 });
  });
  it('validates the expression', () => {
    const t = setup();
    expect(t.send({ type: 'rollDice', label: 'x', dice: { count: 0, sides: 6, bonus: 0 } }, P1)).toMatchObject({ ok: false, code: 'INVALID' });
    expect(t.send({ type: 'rollDice', label: 'x', dice: { count: 2, sides: 8 as 6, bonus: 0 } }, P1)).toMatchObject({ ok: false, code: 'INVALID' });
    expect(t.send({ type: 'rollDice', label: 'x', dice: { count: 21, sides: 10, bonus: 0 } }, P1)).toMatchObject({ ok: false, code: 'INVALID' });
  });
});

describe('chat', () => {
  it('whispers reach only the recipients, the author and the GM', () => {
    const t = setup();
    expect(t.send({ type: 'chat', text: 'Flank left.', to: ['p2'] }, P1).ok).toBe(true);
    expect(t.last().events[0]).toMatchObject({ type: 'chatMessage', by: 'p1', audience: ['p2', 'p1'] });
    expect(eventsFor(t, P1)).toHaveLength(1);
    expect(eventsFor(t, P2)).toHaveLength(1);
    expect(eventsFor(t, P3)).toEqual([]);
    expect(eventsFor(t, GM)).toHaveLength(1);
  });
  it('speaks as a controlled character only, within 500 characters', () => {
    const t = setup();
    expect(t.send({ type: 'chat', text: 'Hi.', asActorId: 'solo' }, P1).ok).toBe(true);
    expect(t.send({ type: 'chat', text: 'Hi.', asActorId: 'solo' }, P2)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(t.send({ type: 'chat', text: '   ' }, P1)).toMatchObject({ ok: false, code: 'INVALID' });
    expect(t.send({ type: 'chat', text: 'x'.repeat(501) }, P1)).toMatchObject({ ok: false, code: 'INVALID' });
  });
});

describe('GM edits', () => {
  it('adjusts HP with Wound State changes, caps healing, and has no floor', () => {
    const t = setup();
    const max = t.state.actors.solo!.combatant.hp.max;
    t.send({ type: 'adjustHp', actorId: 'solo', delta: -30, reason: 'Fall' }, GM);
    expect(t.last().events.map((e) => e.type)).toEqual(['hpAdjusted', 'woundStateChanged']);
    t.send({ type: 'adjustHp', actorId: 'solo', delta: 100 }, GM);
    expect(t.state.actors.solo!.combatant.hp.current).toBe(max);
    expect(t.last().events[0]).toMatchObject({ delta: 30, hpAfter: max });
    t.send({ type: 'adjustHp', actorId: 'solo', delta: -(max + 5) }, GM);
    expect(t.state.actors.solo!.combatant.hp.current).toBe(-5);
    expect(t.state.actors.solo!.combatant.conditions.dead).toBe(false);
  });
  it('keeps NPC HP changes from players and refuses players', () => {
    const t = setup();
    t.send({ type: 'adjustHp', actorId: 'ganger', delta: -3 }, GM);
    expect(eventsFor(t, P1).some((e) => e.type === 'hpAdjusted')).toBe(false);
    expect(t.send({ type: 'adjustHp', actorId: 'solo', delta: 5 }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
  it('sets conditions', () => {
    const t = setup();
    t.send({ type: 'setCondition', actorId: 'ganger', condition: 'prone', value: true }, GM);
    expect(t.state.actors.ganger!.combatant.conditions.prone).toBe(true);
    expect(t.last().events[0]).toMatchObject({ type: 'conditionSet', condition: 'prone', value: true });
  });
});

describe('library, scenes and spawning', () => {
  const ROOF: TacticalMap = { id: 'roof', name: 'Rooftop', width: 4, height: 3, cells: '....'.repeat(3), cellPx: 64, sightRange: 10, tokens: { solo: { x: 0, y: 0 }, ghost: { x: 1, y: 1 } }, watches: {}, spotted: [] };

  it('saves, lists and removes library items, GM only, with validation', () => {
    const t = setup();
    expect(t.send({ type: 'saveToLibrary', kind: 'map', item: ROOF }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(t.send({ type: 'saveToLibrary', kind: 'map', item: ROOF }, GM).ok).toBe(true);
    expect(t.send({ type: 'saveToLibrary', kind: 'actor', item: actor('merc', 'npc', 'gm') }, GM).ok).toBe(true);
    expect(Object.keys(t.state.library.maps)).toEqual(['roof']);
    expect(t.send({ type: 'saveToLibrary', kind: 'map', item: { ...ROOF, cells: '..' } }, GM)).toMatchObject({ ok: false, code: 'INVALID' });
    expect(t.send({ type: 'saveToLibrary', kind: 'actor', item: { ...actor('x', 'npc', 'gm'), id: 'y' } }, GM)).toMatchObject({ ok: false, code: 'INVALID' });
    expect(t.send({ type: 'removeFromLibrary', kind: 'actor', id: 'merc' }, GM).ok).toBe(true);
    expect(t.send({ type: 'removeFromLibrary', kind: 'actor', id: 'merc' }, GM)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    // Never projected to players.
    expect(projectState(t.state, P1).library).toBeUndefined();
    expect(projectEntry(t.last(), P1, t.state).patch.library).toBeUndefined();
  });

  it('switches scenes, parking the current map without its watches', () => {
    const t = setup();
    t.send({ type: 'setWatch', actorId: 'solo', facing: 0 }, P1);
    t.send({ type: 'saveToLibrary', kind: 'map', item: ROOF }, GM);
    expect(t.send({ type: 'switchScene', mapId: 'roof' }, GM).ok).toBe(true);
    expect(t.state.map!.id).toBe('roof');
    expect(t.state.map!.tokens).toEqual({ solo: { x: 0, y: 0 } }); // 'ghost' isn't an actor
    expect(t.state.library.maps.yard!.watches).toEqual({});
    expect(t.last().events[0]).toMatchObject({ type: 'sceneChanged', mapId: 'roof', name: 'Rooftop' });
    expect(t.send({ type: 'switchScene', mapId: 'roof' }, GM)).toMatchObject({ ok: false, code: 'INVALID' });
    expect(t.send({ type: 'switchScene', mapId: 'yard' }, GM).ok).toBe(true);
    expect(t.state.map!.tokens.ganger).toEqual({ x: 6, y: 2 });
  });

  it('spawns fresh copies of a template, optionally on the map', () => {
    const t = setup();
    const merc = actor('merc', 'npc', 'p1');
    merc.combatant.hp.current = 1;
    merc.weapons[0]!.ammo!.loaded = 0;
    t.send({ type: 'saveToLibrary', kind: 'actor', item: merc }, GM);
    expect(t.send({ type: 'spawnFromLibrary', templateId: 'merc', newId: 'merc-1', name: 'Merc 1', at: { x: 10, y: 6 } }, GM).ok).toBe(true);
    const m = t.state.actors['merc-1']!;
    expect(m.combatant).toMatchObject({ id: 'merc-1', name: 'Merc 1' });
    expect(m.combatant.hp.current).toBe(m.combatant.hp.max);
    expect(m.controller).toBe('gm');
    expect(m.weapons[0]!.ammo!.loaded).toBe(8);
    expect(t.state.map!.tokens['merc-1']).toEqual({ x: 10, y: 6 });
    expect(t.send({ type: 'spawnFromLibrary', templateId: 'merc', newId: 'merc-1' }, GM)).toMatchObject({ ok: false, code: 'INVALID' });
    expect(t.send({ type: 'spawnFromLibrary', templateId: 'merc', newId: 'merc-2', at: { x: 10, y: 6 } }, GM)).toMatchObject({ ok: false, code: 'INVALID' });
    expect(t.send({ type: 'spawnFromLibrary', templateId: 'merc', newId: 'merc-3', at: { x: 7, y: 3 } }, GM)).toMatchObject({ ok: false, code: 'INVALID' });
    // The template itself is untouched.
    expect(t.state.library.actors.merc!.combatant.hp.current).toBe(1);
  });
});

describe('lighting', () => {
  it('reveal all shows every token to players and marks them spotted', () => {
    const t = setup();
    expect(projectState(t.state, P1).map!.tokens.thug).toBeUndefined();
    t.send({ type: 'setLighting', lighting: { revealAll: true } }, GM);
    expect(projectState(t.state, P1).map!.tokens.thug).toEqual({ x: 8, y: 3 });
    expect(t.state.map!.spotted).toContain('thug');
  });
  it('revealed squares are always visible', () => {
    const t = setup();
    t.send({ type: 'setLighting', lighting: { revealed: ['8,3'] } }, GM);
    expect(projectState(t.state, P1).map!.tokens.thug).toEqual({ x: 8, y: 3 });
    expect(t.send({ type: 'setLighting', lighting: { revealed: ['nope'] } }, GM)).toMatchObject({ ok: false, code: 'INVALID' });
  });
});

describe('areaAttack', () => {
  it('a launcher blast hits everyone in the 5 × 5 area with sight of the center, friend or foe', () => {
    const t = setup();
    // REF 8 + Heavy Weapons 6 + 9 = 23 vs DV 15 (10 m/yds).
    const r = t.send({ type: 'areaAttack', attackerId: 'solo', weaponId: 'gl', kind: 'launcher', at: { x: 6, y: 3 } }, P1, scriptedDice({ d10: [9], d6: TWOS() }));
    expect(r.ok).toBe(true);
    const area = t.last().events.find((e) => e.type === 'areaResolved')!;
    expect(area.type === 'areaResolved' && area.targetIds.sort()).toEqual(['ganger', 'rook']); // thug is behind the wall
    expect(t.state.actors.ganger!.combatant.hp.current).toBe(t.state.actors.ganger!.combatant.hp.max - 12);
    expect(t.state.actors.thug!.combatant.hp.current).toBe(t.state.actors.thug!.combatant.hp.max);
    expect(t.state.actors.solo!.weapons.find((w) => w.id === 'gl')!.ammo!.loaded).toBe(1);
    expect(t.state.encounter.usage!.actionUsed).toBe(true);
    expect(t.send({ type: 'areaAttack', attackerId: 'solo', weaponId: 'gl', kind: 'launcher', at: { x: 6, y: 3 } }, P1, scriptedDice({ d10: [9] })))
      .toMatchObject({ ok: false, code: 'ACTION_USED' });
  });

  it('a missed explosive scatters for the GM to place, and does no damage yet', () => {
    const t = setup();
    t.send({ type: 'areaAttack', attackerId: 'solo', weaponId: 'gl', kind: 'launcher', at: { x: 6, y: 3 } }, P1, scriptedDice({ d10: [1, 5] }));
    const types = t.last().events.map((e) => e.type);
    expect(types).toContain('gmRulingRequired');
    expect(types).not.toContain('damageRolled');
  });

  it('Shotgun Shells hit tokens within 3 squares in the cone only', () => {
    const t = setup();
    t.send({ type: 'placeToken', actorId: 'ganger', at: { x: 3, y: 2 } }, GM);
    t.send({ type: 'placeToken', actorId: 'rook', at: { x: 2, y: 5 } }, GM);
    // REF 8 + Shoulder Arms 6 + 5 = 19 vs DV 13.
    expect(t.send({ type: 'areaAttack', attackerId: 'solo', weaponId: 'shotgun', kind: 'shotgunShell', at: { x: 4, y: 3 } }, P1, scriptedDice({ d10: [5], d6: TWOS() })).ok).toBe(true);
    const area = t.last().events.find((e) => e.type === 'areaResolved')!;
    expect(area.type === 'areaResolved' && area.targetIds).toEqual(['ganger']);
    expect(t.state.actors.ganger!.combatant.hp.current).toBe(t.state.actors.ganger!.combatant.hp.max - 6);
  });

  it('eligible targets choose to dodge before damage is rolled (Track K)', () => {
    const t = setup();
    t.send({ type: 'replaceActor', actor: actor('ganger', 'npc', 'gm', { REF: 8, DEX: 9 }) }, GM);
    t.send({ type: 'areaAttack', attackerId: 'solo', weaponId: 'gl', kind: 'launcher', at: { x: 6, y: 3 } }, P1, scriptedDice({ d10: [5] }));
    expect(t.state.pending).toMatchObject({ kind: 'awaitingAreaDodge', decisions: { ganger: null } });
    const pid = t.state.pending!.id;
    expect(t.send({ type: 'respondAreaDodge', pendingId: pid, actorId: 'ganger', dodge: true }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(t.send({ type: 'respondAreaDodge', pendingId: pid, actorId: 'ganger', dodge: true }, GM, scriptedDice({ d10: [9], d6: TWOS() })).ok).toBe(true);
    const dodge = t.last().events.find((e) => e.type === 'checkRolled' && e.label === 'Dodge');
    expect(dodge).toMatchObject({ combatantId: 'ganger', success: true }); // 9 + 4 + 9 = 22 beats 19
    expect(t.state.actors.ganger!.combatant.hp.current).toBe(t.state.actors.ganger!.combatant.hp.max);
    expect(t.state.pending).toBeNull();
  });

  it('needs sight of the aimed square, and refuses walls', () => {
    const t = setup();
    expect(t.send({ type: 'areaAttack', attackerId: 'solo', weaponId: 'gl', kind: 'launcher', at: { x: 9, y: 3 } }, P1)).toMatchObject({ ok: false, code: 'NO_LINE_OF_SIGHT' });
    expect(t.send({ type: 'areaAttack', attackerId: 'solo', weaponId: 'gl', kind: 'launcher', at: { x: 7, y: 3 } }, P1)).toMatchObject({ ok: false, code: 'INVALID' });
  });

  it('hides unseen tokens caught in the blast from players', () => {
    const t = setup();
    // A dark yard: the party sees 3 squares. The rook becomes a hidden hostile.
    t.send({ type: 'setMap', map: { ...MAP, sightRange: 3, tokens: { solo: { x: 1, y: 3 }, ganger: { x: 4, y: 2 }, rook: { x: 6, y: 4 }, thug: { x: 8, y: 3 } } } }, GM);
    t.send({ type: 'replaceActor', actor: { ...actor('rook', 'npc', 'gm'), allegiance: 'hostile' } }, GM);
    t.send({ type: 'areaAttack', attackerId: 'solo', weaponId: 'gl', kind: 'launcher', at: { x: 5, y: 3 } }, P1, scriptedDice({ d10: [9], d6: TWOS() }));
    const gm = projectEntry(t.last(), GM, t.state).events.find((e) => e.type === 'areaResolved')!;
    const pl = projectEntry(t.last(), P1, t.state).events.find((e) => e.type === 'areaResolved')!;
    expect(gm.type === 'areaResolved' && gm.targetIds.sort()).toEqual(['ganger', 'rook']);
    expect(pl.type === 'areaResolved' && pl.targetIds).toEqual(['ganger']);
  });
});

describe('suppressiveFire', () => {
  it('targets opposing tokens in sight within 25 m/yds and spends 10 rounds', () => {
    const t = setup();
    expect(t.send({ type: 'suppressiveFire', attackerId: 'solo', weaponId: 'smg' }, P1, scriptedDice({ d10: [5, 5] })).ok).toBe(true);
    const e = t.last().events.find((x) => x.type === 'suppressiveFireResolved')!;
    expect(e.type === 'suppressiveFireResolved' && e.results.map((r) => r.targetId)).toEqual(['ganger']); // not the ally, not the thug behind the wall
    expect(t.state.actors.solo!.weapons.find((w) => w.id === 'smg')!.ammo!.loaded).toBe(20);
    expect(t.state.encounter.usage!.actionUsed).toBe(true);
  });
  it('needs an Autofire weapon, 10 rounds and someone to suppress', () => {
    const t = setup();
    expect(t.send({ type: 'suppressiveFire', attackerId: 'solo', weaponId: 'pistol' }, P1)).toMatchObject({ ok: false, code: 'INVALID' });
    t.send({ type: 'placeToken', actorId: 'ganger', at: { x: 9, y: 3 } }, GM); // behind the wall from solo
    expect(t.send({ type: 'suppressiveFire', attackerId: 'solo', weaponId: 'smg' }, P1)).toMatchObject({ ok: false, code: 'INVALID' });
  });
});

describe('signal parsing', () => {
  it('accepts the three kinds, strips extras, rejects junk', async () => {
    const { parseSignal, parseClientMessage } = await import('../src/index.js');
    expect(parseSignal({ kind: 'ping', at: { x: 1, y: 2, z: 3 } })).toEqual({ kind: 'ping', at: { x: 1, y: 2 } });
    expect(parseSignal({ kind: 'cursor', at: null })).toEqual({ kind: 'cursor', at: null });
    expect(parseSignal({ kind: 'measure', from: { x: 0, y: 0 }, to: { x: 4, y: 1 } })).toEqual({ kind: 'measure', from: { x: 0, y: 0 }, to: { x: 4, y: 1 } });
    expect(parseSignal({ kind: 'ping', at: { x: 1.5, y: 2 } })).toBeNull();
    expect(parseSignal({ kind: 'ping', at: { x: -1, y: 2 } })).toBeNull();
    expect(parseSignal({ kind: 'teleport', at: { x: 1, y: 2 } })).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'signal', signal: { kind: 'ping', at: { x: 1, y: 1 } }, junk: 1 }))).toEqual({ t: 'signal', signal: { kind: 'ping', at: { x: 1, y: 1 } } });
  });
});
