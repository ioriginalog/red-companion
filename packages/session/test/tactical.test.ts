import { describe, expect, it } from 'vitest';
import { maxHP, scriptedDice, type Combatant, type Dice, type Stats } from '@cprc/rules-core';
import {
  applyEntry, emptySession, handleIntent, projectEntry, projectState,
  type Actor, type Intent, type LogEntry, type SessionState, type TacticalMap, type Viewer,
} from '../src/index.js';

const BASE: Stats = { INT: 6, REF: 6, DEX: 6, TECH: 6, COOL: 6, WILL: 6, LUCK: 6, MOVE: 6, BODY: 6, EMP: 6 };
function actor(id: string, side: 'pc' | 'npc', controller: string, stats: Partial<Stats> = {}): Actor {
  const s = { ...BASE, ...stats };
  const max = maxHP(s.BODY, s.WILL);
  const combatant: Combatant = {
    id, name: id, side, stats: s, skills: { Handgun: 6, Evasion: 4 }, hp: { max, current: max },
    armor: [], criticalInjuries: [], deathSave: { accumulatedPenalty: 0 },
    conditions: { prone: false, unconscious: false, dead: false, stabilized: false },
  };
  return { id, controller, weapons: [{ id: 'pistol', name: 'Heavy Pistol', type: 'heavyPistol', ammo: { loaded: 8, capacity: 8 } }], combatant };
}

const GM: Viewer = { role: 'gm' };
const P1: Viewer = { role: 'player', playerId: 'p1' };
const MISS = () => scriptedDice({ d10: [1, 5] }); // natural 1, minus 5

//            0123456789
const ROWS = ['..........',
              '..........',
              '.....#....',
              '.....#....',
              '..........'];
const MAP: TacticalMap = {
  id: 'm', name: 'Test Yard', width: 10, height: 5, cells: ROWS.join(''), cellPx: 64, sightRange: 30,
  tokens: { solo: { x: 2, y: 2 }, ganger: { x: 7, y: 2 } }, watches: {}, spotted: [],
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
  };
}

/** solo (PC, REF 8) acts first; ganger (REF 5, can't dodge) is hidden behind the wall. */
function setup() {
  const t = table();
  t.send({ type: 'addActor', actor: actor('solo', 'pc', 'p1', { REF: 8 }) }, GM);
  t.send({ type: 'addActor', actor: actor('ganger', 'npc', 'gm', { REF: 5 }) }, GM);
  expect(t.send({ type: 'setMap', map: MAP }, GM).ok).toBe(true);
  t.send({ type: 'startEncounter', participants: [{ actorId: 'solo' }, { actorId: 'ganger' }] }, GM, scriptedDice({ d10: [5, 3] }));
  expect(t.state.encounter.order).toEqual(['solo', 'ganger']);
  return t;
}

describe('fog of war', () => {
  it('hides unseen hostiles from players, including their name', () => {
    const t = setup();
    const v = projectState(t.state, P1);
    expect(v.map!.tokens.ganger).toBeUndefined();
    expect(v.map!.tokens.solo).toEqual({ x: 2, y: 2 });
    // Unseen hostiles are omitted entirely; their Turn slot is an opaque placeholder.
    expect(v.actors.ganger).toBeUndefined();
    expect(v.encounter.order).toEqual(['solo', 'hidden:1']);
    expect(v.actors['hidden:1']!.public.name).toBe('Unknown Contact');
    expect(JSON.stringify(v)).not.toContain('ganger');
    expect(projectState(t.state, GM).map!.tokens.ganger).toEqual({ x: 7, y: 2 });
  });

  it('reveals the token and name once the party has line of sight, and keeps the name after', () => {
    const t = setup();
    expect(t.send({ type: 'moveToken', actorId: 'solo', to: { x: 2, y: 0 } }, P1).ok).toBe(true);
    expect(t.state.map!.spotted).toEqual(['ganger']);
    const entry = projectEntry(t.log.at(-1)!, P1, t.state);
    expect(entry.patch.map!.tokens.ganger).toEqual({ x: 7, y: 2 });
    expect(entry.patch.actors!.ganger!.public.name).toBe('ganger');
    // Step back behind the wall: token hidden again, name stays known.
    t.send({ type: 'moveToken', actorId: 'solo', to: { x: 2, y: 2 } }, P1);
    const v = projectState(t.state, P1);
    expect(v.map!.tokens.ganger).toBeUndefined();
    expect(v.actors.ganger!.public.name).toBe('ganger');
  });

  it('keeps hostile movement out of player logs', () => {
    const t = setup();
    t.send({ type: 'endTurn' }, GM);
    t.send({ type: 'moveToken', actorId: 'ganger', to: { x: 8, y: 2 } }, GM);
    expect(projectEntry(t.log.at(-1)!, P1, t.state).events).toEqual([]);
    expect(projectEntry(t.log.at(-1)!, GM, t.state).events[0]!.type).toBe('tokenMoved');
  });
});

describe('line of sight and range', () => {
  it('refuses a shot with no line of sight, unless the GM rules it visible', () => {
    const t = setup();
    const shot: Intent = { type: 'rangedAttack', attackerId: 'solo', defenderId: 'ganger', weaponId: 'pistol', distance: 1 };
    expect(t.send(shot, P1)).toMatchObject({ ok: false, code: 'NO_LINE_OF_SIGHT' });
    expect(t.send({ ...shot, ignoreLineOfSight: true }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(t.send({ ...shot, ignoreLineOfSight: true }, GM, MISS()).ok).toBe(true);
  });

  it('measures range on the grid and ignores the client’s distance', () => {
    const t = setup();
    t.send({ type: 'moveToken', actorId: 'solo', to: { x: 2, y: 0 } }, P1);
    t.send({ type: 'rangedAttack', attackerId: 'solo', defenderId: 'ganger', weaponId: 'pistol', distance: 1 }, P1, MISS());
    const ev = t.log.at(-1)!.events.find((e) => e.type === 'attackResolved')!;
    // 5 squares = 10 m → pistol 7–12 m band, DV 15.
    expect(ev.type === 'attackResolved' && ev.defenseValue).toBe(15);
  });

  it('requires an adjacent square for melee', () => {
    const t = setup();
    t.send({ type: 'moveToken', actorId: 'solo', to: { x: 2, y: 0 } }, P1);
    expect(t.send({ type: 'meleeAttack', attackerId: 'solo', defenderId: 'ganger', with: { kind: 'brawling' } }, P1))
      .toMatchObject({ ok: false, code: 'OUT_OF_REACH' });
  });
});

describe('Turn economy', () => {
  it('gives MOVE squares, and a Run spends the Action for MOVE more', () => {
    const t = setup();
    t.send({ type: 'moveToken', actorId: 'solo', to: { x: 2, y: 0 } }, P1); // 2 of 6
    const far = { type: 'moveToken' as const, actorId: 'solo', to: { x: 9, y: 0 } }; // 7 more
    const r = t.send(far, P1);
    expect(r).toMatchObject({ ok: false, code: 'NO_MOVEMENT' });
    expect(!r.ok && r.message).toContain('Run');
    expect(t.send({ ...far, run: true }, P1).ok).toBe(true);
    expect(t.state.encounter.usage).toMatchObject({ moveUsed: 9, ran: true, actionUsed: true });
    expect(t.send({ type: 'rangedAttack', attackerId: 'solo', defenderId: 'ganger', weaponId: 'pistol', distance: 1 }, P1))
      .toMatchObject({ ok: false, code: 'ACTION_USED' });
  });

  it('allows two attacks with a ROF 2 weapon, then no more', () => {
    const t = setup();
    t.send({ type: 'moveToken', actorId: 'solo', to: { x: 2, y: 0 } }, P1);
    const shot: Intent = { type: 'rangedAttack', attackerId: 'solo', defenderId: 'ganger', weaponId: 'pistol', distance: 1 };
    expect(t.send(shot, P1, MISS()).ok).toBe(true);
    expect(t.send(shot, P1, MISS()).ok).toBe(true);
    expect(t.send(shot, P1, MISS())).toMatchObject({ ok: false, code: 'ACTION_USED' });
    expect(t.send({ type: 'moveToken', actorId: 'solo', to: { x: 9, y: 0 }, run: true }, P1)).toMatchObject({ ok: false, code: 'NO_MOVEMENT' });
  });

  it('lets the GM override economy as referee', () => {
    const t = setup();
    t.send({ type: 'endTurn' }, GM);
    expect(t.send({ type: 'moveToken', actorId: 'ganger', to: { x: 0, y: 4 } }, GM).ok).toBe(true); // 7+ squares, no run
  });

  it('resets usage at the next Turn', () => {
    const t = setup();
    t.send({ type: 'moveToken', actorId: 'solo', to: { x: 2, y: 0 } }, P1);
    t.send({ type: 'endTurn' }, P1);
    expect(t.state.encounter.usage).toMatchObject({ actorId: 'ganger', moveUsed: 0, actionUsed: false });
  });
});

describe('watch (house rule)', () => {
  it('stops an opposing mover in the cone and lets the watcher shoot out of Turn', () => {
    const t = setup();
    expect(t.send({ type: 'setWatch', actorId: 'solo', facing: 0, arc: 90 }, P1).ok).toBe(true);
    expect(t.state.encounter.usage!.actionUsed).toBe(true);
    t.send({ type: 'endTurn' }, P1);
    const r = t.send({ type: 'moveToken', actorId: 'ganger', to: { x: 3, y: 4 } }, GM);
    expect(r.ok).toBe(true);
    const trig = t.log.at(-1)!.events.find((e) => e.type === 'watchTriggered')!;
    expect(trig).toBeDefined();
    expect(trig.type === 'watchTriggered' && t.state.map!.tokens.ganger).toEqual(trig.type === 'watchTriggered' && trig.at);
    expect(t.state.pending).toMatchObject({ kind: 'awaitingWatch', watcherId: 'solo', targetId: 'ganger' });
    expect(t.state.map!.watches.solo).toBeUndefined();
    // Players see the trigger (their watcher) but not the hostile's path.
    const ev = projectEntry(t.log.at(-1)!, P1, t.state).events.map((e) => e.type);
    expect(ev).toEqual(['watchTriggered']);
    // Nothing else may happen until the watch is resolved.
    expect(t.send({ type: 'moveToken', actorId: 'ganger', to: { x: 2, y: 4 } }, GM)).toMatchObject({ ok: false, code: 'PENDING' });
    expect(t.send({ type: 'rangedAttack', attackerId: 'solo', defenderId: 'ganger', weaponId: 'pistol', distance: 1 }, P1, MISS()).ok).toBe(true);
    expect(t.state.pending).toBeNull();
  });

  it('can be declined, and ends at the watcher’s next Turn', () => {
    const t = setup();
    t.send({ type: 'setWatch', actorId: 'solo', facing: 180 }, P1);
    t.send({ type: 'endTurn' }, P1);
    expect(t.state.map!.watches.solo).toBeDefined();
    t.send({ type: 'endTurn' }, GM);
    expect(t.state.map!.watches.solo).toBeUndefined();
  });

  it('hides hostile watches from players', () => {
    const t = setup();
    t.send({ type: 'endTurn' }, GM);
    t.send({ type: 'setWatch', actorId: 'ganger', facing: 180 }, GM);
    expect(projectState(t.state, P1).map!.watches).toEqual({});
    expect(projectEntry(t.log.at(-1)!, P1, t.state).events).toEqual([]);
  });
});

describe('map setup', () => {
  it('only the GM loads maps and places tokens; blocked squares are refused', () => {
    const t = setup();
    expect(t.send({ type: 'placeToken', actorId: 'solo', at: { x: 0, y: 0 } }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(t.send({ type: 'placeToken', actorId: 'solo', at: { x: 5, y: 2 } }, GM)).toMatchObject({ ok: false, code: 'INVALID' });
    expect(t.send({ type: 'placeToken', actorId: 'solo', at: { x: 7, y: 2 } }, GM)).toMatchObject({ ok: false, code: 'INVALID' });
    expect(t.send({ type: 'setMap', map: { ...MAP, cells: '...' } }, GM)).toMatchObject({ ok: false, code: 'INVALID' });
  });
  it('removing an actor removes its token', () => {
    const t = setup();
    t.send({ type: 'removeActor', actorId: 'ganger' }, GM);
    expect(t.state.map!.tokens.ganger).toBeUndefined();
  });
});
