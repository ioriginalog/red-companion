/**
 * Exhaustive redaction: one fixture per CombatEvent type. `FIXTURES` is a
 * mapped type over the event union, so adding an event type without a
 * fixture fails `npm run typecheck`.
 *
 * Every fixture puts the sentinel 7777 in each number a player must not
 * learn about an NPC (HP, SP, stats, raw dice of NPC checks). The tests
 * project each event for a player and check that no sentinel, hidden id,
 * hidden name or hidden count survives.
 */
import { describe, expect, it } from 'vitest';
import { maxHP, scriptedDice, type CheckResult, type CombatEvent, type Combatant, type Stats } from '@cprc/rules-core';
import {
  emptySession, handleIntent, projectEntry, projectState,
  type Actor, type LogEntry, type Pending, type SessionState, type TacticalMap, type Viewer,
} from '../src/index.js';

const scriptedDiceForTests = () => scriptedDice({});

const S = 7777; // secret sentinel
const BASE: Stats = { INT: 6, REF: 6, DEX: 6, TECH: 6, COOL: 6, WILL: 6, LUCK: 6, MOVE: 6, BODY: 6, EMP: 6 };
function actor(id: string, name: string, side: 'pc' | 'npc', controller: string, allegiance: Actor['allegiance']): Actor {
  const max = maxHP(BASE.BODY, BASE.WILL);
  const combatant: Combatant = {
    id, name, side, stats: BASE, skills: { Handgun: 6 }, hp: { max, current: max },
    armor: [], criticalInjuries: [], deathSave: { accumulatedPenalty: 0 },
    conditions: { prone: false, unconscious: false, dead: false, stabilized: false },
  };
  return { id, controller, allegiance, weapons: [], combatant, notes: 'Shared note.', gmNotes: 'GM-ONLY-SECRET' };
}

const P1: Viewer = { role: 'player', playerId: 'p1' };
const GM: Viewer = { role: 'gm' };
const HIDDEN_ID = 'secret-sniper';
const HIDDEN_ID2 = 'secret-sniper-2';
const HIDDEN_NAME = 'Shadowblade';
const MAP: TacticalMap = {
  id: 'm', name: 'Yard', width: 12, height: 5, cells: '........#...'.repeat(5), cellPx: 64, sightRange: 30,
  tokens: { vex: { x: 0, y: 0 }, ganger: { x: 3, y: 0 }, [HIDDEN_ID]: { x: 11, y: 4 }, [HIDDEN_ID2]: { x: 10, y: 4 } },
  watches: {}, spotted: ['ganger'],
};

function world(): SessionState {
  const s = emptySession('s1');
  return {
    ...s,
    actors: {
      vex: actor('vex', 'Vex', 'pc', 'p1', 'party'),
      ganger: actor('ganger', 'Street Ganger', 'npc', 'gm', 'hostile'),
      [HIDDEN_ID]: actor(HIDDEN_ID, HIDDEN_NAME, 'npc', 'gm', 'hostile'),
      [HIDDEN_ID2]: actor(HIDDEN_ID2, 'Nightglass', 'npc', 'gm', 'hostile'),
    },
    // A wall at x = 8 hides the two snipers from the party.
    map: { ...MAP, lighting: {} },
    encounter: { active: true, round: 1, order: ['vex', 'ganger', HIDDEN_ID, HIDDEN_ID2], turnIndex: 0, deathSaveRequiredFor: null },
  };
}

const check = (secret: boolean): CheckResult => ({
  base: secret ? S : 12, baseBreakdown: [{ label: 'REF', value: secret ? S : 6 }], modifiers: [],
  roll: { natural: secret ? S : 5, kind: 'normal', value: secret ? S : 5 }, total: 19,
});

type Fixture<K extends CombatEvent['type']> = (subject: string, other: string) => Extract<CombatEvent, { type: K }>;
const P = 'public' as const;
const c0 = { x: 1, y: 1 };

/** `subject` is the NPC under test; `other` is the player's PC. */
const FIXTURES: { [K in CombatEvent['type']]: Fixture<K> } = {
  initiativeRolled: (s, o) => ({ type: 'initiativeRolled', visibility: P, entries: [
    { combatantId: o, base: 6, roll: 4, total: 10, tiebreaks: [] },
    { combatantId: s, base: S, roll: S, total: S, tiebreaks: [S] },
    { combatantId: HIDDEN_ID2, base: S, roll: S, total: S, tiebreaks: [] },
  ] }),
  attackResolved: (s, o) => ({ type: 'attackResolved', visibility: P, attackerId: s, defenderId: o, attack: check(true), defenseKind: 'rangeDV', defenseValue: 15, hit: true, margin: 4 }),
  ammoSpent: (s) => ({ type: 'ammoSpent', visibility: P, combatantId: s, weaponId: 'w', rounds: S }),
  damageRolled: () => ({ type: 'damageRolled', visibility: P, dice: [3, 4], multiplier: 1, total: 7, critTriggered: false }),
  damageApplied: (s) => ({ type: 'damageApplied', visibility: P, targetId: s, location: 'body', rawDamage: 7, spBefore: S, spCounted: S, through: S, locationMultiplier: 1, hpBefore: S, hpAfter: S }),
  armorAblated: (s) => ({ type: 'armorAblated', visibility: P, targetId: s, location: 'body', pieces: [{ id: 'jack', from: S, to: S }] }),
  criticalInjury: (s) => ({ type: 'criticalInjury', visibility: P, targetId: s, injuryId: 'brokenArm', table: 'body', cause: 'damageDice', rolls: [[6, 6]], bonusDamage: 5, hpAfter: S }),
  critTableExhausted: (s) => ({ type: 'critTableExhausted', visibility: P, targetId: s, table: 'body', cause: 'damageDice' }),
  heldItemDropped: (s) => ({ type: 'heldItemDropped', visibility: P, targetId: s, reason: 'aimedShot' }),
  woundStateChanged: (s) => ({ type: 'woundStateChanged', visibility: P, targetId: s, from: 'unhurt', to: 'lightly' }),
  deathSavePenaltyChanged: (s) => ({ type: 'deathSavePenaltyChanged', visibility: P, targetId: s, from: S, to: S, reason: 'deathSaveRolled' }),
  deathSaveRolled: (s) => ({ type: 'deathSaveRolled', visibility: P, targetId: s, natural: 3, penalty: S, total: S, body: S, success: true }),
  died: (s) => ({ type: 'died', visibility: P, targetId: s }),
  stabilizationAttempted: (s, o) => ({ type: 'stabilizationAttempted', visibility: P, medicId: s, targetId: o, check: check(true), dv: 13, success: true }),
  stabilized: (s) => ({ type: 'stabilized', visibility: P, targetId: s, hpAfter: S, unconscious: true }),
  suppressiveFireResolved: (s, o) => ({ type: 'suppressiveFireResolved', visibility: P, attackerId: s, attack: check(true), results: [
    { targetId: o, resist: check(false), mustSeekCover: true },
    { targetId: HIDDEN_ID2, resist: check(true), mustSeekCover: false },
  ] }),
  gmRulingRequired: () => ({ type: 'gmRulingRequired', visibility: P, reason: `${HIDDEN_NAME} is waiting in the rafters.` }),
  tokenMoved: (s) => ({ type: 'tokenMoved', visibility: P, combatantId: s, path: [c0], cost: 1, ran: false }),
  watchSet: (s) => ({ type: 'watchSet', visibility: P, combatantId: s, facing: 90, arc: 90 }),
  watchTriggered: (s, o) => ({ type: 'watchTriggered', visibility: P, combatantId: s, targetId: o, at: c0 }),
  checkRolled: (s) => ({ type: 'checkRolled', visibility: P, by: 'gm', combatantId: s, label: `${HIDDEN_NAME}’s Stealth`, check: check(true), dv: 15, success: true }),
  diceRolled: () => ({ type: 'diceRolled', visibility: P, by: 'gm', label: 'Loot', dice: [3], sides: 6, bonus: 0, total: 3 }),
  chatMessage: (s) => ({ type: 'chatMessage', visibility: P, by: 'gm', asCombatantId: s, text: `${HIDDEN_NAME} says hello.` }),
  hpAdjusted: (s) => ({ type: 'hpAdjusted', visibility: P, targetId: s, delta: S, hpAfter: S, reason: 'GM fix' }),
  conditionSet: (s) => ({ type: 'conditionSet', visibility: P, targetId: s, condition: 'prone', value: true }),
  sceneChanged: () => ({ type: 'sceneChanged', visibility: P, mapId: 'm2', name: 'Rooftop' }),
  handoutShared: () => ({ type: 'handoutShared', visibility: P, id: 'h1', title: 'Map' }),
  gearAction: (s, o) => ({ type: 'gearAction', visibility: P, combatantId: s, targetId: o, action: 'shield', text: `${HIDDEN_NAME}’s shield takes the hit.`, check: check(true), dv: S, success: true, amount: S, hpLeft: S }),
  netAction: (s) => ({ type: 'netAction', visibility: P, combatantId: s, action: 'zap', text: `${HIDDEN_NAME} zaps the ICE.`, check: check(true), vs: check(true), dv: 8, success: true, dice: [S], amount: S }),
  extraResolved: (s, o) => ({ type: 'extraResolved', visibility: P, combatantId: s, targetId: o, move: 'grab', text: `${HIDDEN_NAME} grabs Vex.`, success: true, rolls: [{ label: 'Grab', total: 14, natural: S }] }),
  areaResolved: (s, o) => ({ type: 'areaResolved', visibility: P, attackerId: s, kind: 'launcher', at: c0, targetIds: [o, HIDDEN_ID2, s] }),
  explosiveMissed: (s) => ({ type: 'explosiveMissed', visibility: P, attackerId: s, at: c0 }),
  explosiveScattered: (s) => ({ type: 'explosiveScattered', visibility: P, attackerId: s, from: c0, to: { x: 2, y: 2 }, rolled: true }),
  noEffect: (s) => ({ type: 'noEffect', visibility: P, targetId: s }),
  turnDelayed: (s, o) => ({ type: 'turnDelayed', visibility: P, combatantId: o, after: s }),
  leftInitiative: (s) => ({ type: 'leftInitiative', visibility: P, combatantId: s }),
  injuryTreated: (s, o) => ({ type: 'injuryTreated', visibility: P, medicId: s, targetId: o, injuryId: 'brokenArm', kind: 'quickFix', skill: 'First Aid', check: check(true), dv: 13, outcome: 'quickFixed' }),
  humanityChanged: (s) => ({ type: 'humanityChanged', visibility: P, combatantId: s, from: S, to: S, empFrom: S, empTo: S, reason: 'gm' }),
  cyberwareInstalled: (s) => ({ type: 'cyberwareInstalled', visibility: P, combatantId: s, itemId: 'eye', name: 'Cybereye', humanityLoss: S, rolled: [S], lossMode: 'roll', maxFrom: S, maxTo: S }),
  cyberwareRemoved: (s) => ({ type: 'cyberwareRemoved', visibility: P, combatantId: s, itemId: 'eye', name: 'Cybereye', humanityRestored: S, maxFrom: S, maxTo: S }),
  therapyResolved: (s) => ({ type: 'therapyResolved', visibility: P, combatantId: s, kind: 'standard', check: check(true), dv: 15, success: true, recovered: S, rolled: [S] }),
  awarenessSet: (s) => ({ type: 'awarenessSet', visibility: P, combatantId: s, allocation: { precisionAttack: S } }),
  rested: (s) => ({ type: 'rested', visibility: P, targetId: s, days: 2, care: 'street', healed: S, hpAfter: S }),
  coverDamaged: (s) => ({ type: 'coverDamaged', visibility: P, at: c0, material: 'concrete', hpBefore: 20, hpAfter: 10, destroyed: false, byId: s }),
  burning: (s) => ({ type: 'burning', visibility: P, targetId: s, damage: 2, hpAfter: S }),
  ignited: (s) => ({ type: 'ignited', visibility: P, targetId: s, perTurn: 2 }),
  extinguished: (s) => ({ type: 'extinguished', visibility: P, targetId: s }),
  ammoLoaded: (s) => ({ type: 'ammoLoaded', visibility: P, combatantId: s, weaponId: 'w', ammoType: 'armorPiercing' }),
  smartAmmoRetry: (s, o) => ({ type: 'smartAmmoRetry', visibility: P, attackerId: s, defenderId: o, roll: { natural: S, kind: 'normal', value: S }, total: 19, dv: 15, hit: true, kind: 'smart' }),
  damageDeflected: (s) => ({ type: 'damageDeflected', visibility: P, targetId: s, amount: S }),
  spotWeakness: (s) => ({ type: 'spotWeakness', visibility: P, combatantId: s, bonus: S }),
  areaDodgeRequested: (s) => ({ type: 'areaDodgeRequested', visibility: P, combatantId: s, attackTotal: 18 }),
  injuryEffect: (s) => ({ type: 'injuryEffect', visibility: P, targetId: s, injuryId: 'brokenRibs', effect: 'rebleed', damage: 5 }),
  turnReminders: (s) => ({ type: 'turnReminders', visibility: P, combatantId: s, items: [{ key: 'prone', text: 'Prone: get up before moving.' }] }),
  speedwareChanged: (s) => ({ type: 'speedwareChanged', visibility: P, combatantId: s, state: 'expired' }),
  netThreat: (s, o) => ({ type: 'netThreat', visibility: 'gm', audience: ['gm'], combatantId: o, ice: [{ floorId: 'f1', index: 0, name: 'Tripwire' }], demon: { floorId: 'f1', name: 'Gatekeeper', netActions: S } }),
};

function entryOf(events: CombatEvent[], seq = 1): LogEntry {
  return { seq, id: `e${seq}`, at: '2077-01-01T00:00:00Z', by: 'gm', intent: { type: 'endTurn' }, events, patch: {} };
}

const ALL = Object.keys(FIXTURES) as CombatEvent['type'][];
const fixture = (t: CombatEvent['type'], s: string, o: string) => (FIXTURES[t] as Fixture<typeof t>)(s, o);

describe('exhaustive event redaction for players', () => {
  const state = world();

  it.each(ALL)('%s about a known NPC carries no NPC HP, SP or stats', (t) => {
    const out = projectEntry(entryOf([fixture(t, 'ganger', 'vex')]), P1, state, undefined, state);
    const json = JSON.stringify(out.events);
    expect(json).not.toContain(String(S));
    expect(json).not.toContain(HIDDEN_ID);
    expect(json).not.toContain(HIDDEN_ID2);
    expect(json).not.toContain('Nightglass');
  });

  it.each(ALL)('%s about an unseen NPC leaks no id, name, count or numbers', (t) => {
    const out = projectEntry(entryOf([fixture(t, HIDDEN_ID, 'vex')]), P1, state, undefined, state);
    const json = JSON.stringify(out);
    expect(json).not.toContain(HIDDEN_ID);
    expect(json).not.toContain(HIDDEN_NAME);
    expect(json).not.toContain('Nightglass');
    expect(json).not.toContain(String(S));
    // At most one opaque `hidden` per actor-id field; lists never carry `hidden` (a count).
    for (const e of out.events) {
      for (const v of Object.values(e)) {
        if (Array.isArray(v)) expect(JSON.stringify(v)).not.toContain('"hidden"');
      }
    }
  });

  it('a PC’s own sheet numbers still reach its player', () => {
    const out = projectEntry(entryOf([fixture('damageApplied', 'vex', 'ganger')]), P1, state, undefined, state);
    const e = out.events[0]!;
    expect(e.type === 'damageApplied' && e.hpAfter).toBe(S);
    expect(e.redacted).toBeUndefined();
  });

  it('initiative lists only known combatants', () => {
    const out = projectEntry(entryOf([fixture('initiativeRolled', 'ganger', 'vex')]), P1, state, undefined, state);
    const e = out.events[0]!;
    expect(e.type === 'initiativeRolled' && e.entries.map((x) => x.combatantId)).toEqual(['vex', 'ganger']);
  });

  it('area results and suppression results drop unseen targets instead of counting them', () => {
    const area = projectEntry(entryOf([fixture('areaResolved', 'ganger', 'vex')]), P1, state, undefined, state).events[0]!;
    expect(area.type === 'areaResolved' && area.targetIds).toEqual(['vex', 'ganger']);
    const sup = projectEntry(entryOf([fixture('suppressiveFireResolved', 'ganger', 'vex')]), P1, state, undefined, state).events[0]!;
    expect(sup.type === 'suppressiveFireResolved' && sup.results.map((r) => r.targetId)).toEqual(['vex']);
  });

  it('events about unseen actors only are dropped; ones that touch the party are aliased', () => {
    const solo = projectEntry(entryOf([fixture('died', HIDDEN_ID, 'vex')]), P1, state, undefined, state);
    expect(solo.events).toEqual([]);
    const shot = projectEntry(entryOf([fixture('attackResolved', HIDDEN_ID, 'vex')]), P1, state, undefined, state);
    expect(shot.events[0]).toMatchObject({ attackerId: 'hidden', defenderId: 'vex' });
    const chat = projectEntry(entryOf([fixture('chatMessage', HIDDEN_ID, 'vex')]), P1, state, undefined, state);
    expect(chat.events[0]).toMatchObject({ asCombatantId: 'hidden', text: 'Unknown Contact says hello.' });
  });

  it('the GM sees every event untouched', () => {
    for (const t of ALL) {
      const e = fixture(t, HIDDEN_ID, 'vex');
      expect(projectEntry(entryOf([e]), GM, state, undefined, state).events).toEqual([e]);
    }
  });
});

describe('pending steps and view state for players', () => {
  it('area-dodge prompts list only known targets', () => {
    const state = world();
    const pending = {
      kind: 'awaitingAreaDodge', id: 'p', attackerId: HIDDEN_ID, areaKind: 'launcher', at: c0,
      attack: check(true), damageDice: 6, source: 'explosive', targets: [{ id: 'vex' }, { id: HIDDEN_ID2 }, { id: 'ganger' }],
      decisions: { [HIDDEN_ID2]: true, vex: false },
    } as unknown as Pending;
    const view = projectState({ ...state, pending }, P1);
    const json = JSON.stringify(view.pending);
    expect(json).not.toContain(HIDDEN_ID2);
    expect(json).not.toContain(HIDDEN_ID);
    expect(view.pending).toMatchObject({ attackerId: 'hidden', targets: [{ id: 'vex' }, { id: 'ganger' }], decisions: { vex: false } });
    // Only the total to beat: no STAT, skill, modifiers or natural roll; no NPC damage dice.
    expect(json).not.toContain(String(S));
    expect(view.pending).toMatchObject({ attack: { total: 19, redacted: true }, damageDice: 0 });
    expect(Object.keys((view.pending as { attack: object }).attack).sort()).toEqual(['redacted', 'total']);
  });

  it.each([HIDDEN_ID, 'ganger'])('area and scatter pendings by %s (sheet not visible) expose only the attack total', (attacker) => {
    const state = world();
    const area = {
      kind: 'awaitingAreaDodge', id: 'p', attackerId: attacker, areaKind: 'thrownGrenade', at: c0,
      attack: check(true), damageDice: S, source: 'explosive', targets: [{ id: 'vex', coverHp: S }], decisions: { vex: null },
    } as unknown as Pending;
    const scatter = { kind: 'awaitingScatter', id: 'q', attackerId: attacker, areaKind: 'launcher', at: c0, attack: check(true), damageDice: S } as Pending;
    for (const pending of [area, scatter]) {
      const view = projectState({ ...state, pending }, P1);
      expect(JSON.stringify(view.pending)).not.toContain(String(S));
      expect((view.pending as { attack: unknown }).attack).toEqual({ total: 19, redacted: true });
      // The same holds for the pending riding in an entry's patch.
      const entry: LogEntry = { ...entryOf([]), patch: { pending } };
      const p = projectEntry(entry, P1, { ...state, pending }, undefined, state).patch.pending;
      expect(JSON.stringify(p)).not.toContain(String(S));
      // The GM and a PC attacker's own players see the whole check.
      expect((projectState({ ...state, pending }, GM).pending as { attack: unknown }).attack).toEqual(check(true));
      const own = { ...pending, attackerId: 'vex' } as Pending;
      expect((projectState({ ...state, pending: own }, P1).pending as { attack: unknown }).attack).toEqual(check(true));
    }
  });

  it('every pending kind is projected without NPC numbers or unseen ids', () => {
    const state = world();
    const pendings = [
      { kind: 'awaitingDodge', id: 'a', defenderId: 'vex', attack: { type: 'rangedAttack', attackerId: HIDDEN_ID, defenderId: 'vex', weaponId: 'zz-secret-gun', distance: 10, situational: [{ label: 'GM', value: S }] } },
      { kind: 'awaitingDamage', id: 'b', attackerId: 'ganger', targetId: 'vex', spec: { dice: S, source: 'ranged', location: 'body' } },
      { kind: 'awaitingWatch', id: 'c', watcherId: HIDDEN_ID, targetId: 'vex' },
    ] as unknown as Pending[];
    for (const pending of pendings) {
      const json = JSON.stringify(projectState({ ...state, pending }, P1).pending);
      for (const secret of [String(S), HIDDEN_ID, 'zz-secret-gun']) expect(json).not.toContain(secret);
    }
  });

  it('player view state never carries hidden actors, NPC sheets or GM notes', () => {
    const view = projectState(world(), P1);
    const json = JSON.stringify(view);
    for (const secret of [HIDDEN_ID, HIDDEN_ID2, HIDDEN_NAME, 'Nightglass', 'GM-ONLY-SECRET']) expect(json).not.toContain(secret);
    expect(view.actors.ganger!.combatant).toBeUndefined();
    expect(view.actors.vex!.notes).toBe('Shared note.');
    expect(view.actors.vex!.gmNotes).toBeUndefined();
    expect(view.encounter.order).toEqual(['vex', 'ganger']);
  });

  it('the GM sees GM notes', () => {
    expect(projectState(world(), GM).actors[HIDDEN_ID]!.gmNotes).toBe('GM-ONLY-SECRET');
  });

  it('GM notes never ride along in a projected patch', () => {
    const before = world();
    const r = handleIntent(before, { type: 'replaceActor', actor: { ...before.actors.vex!, gmNotes: 'Owes the Tyger Claws.' } }, GM, { dice: scriptedDiceForTests() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = { ...before, actors: { ...before.actors, vex: { ...before.actors.vex!, gmNotes: 'Owes the Tyger Claws.' } } };
    expect(JSON.stringify(projectEntry(r.entry, P1, after, undefined, before))).not.toContain('Tyger');
  });
});

describe('Black ICE and Demons', () => {
  it('the ICE side of a contest shows only its total, even on a PC runner’s line', () => {
    const state = world();
    for (const [action, field] of [['iceAttack', 'check'], ['demonZap', 'check'], ['speedCheck', 'vs'], ['slide', 'vs'], ['zap', 'vs'], ['program', 'vs']] as const) {
      const e: CombatEvent = { type: 'netAction', visibility: 'public', combatantId: 'vex', action, text: 'Hellhound attacks Vex: 19 vs 12. Hit.', check: check(true), vs: check(true), success: true };
      const out = projectEntry(entryOf([e]), P1, state, undefined, state).events[0] as Extract<CombatEvent, { type: 'netAction' }>;
      expect(out[field]).toMatchObject({ total: 19, baseBreakdown: [], redacted: true });
      expect(out[field === 'check' ? 'vs' : 'check']).toEqual(check(true));
      expect((projectEntry(entryOf([e]), GM, state).events[0] as typeof out)[field]).toEqual(check(true));
    }
  });
});

describe('unexplored terrain', () => {
  it('players get `?` for squares the party has never seen, and no cover records there', () => {
    const s = world();
    // Explored: the left eight columns only. A crate at (10, 1) behind the wall.
    const explored = Array.from({ length: 5 }, () => '1'.repeat(9) + '000').join('');
    const cells = MAP.cells.split('');
    cells[1 * 12 + 10] = 'c';
    cells[2 * 12 + 2] = 'c';
    const map: TacticalMap = { ...MAP, cells: cells.join(''), explored, cover: { '10,1': { material: 'concrete', hp: 25 }, '2,2': { material: 'thickWood', hp: 20 } } };
    const view = projectState({ ...s, map }, P1).map!;
    expect(view.cells).toHaveLength(60);
    for (let y = 0; y < 5; y++) {
      expect(view.cells.slice(y * 12 + 9, y * 12 + 12)).toBe('???');
      expect(view.cells.slice(y * 12, y * 12 + 9)).toBe(map.cells.slice(y * 12, y * 12 + 9));
    }
    expect(view.cover).toEqual({ '2,2': { material: 'thickWood', hp: 20 } });
    expect(view.explored).toBe(explored);
    // The GM sees everything.
    expect(projectState({ ...s, map }, GM).map!.cells).toBe(map.cells);
    // Squares in view right now are never masked, even if `explored` lags behind.
    const fresh = projectState({ ...s, map: { ...map, explored: '0'.repeat(60) } }, P1).map!;
    expect(fresh.cells.slice(0, 8)).toBe(map.cells.slice(0, 8));
  });
});
