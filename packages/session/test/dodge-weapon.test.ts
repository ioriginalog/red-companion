import { describe, expect, it } from 'vitest';
import { maxHP, scriptedDice, type Combatant, type Stats } from '@cprc/rules-core';
import { applyEntry, emptySession, handleIntent, projectState, type Actor, type Intent, type SessionState, type TacticalMap, type Viewer } from '../src/index.js';

const BASE: Stats = { INT: 6, REF: 6, DEX: 6, TECH: 6, COOL: 6, WILL: 6, LUCK: 6, MOVE: 6, BODY: 6, EMP: 6 };
function actor(id: string, side: 'pc' | 'npc', controller: string, stats: Partial<Stats> = {}): Actor {
  const s = { ...BASE, ...stats };
  const max = maxHP(s.BODY, s.WILL);
  const combatant: Combatant = {
    id, name: id, side, stats: s, skills: { Handgun: 6, Evasion: 4 }, hp: { max, current: max }, armor: [], criticalInjuries: [],
    deathSave: { accumulatedPenalty: 0 }, conditions: { prone: false, unconscious: false, dead: false, stabilized: false },
  };
  return { id, controller, weapons: [{ id: 'pistol', name: 'Heavy Pistol', type: 'heavyPistol', ammo: { loaded: 8, capacity: 8 } }], combatant };
}
const GM: Viewer = { role: 'gm' };
const P1: Viewer = { role: 'player', playerId: 'p1' };
const MAP: TacticalMap = {
  id: 'm', name: 'Yard', width: 10, height: 3, cells: '.'.repeat(30), cellPx: 64, sightRange: 30,
  tokens: { solo: { x: 0, y: 1 }, ganger: { x: 5, y: 1 } }, watches: {}, spotted: [],
};

describe('dodge prompt weapon type (#15)', () => {
  it('tells the defender what kind of weapon a known attacker is using, without its stats', () => {
    let s: SessionState = emptySession('s');
    const send = (i: Intent, by: Viewer, d = scriptedDice({})) => { const r = handleIntent(s, i, by, { dice: d }); if (!r.ok) throw new Error(r.message); s = applyEntry(s, r.entry); };
    send({ type: 'addActor', actor: actor('solo', 'pc', 'p1', { REF: 8 }) }, GM);
    send({ type: 'addActor', actor: actor('ganger', 'npc', 'gm') }, GM);
    send({ type: 'setMap', map: MAP }, GM);
    send({ type: 'startEncounter', participants: [{ actorId: 'ganger' }, { actorId: 'solo' }] }, GM, scriptedDice({ d10: [9, 1] }));
    send({ type: 'rangedAttack', attackerId: 'ganger', defenderId: 'solo', weaponId: 'pistol', distance: 10 }, GM);
    const p = projectState(s, P1).pending;
    expect(p?.kind).toBe('awaitingDodge');
    const attack = (p as Extract<typeof p, { kind: 'awaitingDodge' }>).attack;
    expect(attack.weaponType).toBe('heavyPistol');
    expect(attack.weaponId).toBe('unknown');
    expect(JSON.stringify(p)).not.toContain('"ammo"');
  });
});
