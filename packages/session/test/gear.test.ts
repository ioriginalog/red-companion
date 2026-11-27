import { describe, expect, it } from 'vitest';
import { effectiveStat, maxHP, scriptedDice, type Combatant, type Dice, type DrugDef, type Stats } from '@cprc/rules-core';
import {
  applyEntry, emptySession, handleIntent, projectEntry, projectState, validateActor,
  type Actor, type ExtraOp, type GearOp, type Intent, type LogEntry, type SessionState, type TacticalMap, type Viewer,
} from '../src/index.js';

const BASE: Stats = { INT: 6, REF: 6, DEX: 6, TECH: 6, COOL: 6, WILL: 6, LUCK: 6, MOVE: 6, BODY: 6, EMP: 6 };
function actor(id: string, side: 'pc' | 'npc', controller: string, extra: Partial<Combatant> = {}, weapons?: Actor['weapons']): Actor {
  const max = maxHP(BASE.BODY, BASE.WILL);
  return {
    id, controller,
    weapons: weapons ?? [
      { id: 'pistol', name: 'Heavy Pistol', type: 'heavyPistol', ammo: { loaded: 8, capacity: 8 } },
      { id: 'rifle', name: 'Assault Rifle', type: 'assaultRifle', ammo: { loaded: 25, capacity: 25 } },
    ],
    combatant: {
      id, name: id, side, stats: BASE, skills: { Handgun: 4, 'Shoulder Arms': 4, Brawling: 6, Evasion: 2, 'Resist Torture/Drugs': 2 }, hp: { max, current: max }, armor: [],
      criticalInjuries: [], deathSave: { accumulatedPenalty: 0 }, conditions: { prone: false, unconscious: false, dead: false, stabilized: false }, ...extra,
    },
  };
}
const GM: Viewer = { role: 'gm' };
const P1: Viewer = { role: 'player', playerId: 'p1' };

const MAP: TacticalMap = {
  id: 'm', name: 'Street', width: 12, height: 4, cells: '............'.repeat(2) + '.......#....' + '............', cellPx: 64, sightRange: 30,
  tokens: { solo: { x: 1, y: 1 }, thug: { x: 2, y: 1 }, boss: { x: 5, y: 1 } }, watches: {}, spotted: ['thug', 'boss'],
};

/** What the solo carries: catalog shields and drugs are linked gear entries (granted by the GM). */
const SOLO_GEAR = [
  { name: 'Polymer Riot Slab', qty: 1, item: 'shield:riot-slab' },
  { name: 'Folding Ballistic Wing', qty: 1, item: 'shield:fold-shield' },
  { name: 'Glimmer', qty: 2, item: 'drug:glimmer' },
  { name: 'Nightjar', qty: 1, item: 'drug:nightjar' },
  { name: 'Rope', qty: 1 },
] as Combatant['gear'];

function table() {
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
    g(op: GearOp | Record<string, unknown>, by: Viewer, dice?: Dice) { return t.send({ type: 'gear', op: op as GearOp }, by, dice); },
    x(op: ExtraOp | Record<string, unknown>, by: Viewer, dice?: Dice) { return t.send({ type: 'extra', op: op as ExtraOp }, by, dice); },
  };
  t.send({ type: 'addActor', actor: actor('solo', 'pc', 'p1', { gear: SOLO_GEAR }) }, GM);
  t.send({ type: 'addActor', actor: actor('thug', 'npc', 'gm') }, GM);
  t.send({ type: 'addActor', actor: actor('boss', 'npc', 'gm') }, GM);
  t.send({ type: 'setMap', map: MAP }, GM);
  return t;
}
const c = (t: ReturnType<typeof table>, id: string) => t.state.actors[id]!.combatant;
function encounter(t: ReturnType<typeof table>) {
  t.send({ type: 'startEncounter', participants: [{ actorId: 'solo' }, { actorId: 'thug' }, { actorId: 'boss' }] }, GM, scriptedDice({ d10: [9, 2, 3] }));
  expect(t.state.encounter.order[0]).toBe('solo');
}

describe('shields', () => {
  it('equipping is an Action; raised, it takes the hit and its holder can’t dodge', () => {
    const t = table();
    encounter(t);
    expect(t.g({ op: 'equipShield', actorId: 'solo', templateId: 'riot-slab' }, P1).ok).toBe(true);
    expect(c(t, 'solo').shield).toEqual({ name: 'Polymer Riot Slab', hp: 12, maxHp: 12, raised: true });
    expect(t.state.encounter.usage!.actionUsed).toBe(true);
    // A two-handed weapon needs the shield hand.
    t.send({ type: 'endTurn' }, P1);
    // The thug shoots: no dodge prompt; 6+4+9 = 19 beats DV 13; 3d6 = 4+4+3 = 11 into the shield.
    const r = t.send({ type: 'rangedAttack', attackerId: 'thug', defenderId: 'solo', weaponId: 'pistol', distance: 2 }, GM, scriptedDice({ d10: [9] }));
    expect(r.ok).toBe(true);
    expect(t.state.pending?.kind).toBe('awaitingDamage');
    const hp = c(t, 'solo').hp.current;
    expect(t.send({ type: 'rollDamage', pendingId: (t.state.pending as { id: string }).id }, GM, scriptedDice({ d6: [4, 4, 3] })).ok).toBe(true);
    expect(c(t, 'solo').hp.current).toBe(hp);
    expect(c(t, 'solo').shield!.hp).toBe(1);
    const ev = t.log.at(-1)!.events.find((e) => e.type === 'gearAction');
    expect(ev).toMatchObject({ action: 'shieldHit', amount: 11, hpLeft: 1 });
  });

  it('a shield takes a hand: no two-handed weapons until it’s dropped (an Action)', () => {
    const t = table();
    t.g({ op: 'equipShield', actorId: 'solo', shield: { name: 'Trash Can Lid', hp: 5 } }, GM); // custom shields come from the GM
    expect(t.send({ type: 'rangedAttack', attackerId: 'solo', defenderId: 'thug', weaponId: 'rifle', distance: 2 }, P1)).toMatchObject({ ok: false, code: 'INVALID' });
    expect(t.g({ op: 'raiseShield', actorId: 'solo', raised: false }, P1).ok).toBe(true);
    expect(c(t, 'solo').shield!.raised).toBe(false);
    expect(t.g({ op: 'dropShield', actorId: 'solo' }, P1).ok).toBe(true);
    expect(c(t, 'solo').shield).toBeUndefined();
  });

  it('lowered, it doesn’t block, and the dodge is back', () => {
    const t = table();
    t.g({ op: 'equipShield', actorId: 'solo', templateId: 'fold-shield' }, P1);
    t.g({ op: 'raiseShield', actorId: 'solo', raised: false }, P1);
    // REF 6 < 8, so no dodge prompt anyway; but damage lands on the body.
    t.send({ type: 'rangedAttack', attackerId: 'thug', defenderId: 'solo', weaponId: 'pistol', distance: 2 }, GM, scriptedDice({ d10: [9] }));
    const hp = c(t, 'solo').hp.current;
    t.send({ type: 'rollDamage', pendingId: (t.state.pending as { id: string }).id }, GM, scriptedDice({ d6: [4, 4, 3] }));
    expect(c(t, 'solo').hp.current).toBe(hp - 11);
    expect(c(t, 'solo').shield!.hp).toBe(8);
  });
});

describe('human shields', () => {
  function held() {
    const t = table();
    t.send({ type: 'placeToken', actorId: 'thug', at: { x: 2, y: 1 } }, GM);
    // solo 6+6+5 = 17 vs thug 6+6+2 = 14: solo holds the thug.
    expect(t.x({ kind: 'grab', actorId: 'solo', targetId: 'thug', choice: 'grapple' }, P1, scriptedDice({ d10: [5, 2] })).ok).toBe(true);
    return t;
  }
  it('takes an Action and a grapple; ranged hits go to the person held', () => {
    const t = table();
    expect(t.g({ op: 'humanShield', actorId: 'solo' }, P1)).toMatchObject({ ok: false });
    const h = held();
    expect(h.g({ op: 'humanShield', actorId: 'solo' }, P1).ok).toBe(true);
    expect(h.state.extras!.grapples[0]!.humanShield).toBe(true);
    const before = { solo: c(h, 'solo').hp.current, thug: c(h, 'thug').hp.current };
    h.send({ type: 'rangedAttack', attackerId: 'boss', defenderId: 'solo', weaponId: 'pistol', distance: 8 }, GM, scriptedDice({ d10: [9] }));
    h.send({ type: 'rollDamage', pendingId: (h.state.pending as { id: string }).id }, GM, scriptedDice({ d6: [3, 3, 2] }));
    expect(c(h, 'solo').hp.current).toBe(before.solo);
    expect(c(h, 'thug').hp.current).toBe(before.thug - 8);
  });
  it('doesn’t block head shots or melee; the held can’t dodge; dead, it becomes a shield of BODY HP', () => {
    const h = held();
    h.g({ op: 'humanShield', actorId: 'solo' }, P1);
    h.send({ type: 'placeToken', actorId: 'boss', at: { x: 0, y: 1 } }, GM);
    const solo = c(h, 'solo').hp.current;
    // Melee goes around a human shield: 6+6+9 = 21 vs solo 6+2+2−2 = 8.
    expect(h.send({ type: 'meleeAttack', attackerId: 'boss', defenderId: 'solo', with: { kind: 'brawling' } }, GM, scriptedDice({ d10: [9, 2] })).ok).toBe(true);
    h.send({ type: 'rollDamage', pendingId: (h.state.pending as { id: string }).id }, GM, scriptedDice({ d6: [2, 2] }));
    expect(c(h, 'solo').hp.current).toBe(solo - 4);
    // The held thug can't dodge ranged attacks: a dodge request is ignored.
    const r = h.send({ type: 'rangedAttack', attackerId: 'boss', defenderId: 'thug', weaponId: 'pistol', distance: 2, defenderDodges: true }, GM, scriptedDice({ d10: [9] }));
    expect(r.ok && r.entry.events.find((e) => e.type === 'attackResolved')).toMatchObject({ defense: undefined });
    h.send({ type: 'cancelPending' }, GM);
    // A head shot isn't blocked by the human shield.
    const thug = c(h, 'thug').hp.current;
    h.send({ type: 'rangedAttack', attackerId: 'boss', defenderId: 'solo', weaponId: 'pistol', distance: 2, aimTarget: 'head' }, GM, scriptedDice({ d10: [9] }));
    if (h.state.pending?.kind === 'awaitingDamage') h.send({ type: 'rollDamage', pendingId: h.state.pending.id }, GM, scriptedDice({ d6: [1, 1, 1] }));
    expect(c(h, 'thug').hp.current).toBe(thug);
    // Dead, the thug is carried as a shield with HP = BODY (6).
    h.send({ type: 'setCondition', actorId: 'thug', condition: 'dead', value: true }, GM);
    expect(c(h, 'solo').shield).toMatchObject({ name: 'thug’s Body', hp: 6, maxHp: 6, body: true });
    expect(h.state.extras!.grapples).toEqual([]);
    {
      h.send({ type: 'rangedAttack', attackerId: 'boss', defenderId: 'solo', weaponId: 'pistol', distance: 2 }, GM, scriptedDice({ d10: [9] }));
      const before = c(h, 'solo').hp.current;
      h.send({ type: 'rollDamage', pendingId: (h.state.pending as { id: string }).id }, GM, scriptedDice({ d6: [1, 1, 2] }));
      expect(c(h, 'solo').shield).toMatchObject({ name: 'thug’s Body', hp: 2, maxHp: 6, body: true });
      expect(c(h, 'solo').hp.current).toBe(before);
      expect(h.state.extras!.grapples).toEqual([]);
    }
  });
});

describe('weapon quality', () => {
  it('Excellent adds +1 and Poor −1 to the attack; bows can’t be Excellent', () => {
    const t = table();
    const fine = actor('ace', 'pc', 'p1', {}, [{ id: 'p', name: 'Tuned Pistol', type: 'heavyPistol', quality: 'excellent', ammo: { loaded: 8, capacity: 8 } },
      { id: 'q', name: 'Junk Pistol', type: 'heavyPistol', quality: 'poor', ammo: { loaded: 8, capacity: 8 } }]);
    expect(t.send({ type: 'addActor', actor: fine }, GM).ok).toBe(true);
    t.send({ type: 'placeToken', actorId: 'ace', at: { x: 1, y: 2 } }, GM);
    const mods = (weaponId: string) => {
      const r = t.send({ type: 'rangedAttack', attackerId: 'ace', defenderId: 'thug', weaponId, distance: 2 }, P1, scriptedDice({ d10: [5] }));
      const e = r.ok ? r.entry.events.find((x) => x.type === 'attackResolved') : undefined;
      t.send({ type: 'cancelPending' }, GM);
      return e && e.type === 'attackResolved' ? e.attack.modifiers : [];
    };
    expect(mods('p')).toContainEqual({ label: 'Excellent Quality', value: 1 });
    expect(mods('q')).toContainEqual({ label: 'Poor Quality', value: -1 });
    const bow = actor('robin', 'pc', 'p1', {}, [{ id: 'b', name: 'Bow', type: 'bowsAndCrossbows', quality: 'excellent' }]);
    expect(t.send({ type: 'addActor', actor: bow }, GM)).toMatchObject({ ok: false, code: 'INVALID' });
    expect(t.send({ type: 'addActor', actor: actor('x', 'pc', 'p1', {}, [{ id: 'b', name: 'X', type: 'heavyPistol', quality: 'legendary' as never }]) }, GM)).toMatchObject({ ok: false });
  });
});

describe('drugs', () => {
  it('a dose is an Action and lifts a STAT; wearing off rolls WILL + Resist Torture/Drugs vs the DV', () => {
    const t = table();
    encounter(t);
    expect(t.g({ op: 'takeDrug', actorId: 'solo', drugId: 'glimmer' }, P1).ok).toBe(true);
    expect(t.state.encounter.usage!.actionUsed).toBe(true);
    expect(effectiveStat(c(t, 'solo'), 'REF')).toBe(7);
    expect(t.g({ op: 'drugWearsOff', actorId: 'solo', drugId: 'glimmer' }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    // 6 + 2 + 3 = 11 vs DV 13: hooked. Glimmer's secondary: REF −1, INT −1.
    expect(t.g({ op: 'drugWearsOff', actorId: 'solo', drugId: 'glimmer' }, GM, scriptedDice({ d10: [3] })).ok).toBe(true);
    expect(c(t, 'solo').drugs!.addictions.map((d) => d.id)).toEqual(['glimmer']);
    expect(effectiveStat(c(t, 'solo'), 'REF')).toBe(5);
    expect(effectiveStat(c(t, 'solo'), 'INT')).toBe(5);
    // The next dose replaces the craving with the high.
    t.send({ type: 'endTurn' }, GM); t.send({ type: 'endTurn' }, GM); t.send({ type: 'endTurn' }, GM);
    expect(t.g({ op: 'takeDrug', actorId: 'solo', drugId: 'glimmer' }, P1).ok).toBe(true);
    expect(effectiveStat(c(t, 'solo'), 'REF')).toBe(7);
    // A good roll on the way down doesn't cure an existing addiction; therapy does.
    t.g({ op: 'drugWearsOff', actorId: 'solo', drugId: 'glimmer' }, GM, scriptedDice({ d10: [9] }));
    expect(c(t, 'solo').drugs!.addictions).toHaveLength(1);
    expect(t.g({ op: 'cureAddiction', actorId: 'solo', drugId: 'glimmer' }, GM).ok).toBe(true);
    expect(effectiveStat(c(t, 'solo'), 'REF')).toBe(6);
  });

  it('dosing someone else needs them willing and adjacent; custom drugs are validated', () => {
    const t = table();
    t.send({ type: 'addActor', actor: actor('pal', 'pc', 'p2') }, GM);
    t.send({ type: 'placeToken', actorId: 'pal', at: { x: 9, y: 3 } }, GM);
    expect(t.g({ op: 'takeDrug', actorId: 'solo', targetId: 'pal', drugId: 'nightjar' }, P1)).toMatchObject({ ok: false, code: 'OUT_OF_REACH' });
    expect(t.g({ op: 'takeDrug', actorId: 'solo', targetId: 'thug', drugId: 'nightjar' }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    const custom: DrugDef = { id: 'homebrew', name: 'Homebrew', duration: '1 hour', addictionDv: 12, effect: { note: 'Ours.', stats: { COOL: 2 } }, secondary: { note: 'Ours.', stats: { COOL: -1 } } };
    expect(t.g({ op: 'takeDrug', actorId: 'solo', drug: custom }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(t.g({ op: 'takeDrug', actorId: 'solo', drug: custom }, GM).ok).toBe(true);
    expect(effectiveStat(c(t, 'solo'), 'COOL')).toBe(8);
    for (const drug of [{ ...custom, effect: { note: 'x', stats: { COOL: 99 } } }, { ...custom, id: '<script>' }, { ...custom, sneaky: 1 }, { ...custom, effect: { note: 'x', stats: { HP: 1 } } }] as unknown[]) {
      expect(t.g({ op: 'takeDrug', actorId: 'solo', drug } as Record<string, unknown>, P1)).toMatchObject({ ok: false, code: 'INVALID' });
    }
  });
});

describe('owned shields and drugs', () => {
  const linked = (t: ReturnType<typeof table>, item: string) => ((c(t, 'solo').gear ?? []) as { item?: string; qty: number }[]).filter((g) => g.item === item).reduce((n, g) => n + g.qty, 0);
  it('players equip only shields their character carries, and equipping takes it from the gear list', () => {
    const t = table();
    expect(t.g({ op: 'equipShield', actorId: 'solo', templateId: 'door-panel' }, P1)).toMatchObject({ ok: false, code: 'INVALID', message: 'solo isn’t carrying a Salvaged Car Door.' });
    expect(t.g({ op: 'equipShield', actorId: 'solo', shield: { name: 'Homemade', hp: 50 } }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(t.g({ op: 'equipShield', actorId: 'solo', templateId: 'riot-slab' }, P1).ok).toBe(true);
    expect(linked(t, 'shield:riot-slab')).toBe(0);
    expect(c(t, 'solo').gear!.some((g) => g.name === 'Polymer Riot Slab')).toBe(false);
    t.g({ op: 'dropShield', actorId: 'solo' }, P1);
    expect(t.g({ op: 'equipShield', actorId: 'solo', templateId: 'riot-slab' }, P1)).toMatchObject({ ok: false, code: 'INVALID' });
    // The GM referees: any shield, carried or not.
    expect(t.g({ op: 'equipShield', actorId: 'solo', templateId: 'door-panel' }, GM).ok).toBe(true);
  });
  it('players take only drugs they carry; each dose comes out of the giver’s gear', () => {
    const t = table();
    expect(t.g({ op: 'takeDrug', actorId: 'solo', drugId: 'brickwall' }, P1)).toMatchObject({ ok: false, code: 'INVALID', message: 'solo isn’t carrying any Brickwall.' });
    expect(t.g({ op: 'takeDrug', actorId: 'solo', drugId: 'glimmer' }, P1).ok).toBe(true);
    expect(linked(t, 'drug:glimmer')).toBe(1);
    t.send({ type: 'addActor', actor: actor('pal', 'pc', 'p2') }, GM);
    t.send({ type: 'placeToken', actorId: 'pal', at: { x: 1, y: 2 } }, GM);
    expect(t.g({ op: 'takeDrug', actorId: 'solo', targetId: 'pal', drugId: 'glimmer' }, P1).ok).toBe(true);
    expect(linked(t, 'drug:glimmer')).toBe(0);
    expect(t.state.actors.pal!.combatant.drugs!.active.map((d) => d.id)).toEqual(['glimmer']);
    expect(t.g({ op: 'takeDrug', actorId: 'solo', drugId: 'glimmer' }, P1)).toMatchObject({ ok: false, code: 'INVALID' });
  });
  it('a player’s sheet edit can drop catalog gear but never add it or raise its count', () => {
    const t = table();
    const gear = c(t, 'solo').gear!;
    const edit = (g: unknown[]) => t.send({ type: 'editOwnSheet', actorId: 'solo', gear: g as Combatant['gear'] }, P1);
    expect(edit([...gear, { name: 'Brickwall', qty: 5, item: 'drug:brickwall' }])).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(edit(gear.map((g) => (g.name === 'Glimmer' ? { ...g, qty: 9 } : g)))).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(edit([...gear, { name: 'Glimmer', qty: 1, item: 'drug:glimmer' }])).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(edit([...gear, { name: 'Odd', qty: 1, item: 'gun:x' }])).toMatchObject({ ok: false, code: 'INVALID' });
    // Renaming, notes and using some up are fine; links survive the edit.
    expect(edit(gear.map((g) => (g.name === 'Glimmer' ? { ...g, name: 'Glim', qty: 1, notes: 'Last ones' } : g))).ok).toBe(true);
    expect(linked(t, 'drug:glimmer')).toBe(1);
    expect(t.g({ op: 'takeDrug', actorId: 'solo', drugId: 'glimmer' }, P1).ok).toBe(true);
    // The GM hands out more.
    expect(t.send({ type: 'editOwnSheet', actorId: 'solo', gear: [...c(t, 'solo').gear!, { name: 'Brickwall', qty: 2, item: 'drug:brickwall' } as never] }, GM).ok).toBe(true);
    expect(t.g({ op: 'takeDrug', actorId: 'solo', drugId: 'brickwall' }, P1).ok).toBe(true);
  });
});

describe('vehicles', () => {
  function withCar(sp?: number) {
    const t = table();
    expect(t.g({ op: 'spawnVehicle', templateId: 'hatch', id: 'car', at: { x: 1, y: 2 }, allegiance: 'party', controller: 'p1', ...(sp ? { sp } : {}) }, GM).ok).toBe(true);
    expect(t.g({ op: 'spawnVehicle', templateId: 'van', id: 'van', at: { x: 10, y: 3 }, allegiance: 'hostile' }, GM).ok).toBe(true);
    return t;
  }
  it('only the GM spawns them; vehicles have SDP, seats and MOVE and stay out of initiative', () => {
    const t = table();
    expect(t.g({ op: 'spawnVehicle', templateId: 'hatch', id: 'car' }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    const w = withCar();
    expect(c(w, 'car').hp).toEqual({ max: 45, current: 45 });
    expect(c(w, 'car').vehicle).toMatchObject({ seats: 4, move: 18, passengers: [] });
    expect(w.send({ type: 'startEncounter', participants: [{ actorId: 'solo' }, { actorId: 'car' }] }, GM)).toMatchObject({ ok: false, code: 'INVALID' });
    expect(w.send({ type: 'moveToken', actorId: 'car', to: { x: 3, y: 2 } }, P1)).toMatchObject({ ok: false });
  });

  it('board (Move Action), drive the vehicle’s MOVE, get out next to it', () => {
    const t = withCar();
    encounter(t);
    expect(t.g({ op: 'board', actorId: 'solo', vehicleId: 'car', drive: true }, P1).ok).toBe(true);
    expect(t.state.map!.tokens.solo).toBeUndefined();
    expect(c(t, 'car').vehicle).toMatchObject({ passengers: ['solo'], driverId: 'solo' });
    expect(t.g({ op: 'drive', actorId: 'solo', to: { x: 9, y: 0 } }, P1)).toMatchObject({ ok: false, code: 'NO_MOVEMENT' }); // Move Action spent boarding
    t.send({ type: 'endTurn' }, P1); t.send({ type: 'endTurn' }, GM); t.send({ type: 'endTurn' }, GM);
    expect(t.g({ op: 'drive', actorId: 'solo', to: { x: 9, y: 0 } }, P1).ok).toBe(true);
    expect(t.state.map!.tokens.car).toEqual({ x: 9, y: 0 });
    t.send({ type: 'endTurn' }, P1); t.send({ type: 'endTurn' }, GM); t.send({ type: 'endTurn' }, GM);
    expect(t.g({ op: 'exit', actorId: 'solo' }, P1).ok).toBe(true);
    const at = t.state.map!.tokens.solo!;
    expect(Math.max(Math.abs(at.x - 9), Math.abs(at.y - 0))).toBe(1);
    expect(c(t, 'car').vehicle!.driverId).toBeNull();
  });

  it('attacks on vehicles: no dodge, plating SP first, a weak-spot Aimed Shot at −8 doubles what gets through', () => {
    const t = withCar(4);
    expect(t.send({ type: 'rangedAttack', attackerId: 'thug', defenderId: 'car', weaponId: 'pistol', distance: 2 }, GM)).toMatchObject({ ok: false, code: 'INVALID' });
    // thug at (2,1), car at (1,2): 6+4+9 = 19 vs DV 13. 3d6 = 5+5+4 = 14 − 4 SP = 10.
    expect(t.g({ op: 'attackVehicle', attackerId: 'thug', vehicleId: 'car', weaponId: 'pistol' }, GM, scriptedDice({ d10: [9], d6: [5, 5, 4] })).ok).toBe(true);
    expect(c(t, 'car').hp.current).toBe(35);
    // Aimed: 19 − 8 = 11 doesn't beat 13.
    t.g({ op: 'attackVehicle', attackerId: 'thug', vehicleId: 'car', weaponId: 'pistol', aimed: true }, GM, scriptedDice({ d10: [9] }));
    expect(c(t, 'car').hp.current).toBe(35);
    // Aimed with a crit roll: 10 + 3 = 13 → 6+4+13−8 = 15 beats 13; (6+6+6 − 4) × 2 = 28.
    t.g({ op: 'attackVehicle', attackerId: 'thug', vehicleId: 'car', weaponId: 'pistol', aimed: true }, GM, scriptedDice({ d10: [10, 3], d6: [6, 6, 6] }));
    expect(c(t, 'car').hp.current).toBe(7);
    t.g({ op: 'attackVehicle', attackerId: 'thug', vehicleId: 'car', weaponId: 'pistol' }, GM, scriptedDice({ d10: [9], d6: [6, 6, 6] }));
    expect(c(t, 'car').hp.current).toBe(0);
    expect(c(t, 'car').conditions.dead).toBe(true);
    expect(t.g({ op: 'board', actorId: 'solo', vehicleId: 'car', drive: true }, P1)).toMatchObject({ ok: false, code: 'INVALID' });
  });

  it('ramming is a GM prompt raised by the driver', () => {
    const t = withCar();
    t.g({ op: 'board', actorId: 'solo', vehicleId: 'car', drive: true }, P1);
    const r = t.g({ op: 'ram', vehicleId: 'car', targetId: 'thug' }, P1);
    expect(r.ok && r.entry.events.some((e) => e.type === 'gmRulingRequired')).toBe(true);
    expect(t.g({ op: 'ram', vehicleId: 'van', targetId: 'solo' }, P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('players never see an NPC vehicle’s SDP or passengers, an unseen vehicle at all, or NPC gear', () => {
    const t = withCar();
    t.g({ op: 'board', actorId: 'boss', vehicleId: 'van' }, GM);
    t.g({ op: 'equipShield', actorId: 'thug', templateId: 'door-panel' }, GM);
    t.g({ op: 'takeDrug', actorId: 'thug', drugId: 'brickwall' }, GM);
    const view = projectState(t.state, P1);
    // The van sits behind nothing, so it's spotted, but only its public face shows.
    const van = view.actors.van;
    expect(van).toBeDefined();
    if (van) {
      expect(van.combatant).toBeUndefined();
      expect(van.public.vehicle).toBe(true);
    }
    expect(view.actors.car!.combatant!.vehicle).toBeDefined(); // party vehicle: full sheet
    expect(view.actors.thug!.combatant).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('Brickwall');
    expect(JSON.stringify(view)).not.toContain('Salvaged Car Door');
    // Hide the van behind the wall: it drops out of the player view entirely.
    t.send({ type: 'setMap', map: { ...t.state.map!, spotted: ['thug', 'boss'], tokens: { ...t.state.map!.tokens, van: { x: 11, y: 2 } } } }, GM);
    const hidden = projectState(t.state, P1);
    expect(JSON.stringify(hidden.actors.van ?? null)).not.toContain('60');
    // The NPC shield hit narration carries no NPC numbers.
    t.send({ type: 'rangedAttack', attackerId: 'solo', defenderId: 'thug', weaponId: 'pistol', distance: 2 }, P1, scriptedDice({ d10: [9] }));
    const roll = t.send({ type: 'rollDamage', pendingId: (t.state.pending as { id: string }).id }, GM, scriptedDice({ d6: [1, 1, 1] }));
    expect(roll.ok).toBe(true);
    const projected = projectEntry(roll.ok ? roll.entry : (null as never), P1, t.state, undefined, t.state);
    const hit = projected.events.find((e) => e.type === 'gearAction');
    expect(hit).toBeDefined();
    expect(hit).not.toHaveProperty('hpLeft');
    expect(hit).not.toHaveProperty('amount');
  });
});

describe('hostile gear payloads', () => {
  it('rejects junk ops without touching state', () => {
    const t = table();
    const before = JSON.stringify(t.state);
    const junk: unknown[] = [
      null, 'x', [], { op: 'nope' }, { op: 'equipShield', actorId: 'solo' }, { op: 'equipShield', actorId: 'solo', templateId: 'riot-slab', shield: { name: 'a', hp: 1 } },
      { op: 'equipShield', actorId: 'solo', shield: { name: 'x', hp: 1e9 } }, { op: 'equipShield', actorId: 'solo', shield: { name: '', hp: 3 } },
      { op: 'equipShield', actorId: { $ne: 1 }, templateId: 'riot-slab' }, { op: 'raiseShield', actorId: 'solo', raised: 'yes' },
      { op: 'takeDrug', actorId: 'solo' }, { op: 'takeDrug', actorId: 'solo', drugId: 'glimmer', drug: {} }, { op: 'takeDrug', actorId: 'solo', drug: { id: 'x' } },
      { op: 'drugWearsOff', actorId: 'solo', drugId: '../etc' }, { op: 'spawnVehicle', templateId: 'hatch', id: 'a b' },
      { op: 'spawnVehicle', templateId: 'hatch', id: 'v', allegiance: 'evil' }, { op: 'spawnVehicle', templateId: 'hatch', id: 'v', sp: 999 },
      { op: 'spawnVehicle', templateId: 'hatch', id: 'v', at: { x: -1, y: 0 } }, { op: 'drive', actorId: 'solo', to: 'there' },
      { op: 'attackVehicle', attackerId: 'solo', vehicleId: 'car', weaponId: 'pistol', aimed: 1 }, { op: 'board', actorId: 'solo', vehicleId: 'thug' },
      { op: 'ram', vehicleId: 'solo', targetId: 'thug' }, { op: 'humanShield', actorId: 'nobody' },
    ];
    for (const op of junk) {
      const r = t.send({ type: 'gear', op } as unknown as Intent, GM);
      expect([JSON.stringify(op), r.ok]).toEqual([JSON.stringify(op), false]);
    }
    expect(JSON.stringify(t.state)).toBe(before);
  });

  it('actor validation rejects junk shields, drugs and vehicle data', () => {
    const base = actor('z', 'npc', 'gm');
    const bad: Partial<Combatant>[] = [
      { shield: { name: 'x', hp: 5, maxHp: 3, raised: true } }, { shield: 'big' as never }, { shield: { name: 'x', hp: 1, maxHp: 1, raised: true, evil: 1 } as never },
      { drugs: { active: [{ id: 'x' }], addictions: [] } as never }, { drugs: { active: Array(30).fill(null), addictions: [] } as never },
      { vehicle: { seats: 0, move: 5, passengers: [] } }, { vehicle: { seats: 2, move: 5, passengers: ['a', 'b', 'c'] } },
      { vehicle: { seats: 2, move: 5, passengers: ['a'], driverId: 'b' } }, { vehicle: { seats: 2, move: 5, passengers: [], hack: true } as never },
    ];
    for (const extra of bad) {
      expect(() => validateActor({ ...base, combatant: { ...base.combatant, ...extra } })).toThrow();
    }
    expect(() => validateActor({ ...base, combatant: { ...base.combatant, shield: { name: 'Lid', hp: 3, maxHp: 5, raised: false } } })).not.toThrow();
  });
});
