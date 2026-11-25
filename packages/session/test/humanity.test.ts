import { describe, expect, it } from 'vitest';
import { applySystems, maxHP, scriptedDice, type Combatant, type CyberwareItem, type Dice } from '@cprc/rules-core';
import { applyEntry, emptySession, handleIntent, type Actor, type Intent, type SessionState, type Viewer } from '../src/index.js';

const GM: Viewer = { role: 'gm' };
const P1: Viewer = { role: 'player', playerId: 'p1' };

function runner(humanity?: Combatant['humanity'], cyberware: CyberwareItem[] = []): Actor {
  const stats = { INT: 6, REF: 6, DEX: 6, TECH: 6, COOL: 6, WILL: 6, LUCK: 6, MOVE: 6, BODY: 6, EMP: 6 };
  const c: Combatant = applySystems({
    id: 'v', name: 'V', side: 'pc', stats, skills: {}, hp: { max: maxHP(6, 6), current: maxHP(6, 6) }, armor: [], criticalInjuries: [],
    deathSave: { accumulatedPenalty: 0 }, conditions: { prone: false, unconscious: false, dead: false, stabilized: false },
    ...(humanity ? { humanity } : {}), cyberware,
  });
  return { id: 'v', controller: 'p1', combatant: c, weapons: [] };
}
function table(a: Actor) {
  let s: SessionState = emptySession('h');
  const send = (i: Intent, by: Viewer, dice: Dice = scriptedDice({})) => {
    const r = handleIntent(s, i, by, { dice, now: () => 't', newId: () => 'x' });
    if (r.ok) s = applyEntry(s, r.entry);
    return r;
  };
  send({ type: 'addActor', actor: a }, GM);
  return { send, get v() { return s.actors.v!.combatant; } };
}
const item = (id: string, extra: Partial<CyberwareItem> = {}): CyberwareItem => ({ id, name: id, humanityLoss: 0, effects: [], hlDice: '2d6', hlFixed: 7, ...extra });

describe('installing cyberware', () => {
  it('rolls the item’s dice, lowers max by 2, and EMP follows Humanity', () => {
    const t = table(runner({ base: 60, max: 60, current: 60 }));
    expect(t.send({ type: 'installCyberware', actorId: 'v', item: item('a'), lossMode: 'roll' }, GM, scriptedDice({ d6: [6, 5] })).ok).toBe(true);
    expect(t.v.humanity).toEqual({ base: 60, max: 58, current: 49 });
    expect(t.v.stats.EMP).toBe(4);
  });
  it('takes the fixed value, or nothing (which also spares max)', () => {
    const t = table(runner({ base: 60, max: 60, current: 60 }));
    t.send({ type: 'installCyberware', actorId: 'v', item: item('a'), lossMode: 'fixed' }, GM);
    expect(t.v.humanity).toEqual({ base: 60, max: 58, current: 53 });
    t.send({ type: 'installCyberware', actorId: 'v', item: item('b'), lossMode: 'none' }, GM);
    expect(t.v.humanity).toEqual({ base: 60, max: 58, current: 53 });
  });
  it('halves 1d6/2 rounding up; borgware costs 4 max', () => {
    const t = table(runner({ base: 60, max: 60, current: 60 }));
    t.send({ type: 'installCyberware', actorId: 'v', item: item('a', { hlDice: '1d6/2', hlFixed: 2 }), lossMode: 'roll' }, GM, scriptedDice({ d6: [5] }));
    expect(t.v.humanity!.current).toBe(57);
    t.send({ type: 'installCyberware', actorId: 'v', item: item('b', { hlDice: '4d6', hlFixed: 14, borgware: true }), lossMode: 'fixed' }, GM);
    expect(t.v.humanity).toEqual({ base: 60, max: 54, current: 43 });
  });
  it('flags cyberpsychosis at 0', () => {
    const t = table(runner({ base: 20, max: 20, current: 5 }));
    const r = t.send({ type: 'installCyberware', actorId: 'v', item: item('a'), lossMode: 'fixed' }, GM);
    expect(r.ok && r.entry.events.some((e) => e.type === 'gmRulingRequired')).toBe(true);
  });
  it('removal gives back the max and half the loss', () => {
    const t = table(runner({ base: 60, max: 60, current: 60 }));
    t.send({ type: 'installCyberware', actorId: 'v', item: item('a'), lossMode: 'fixed' }, GM);
    t.send({ type: 'removeCyberware', actorId: 'v', itemId: 'a' }, GM);
    expect(t.v.humanity).toEqual({ base: 60, max: 60, current: 56 });
  });
  it('recovers base for older saves without it', () => {
    const old = runner({ max: 58, current: 50 }, [item('a', { humanityLoss: 8 })]);
    const t = table(old);
    t.send({ type: 'installCyberware', actorId: 'v', item: item('b'), lossMode: 'fixed' }, GM);
    expect(t.v.humanity).toEqual({ base: 60, max: 56, current: 43 });
  });
  it('therapy never exceeds max', () => {
    const t = table(runner({ base: 60, max: 60, current: 60 }));
    t.send({ type: 'installCyberware', actorId: 'v', item: item('a'), lossMode: 'fixed' }, GM); // 53 / 58
    t.send({ type: 'therapy', actorId: 'v', kind: 'standard', therapistBase: 20 }, GM, scriptedDice({ d10: [5], d6: [6, 6] }));
    expect(t.v.humanity).toEqual({ base: 60, max: 58, current: 58 });
  });
});

describe('hostile install payloads', () => {
  it('refuses bad modes, bad dice and players', () => {
    const t = table(runner({ base: 60, max: 60, current: 60 }));
    expect(t.send({ type: 'installCyberware', actorId: 'v', item: item('a'), lossMode: 'yolo' as never }, GM)).toMatchObject({ ok: false });
    expect(t.send({ type: 'installCyberware', actorId: 'v', item: item('a', { hlDice: '9d20' }), lossMode: 'roll' }, GM)).toMatchObject({ ok: false });
    expect(t.send({ type: 'installCyberware', actorId: 'v', item: item('a', { hlDice: undefined, hlFixed: undefined }), lossMode: 'roll' }, GM)).toMatchObject({ ok: false });
    expect(t.send({ type: 'installCyberware', actorId: 'v', item: item('a', { hlFixed: -3 }), lossMode: 'fixed' }, GM)).toMatchObject({ ok: false });
    expect(t.send({ type: 'installCyberware', actorId: 'v', item: item('a', { borgware: 'yes' as never }) }, GM)).toMatchObject({ ok: false });
    expect(t.send({ type: 'installCyberware', actorId: 'v', item: item('a'), lossMode: 'fixed' }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
});
