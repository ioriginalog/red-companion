import { describe, expect, it } from 'vitest';
import { maxHP, scriptedDice, type Combatant } from '@cprc/rules-core';
import { applyEntry, emptySession, handleIntent, projectState, type Actor, type Intent, type SessionState, type Viewer } from '../src/index.js';

function actor(id: string, controller: string): Actor {
  const stats = { INT: 6, REF: 6, DEX: 6, TECH: 6, COOL: 6, WILL: 6, LUCK: 6, MOVE: 6, BODY: 6, EMP: 6 };
  const max = maxHP(6, 6);
  const combatant: Combatant = {
    id, name: id, side: 'pc', stats, skills: { Handgun: 4 }, hp: { max, current: max }, armor: [], criticalInjuries: [],
    deathSave: { accumulatedPenalty: 0 }, conditions: { prone: false, unconscious: false, dead: false, stabilized: false },
  };
  return { id, controller, weapons: [], combatant, notes: 'old', gmNotes: 'secret' };
}
const GM: Viewer = { role: 'gm' };
const P1: Viewer = { role: 'player', playerId: 'p1' };
function setup(): SessionState {
  let s = emptySession('s');
  for (const a of [actor('vex', 'p1'), actor('doc', 'p2')]) {
    const r = handleIntent(s, { type: 'addActor', actor: a }, GM, { dice: scriptedDice({}) });
    if (!r.ok) throw new Error(r.message);
    s = applyEntry(s, r.entry);
  }
  return s;
}
const send = (s: SessionState, i: unknown, by: Viewer) => handleIntent(s, i as Intent, by, { dice: scriptedDice({}) });

describe('editOwnSheet', () => {
  it('lets a player change their own notes and gear, and nothing else', () => {
    const s = setup();
    const r = send(s, { type: 'editOwnSheet', actorId: 'vex', notes: ' New notes ', gear: [{ name: 'Agent', qty: 1 }, { name: 'Flashlight', qty: 2, notes: 'Taped' }] }, P1);
    expect(r.ok).toBe(true);
    const after = applyEntry(s, (r as { ok: true; entry: never }).entry);
    expect(after.actors.vex!.notes).toBe('New notes');
    expect(after.actors.vex!.combatant.gear).toEqual([{ name: 'Agent', qty: 1 }, { name: 'Flashlight', qty: 2, notes: 'Taped' }]);
    expect(after.actors.vex!.gmNotes).toBe('secret');
    expect(after.actors.vex!.combatant.skills).toEqual({ Handgun: 4 });
  });
  it('refuses someone else’s character and any other field', () => {
    const s = setup();
    expect(send(s, { type: 'editOwnSheet', actorId: 'doc', notes: 'x' }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(send(s, { type: 'editOwnSheet', actorId: 'vex', gmNotes: 'x' }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(send(s, { type: 'editOwnSheet', actorId: 'vex', stats: { REF: 10 } }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
  it('rejects hostile payloads', () => {
    const s = setup();
    const bad: unknown[] = [
      { type: 'editOwnSheet', actorId: 'vex' },
      { type: 'editOwnSheet', actorId: 'vex', notes: 5 },
      { type: 'editOwnSheet', actorId: 'vex', notes: 'x'.repeat(8001) },
      { type: 'editOwnSheet', actorId: 'vex', gear: 'lots' },
      { type: 'editOwnSheet', actorId: 'vex', gear: [{ name: '', qty: 1 }] },
      { type: 'editOwnSheet', actorId: 'vex', gear: [{ name: 'x', qty: 1.5 }] },
      { type: 'editOwnSheet', actorId: 'vex', gear: [{ name: 'x', qty: -1 }] },
      { type: 'editOwnSheet', actorId: 'vex', gear: Array.from({ length: 101 }, () => ({ name: 'x', qty: 1 })) },
      { type: 'editOwnSheet', actorId: 'vex', gear: [null] },
      { type: 'editOwnSheet', actorId: 42, notes: 'x' },
      { type: 'editOwnSheet', actorId: 'nobody', notes: 'x' },
    ];
    for (const i of bad) expect(send(s, i, P1).ok).toBe(false);
  });
  it('never leaks GM notes to the player who edits', () => {
    const s = setup();
    const v = projectState(s, P1);
    expect(v.actors.vex!.gmNotes).toBeUndefined();
  });
});
