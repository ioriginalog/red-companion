import { describe, expect, it } from 'vitest';
import { scriptedDice } from '@cprc/rules-core';
import { applyEntry, checkPlayerName, emptySession, handleIntent, isReservedName, nameKey, parseClientMessage, type Actor, type Intent, type SessionState, type Viewer } from '../src/index.js';

describe('player names', () => {
  it.each(['GM', 'gm', 'G M', 'G.M.', 'g-m', 'GameMaster', 'Game Master', 'Games Master', 'The GM', 'the_gm', 'Bob (GM)', 'GM Bob', '[GM] Bob', '6M', 'G M Bob',
    'Gаme Mаster' /* Cyrillic а */, 'ＧＭ' /* full width */, 'Gàmé Mästér', 'Dungeon Master', 'DM', 'Referee', 'Admin'])('reserves %s', (n) => {
    expect(isReservedName(n)).toBe(true);
    expect(checkPlayerName(n)).toEqual({ ok: false, message: 'That name is reserved for the GM. Pick another name.' });
  });
  it.each(['Gemma', 'Magnus', 'Gus Mendez', 'Vex', 'Gimli', 'Agamemnon', 'Ögmund', '李小龙', 'Mgm'])('allows %s', (n) => {
    expect(isReservedName(n)).toBe(false);
    expect(checkPlayerName(n).ok).toBe(true);
  });
  it('trims and bounds names, and compares them loosely', () => {
    expect(checkPlayerName('  Bo   Rivers ')).toEqual({ ok: true, name: 'Bo Rivers' });
    expect(checkPlayerName('   ').ok).toBe(false);
    expect(checkPlayerName('!!!').ok).toBe(false);
    expect(checkPlayerName('x'.repeat(41)).ok).toBe(false);
    expect(nameKey('Ána-Maria')).toBe(nameKey('ana maria'));
  });
  it('parses roster commands strictly', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'roster', op: { op: 'merge', keepId: 'a', dropId: 'b', extra: 1 } }))).toEqual({ t: 'roster', op: { op: 'merge', keepId: 'a', dropId: 'b' } });
    expect(parseClientMessage(JSON.stringify({ t: 'roster', op: { op: 'reclaim', requestId: 'r', approve: 'yes' } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'roster', op: { op: 'nuke' } }))).toBeNull();
  });
});

describe('reassignPlayer', () => {
  const pc = (id: string, controller: string): Actor => ({
    id, controller, weapons: [],
    combatant: { id, name: id, side: 'pc', stats: { INT: 6, REF: 6, DEX: 6, TECH: 6, COOL: 6, WILL: 6, LUCK: 6, MOVE: 6, BODY: 6, EMP: 6 }, skills: {}, hp: { max: 40, current: 40 }, armor: [], criticalInjuries: [], deathSave: { accumulatedPenalty: 0 }, conditions: { prone: false, unconscious: false, dead: false, stabilized: false } },
  });
  it('moves every character of one player to another, GM only', () => {
    let s: SessionState = emptySession('s');
    const GM: Viewer = { role: 'gm' };
    const send = (i: Intent, by: Viewer = GM) => { const r = handleIntent(s, i, by, { dice: scriptedDice({}) }); if (r.ok) s = applyEntry(s, r.entry); return r; };
    send({ type: 'addActor', actor: pc('a', 'p1') });
    send({ type: 'addActor', actor: pc('b', 'p1') });
    send({ type: 'addActor', actor: pc('c', 'p2') });
    expect(send({ type: 'reassignPlayer', from: 'p1', to: 'p2' }, { role: 'player', playerId: 'p1' })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(send({ type: 'reassignPlayer', from: 'p1', to: 'p2' }).ok).toBe(true);
    expect(Object.values(s.actors).map((a) => a.controller)).toEqual(['p2', 'p2', 'p2']);
    expect(send({ type: 'reassignPlayer', from: 'p2', to: 'gm' }).ok).toBe(true);
    expect(Object.values(s.actors).every((a) => a.controller === 'gm')).toBe(true);
    expect(send({ type: 'reassignPlayer', from: 'gm', to: 'p1' })).toMatchObject({ ok: false, code: 'INVALID' });
  });
});
