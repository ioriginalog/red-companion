import { describe, expect, it } from 'vitest';
import { maxHP, scriptedDice, type Combatant, type Dice, type Stats } from '@cprc/rules-core';
import {
  applyEntry, applyProjectedEntry, emptySession, emptyView, handleIntent, parseClientMessage, projectEntry, projectState,
  replay, type Actor, type Intent, type LogEntry, type SessionState, type Viewer,
} from '../src/index.js';

const BASE: Stats = { INT: 6, REF: 6, DEX: 6, TECH: 6, COOL: 6, WILL: 6, LUCK: 6, MOVE: 6, BODY: 6, EMP: 6 };
function actor(id: string, side: 'pc' | 'npc', controller: string, stats: Partial<Stats> = {}, extra: Partial<Combatant> = {}): Actor {
  const s = { ...BASE, ...stats };
  const max = maxHP(s.BODY, s.WILL);
  return {
    id, controller,
    weapons: [{ id: 'pistol', name: 'Heavy Pistol', type: 'heavyPistol', ammo: { loaded: 8, capacity: 8 } }],
    combatant: {
      id, name: id, side, stats: s, skills: { Handgun: 6, Evasion: 4, Paramedic: 4 }, hp: { max, current: max },
      armor: [{ id: 'jack', name: 'Light Armorjack', location: 'body', maxSP: 11, currentSP: 11, penalty: 0 }],
      criticalInjuries: [], deathSave: { accumulatedPenalty: 0 },
      conditions: { prone: false, unconscious: false, dead: false, stabilized: false }, ...extra,
    },
  };
}

const GM: Viewer = { role: 'gm' };
const P1: Viewer = { role: 'player', playerId: 'p1' };
const P2: Viewer = { role: 'player', playerId: 'p2' };

/** Tiny harness: authority + log, like the GM device. */
function table() {
  let state: SessionState = emptySession('s1');
  const log: LogEntry[] = [];
  let n = 0;
  const ctx = (dice: Dice) => ({ dice, now: () => '2045-01-01T00:00:00Z', newId: () => `id${++n}` });
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

function setup() {
  const t = table();
  t.send({ type: 'addActor', actor: actor('solo', 'pc', 'p1', { REF: 8 }) }, GM);
  t.send({ type: 'addActor', actor: actor('medic', 'pc', 'p2', { TECH: 7 }) }, GM);
  t.send({ type: 'addActor', actor: actor('ganger', 'npc', 'gm', { REF: 5, DEX: 5 }) }, GM);
  // Initiative: solo 8+5=13, medic 6+3=9, ganger 5+9=14 → ganger, solo, medic
  t.send({ type: 'startEncounter', participants: [{ actorId: 'solo' }, { actorId: 'medic' }, { actorId: 'ganger' }] }, GM, scriptedDice({ d10: [5, 3, 9] }));
  return t;
}

describe('authorization and turn flow', () => {
  it('players can’t do GM setup', () => {
    const t = table();
    expect(t.send({ type: 'addActor', actor: actor('x', 'npc', 'gm') }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
  it('initiative order and Turn enforcement', () => {
    const t = setup();
    expect(t.state.encounter.order).toEqual(['ganger', 'solo', 'medic']);
    expect(t.send({ type: 'rangedAttack', attackerId: 'solo', defenderId: 'ganger', weaponId: 'pistol', distance: 10 }, P1)).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
    expect(t.send({ type: 'endTurn' }, P1)).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
    expect(t.send({ type: 'endTurn' }, GM).ok).toBe(true);
    expect(t.send({ type: 'rangedAttack', attackerId: 'medic', defenderId: 'ganger', weaponId: 'pistol', distance: 10 }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
});

describe('attack → damage flow', () => {
  it('non-dodging defender: attack resolves at once, then attacker rolls damage', () => {
    const t = setup();
    t.send({ type: 'endTurn' }, GM); // solo's turn
    const a = t.send({ type: 'rangedAttack', attackerId: 'solo', defenderId: 'ganger', weaponId: 'pistol', distance: 10 }, P1, scriptedDice({ d10: [5] }));
    expect(a.ok).toBe(true);
    expect(t.state.pending).toMatchObject({ kind: 'awaitingDamage', targetId: 'ganger' });
    expect(t.state.actors.solo!.weapons[0]!.ammo!.loaded).toBe(7);
    // Nothing else while pending
    expect(t.send({ type: 'endTurn' }, P1)).toMatchObject({ ok: false, code: 'PENDING' });
    const pendingId = t.state.pending!.id;
    expect(t.send({ type: 'rollDamage', pendingId }, P2)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    t.send({ type: 'rollDamage', pendingId }, P1, scriptedDice({ d6: [6, 5, 4] })); // 15 − 11 = 4
    expect(t.state.actors.ganger!.combatant.hp.current).toBe(36);
    expect(t.state.pending).toBeNull();
  });

  it('REF 8+ defender gets a dodge prompt; only their controller answers', () => {
    const t = setup();
    // GM's ganger shoots the solo (REF 8) → dodge prompt for p1
    const r = t.send({ type: 'rangedAttack', attackerId: 'ganger', defenderId: 'solo', weaponId: 'pistol', distance: 30 }, GM);
    expect(r.ok).toBe(true);
    expect(t.state.pending).toMatchObject({ kind: 'awaitingDodge', defenderId: 'solo' });
    const id = t.state.pending!.id;
    expect(t.send({ type: 'respondDodge', pendingId: id, dodge: true }, P2)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    // ganger 5 + 6 + 9 = 20 vs solo dodge 6 + 4 + 8 = 18 → hit
    t.send({ type: 'respondDodge', pendingId: id, dodge: true }, P1, scriptedDice({ d10: [9, 8] }));
    expect(t.state.pending).toMatchObject({ kind: 'awaitingDamage' });
  });

  it('dodge prompt is not created for an illegal attack', () => {
    const t = setup();
    const r = t.send({ type: 'rangedAttack', attackerId: 'ganger', defenderId: 'solo', weaponId: 'pistol', distance: 500 }, GM);
    expect(r).toMatchObject({ ok: false, code: 'OUT_OF_RANGE' });
    expect(t.state.pending).toBeNull();
  });

  it('GM can cancel a pending step', () => {
    const t = setup();
    t.send({ type: 'rangedAttack', attackerId: 'ganger', defenderId: 'solo', weaponId: 'pistol', distance: 30 }, GM);
    expect(t.send({ type: 'cancelPending' }, GM).ok).toBe(true);
    expect(t.state.pending).toBeNull();
  });
});

describe('Death Saves in the Turn order', () => {
  it('dying actor must roll before acting; dead actors are skipped', () => {
    const t = table();
    t.send({ type: 'addActor', actor: actor('solo', 'pc', 'p1', {}, { hp: { max: 40, current: 0 } }) }, GM);
    t.send({ type: 'addActor', actor: actor('ganger', 'npc', 'gm') }, GM);
    t.send({ type: 'startEncounter', participants: [{ actorId: 'solo' }, { actorId: 'ganger' }] }, GM, scriptedDice({ d10: [9, 1] }));
    expect(t.state.encounter.deathSaveRequiredFor).toBe('solo');
    expect(t.send({ type: 'rangedAttack', attackerId: 'solo', defenderId: 'ganger', weaponId: 'pistol', distance: 5 }, P1)).toMatchObject({ ok: false, code: 'DEATH_SAVE_FIRST' });
    t.send({ type: 'deathSave', actorId: 'solo' }, P1, scriptedDice({ d10: [10] }));
    expect(t.state.actors.solo!.combatant.conditions.dead).toBe(true);
    t.send({ type: 'endTurn' }, P1);
    t.send({ type: 'endTurn' }, GM); // ganger → wraps, skips dead solo, back to ganger
    expect(t.state.encounter.order[t.state.encounter.turnIndex]).toBe('ganger');
    expect(t.state.encounter.round).toBe(2);
  });
});

describe('replay and undo', () => {
  it('replaying the log reproduces the authority state exactly', () => {
    const t = setup();
    t.send({ type: 'endTurn' }, GM);
    t.send({ type: 'rangedAttack', attackerId: 'solo', defenderId: 'ganger', weaponId: 'pistol', distance: 10 }, P1, scriptedDice({ d10: [5] }));
    t.send({ type: 'rollDamage', pendingId: t.state.pending!.id }, P1, scriptedDice({ d6: [6, 6, 4, 3, 3] }));
    const rebuilt = replay('s1', JSON.parse(JSON.stringify(t.log)));
    expect(rebuilt).toEqual(t.state);
    // Undo the damage
    const undone = replay('s1', t.log.slice(0, -1));
    expect(undone.actors.ganger!.combatant.hp.current).toBe(40);
    expect(undone.pending).toMatchObject({ kind: 'awaitingDamage' });
  });
  it('rejects gaps', () => {
    const t = setup();
    expect(() => applyEntry(emptySession('s1'), t.log[1]!)).toThrow(/seq/);
  });
});

describe('projection', () => {
  it('players never see NPC stats or HP, in snapshots or in entries', () => {
    const t = setup();
    t.send({ type: 'endTurn' }, GM);
    t.send({ type: 'rangedAttack', attackerId: 'solo', defenderId: 'ganger', weaponId: 'pistol', distance: 10 }, P1, scriptedDice({ d10: [5] }));
    t.send({ type: 'rollDamage', pendingId: t.state.pending!.id }, P1, scriptedDice({ d6: [6, 6, 4, 3, 3] }));

    const view = projectState(t.state, P1);
    expect(view.actors.ganger!.combatant).toBeUndefined();
    expect(view.actors.ganger!.public.woundState).toBe('lightly');
    expect(view.actors.ganger!.public.injuries).toEqual(['Broken Arm']);
    expect(view.actors.medic!.combatant).toBeDefined(); // PCs visible to the party

    // Fold projected entries from scratch → same as projecting the final state.
    let v = emptyView('s1');
    let s = emptySession('s1');
    for (const e of t.log) {
      s = applyEntry(s, e);
      v = applyProjectedEntry(v, projectEntry(e, P1, s.actors));
    }
    expect(v).toEqual(view);

    const dmgEntry = projectEntry(t.log.at(-1)!, P1, t.state.actors);
    const serialized = JSON.stringify(dmgEntry);
    expect(dmgEntry.events.some((e) => e.type === 'damageApplied')).toBe(false);
    expect(serialized).not.toContain('"hpAfter":30');
    expect(serialized).not.toContain('"currentSP"');
    expect(projectEntry(t.log[2]!, P1, t.state.actors).intentType).toBe('addActor');
    expect(JSON.stringify(projectEntry(t.log[2]!, P1, t.state.actors))).not.toContain('"skills"');
  });
  it('GM projection is complete', () => {
    const t = setup();
    expect(projectState(t.state, GM).actors.ganger!.combatant).toEqual(t.state.actors.ganger!.combatant);
  });
  it('redacts NPC initiative numbers', () => {
    const t = setup();
    const e = projectEntry(t.log[3]!, P1, t.state.actors).events[0]!;
    expect(e.type === 'initiativeRolled' && e.entries.find((x) => x.combatantId === 'ganger')!.total).toBe(0);
  });
});

describe('protocol parsing', () => {
  it('accepts valid and rejects malformed messages', () => {
    expect(parseClientMessage('{"t":"hello","v":1,"role":"player","joinCode":"ABC123","name":"Nix"}')).not.toBeNull();
    expect(parseClientMessage('{"t":"hello","v":2,"role":"player","joinCode":"ABC123","name":"Nix"}')).toBeNull();
    expect(parseClientMessage('not json')).toBeNull();
    expect(parseClientMessage('{"t":"truncate","toSeq":-1}')).toBeNull();
    expect(parseClientMessage('{"t":"intent","clientMsgId":"1","intent":{"type":"endTurn"}}')).not.toBeNull();
  });
});
