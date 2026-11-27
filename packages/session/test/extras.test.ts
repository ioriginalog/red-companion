import { describe, expect, it } from 'vitest';
import { maxHP, scriptedDice, type Combatant, type Dice, type Stats } from '@cprc/rules-core';
import {
  applyEntry, CANT_DO_THAT, emptySession, handleIntent, projectEntry, projectState,
  type Actor, type ExtraOp, type Intent, type LogEntry, type SessionState, type TacticalMap, type Viewer,
} from '../src/index.js';

const BASE: Stats = { INT: 6, REF: 6, DEX: 6, TECH: 6, COOL: 6, WILL: 6, LUCK: 6, MOVE: 6, BODY: 6, EMP: 6 };
function actor(id: string, side: 'pc' | 'npc', controller: string, stats: Partial<Stats> = {}, skills: Record<string, number> = {}, extra: Partial<Combatant> = {}): Actor {
  const s = { ...BASE, ...stats };
  const max = maxHP(s.BODY, s.WILL);
  return {
    id, controller,
    weapons: [{ id: 'pistol', name: 'Heavy Pistol', type: 'heavyPistol', ammo: { loaded: 8, capacity: 8 } }, { id: 'rifle', name: 'Assault Rifle', type: 'assaultRifle', ammo: { loaded: 25, capacity: 25 } }],
    combatant: {
      id, name: id, side, stats: s, skills: { Brawling: 4, Evasion: 2, ...skills }, hp: { max, current: max }, armor: [],
      criticalInjuries: [], deathSave: { accumulatedPenalty: 0 }, conditions: { prone: false, unconscious: false, dead: false, stabilized: false }, ...extra,
    },
  };
}
const GM: Viewer = { role: 'gm' };
const P1: Viewer = { role: 'player', playerId: 'p1' };
const P2: Viewer = { role: 'player', playerId: 'p2' };

const MAP: TacticalMap = {
  id: 'm', name: 'Room', width: 8, height: 3, cells: '........'.repeat(3), cellPx: 64, sightRange: 30,
  tokens: { solo: { x: 1, y: 1 }, thug: { x: 2, y: 1 }, far: { x: 6, y: 1 } }, watches: {}, spotted: [],
};

function table(withMap = true) {
  let state: SessionState = emptySession('s');
  const log: LogEntry[] = [];
  let n = 0;
  const t = {
    get state() { return state; },
    log,
    send(intent: Intent, by: Viewer, dice: Dice = scriptedDice({})) {
      const r = handleIntent(state, intent, by, { dice, now: () => '2077-01-01T00:00:00Z', newId: () => `id${++n}` });
      if (r.ok) { state = applyEntry(state, r.entry); log.push(r.entry); }
      return r;
    },
    x(op: ExtraOp | Record<string, unknown>, by: Viewer, dice?: Dice) {
      return t.send({ type: 'extra', op: op as ExtraOp }, by, dice);
    },
  };
  t.send({ type: 'addActor', actor: actor('solo', 'pc', 'p1', { REF: 8, DEX: 7, BODY: 8, WILL: 8, MOVE: 8 }, { 'Martial Arts (Karate)': 4, 'Martial Arts (Taekwondo)': 3, 'Martial Arts (Aikido)': 3 }) }, GM);
  t.send({ type: 'addActor', actor: actor('thug', 'npc', 'gm', { REF: 5 }) }, GM);
  t.send({ type: 'addActor', actor: actor('far', 'npc', 'gm') }, GM);
  if (withMap) t.send({ type: 'setMap', map: MAP }, GM);
  return t;
}
function encounter(t: ReturnType<typeof table>) {
  t.send({ type: 'startEncounter', participants: [{ actorId: 'solo' }, { actorId: 'thug' }, { actorId: 'far' }] }, GM, scriptedDice({ d10: [9, 1, 2] }));
  expect(t.state.encounter.order[0]).toBe('solo');
}
const hpOf = (t: ReturnType<typeof table>, id: string) => t.state.actors[id]!.combatant.hp.current;

describe('grapples', () => {
  it('grab (opposed DEX + Brawling), then penalties, no Move for the held, Choke floors at 1 HP', () => {
    const t = table();
    encounter(t);
    // solo 7+4+6 = 17 vs thug 6+4+2 = 12
    expect(t.x({ kind: 'grab', actorId: 'solo', targetId: 'thug', choice: 'grapple' }, P1, scriptedDice({ d10: [6, 2] })).ok).toBe(true);
    expect(t.state.extras!.grapples).toEqual([{ holderId: 'solo', heldId: 'thug', chokes: 0, lastChokeRound: null, ironGrip: false }]);
    expect(t.state.encounter.usage!.actionUsed).toBe(true);
    // Both take −2: the held thug's attack carries it.
    t.send({ type: 'endTurn' }, GM);
    const r = t.send({ type: 'meleeAttack', attackerId: 'thug', defenderId: 'solo', with: { kind: 'brawling' } }, GM, scriptedDice({ d10: [5, 5] }));
    expect(r.ok).toBe(true);
    const att = t.log.at(-1)!.events.find((e) => e.type === 'attackResolved');
    expect(att && att.type === 'attackResolved' && att.attack.modifiers.map((m) => m.label)).toContain('Grappling');
    expect(t.send({ type: 'moveToken', actorId: 'thug', to: { x: 3, y: 1 } }, GM)).toMatchObject({ ok: false, code: 'INVALID' });
    // Two-handed weapons are out while grappling.
    expect(t.send({ type: 'rangedAttack', attackerId: 'thug', defenderId: 'solo', weaponId: 'rifle', distance: 2 }, GM)).toMatchObject({ ok: false, code: 'INVALID' });
  });

  it('Choke: BODY to HP, never below 1, and three Rounds running knock out', () => {
    const t = table();
    encounter(t);
    t.x({ kind: 'grab', actorId: 'solo', targetId: 'thug', choice: 'grapple' }, P1, scriptedDice({ d10: [6, 2] }));
    const round = () => { t.send({ type: 'endTurn' }, GM); t.send({ type: 'endTurn' }, GM); t.send({ type: 'endTurn' }, GM); };
    round();
    const before = hpOf(t, 'thug');
    expect(t.x({ kind: 'choke', actorId: 'solo' }, P1).ok).toBe(true);
    expect(hpOf(t, 'thug')).toBe(before - 8);
    round();
    t.x({ kind: 'choke', actorId: 'solo' }, P1);
    round();
    t.x({ kind: 'choke', actorId: 'solo' }, P1);
    expect(t.state.actors.thug!.combatant.conditions.unconscious).toBe(true);
    expect(hpOf(t, 'thug')).toBeGreaterThanOrEqual(1);
    // An unconscious target still held; the holder lets go for free.
    expect(t.x({ kind: 'release', actorId: 'solo' }, P1).ok).toBe(true);
    expect(t.state.extras!.grapples).toEqual([]);
  });

  it('Throw ends the grapple, ignores armor and leaves the target Prone', () => {
    const t = table();
    encounter(t);
    t.x({ kind: 'grab', actorId: 'solo', targetId: 'thug', choice: 'grapple' }, P1, scriptedDice({ d10: [6, 2] }));
    t.send({ type: 'endTurn' }, GM); t.send({ type: 'endTurn' }, GM); t.send({ type: 'endTurn' }, GM);
    const before = hpOf(t, 'thug');
    expect(t.x({ kind: 'throw', actorId: 'solo' }, P1).ok).toBe(true);
    expect(hpOf(t, 'thug')).toBe(before - 8);
    expect(t.state.actors.thug!.combatant.conditions.prone).toBe(true);
    expect(t.state.extras!.grapples).toEqual([]);
  });

  it('escape uses the same opposed check; ties stay held', () => {
    const t = table();
    t.x({ kind: 'grab', actorId: 'solo', targetId: 'thug', choice: 'grapple' }, P1, scriptedDice({ d10: [6, 2] }));
    // thug 6+4−2+4 = 12 vs solo 7+4−2+1 = 10 → escapes
    expect(t.x({ kind: 'escape', actorId: 'thug', heldId: 'thug' }, GM, scriptedDice({ d10: [4, 2] })).ok).toBe(true);
    expect(t.state.extras!.grapples).toEqual([]);
  });

  it('take an item: a named weapon changes hands', () => {
    const t = table();
    expect(t.x({ kind: 'grab', actorId: 'solo', targetId: 'thug', choice: 'takeItem', weaponId: 'pistol' }, P1, scriptedDice({ d10: [6, 2] })).ok).toBe(true);
    expect(t.state.actors.thug!.weapons.map((w) => w.id)).toEqual(['rifle']);
    expect(t.state.actors.solo!.weapons.map((w) => w.id)).toEqual(['pistol', 'rifle', 'pistol-2']);
  });

  it('refuses out of reach, out of Turn and self-grabs', () => {
    const t = table();
    expect(t.x({ kind: 'grab', actorId: 'solo', targetId: 'far', choice: 'grapple' }, P1)).toMatchObject({ ok: false, code: 'OUT_OF_REACH' });
    expect(t.x({ kind: 'grab', actorId: 'solo', targetId: 'solo', choice: 'grapple' }, P1)).toMatchObject({ ok: false });
    encounter(t);
    t.send({ type: 'endTurn' }, GM);
    expect(t.x({ kind: 'grab', actorId: 'solo', targetId: 'thug', choice: 'grapple' }, P1)).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
  });

  it('moving the holder away breaks the hold', () => {
    const t = table();
    t.x({ kind: 'grab', actorId: 'solo', targetId: 'thug', choice: 'grapple' }, P1, scriptedDice({ d10: [6, 2] }));
    t.send({ type: 'placeToken', actorId: 'solo', at: { x: 5, y: 2 } }, GM);
    expect(t.state.extras!.grapples).toEqual([]);
  });
});

describe('Martial Arts', () => {
  it('Bone Breaking Strike: one strike, adds Broken Ribs on a hit', () => {
    const t = table();
    encounter(t);
    // Attack: DEX 7 + Karate 4 + 9 = 20 vs thug DEX 6 + Evasion 2 + 1 = 9; damage BODY 8 → 3d6
    const r = t.x({ kind: 'specialMove', actorId: 'solo', moveId: 'karate.boneBreak', targetId: 'thug' }, P1, scriptedDice({ d10: [9, 2], d6: [3, 3, 2] }));
    expect(r.ok).toBe(true);
    expect(t.state.actors.thug!.combatant.criticalInjuries.map((i) => i.injuryId)).toContain('brokenRibs');
    expect(t.state.encounter.usage!.actionUsed).toBe(true);
  });

  it('Bone Breaking Strike needs WILL 8 and a free Action', () => {
    const t = table();
    t.send({ type: 'replaceActor', actor: actor('solo', 'pc', 'p1', { WILL: 7, DEX: 7 }, { 'Martial Arts (Karate)': 4 }) }, GM);
    expect(t.x({ kind: 'specialMove', actorId: 'solo', moveId: 'karate.boneBreak', targetId: 'thug' }, P1)).toMatchObject({ ok: false, message: expect.stringMatching(/WILL 8/) });
  });

  it('Disarming Combination needs a Brawling and a Martial Arts hit on that target this Turn (GM may force)', () => {
    const t = table();
    encounter(t);
    expect(t.x({ kind: 'specialMove', actorId: 'solo', moveId: 'aikido.disarm', targetId: 'thug' }, P1)).toMatchObject({ ok: false, message: expect.stringMatching(/isn’t available/) });
    // Brawling hit, then a Martial Arts hit, same Turn.
    t.send({ type: 'meleeAttack', attackerId: 'solo', defenderId: 'thug', with: { kind: 'brawling' } }, P1, scriptedDice({ d10: [9, 2] }));
    t.send({ type: 'cancelPending' }, GM);
    t.send({ type: 'meleeAttack', attackerId: 'solo', defenderId: 'thug', with: { kind: 'martialArts', form: 'Aikido' } }, GM, scriptedDice({ d10: [9, 2] }));
    t.send({ type: 'cancelPending' }, GM);
    expect(t.state.extras!.hits.filter((h) => h.hit).map((h) => h.with)).toEqual(['brawling', 'martialArts']);
    // DEX 7 + Aikido 3 + 8 = 18 > 15
    expect(t.x({ kind: 'specialMove', actorId: 'solo', moveId: 'aikido.disarm', targetId: 'thug', weaponId: 'pistol' }, P1, scriptedDice({ d10: [8] })).ok).toBe(true);
    expect(t.state.actors.thug!.weapons.map((w) => w.id)).toEqual(['rifle']);
    // Once per Turn.
    expect(t.x({ kind: 'specialMove', actorId: 'solo', moveId: 'aikido.disarm', targetId: 'thug' }, P1)).toMatchObject({ ok: false, message: expect.stringMatching(/once per Turn/) });
    expect(t.x({ kind: 'specialMove', actorId: 'solo', moveId: 'aikido.disarm', targetId: 'thug', force: true }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('Recovery: beat DV 13 to stand without spending the Action', () => {
    const t = table();
    t.send({ type: 'setCondition', actorId: 'solo', condition: 'prone', value: true }, GM);
    encounter(t);
    expect(t.x({ kind: 'getUp', actorId: 'solo', form: 'Karate' }, P1, scriptedDice({ d10: [3] })).ok).toBe(true); // 7+4+3 = 14
    expect(t.state.actors.solo!.combatant.conditions.prone).toBe(false);
    expect(t.state.encounter.usage?.actionUsed ?? false).toBe(false);
  });
});

describe('Facedowns', () => {
  it('winner, loser choosing to fight takes −2 against the winner only', () => {
    const t = table();
    t.x({ kind: 'setReputation', actorId: 'solo', value: 3 }, GM);
    expect(t.x({ kind: 'setReputation', actorId: 'solo', value: 4 }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(t.x({ kind: 'facedown', actorId: 'solo', targetId: 'thug' }, P1, scriptedDice({ d10: [5, 5] })).ok).toBe(true);
    const f = t.state.extras!.facedowns[0]!;
    expect(f).toMatchObject({ winnerId: 'solo', loserId: 'thug', status: 'choosing' });
    expect(t.x({ kind: 'facedownChoice', facedownId: f.id, choice: 'fight' }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    t.x({ kind: 'facedownChoice', facedownId: f.id, choice: 'fight' }, GM);
    t.send({ type: 'meleeAttack', attackerId: 'thug', defenderId: 'solo', with: { kind: 'brawling' } }, GM, scriptedDice({ d10: [5, 5] }));
    const att = t.log.at(-1)!.events.find((e) => e.type === 'attackResolved');
    expect(att && att.type === 'attackResolved' && att.attack.modifiers.map((m) => m.label)).toContain('Lost Facedown');
    expect(t.x({ kind: 'endFacedown', facedownId: f.id }, P1).ok).toBe(true);
  });

  it('needs the initiator to see the target (own sight or party vision)', () => {
    const t = table();
    // A wall between the solo and the far thug, and nobody else on the party side.
    const walled: TacticalMap = { ...MAP, cells: '....#...'.repeat(3) };
    t.send({ type: 'setMap', map: walled }, GM);
    const r = t.x({ kind: 'facedown', actorId: 'solo', targetId: 'far' }, P1, scriptedDice({ d10: [5, 5] }));
    // Never seen by the party, so the refusal is the one for an unknown id.
    expect(r).toMatchObject({ ok: false, code: 'NOT_FOUND', message: CANT_DO_THAT });
    expect(t.state.extras?.facedowns ?? []).toEqual([]);
    // An ally on the far side of the wall gives the party sight of the thug.
    t.send({ type: 'addActor', actor: { ...actor('ally', 'pc', 'p2'), allegiance: 'ally' } }, GM);
    t.send({ type: 'placeToken', actorId: 'ally', at: { x: 7, y: 0 } }, GM);
    expect(t.x({ kind: 'facedown', actorId: 'solo', targetId: 'far' }, P1, scriptedDice({ d10: [5, 5] })).ok).toBe(true);
    // The GM referees and isn't refused.
    t.send({ type: 'placeToken', actorId: 'ally', at: null }, GM);
    expect(t.x({ kind: 'facedown', actorId: 'solo', targetId: 'far' }, GM, scriptedDice({ d10: [5, 5] })).ok).toBe(true);
  });

  it('a tie: nobody blinks', () => {
    const t = table();
    t.x({ kind: 'facedown', actorId: 'solo', targetId: 'thug' }, P1, scriptedDice({ d10: [5, 5] }));
    expect(t.state.extras?.facedowns ?? []).toEqual([]);
  });
});

describe('Role Abilities', () => {
  const withRole = (t: ReturnType<typeof table>, role: Record<string, unknown>, extra: Partial<Combatant> = {}) =>
    t.send({ type: 'replaceActor', actor: actor('solo', 'pc', 'p1', { COOL: 7, TECH: 7 }, { Trading: 4, Weaponstech: 5 }, { role: role as never, ...extra }) }, GM);

  it('Backup uses the Action and reports who comes', () => {
    const t = table();
    withRole(t, { id: 'lawman', rank: 4 });
    encounter(t);
    expect(t.x({ kind: 'backup', actorId: 'solo' }, P1, scriptedDice({ d10: [2], d6: [3] })).ok).toBe(true);
    expect(t.state.encounter.usage!.actionUsed).toBe(true);
    const e = t.log.at(-1)!.events[0]!;
    expect(e.type === 'extraResolved' && e.text).toMatch(/arriving in 3 Rounds/);
  });

  it('only the right Role can use an ability; GM fields are GM-only', () => {
    const t = table();
    withRole(t, { id: 'solo', rank: 4 });
    expect(t.x({ kind: 'impact', actorId: 'solo', audience: 'single' }, P1)).toMatchObject({ ok: false, message: expect.stringMatching(/Rockerboy/) });
    expect(t.x({ kind: 'haggle', actorId: 'solo', sellerTotal: 12 }, P1)).toMatchObject({ ok: false });
    withRole(t, { id: 'exec', rank: 5 });
    expect(t.x({ kind: 'recruit', actorId: 'solo', name: 'Ana', memberKind: 'driver' }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(t.x({ kind: 'recruit', actorId: 'solo', name: 'Ana', memberKind: 'driver' }, GM, scriptedDice({ d6: [4] })).ok).toBe(true);
    expect(t.state.actors.solo!.combatant.role!.team).toEqual([{ name: 'Ana', kind: 'driver', loyalty: 5 }]);
    // Loyalty checks are the GM's secret.
    t.x({ kind: 'loyalty', actorId: 'solo', member: 0 }, GM, scriptedDice({ d6: [2] }));
    expect(projectEntry(t.log.at(-1)!, P1, t.state).events).toEqual([]);
  });

  it('Maker and Moto', () => {
    const t = table();
    withRole(t, { id: 'tech', rank: 3, maker: { field: 1, upgrade: 2, fabrication: 2, invention: 1 } });
    const r = t.x({ kind: 'maker', actorId: 'solo', specialty: 'fabrication', skill: 'Weaponstech', price: 'premium', item: 'a silenced pistol' }, P1, scriptedDice({ d10: [5] }));
    expect(r.ok).toBe(true);
    const e = t.log.at(-1)!.events[0]!;
    expect(e.type === 'extraResolved' && e.success).toBe(true); // TECH 7 + Weaponstech 5 + Fabrication 2 + 5 = 19 > DV 17
  });

  it('setRoleExtras validates and recomputes mods', () => {
    const t = table();
    withRole(t, { id: 'nomad', rank: 3 });
    expect(t.x({ kind: 'setRoleExtras', actorId: 'solo', maker: { field: 1, upgrade: 0, fabrication: 0, invention: 0 } }, GM)).toMatchObject({ ok: false, message: expect.stringMatching(/Only Techs/) });
    expect(t.x({ kind: 'setRoleExtras', actorId: 'solo', moto: { vehicles: ['Roadbike'], upgrades: [] } }, GM).ok).toBe(true);
  });
});

describe('hostile payloads', () => {
  it('rejects junk without throwing', () => {
    const t = table();
    const bad: unknown[] = [
      null, 'grab', { kind: 'nope' }, { kind: 'grab' }, { kind: 'grab', actorId: 'solo', targetId: 'thug', choice: 'hug' },
      { kind: 'grab', actorId: 'x'.repeat(500), targetId: 'thug', choice: 'grapple' }, { kind: 'publish', actorId: 'solo', dv: 'abc', evidence: 1 },
      { kind: 'setReputation', actorId: 'solo', value: 11 }, { kind: 'setReputation', actorId: 'solo', value: 2.5 },
      { kind: 'specialMove', actorId: 'solo', moveId: { $ne: 1 } }, { kind: 'facedownChoice', facedownId: 'nope', choice: 'fight' },
      { kind: 'maker', actorId: 'solo', specialty: 'upgrade', skill: 'rm -rf', price: 'cheap', item: 'x' },
      { kind: 'setRoleExtras', actorId: 'solo', team: [{ name: '', kind: 'driver', loyalty: 1 }] },
    ];
    for (const op of bad) {
      const r = t.send({ type: 'extra', op } as unknown as Intent, GM);
      expect(r.ok).toBe(false);
    }
  });
});

describe('fog', () => {
  it('players never see grapples or lines involving unknown characters', () => {
    const t = table();
    // Wall off "far": put a wall between solo and far by GM-placing far behind... simpler: a map where far is unseen.
    const walled: TacticalMap = { ...MAP, cells: '.....#..' + '.....#..' + '.....#..', tokens: { solo: { x: 1, y: 1 }, thug: { x: 6, y: 0 }, far: { x: 6, y: 1 } }, spotted: [] };
    t.send({ type: 'setMap', map: walled }, GM);
    t.x({ kind: 'grab', actorId: 'thug', targetId: 'far', choice: 'grapple' }, GM, scriptedDice({ d10: [9, 2] }));
    expect(t.state.extras!.grapples).toHaveLength(1);
    expect(projectState(t.state, P1).extras!.grapples).toEqual([]);
    expect(projectEntry(t.log.at(-1)!, P1, t.state).events).toEqual([]);
    expect(projectState(t.state, P2).extras!.hits).toEqual([]);
  });
});
