import { describe, expect, it } from 'vitest';
import { maxHP, RulesError, scriptedDice, sumModifiers, type Combatant, type Dice, type Stats } from '@cprc/rules-core';
import {
  applyEntry, emptySession, handleIntent, projectEntry, projectState,
  type Actor, type Intent, type LogEntry, type SessionState, type TacticalMap, type Viewer,
} from '../src/index.js';

const BASE: Stats = { INT: 6, REF: 6, DEX: 6, TECH: 6, COOL: 6, WILL: 6, LUCK: 6, MOVE: 6, BODY: 6, EMP: 6 };
function actor(id: string, side: 'pc' | 'npc', controller: string, stats: Partial<Stats> = {}): Actor {
  const s = { ...BASE, ...stats };
  const max = maxHP(s.BODY, s.WILL);
  const combatant: Combatant = {
    id, name: id === 'ganger' ? 'Secret Boss' : id, side, stats: s, skills: { Handgun: 6, Evasion: 4, 'First Aid': 4 }, hp: { max, current: max },
    armor: [], criticalInjuries: [], deathSave: { accumulatedPenalty: 0 },
    conditions: { prone: false, unconscious: false, dead: false, stabilized: false },
  };
  return { id, controller, weapons: [{ id: 'pistol', name: 'Heavy Pistol', type: 'heavyPistol', ammo: { loaded: 8, capacity: 8 } }], combatant };
}
const GM: Viewer = { role: 'gm' };
const P1: Viewer = { role: 'player', playerId: 'p1' };
const ROWS = ['..........', '..........', '.....#....', '.....#....', '..........'];
const MAP: TacticalMap = {
  id: 'm', name: 'Yard', width: 10, height: 5, cells: ROWS.join(''), cellPx: 64, sightRange: 30,
  tokens: { solo: { x: 2, y: 2 }, ganger: { x: 7, y: 2 } }, watches: {}, spotted: [],
};

function table() {
  let state: SessionState = emptySession('s1');
  const log: LogEntry[] = [];
  const befores: SessionState[] = [];
  let n = 0;
  return {
    get state() { return state; }, log, befores,
    send(intent: unknown, by: Viewer, dice: Dice = scriptedDice({})) {
      const r = handleIntent(state, intent as Intent, by, { dice, now: () => 't', newId: () => `id${++n}` });
      if (r.ok) { befores.push(state); state = applyEntry(state, r.entry); log.push(r.entry); }
      return r;
    },
    /** The last entry as the relay projects it for a player (with the before state). */
    lastFor(v: Viewer) { return projectEntry(log.at(-1)!, v, state, undefined, befores.at(-1)); },
  };
}
function setup() {
  const t = table();
  t.send({ type: 'addActor', actor: actor('solo', 'pc', 'p1', { REF: 8 }) }, GM);
  t.send({ type: 'addActor', actor: actor('ganger', 'npc', 'gm', { REF: 5 }) }, GM);
  t.send({ type: 'setMap', map: MAP }, GM);
  t.send({ type: 'startEncounter', participants: [{ actorId: 'solo' }, { actorId: 'ganger' }] }, GM, scriptedDice({ d10: [5, 3] }));
  return t;
}

describe('hostile payloads (round 1 critic #1, #2)', () => {
  const shot = { type: 'rangedAttack', attackerId: 'solo', defenderId: 'ganger', weaponId: 'pistol', distance: 10, ignoreLineOfSight: undefined };
  it('refuses player-sent modifiers and rulings on attacks', () => {
    const t = setup();
    expect(t.send({ ...shot, situational: [{ label: 'x', value: 100 }] }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(t.send({ type: 'meleeAttack', attackerId: 'solo', defenderId: 'ganger', with: { kind: 'brawling' }, gmDv: 1 }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(t.send({ ...shot, ignoreLineOfSight: true }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(t.send({ type: 'stabilize', medicId: 'solo', targetId: 'solo', skill: 'First Aid', situational: [{ label: 'x', value: 5 }] }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(t.log).toHaveLength(4);
  });
  it('refuses non-numeric and out-of-bounds GM modifiers, so the log never stores a bad total', () => {
    const t = setup();
    expect(t.send({ ...shot, situational: [{ label: 'x', value: 'abc' }] }, GM)).toMatchObject({ ok: false, code: 'INVALID' });
    expect(t.send({ ...shot, situational: [{ label: 'x', value: 21 }] }, GM)).toMatchObject({ ok: false, code: 'INVALID' });
    expect(t.send({ ...shot, situational: [{ label: 'x', value: 1.5 }] }, GM)).toMatchObject({ ok: false, code: 'INVALID' });
    expect(t.log).toHaveLength(4);
  });
  it('rejects malformed shapes before they reach the engine', () => {
    const t = setup();
    const cases: unknown[] = [
      null, 42, 'endTurn', { type: 7 }, {},
      { ...shot, distance: 'ten' },
      { ...shot, distance: Number.NaN },
      { ...shot, attackerId: { $ne: 1 } },
      { ...shot, mode: 'burst' },
      { type: 'moveToken', actorId: 'solo', to: { x: -1, y: 0 } },
      { type: 'moveToken', actorId: 'solo', to: { x: '2', y: 0 } },
      { type: 'chat', text: 'x'.repeat(501) },
      { type: 'chat', text: 'hi', to: 'gm' },
      { type: 'rollDice', label: 'x', dice: { count: 1e9, sides: 6, bonus: 0 } },
      { type: 'setWatch', actorId: 'solo', facing: Infinity },
      { type: 'respondDodge', pendingId: 1, dodge: true },
    ];
    for (const c of cases) {
      const r = t.send(c, P1);
      expect(r.ok, JSON.stringify(c)).toBe(false);
    }
    const gmCases: unknown[] = [
      { type: 'addActor', actor: { ...actor('x', 'npc', 'gm'), combatant: { ...actor('x', 'npc', 'gm').combatant, stats: { ...BASE, REF: '9' } } } },
      { type: 'addActor', actor: { ...actor('y', 'npc', 'gm'), weapons: [{ id: 'w', name: 'W', type: 'laser', ammo: { loaded: 1, capacity: 1 } }] } },
      { type: 'addActor', actor: { ...actor('z', 'npc', 'gm'), portrait: 'javascript:alert(1)' } },
      { type: 'setMap', map: { ...MAP, cells: 'X'.repeat(50) } },
      { type: 'setMap', map: { ...MAP, width: 1e6 } },
      { type: 'startEncounter', participants: [{ actorId: 'solo', bonus: 'x' }] },
      { type: 'adjustHp', actorId: 'solo', delta: 1e12 },
    ];
    for (const c of gmCases) expect(t.send(c, GM).ok, JSON.stringify(c).slice(0, 80)).toBe(false);
    expect(t.log).toHaveLength(4);
  });
  it('lets unknown intent types through to their own handlers', () => {
    const t = setup();
    expect(t.send({ type: 'jackIn', anything: 1 }, P1)).toMatchObject({ ok: false, code: 'INVALID', message: expect.stringContaining('supported') });
  });
  it('sumModifiers rejects non-finite values (rules-core hardening)', () => {
    expect(() => sumModifiers([{ label: 'x', value: 'abc' as unknown as number }])).toThrow(RulesError);
    expect(() => sumModifiers([{ label: 'x', value: Number.POSITIVE_INFINITY }])).toThrow(RulesError);
    expect(sumModifiers([{ label: 'a', value: 2 }, { label: 'b', value: -3 }])).toBe(-1);
  });
});

describe('fog leaks (round 1 critic #4)', () => {
  it('never sends an unseen hostile’s id, name or stats in snapshots', () => {
    const t = setup();
    const json = JSON.stringify(projectState(t.state, P1));
    expect(json).not.toContain('ganger');
    expect(json).not.toContain('Secret Boss');
    expect(projectState(t.state, P1).encounter.order).toEqual(['solo', 'hidden:1']);
  });
  it('aliases a hidden attacker in events and pending steps, and withholds its damage dice and ammo', () => {
    const t = setup();
    t.send({ type: 'endTurn' }, P1);
    expect(JSON.stringify(t.lastFor(P1))).not.toContain('ganger');
    // GM rules the hidden ganger can shoot (e.g. through a gap the map doesn't show).
    expect(t.send({ type: 'rangedAttack', attackerId: 'ganger', defenderId: 'solo', weaponId: 'pistol', distance: 10, ignoreLineOfSight: true }, GM).ok).toBe(true);
    const dodge = t.lastFor(P1);
    expect(dodge.patch.pending).toMatchObject({ kind: 'awaitingDodge', attack: { attackerId: 'hidden:1', weaponId: 'unknown' } });
    expect(JSON.stringify(dodge)).not.toContain('ganger');
    expect(t.send({ type: 'respondDodge', pendingId: (t.state.pending as { id: string }).id, dodge: false }, P1, scriptedDice({ d10: [9] })).ok).toBe(true);
    const hit = t.lastFor(P1);
    expect(hit.patch.pending).toMatchObject({ kind: 'awaitingDamage', attackerId: 'hidden:1' });
    expect(hit.patch.pending).not.toHaveProperty('spec');
    expect(hit.events.map((e) => e.type)).not.toContain('ammoSpent');
    expect(JSON.stringify(hit)).not.toContain('ganger');
    // The GM still sees everything.
    expect(projectEntry(t.log.at(-1)!, GM, t.state).events.map((e) => e.type)).toContain('ammoSpent');
  });
  it('reveals an NPC (and only then) when the party spots it, and diffs actors exactly', () => {
    const t = setup();
    t.send({ type: 'moveToken', actorId: 'solo', to: { x: 2, y: 0 } }, P1);
    const e = t.lastFor(P1);
    expect(e.patch.actors!.ganger!.public.name).toBe('Secret Boss');
    expect(e.patch.actors!['hidden:1']).toBeNull();
    expect(e.patch.encounter!.order).toEqual(['solo', 'ganger']);
  });
  it('a player never gets a removal for an actor they never knew about', () => {
    const t = setup();
    t.send({ type: 'removeActor', actorId: 'ganger' }, GM);
    const e = t.lastFor(P1);
    expect(JSON.stringify(e)).not.toContain('ganger');
    expect(e.patch.actors!['hidden:1']).toBeNull();
  });
  it('without a map, hostiles are known only while in an active encounter', () => {
    const t = table();
    t.send({ type: 'addActor', actor: actor('solo', 'pc', 'p1') }, GM);
    t.send({ type: 'addActor', actor: actor('ganger', 'npc', 'gm') }, GM);
    expect(JSON.stringify(t.lastFor(P1))).not.toContain('ganger');
    t.send({ type: 'startEncounter', participants: [{ actorId: 'solo' }, { actorId: 'ganger' }] }, GM, scriptedDice({ d10: [5, 3] }));
    expect(t.lastFor(P1).patch.actors!.ganger!.public.name).toBe('Secret Boss');
  });
});
