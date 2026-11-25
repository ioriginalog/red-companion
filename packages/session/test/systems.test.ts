import { describe, expect, it } from 'vitest';
import { applySystems, maxHP, scriptedDice, type Combatant, type Dice, type Stats, type Weapon } from '@cprc/rules-core';
import {
  applyEntry, emptySession, handleIntent, projectEntry, projectState,
  type Actor, type Allegiance, type Intent, type LogEntry, type SessionState, type TacticalMap, type Viewer,
} from '../src/index.js';

const BASE: Stats = { INT: 6, REF: 6, DEX: 6, TECH: 6, COOL: 6, WILL: 6, LUCK: 6, MOVE: 6, BODY: 6, EMP: 6 };
const W = (id: string, type: Weapon['type'], capacity?: number): Weapon => (capacity ? { id, name: id, type, ammo: { loaded: capacity, capacity } } : { id, name: id, type });
function actor(id: string, side: 'pc' | 'npc', controller: string, stats: Partial<Stats> = {}, extra: Partial<Combatant> = {}, allegiance?: Allegiance): Actor {
  const s = { ...BASE, ...stats };
  const max = maxHP(s.BODY, s.WILL);
  const combatant: Combatant = applySystems({
    id, name: id, side, stats: s,
    skills: { Handgun: 6, 'Heavy Weapons': 6, 'Shoulder Arms': 6, Evasion: 4, Paramedic: 6, 'First Aid': 4, Brawling: 4 },
    hp: { max, current: max }, armor: [], criticalInjuries: [], deathSave: { accumulatedPenalty: 0 },
    conditions: { prone: false, unconscious: false, dead: false, stabilized: false }, ...extra,
  });
  return {
    id, controller, combatant, ...(allegiance ? { allegiance } : {}),
    weapons: [W('pistol', 'heavyPistol', 8), W('gl', 'grenadeLauncher', 2), W('ar', 'assaultRifle', 25), W('knife', 'lightMelee')],
  };
}
const GM: Viewer = { role: 'gm' };
const P1: Viewer = { role: 'player', playerId: 'p1' };
const P2: Viewer = { role: 'player', playerId: 'p2' };
const TWOS = (n = 40) => Array<number>(n).fill(2);

//            0123456789AB
const ROWS = ['............',
              '............',
              '............',
              '......c#....',
              '............',
              '............',
              '............'];
const MAP: TacticalMap = {
  id: 'yard', name: 'Yard', width: 12, height: 7, cells: ROWS.join(''), cellPx: 64, sightRange: 30,
  tokens: { solo: { x: 1, y: 3 }, doc: { x: 1, y: 5 }, ganger: { x: 5, y: 3 }, thug: { x: 8, y: 3 } }, watches: {}, spotted: [],
};

function table() {
  let state: SessionState = emptySession('s1');
  const log: LogEntry[] = [];
  let n = 0;
  const ctx = (dice: Dice) => ({ dice, now: () => '2077-01-01T00:00:00Z', newId: () => `id${++n}` });
  return {
    get state() { return state; },
    send(intent: Intent, by: Viewer, dice: Dice = scriptedDice({})) {
      const r = handleIntent(state, intent, by, ctx(dice));
      if (r.ok) { state = applyEntry(state, r.entry); log.push(r.entry); }
      return r;
    },
    last: () => log.at(-1)!,
  };
}
const ev = (t: ReturnType<typeof table>, type: string) => t.last().events.filter((e) => e.type === type);

function setup(opts: { solo?: Partial<Combatant>; soloStats?: Partial<Stats>; encounter?: boolean } = {}) {
  const t = table();
  t.send({ type: 'addActor', actor: actor('solo', 'pc', 'p1', { REF: 8, ...opts.soloStats }, opts.solo) }, GM);
  t.send({ type: 'addActor', actor: actor('doc', 'pc', 'p2', { TECH: 7 }) }, GM);
  t.send({ type: 'addActor', actor: actor('ganger', 'npc', 'gm', { REF: 5 }) }, GM);
  t.send({ type: 'addActor', actor: actor('thug', 'npc', 'gm', { REF: 5 }) }, GM);
  expect(t.send({ type: 'setMap', map: MAP }, GM).ok).toBe(true);
  if (opts.encounter !== false) {
    t.send({ type: 'startEncounter', participants: [{ actorId: 'solo' }, { actorId: 'ganger' }, { actorId: 'doc' }] }, GM, scriptedDice({ d10: [9, 3, 1] }));
    expect(t.state.encounter.order[0]).toBe('solo');
  }
  return t;
}

describe('cover with HP', () => {
  it('a blast destroys weak cover and hits whoever was behind it', () => {
    const t = setup();
    t.send({ type: 'setCover', at: { x: 6, y: 3 }, material: 'thinWood' }, GM);
    // Aim at (6, 1): the blast reaches the crate at (6, 3); the ganger at (5, 3) is caught in the open.
    expect(t.send({ type: 'areaAttack', attackerId: 'solo', weaponId: 'gl', kind: 'launcher', at: { x: 6, y: 1 } }, P1, scriptedDice({ d10: [9], d6: TWOS() })).ok).toBe(true);
    const cov = ev(t, 'coverDamaged');
    expect(cov).toContainEqual(expect.objectContaining({ at: { x: 6, y: 3 }, destroyed: true }));
    expect(t.state.map!.cells[3 * 12 + 6]).toBe('.');
  });
  it('cover between the blast and a target protects only if it survives', () => {
    const t = setup();
    t.send({ type: 'placeToken', actorId: 'ganger', at: { x: 6, y: 4 } }, GM);
    t.send({ type: 'setCover', at: { x: 6, y: 3 }, material: 'thickSteel' }, GM);
    // Center (6, 2): the crate at (6, 3) is straight between the center and the ganger at (6, 4).
    t.send({ type: 'areaAttack', attackerId: 'solo', weaponId: 'gl', kind: 'launcher', at: { x: 6, y: 2 } }, P1, scriptedDice({ d10: [9], d6: TWOS() }));
    expect(t.state.actors.ganger!.combatant.hp.current).toBe(t.state.actors.ganger!.combatant.hp.max);
    expect(t.state.map!.cover!['6,3']!.hp).toBe(38);
  });
  it('strong cover survives and protects; walls always shield', () => {
    const t = setup();
    t.send({ type: 'setCover', at: { x: 6, y: 3 }, material: 'thickSteel' }, GM);
    t.send({ type: 'placeToken', actorId: 'thug', at: { x: 7, y: 4 } }, GM);
    // Center (4, 3): ganger at (5, 3) in the open; nobody behind the steel.
    t.send({ type: 'areaAttack', attackerId: 'solo', weaponId: 'gl', kind: 'launcher', at: { x: 4, y: 3 } }, P1, scriptedDice({ d10: [9], d6: TWOS() }));
    expect(t.state.map!.cover!['6,3']).toEqual({ material: 'thickSteel', hp: 38 });
    expect(t.state.actors.ganger!.combatant.hp.current).toBeLessThan(t.state.actors.ganger!.combatant.hp.max);
  });
  it('lets a blast target a cover square, but not a wall', () => {
    const t = setup();
    expect(t.send({ type: 'areaAttack', attackerId: 'solo', weaponId: 'gl', kind: 'launcher', at: { x: 6, y: 3 } }, P1, scriptedDice({ d10: [9], d6: TWOS() })).ok).toBe(true);
    const t2 = setup();
    expect(t2.send({ type: 'areaAttack', attackerId: 'solo', weaponId: 'gl', kind: 'launcher', at: { x: 7, y: 3 } }, P1)).toMatchObject({ ok: false, code: 'INVALID' });
  });
  it('shoots cover: ranged vs the range DV, damage to its HP', () => {
    const t = setup();
    t.send({ type: 'setCover', at: { x: 6, y: 3 }, material: 'thinWood' }, GM);
    t.send({ type: 'placeToken', actorId: 'ganger', at: { x: 5, y: 5 } }, GM);
    // REF 8 + Handgun 6 + 5 = 19 vs DV 15 (10 m); 3d6 = 6 ≥ 5 HP.
    expect(t.send({ type: 'attackCover', attackerId: 'solo', weaponId: 'pistol', at: { x: 6, y: 3 } }, P1, scriptedDice({ d10: [5], d6: TWOS() })).ok).toBe(true);
    expect(ev(t, 'coverDamaged')[0]).toMatchObject({ destroyed: true, hpBefore: 5 });
    expect(t.state.actors.solo!.weapons.find((w) => w.id === 'pistol')!.ammo!.loaded).toBe(7);
    expect(t.send({ type: 'attackCover', attackerId: 'solo', weaponId: 'pistol', at: { x: 2, y: 2 } }, P1)).toMatchObject({ ok: false, code: 'INVALID' });
    expect(t.send({ type: 'attackCover', attackerId: 'solo', weaponId: 'knife', at: { x: 6, y: 3 } }, P1)).toMatchObject({ ok: false });
  });
  it('validates setCover', () => {
    const t = setup();
    expect(t.send({ type: 'setCover', at: { x: 6, y: 3 }, material: 'thinWood' }, P1)).toMatchObject({ code: 'FORBIDDEN' });
    expect(t.send({ type: 'setCover', at: { x: 0, y: 0 }, material: 'thinWood' }, GM)).toMatchObject({ code: 'INVALID' });
    expect(t.send({ type: 'setCover', at: { x: 99, y: 0 }, material: 'thinWood' }, GM)).toMatchObject({ code: 'INVALID' });
    expect(t.send({ type: 'setCover', at: { x: 6, y: 3 }, material: 'adamantium' as never }, GM)).toMatchObject({ code: 'INVALID' });
  });
});

describe('area-dodge decisions', () => {
  it('waits for each eligible defender; players decide their own; others are hidden from players', () => {
    const t = setup();
    t.send({ type: 'replaceActor', actor: actor('doc', 'pc', 'p2', { REF: 8, DEX: 8, TECH: 7 }) }, GM);
    t.send({ type: 'replaceActor', actor: actor('ganger', 'npc', 'gm', { REF: 9 }) }, GM);
    t.send({ type: 'placeToken', actorId: 'doc', at: { x: 4, y: 4 } }, GM);
    t.send({ type: 'areaAttack', attackerId: 'solo', weaponId: 'gl', kind: 'launcher', at: { x: 4, y: 3 } }, P1, scriptedDice({ d10: [9] }));
    const p = t.state.pending!;
    expect(p).toMatchObject({ kind: 'awaitingAreaDodge', decisions: { doc: null, ganger: null } });
    // A third viewer sees doc (friendly) and ganger only if visible; here both are visible.
    expect(t.send({ type: 'respondAreaDodge', pendingId: p.id, actorId: 'doc', dodge: false }, P1)).toMatchObject({ code: 'FORBIDDEN' });
    expect(t.send({ type: 'respondAreaDodge', pendingId: p.id, actorId: 'doc', dodge: false }, P2).ok).toBe(true);
    expect(t.state.pending).toMatchObject({ decisions: { doc: false, ganger: null } });
    expect(t.send({ type: 'endTurn' }, P1)).toMatchObject({ code: 'PENDING' });
    expect(t.send({ type: 'resolveAreaDodges', pendingId: p.id }, P1)).toMatchObject({ code: 'FORBIDDEN' });
    expect(t.send({ type: 'resolveAreaDodges', pendingId: p.id }, GM, scriptedDice({ d10: [2], d6: TWOS() })).ok).toBe(true);
    expect(t.state.pending).toBeNull();
    expect(ev(t, 'checkRolled').map((e) => e.type === 'checkRolled' && e.combatantId)).toEqual(['ganger']);
  });
  it('strips unseen targets from the pending step for players', () => {
    const t = setup();
    t.send({ type: 'setMap', map: { ...MAP, sightRange: 2, tokens: { solo: { x: 1, y: 3 }, doc: { x: 1, y: 5 }, ganger: { x: 5, y: 3 }, thug: { x: 8, y: 3 } } } }, GM);
    t.send({ type: 'replaceActor', actor: actor('ganger', 'npc', 'gm', { REF: 9 }) }, GM);
    t.send({ type: 'areaAttack', attackerId: 'solo', weaponId: 'gl', kind: 'launcher', at: { x: 4, y: 3 } }, GM, scriptedDice({ d10: [9] }));
    expect(t.state.pending).toMatchObject({ decisions: { ganger: null } });
    expect(projectState(t.state, P1).pending).toMatchObject({ decisions: {}, targets: [] });
    expect(projectEntry(t.last(), P1, t.state).patch.pending).toMatchObject({ decisions: {} });
    expect(projectEntry(t.last(), P1, t.state).events.some((e) => e.type === 'areaDodgeRequested')).toBe(false);
  });
});

describe('ammunition and fire', () => {
  it('loading ammo is a reload (Action) and refuses grenade-only types', () => {
    const t = setup();
    expect(t.send({ type: 'setAmmoType', actorId: 'solo', weaponId: 'pistol', ammoType: 'smoke' }, P1)).toMatchObject({ code: 'INVALID' });
    expect(t.send({ type: 'setAmmoType', actorId: 'solo', weaponId: 'pistol', ammoType: 'x' as never }, P1)).toMatchObject({ code: 'INVALID' });
    expect(t.send({ type: 'setAmmoType', actorId: 'solo', weaponId: 'pistol', ammoType: 'incendiary' }, P1).ok).toBe(true);
    expect(t.state.encounter.usage?.actionUsed).toBe(true);
    expect(t.send({ type: 'setAmmoType', actorId: 'ganger', weaponId: 'pistol', ammoType: 'rubber' }, P1)).toMatchObject({ code: 'FORBIDDEN' });
  });
  it('Incendiary sets On Fire; it burns at the start of their Turn; putting it out takes an Action', () => {
    const t = setup();
    t.send({ type: 'setAmmoType', actorId: 'solo', weaponId: 'pistol', ammoType: 'incendiary' }, GM);
    t.send({ type: 'rangedAttack', attackerId: 'solo', weaponId: 'pistol', defenderId: 'ganger', distance: 8 }, GM, scriptedDice({ d10: [8] }));
    t.send({ type: 'rollDamage', pendingId: t.state.pending!.id }, GM, scriptedDice({ d6: [5, 4, 3] }));
    expect(t.state.actors.ganger!.combatant.onFire).toBe(2);
    const hp = t.state.actors.ganger!.combatant.hp.current;
    t.send({ type: 'endTurn' }, GM);
    expect(ev(t, 'burning')[0]).toMatchObject({ targetId: 'ganger', damage: 2 });
    expect(t.state.actors.ganger!.combatant.hp.current).toBe(hp - 2);
    expect(t.send({ type: 'extinguish', actorId: 'ganger' }, GM).ok).toBe(true);
    expect(t.state.actors.ganger!.combatant.onFire).toBeUndefined();
    expect(t.send({ type: 'extinguish', actorId: 'ganger' }, GM)).toMatchObject({ code: 'INVALID' });
  });
});

describe('Solo Combat Awareness in play', () => {
  const soloRole = { role: { id: 'solo' as const, rank: 6, awareness: { spotWeakness: 3 } } };
  it('Spot Weakness adds damage on the first hit each Round only', () => {
    const t = setup({ solo: soloRole });
    t.send({ type: 'rangedAttack', attackerId: 'solo', weaponId: 'pistol', defenderId: 'ganger', distance: 8 }, P1, scriptedDice({ d10: [8] }));
    t.send({ type: 'rollDamage', pendingId: t.state.pending!.id }, P1, scriptedDice({ d6: [2, 2, 2] }));
    expect(ev(t, 'spotWeakness')).toHaveLength(1);
    expect(t.last().events.find((e) => e.type === 'damageApplied')).toMatchObject({ rawDamage: 9 });
    t.send({ type: 'rangedAttack', attackerId: 'solo', weaponId: 'pistol', defenderId: 'ganger', distance: 8 }, P1, scriptedDice({ d10: [8] }));
    t.send({ type: 'rollDamage', pendingId: t.state.pending!.id }, P1, scriptedDice({ d6: [2, 2, 2] }));
    expect(ev(t, 'spotWeakness')).toHaveLength(0);
  });
  it('re-allocating: free out of combat, an Action in combat, validated', () => {
    const t = setup({ solo: soloRole, encounter: false });
    expect(t.send({ type: 'setAwareness', actorId: 'solo', allocation: { precisionAttack: 3, initiativeReaction: 3 } }, P1).ok).toBe(true);
    expect(t.state.actors.solo!.combatant.mods).toMatchObject({ attack: 1, initiative: 3 });
    expect(t.send({ type: 'setAwareness', actorId: 'solo', allocation: { precisionAttack: 9 } }, P1)).toMatchObject({ code: 'INVALID' });
    expect(t.send({ type: 'setAwareness', actorId: 'doc', allocation: {} }, P2)).toMatchObject({ code: 'INVALID' });
    expect(t.send({ type: 'setAwareness', actorId: 'solo', allocation: {} }, P2)).toMatchObject({ code: 'FORBIDDEN' });
    const c = setup({ solo: soloRole });
    expect(c.send({ type: 'setAwareness', actorId: 'solo', allocation: { damageDeflection: 2 } }, P1).ok).toBe(true);
    expect(c.send({ type: 'setAwareness', actorId: 'solo', allocation: { damageDeflection: 4 } }, P1)).toMatchObject({ code: 'ACTION_USED' });
  });
});

describe('cyberware and Humanity', () => {
  const item = { id: 'plugs', name: 'Interface Plugs', humanityLoss: 7, effects: [{ kind: 'interfacePlugs' as const }] };
  it('installs (GM only), lowers Humanity and EMP, and removal restores half', () => {
    const t = setup({ solo: { humanity: { current: 60, max: 60 } } });
    expect(t.send({ type: 'installCyberware', actorId: 'solo', item }, P1)).toMatchObject({ code: 'FORBIDDEN' });
    expect(t.send({ type: 'installCyberware', actorId: 'solo', item }, GM).ok).toBe(true);
    expect(t.state.actors.solo!.combatant.humanity!.current).toBe(53);
    expect(t.state.actors.solo!.combatant.stats.EMP).toBe(5);
    expect(t.state.actors.solo!.combatant.mods?.interfacePlugs).toBe(true);
    expect(t.send({ type: 'installCyberware', actorId: 'solo', item }, GM)).toMatchObject({ code: 'INVALID' });
    expect(t.send({ type: 'removeCyberware', actorId: 'solo', itemId: 'plugs' }, GM).ok).toBe(true);
    expect(t.state.actors.solo!.combatant.humanity!.current).toBe(56);
  });
  it('rolls Humanity Loss when asked and flags cyberpsychosis at 0', () => {
    const t = setup({ solo: { humanity: { current: 8, max: 60 } } });
    t.send({ type: 'installCyberware', actorId: 'solo', item: { ...item, humanityLoss: 0 }, rollLoss: { count: 2, bonus: 1 } }, GM, scriptedDice({ d6: [3, 4] }));
    expect(t.state.actors.solo!.combatant.humanity!.current).toBe(0);
    expect(ev(t, 'gmRulingRequired')[0]).toMatchObject({ visibility: 'gm' });
  });
  it('refuses hostile payloads', () => {
    const t = setup({ solo: { humanity: { current: 60, max: 60 } } });
    expect(t.send({ type: 'installCyberware', actorId: 'solo', item: { ...item, humanityLoss: '7' as never } }, GM)).toMatchObject({ code: 'INVALID' });
    expect(t.send({ type: 'installCyberware', actorId: 'solo', item: { ...item, effects: [{ kind: 'stat', stat: 'REF', value: 50 }] } }, GM)).toMatchObject({ code: 'INVALID' });
    expect(t.send({ type: 'installCyberware', actorId: 'solo', item, rollLoss: { count: 1e9, bonus: 0 } }, GM)).toMatchObject({ code: 'INVALID' });
    expect(t.send({ type: 'installCyberware', actorId: 'solo', item: null as never }, GM)).toMatchObject({ code: 'INVALID' });
  });
  it('therapy: Standard needs 40+, success recovers 2d6 up to max', () => {
    const t = setup({ solo: { humanity: { current: 35, max: 60 } } });
    expect(t.send({ type: 'therapy', actorId: 'solo', kind: 'standard', therapistBase: 12 }, GM)).toMatchObject({ code: 'INVALID' });
    expect(t.send({ type: 'therapy', actorId: 'solo', kind: 'extreme', therapistBase: 12 }, GM, scriptedDice({ d10: [8], d6: [6, 5] })).ok).toBe(true);
    expect(t.state.actors.solo!.combatant.humanity!.current).toBe(46);
    expect(t.send({ type: 'therapy', actorId: 'solo', kind: 'standard', therapistBase: 1e6 }, GM)).toMatchObject({ code: 'INVALID' });
  });
});

describe('treatment, rest and arm injuries', () => {
  const broken = { criticalInjuries: [{ injuryId: 'brokenArm', table: 'body' as const, quickFixed: false }] };
  it('a medic Quick-Fixes a Broken Arm; wrong skill or reach is refused', () => {
    const t = setup({ solo: broken });
    t.send({ type: 'endTurn' }, GM); t.send({ type: 'endTurn' }, GM); // doc's Turn
    expect(t.send({ type: 'treatInjury', medicId: 'doc', targetId: 'solo', injuryIndex: 0, kind: 'quickFix', skill: 'Paramedic' }, P2)).toMatchObject({ code: 'OUT_OF_REACH' });
    t.send({ type: 'placeToken', actorId: 'doc', at: { x: 1, y: 4 } }, GM);
    expect(t.send({ type: 'treatInjury', medicId: 'doc', targetId: 'solo', injuryIndex: 0, kind: 'quickFix', skill: 'First Aid' }, P2)).toMatchObject({ code: 'INVALID' });
    expect(t.send({ type: 'treatInjury', medicId: 'doc', targetId: 'solo', injuryIndex: 5, kind: 'quickFix', skill: 'Paramedic' }, P2)).toMatchObject({ code: 'INVALID' });
    expect(t.send({ type: 'treatInjury', medicId: 'doc', targetId: 'solo', injuryIndex: 0, kind: 'quickFix', skill: 'Paramedic' }, P2, scriptedDice({ d10: [5] })).ok).toBe(true);
    expect(t.state.actors.solo!.combatant.criticalInjuries[0]!.quickFixed).toBe(true);
  });
  it('a Broken Arm stops two-handed weapons until Quick-Fixed', () => {
    const t = setup({ solo: broken });
    expect(t.send({ type: 'rangedAttack', attackerId: 'solo', weaponId: 'ar', defenderId: 'ganger', distance: 8 }, P1)).toMatchObject({ code: 'INVALID' });
    expect(t.send({ type: 'areaAttack', attackerId: 'solo', weaponId: 'gl', kind: 'launcher', at: { x: 4, y: 3 } }, P1)).toMatchObject({ code: 'INVALID' });
    expect(t.send({ type: 'rangedAttack', attackerId: 'solo', weaponId: 'pistol', defenderId: 'ganger', distance: 8 }, P1, scriptedDice({ d10: [2] })).ok).toBe(true);
  });
  it('rest is GM-only, out of combat, and heals BODY per day', () => {
    const t = setup({ encounter: false });
    t.send({ type: 'adjustHp', actorId: 'solo', delta: -20 }, GM);
    expect(t.send({ type: 'rest', days: 1, care: 'home' }, P1)).toMatchObject({ code: 'FORBIDDEN' });
    expect(t.send({ type: 'rest', days: 1e9, care: 'home' }, GM)).toMatchObject({ code: 'INVALID' });
    expect(t.send({ type: 'rest', days: 1, care: 'spa' as never }, GM)).toMatchObject({ code: 'INVALID' });
    const before = t.state.actors.solo!.combatant.hp.current;
    expect(t.send({ type: 'rest', days: 2, care: 'home', actorIds: ['solo'] }, GM).ok).toBe(true);
    expect(t.state.actors.solo!.combatant.hp.current).toBe(before + 12);
    const c = setup();
    expect(c.send({ type: 'rest', days: 1, care: 'home' }, GM)).toMatchObject({ code: 'INVALID' });
  });
});
