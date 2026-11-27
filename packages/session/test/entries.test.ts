/**
 * What players receive per log entry: nothing at all for entries they can't
 * see (so unseen Turns, private rolls and whispers can't be counted), no
 * author or intent type for entries whose content is hidden, and rejection
 * messages that never name an actor whose sheet they can't see.
 */
import { describe, expect, it } from 'vitest';
import { maxHP, scriptedDice, type Combatant, type Dice, type Stats } from '@cprc/rules-core';
import {
  applyEntry, CANT_DO_THAT, emptySession, handleIntent, playerSees, projectEntry,
  type Actor, type Intent, type LogEntry, type SessionState, type TacticalMap, type Viewer,
} from '../src/index.js';

const BASE: Stats = { INT: 6, REF: 6, DEX: 6, TECH: 6, COOL: 6, WILL: 6, LUCK: 6, MOVE: 6, BODY: 6, EMP: 6 };
function actor(id: string, name: string, side: 'pc' | 'npc', controller: string): Actor {
  const max = maxHP(6, 6);
  const combatant: Combatant = {
    id, name, side, stats: BASE, skills: { Handgun: 6, Evasion: 4 }, hp: { max, current: max },
    armor: [], criticalInjuries: [], deathSave: { accumulatedPenalty: 0 },
    conditions: { prone: false, unconscious: false, dead: false, stabilized: false },
  };
  return { id, controller, weapons: [{ id: 'pistol', name: 'Heavy Pistol', type: 'heavyPistol', ammo: { loaded: 8, capacity: 8 } }], combatant };
}
const GM: Viewer = { role: 'gm' };
const P1: Viewer = { role: 'player', playerId: 'p1' };
const P2: Viewer = { role: 'player', playerId: 'p2' };
// A wall at x = 6 hides the two Lieutenants on the right.
const MAP: TacticalMap = {
  id: 'm', name: 'Split', width: 12, height: 4, cells: '......#.....'.repeat(4), cellPx: 64, sightRange: 30,
  tokens: { vex: { x: 1, y: 1 }, kit: { x: 2, y: 2 }, lt: { x: 9, y: 1 }, sgt: { x: 10, y: 2 }, ganger: { x: 4, y: 1 } }, watches: {}, spotted: [],
};

function table() {
  let state: SessionState = emptySession('s');
  const log: { entry: LogEntry; before: SessionState; after: SessionState }[] = [];
  let n = 0;
  const t = {
    get state() { return state; },
    log,
    send(intent: Intent, by: Viewer, dice: Dice = scriptedDice({})) {
      const r = handleIntent(state, intent, by, { dice, now: () => '2077-01-01T00:00:00Z', newId: () => `id${++n}` });
      if (r.ok) { const before = state; state = applyEntry(state, r.entry); log.push({ entry: r.entry, before, after: state }); }
      return r;
    },
    /** The last entry as the relay projects it for `v`. */
    last(v: Viewer) { const l = log.at(-1)!; return projectEntry(l.entry, v, l.after, undefined, l.before); },
  };
  t.send({ type: 'addActor', actor: actor('vex', 'Vex', 'pc', 'p1') }, GM);
  t.send({ type: 'addActor', actor: actor('kit', 'Kit', 'pc', 'p2') }, GM);
  t.send({ type: 'addActor', actor: actor('ganger', 'Street Ganger', 'npc', 'gm') }, GM);
  t.send({ type: 'addActor', actor: actor('lt', 'Lieutenant', 'npc', 'gm') }, GM);
  t.send({ type: 'addActor', actor: actor('sgt', 'Sergeant', 'npc', 'gm') }, GM);
  t.send({ type: 'setMap', map: MAP }, GM);
  return t;
}

describe('entries players never receive', () => {
  it('two consecutive unseen hostile Turns send other players nothing at all', () => {
    const t = table();
    // Order: vex, ganger, lt, sgt, kit.
    t.send({ type: 'startEncounter', participants: [{ actorId: 'vex' }, { actorId: 'ganger' }, { actorId: 'lt' }, { actorId: 'sgt' }, { actorId: 'kit' }] }, GM, scriptedDice({ d10: [10, 9, 8, 7, 6] }));
    expect(t.state.encounter.order).toEqual(['vex', 'ganger', 'lt', 'sgt', 'kit']);
    t.send({ type: 'endTurn' }, P1);
    t.send({ type: 'endTurn' }, GM); // ganger → lt (unseen): players see the anonymous slot appear
    expect(playerSees(t.last(P2))).toBe(true);
    const lt = t.send({ type: 'moveToken', actorId: 'lt', to: { x: 9, y: 0 } }, GM);
    expect(lt.ok).toBe(true);
    expect(playerSees(t.last(P2))).toBe(false);
    t.send({ type: 'endTurn' }, GM); // lt → sgt: both unseen, the anonymous slot doesn't change
    expect(playerSees(t.last(P1))).toBe(false);
    expect(playerSees(t.last(P2))).toBe(false);
    t.send({ type: 'moveToken', actorId: 'sgt', to: { x: 10, y: 3 } }, GM);
    expect(playerSees(t.last(P2))).toBe(false);
    t.send({ type: 'endTurn' }, GM); // sgt → kit
    expect(playerSees(t.last(P2))).toBe(true);
    // The GM gets every entry.
    for (const l of t.log) expect(projectEntry(l.entry, GM, l.after, undefined, l.before)).toMatchObject({ seq: l.entry.seq, by: l.entry.by, intentType: l.entry.intent.type });
  });

  it('a private roll and a whisper reach only their audience', () => {
    const t = table();
    t.send({ type: 'rollDice', label: 'Secret', dice: { count: 3, sides: 6, bonus: 0 }, private: true }, P1, scriptedDice({ d6: [1, 2, 3] }));
    expect(playerSees(t.last(P1))).toBe(true);
    expect(t.last(P1).by).toBe('player:p1');
    expect(playerSees(t.last(P2))).toBe(false);
    t.send({ type: 'chat', text: 'Psst.', to: ['gm'] }, P1);
    expect(playerSees(t.last(P2))).toBe(false);
    t.send({ type: 'chat', text: 'For Kit only.', to: ['p2'] }, GM);
    expect(playerSees(t.last(P1))).toBe(false);
    expect(t.last(P2)).toMatchObject({ by: 'gm', intentType: 'chat' });
    t.send({ type: 'rollCheck', label: 'Perception', base: 10, private: true }, GM, scriptedDice({ d10: [5] }));
    expect(playerSees(t.last(P1))).toBe(false);
  });

  it('GM-only bookkeeping with no visible effect sends players nothing', () => {
    const t = table();
    t.send({ type: 'adjustHp', actorId: 'lt', delta: -5 }, GM);
    expect(playerSees(t.last(P1))).toBe(false);
    t.send({ type: 'saveToLibrary', kind: 'actor', item: actor('tpl', 'Template', 'npc', 'gm') }, GM);
    expect(playerSees(t.last(P1))).toBe(false);
  });

  it('a hidden part withholds the author and intent type; a fully visible entry keeps them', () => {
    const t = table();
    t.send({ type: 'chat', text: 'Everyone hears this.' }, GM);
    // GM chat carries `by: 'gm'` on the event, so the client can tell the GM from a player.
    expect(t.last(P1)).toMatchObject({ by: 'gm', intentType: 'chat', events: [{ type: 'chatMessage', by: 'gm' }] });
    t.send({ type: 'placeToken', actorId: 'ganger', at: { x: 5, y: 1 } }, GM);
    const p = t.last(P1);
    expect(playerSees(p)).toBe(true); // the token moved in plain view
    expect(p.by).toBeUndefined();
    expect(p.intentType).toBeUndefined();
  });
});

describe('rejections never name what a player can’t see', () => {
  it('an unseen actor’s id is refused exactly like one that doesn’t exist', () => {
    const t = table();
    for (const intent of [
      { type: 'chat', text: 'hi', asActorId: 'lt' },
      { type: 'chat', text: 'hi', asActorId: 'nobody' },
      { type: 'rangedAttack', attackerId: 'vex', defenderId: 'lt', weaponId: 'pistol', distance: 10 },
      { type: 'rangedAttack', attackerId: 'vex', defenderId: 'nobody', weaponId: 'pistol', distance: 10 },
      { type: 'moveToken', actorId: 'lt', to: { x: 0, y: 0 } },
      { type: 'gear', op: { op: 'takeDrug', actorId: 'vex', targetId: 'sgt', drugId: 'glimmer' } },
    ] as Intent[]) {
      expect(t.send(intent, P1)).toEqual({ ok: false, code: 'NOT_FOUND', message: CANT_DO_THAT });
    }
  });

  it('a seen NPC whose sheet the player can’t see is never named', () => {
    const t = table();
    // The ganger is in plain view (spotted), but its sheet is the GM's.
    expect(t.state.map!.spotted).toContain('ganger');
    const speak = t.send({ type: 'chat', text: 'hi', asActorId: 'ganger' }, P1);
    expect(speak).toEqual({ ok: false, code: 'FORBIDDEN', message: CANT_DO_THAT });
    const move = t.send({ type: 'moveToken', actorId: 'ganger', to: { x: 3, y: 1 } }, P1);
    expect(move.ok).toBe(false);
    expect(JSON.stringify(move)).not.toContain('Ganger');
    // Hide the ganger behind a crate the party knows about: the refusal says "that character".
    t.send({ type: 'setMap', map: { ...t.state.map!, cells: t.state.map!.cells.slice(0, 12 + 3) + 'c' + t.state.map!.cells.slice(16), tokens: { ...t.state.map!.tokens, ganger: { x: 4, y: 1 } } } }, GM);
    const shot = t.send({ type: 'rangedAttack', attackerId: 'vex', defenderId: 'ganger', weaponId: 'pistol', distance: 10 }, P1);
    expect(shot).toMatchObject({ ok: false, code: 'NO_LINE_OF_SIGHT', message: 'That character is behind cover or out of sight.' });
    // The GM still gets names.
    expect(t.send({ type: 'rangedAttack', attackerId: 'vex', defenderId: 'ganger', weaponId: 'pistol', distance: 10 }, GM)).toMatchObject({ message: 'Street Ganger is behind cover or out of sight.' });
  });

  it('players can still be told about their own and other PCs', () => {
    const t = table();
    t.send({ type: 'startEncounter', participants: [{ actorId: 'kit' }, { actorId: 'vex' }] }, GM, scriptedDice({ d10: [9, 2] }));
    expect(t.send({ type: 'moveToken', actorId: 'vex', to: { x: 1, y: 0 } }, P1)).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN', message: 'It isn’t Vex’s Turn.' });
    expect(t.send({ type: 'moveToken', actorId: 'kit', to: { x: 1, y: 0 } }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN', message: 'You don’t control Kit.' });
  });
});
