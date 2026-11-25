import { describe, expect, it } from 'vitest';
import { maxHP, scriptedDice, type Combatant, type Dice, type Stats, type Weapon } from '@cprc/rules-core';
import {
  applyEntry, emptySession, handleIntent, projectEntry, projectState,
  type Actor, type Intent, type LogEntry, type SessionState, type TacticalMap, type Viewer,
} from '../src/index.js';

const BASE: Stats = { INT: 6, REF: 6, DEX: 6, TECH: 6, COOL: 6, WILL: 6, LUCK: 6, MOVE: 6, BODY: 6, EMP: 6 };
function actor(id: string, side: 'pc' | 'npc', controller: string, stats: Partial<Stats> = {}, weapons?: Weapon[], sp = 0): Actor {
  const s = { ...BASE, ...stats };
  const max = maxHP(s.BODY, s.WILL);
  const combatant: Combatant = {
    id, name: id, side, stats: s, skills: { Handgun: 6, 'Heavy Weapons': 6, Evasion: 4 }, hp: { max, current: max },
    armor: sp ? [{ id: 'jack', name: 'Jack', location: 'body', maxSP: sp, currentSP: sp, penalty: 0 }, { id: 'helm', name: 'Helm', location: 'head', maxSP: sp, currentSP: sp, penalty: 0 }] : [],
    criticalInjuries: [], deathSave: { accumulatedPenalty: 0 },
    conditions: { prone: false, unconscious: false, dead: false, stabilized: false },
  };
  return { id, controller, weapons: weapons ?? [{ id: 'pistol', name: 'Heavy Pistol', type: 'heavyPistol', ammo: { loaded: 8, capacity: 8 } }], combatant };
}

const GM: Viewer = { role: 'gm' };
const P1: Viewer = { role: 'player', playerId: 'p1' };
const d10 = (...xs: number[]) => scriptedDice({ d10: xs });

const OPEN: TacticalMap = {
  id: 'm', name: 'Yard', width: 14, height: 7, cells: '.'.repeat(14 * 7), cellPx: 64, sightRange: 30,
  tokens: {}, watches: {}, spotted: [],
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

/** solo (PC, REF 8) acts first, then ganger (REF 5). */
function setup(extra: Actor[] = []) {
  const t = table();
  t.send({ type: 'addActor', actor: actor('solo', 'pc', 'p1', { REF: 8 }) }, GM);
  t.send({ type: 'addActor', actor: actor('ganger', 'npc', 'gm', { REF: 5 }) }, GM);
  for (const a of extra) t.send({ type: 'addActor', actor: a }, GM);
  t.send({ type: 'startEncounter', participants: [{ actorId: 'solo' }, { actorId: 'ganger' }] }, GM, d10(5, 3)); // 13, 8
  expect(t.state.encounter.order).toEqual(['solo', 'ganger']);
  return t;
}

describe('initiative: late arrivals and removal', () => {
  it('stores totals at the start of an encounter', () => {
    expect(setup().state.encounter.initiative).toEqual({ solo: 13, ganger: 8 });
  });

  it('rolls a late arrival in by total and keeps the current actor acting', () => {
    const t = setup([actor('late', 'npc', 'gm', { REF: 6 })]);
    t.send({ type: 'endTurn' }, GM); // ganger's Turn
    expect(t.send({ type: 'addToInitiative', actorId: 'late' }, GM, d10(4)).ok).toBe(true); // 6 + 4 = 10
    expect(t.state.encounter.order).toEqual(['solo', 'late', 'ganger']);
    expect(t.state.encounter.order[t.state.encounter.turnIndex]).toBe('ganger');
    expect(t.state.encounter.initiative!.late).toBe(10);
    expect(t.log.at(-1)!.events[0]!.type).toBe('initiativeRolled');
  });

  it('accepts a given total, slots ties by a roll-off, and is GM-only', () => {
    const t = setup([actor('late', 'npc', 'gm')]);
    expect(t.send({ type: 'addToInitiative', actorId: 'late', roll: 20 }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(t.send({ type: 'addToInitiative', actorId: 'late', roll: 13 }, GM, d10(7, 2)).ok).toBe(true); // ties solo, wins roll-off
    expect(t.state.encounter.order).toEqual(['late', 'solo', 'ganger']);
    expect(t.state.encounter.order[t.state.encounter.turnIndex]).toBe('solo');
    expect(t.send({ type: 'addToInitiative', actorId: 'late', roll: 5 }, GM)).toMatchObject({ ok: false, code: 'INVALID' }); // already in
  });

  it('rejects hostile payloads', () => {
    const t = setup([actor('late', 'npc', 'gm')]);
    for (const roll of ['abc', 1000, 1.5, null, {}]) {
      expect(t.send({ type: 'addToInitiative', actorId: 'late', roll } as unknown as Intent, GM)).toMatchObject({ ok: false });
    }
    expect(t.send({ type: 'addToInitiative', actorId: 42 } as unknown as Intent, GM)).toMatchObject({ ok: false });
    expect(t.send({ type: 'placeScatter', pendingId: 'x', at: { x: -1, y: 0 } } as Intent, GM)).toMatchObject({ ok: false });
    expect(t.send({ type: 'delayTurn', after: { evil: true } } as unknown as Intent, P1)).toMatchObject({ ok: false });
  });

  it('needs a running encounter', () => {
    const t = table();
    t.send({ type: 'addActor', actor: actor('late', 'npc', 'gm') }, GM);
    expect(t.send({ type: 'addToInitiative', actorId: 'late' }, GM, d10(4))).toMatchObject({ ok: false, code: 'INVALID' });
  });

  it('removes someone from the order; removing the current actor passes the Turn on', () => {
    const t = setup();
    expect(t.send({ type: 'removeFromInitiative', actorId: 'solo' }, GM).ok).toBe(true);
    expect(t.state.encounter.order).toEqual(['ganger']);
    expect(t.state.encounter.order[t.state.encounter.turnIndex]).toBe('ganger');
    expect(t.state.actors.solo).toBeDefined();
    expect(t.log.at(-1)!.events[0]).toMatchObject({ type: 'leftInitiative', combatantId: 'solo' });
  });
});

describe('delay (house rule)', () => {
  it('lets the current actor act last, or after someone later this Round', () => {
    const t = setup([actor('third', 'npc', 'gm', { REF: 2 })]);
    t.send({ type: 'endEncounter' }, GM);
    t.send({ type: 'startEncounter', participants: [{ actorId: 'solo' }, { actorId: 'ganger' }, { actorId: 'third' }] }, GM, d10(5, 3, 1));
    expect(t.state.encounter.order).toEqual(['solo', 'ganger', 'third']);
    expect(t.send({ type: 'delayTurn', after: 'ganger' }, P1).ok).toBe(true);
    expect(t.state.encounter.order).toEqual(['ganger', 'solo', 'third']);
    expect(t.state.encounter.order[t.state.encounter.turnIndex]).toBe('ganger');
    expect(t.log.at(-1)!.events[0]).toMatchObject({ type: 'turnDelayed', combatantId: 'solo', after: 'ganger' });
  });

  it('only before moving or acting, only on your own Turn, and never past the end', () => {
    const t = setup();
    expect(t.send({ type: 'delayTurn', after: 'solo' }, P1)).toMatchObject({ ok: false, code: 'INVALID' }); // not later
    t.send({ type: 'rollCheck', actorId: 'solo', label: 'Look', stat: 'INT', skill: 'Perception' }, P1, d10(5));
    expect(t.send({ type: 'delayTurn' }, P1).ok).toBe(true); // checks don't count as acting
    expect(t.state.encounter.order).toEqual(['ganger', 'solo']);
    expect(t.send({ type: 'delayTurn' }, P1)).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
    t.send({ type: 'endTurn' }, GM); // solo again, last this Round
    expect(t.send({ type: 'delayTurn' }, P1)).toMatchObject({ ok: false, code: 'INVALID' });
  });

  it('is refused after spending the Action, and the GM can switch it off', () => {
    const t = setup();
    t.send({ type: 'reload', actorId: 'solo', weaponId: 'pistol' }, P1);
    expect(t.send({ type: 'delayTurn' }, P1)).toMatchObject({ ok: false, code: 'INVALID' });
    const u = setup();
    expect(u.send({ type: 'setDelayRule', allowed: false }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(u.send({ type: 'setDelayRule', allowed: false }, GM).ok).toBe(true);
    expect(u.send({ type: 'delayTurn' }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    u.send({ type: 'endEncounter' }, GM);
    expect(u.state.encounter.delayAllowed).toBe(false); // survives the encounter
  });
});

describe('scatter', () => {
  const launcher: Weapon = { id: 'gl', name: 'Grenade Launcher', type: 'grenadeLauncher', ammo: { loaded: 2, capacity: 2 } };
  function blastSetup() {
    const t = table();
    t.send({ type: 'addActor', actor: actor('solo', 'pc', 'p1', { REF: 6 }, [launcher]) }, GM);
    t.send({ type: 'addActor', actor: actor('ganger', 'npc', 'gm', { REF: 5 }) }, GM);
    t.send({ type: 'setMap', map: { ...OPEN, tokens: { solo: { x: 0, y: 3 }, ganger: { x: 10, y: 3 } } } }, GM);
    return t;
  }

  it('turns a missed explosive into a GM placement, then resolves the blast there', () => {
    const t = blastSetup();
    // REF 6 + Heavy Weapons 6 + natural 1 − 9 = 3: a miss.
    expect(t.send({ type: 'areaAttack', attackerId: 'solo', weaponId: 'gl', kind: 'launcher', at: { x: 7, y: 3 } }, P1, d10(1, 9)).ok).toBe(true);
    const p = t.state.pending!;
    expect(p).toMatchObject({ kind: 'awaitingScatter', at: { x: 7, y: 3 } });
    expect(t.log.at(-1)!.events.map((e) => e.type)).toContain('explosiveMissed');
    expect(t.log.at(-1)!.events.map((e) => e.type)).not.toContain('gmRulingRequired');
    expect(t.send({ type: 'placeScatter', pendingId: p.id, at: { x: 9, y: 3 } }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(t.send({ type: 'endTurn' }, GM)).toMatchObject({ ok: false, code: 'PENDING' });
    const before = t.state.actors.ganger!.combatant.hp.current;
    expect(t.send({ type: 'placeScatter', pendingId: p.id, at: { x: 9, y: 3 } }, GM, scriptedDice({ d6: [3, 3, 3, 3, 3, 3] })).ok).toBe(true);
    const ev = t.log.at(-1)!.events;
    expect(ev[0]).toMatchObject({ type: 'explosiveScattered', from: { x: 7, y: 3 }, to: { x: 9, y: 3 }, rolled: false });
    expect(ev.find((e) => e.type === 'areaResolved')).toMatchObject({ targetIds: ['ganger'] });
    expect(t.state.actors.ganger!.combatant.hp.current).toBe(before - 18);
    expect(t.state.pending).toBeNull();
  });

  it('can roll the landing square: never the aim square, never a wall', () => {
    const t = blastSetup();
    t.send({ type: 'areaAttack', attackerId: 'solo', weaponId: 'gl', kind: 'launcher', at: { x: 7, y: 3 } }, P1, d10(1, 9));
    const p = t.state.pending!;
    // (3 − 1) mod 5 − 2 = 0 twice → aim square, rerolled; then (5 − 1) mod 5 − 2 = +2, (1 − 1) mod 5 − 2 = −2.
    expect(t.send({ type: 'placeScatter', pendingId: p.id }, GM, scriptedDice({ d10: [3, 3, 5, 1], d6: [1, 1, 1, 1, 1, 1] })).ok).toBe(true);
    expect(t.log.at(-1)!.events[0]).toMatchObject({ type: 'explosiveScattered', to: { x: 9, y: 1 }, rolled: true });
  });

  it('shows players the landing but not NPC damage dice', () => {
    const t = table();
    t.send({ type: 'addActor', actor: actor('solo', 'pc', 'p1') }, GM);
    t.send({ type: 'addActor', actor: actor('ganger', 'npc', 'gm', {}, [launcher]) }, GM);
    t.send({ type: 'setMap', map: { ...OPEN, tokens: { solo: { x: 0, y: 3 }, ganger: { x: 10, y: 3 } } } }, GM);
    t.send({ type: 'areaAttack', attackerId: 'ganger', weaponId: 'gl', kind: 'launcher', at: { x: 3, y: 3 } }, GM, d10(1, 9));
    const view = projectState(t.state, P1);
    expect(view.pending).toMatchObject({ kind: 'awaitingScatter', attackerId: 'ganger', damageDice: 0 });
  });
});

describe('no effect', () => {
  it('tells players a hit on an NPC did nothing, without SP numbers', () => {
    const t = table();
    t.send({ type: 'addActor', actor: actor('solo', 'pc', 'p1', { REF: 8 }) }, GM);
    t.send({ type: 'addActor', actor: actor('tank', 'npc', 'gm', { REF: 5 }, undefined, 18) }, GM);
    t.send({ type: 'setMap', map: { ...OPEN, tokens: { solo: { x: 0, y: 3 }, tank: { x: 3, y: 3 } }, spotted: ['tank'] } }, GM);
    // 8 + 6 + 5 = 19 vs DV 13 (6 m): hit; 3d6 = 3 vs SP 18.
    expect(t.send({ type: 'rangedAttack', attackerId: 'solo', defenderId: 'tank', weaponId: 'pistol', distance: 6 }, P1, d10(5)).ok).toBe(true);
    expect(t.send({ type: 'rollDamage', pendingId: t.state.pending!.id }, P1, scriptedDice({ d6: [1, 1, 1] })).ok).toBe(true);
    const seen = projectEntry(t.log.at(-1)!, P1, t.state).events;
    expect(seen.map((e) => e.type)).toContain('noEffect');
    expect(seen.some((e) => e.type === 'damageApplied')).toBe(false);
  });
});
