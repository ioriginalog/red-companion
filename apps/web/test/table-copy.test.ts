import { describe, expect, it } from 'vitest';
import { emptyView, type PlayerInfo, type ProjectedActor, type ViewState } from '@cprc/session';
import { actionSpent, grabButton, mergeLocal, noTargetHint } from '../src/table/hints.js';
import { startOfTurnItems } from '../src/table/turnStart.js';
import { mergeTargets, playerAdmin, removeWarning, renameProblem, rosterRows } from '../src/table/roster.js';
import { COMMANDS, SHORTCUTS } from '../src/table/panels.js';

describe('target hint', () => {
  const base = { canAct: true, opponents: 3, anyShot: false, actingName: 'Street Ganger', touch: false };
  it('a GM-run hostile never reads “the party can see enemies”', () => {
    const h = noTargetHint({ ...base, friendly: false })!;
    expect(h).not.toMatch(/party/i);
    expect(h).toBe('No opponent is in Street Ganger’s line of sight. Move for a clear shot.');
    expect(noTargetHint({ ...base, friendly: false, opponents: 0 })).toBe('Street Ganger has no opponents on the map.');
  });
  it('keeps the party wording for the party', () => {
    expect(noTargetHint({ ...base, actingName: 'Vex', friendly: true })).toMatch(/^The party can see enemies, but none is in Vex’s/);
    expect(noTargetHint({ ...base, friendly: true, anyShot: true, touch: true })).toBe('Tap an enemy on the map or in the target strip.');
    expect(noTargetHint({ ...base, canAct: false, friendly: true })).toBeUndefined();
  });
});

describe('grab button', () => {
  it('shows the reason, not the odds, when it can’t be used', () => {
    expect(grabButton({ hasTarget: true, near: false, actionSpent: false, odds: '15%' })).toEqual({ label: 'Grab · Not Adjacent', disabled: true, title: 'Needs an adjacent target.' });
    expect(grabButton({ hasTarget: true, near: true, actionSpent: true, odds: '15%' }).label).toBe('Grab · Action Spent');
    expect(grabButton({ hasTarget: false, near: false, actionSpent: false, odds: null })).toMatchObject({ label: 'Grab', disabled: true });
    expect(grabButton({ hasTarget: true, near: true, actionSpent: false, odds: '62%' })).toMatchObject({ label: 'Grab · 62%', disabled: false });
  });
  it('action spent only on their own Turn in an encounter', () => {
    const usage = { actorId: 'vex', actionUsed: true };
    expect(actionSpent({ active: true, usage }, 'vex')).toBe(true);
    expect(actionSpent({ active: true, usage }, 'doc')).toBe(false);
    expect(actionSpent({ active: false, usage }, 'vex')).toBe(false);
    expect(actionSpent({ active: true, usage: { actorId: 'vex', actionUsed: false } }, 'vex')).toBe(false);
  });
});

describe('local chat lines', () => {
  it('sit in order: after what existed, before anything newer', () => {
    const items = [{ seq: 1 }, { seq: 2 }, { seq: 5 }];
    const local = [{ id: 1, text: 'Unknown command.', tone: 'error' as const, after: 2 }, { id: 2, text: 'Again.', tone: 'error' as const, after: 5 }];
    const out = mergeLocal(items, local).map((x) => (x.kind === 'item' ? x.item.seq : `L${x.line.id}`));
    expect(out).toEqual([1, 2, 'L1', 5, 'L2']);
  });
  it('with no log yet, local lines still show', () => {
    expect(mergeLocal([], [{ id: 1, text: 'x', tone: 'help', after: 0 }])).toHaveLength(1);
  });
});

// ----- Start of Turn -----
const combatant = (extra: object = {}) => ({
  id: 'vex', name: 'Vex', side: 'pc', stats: { BODY: 6, MOVE: 6 }, skills: {}, hp: { max: 40, current: 27 }, armor: [], criticalInjuries: [],
  deathSave: { accumulatedPenalty: 0 }, conditions: { prone: false, unconscious: false, dead: false, stabilized: false }, ...extra,
});
const pa = (c: object, extra: object = {}): ProjectedActor => ({
  id: 'vex', controller: 'p1', public: { name: 'Vex', allegiance: 'party', woundState: 'lightly', conditions: { prone: false, dead: false, unconscious: false, stabilized: false }, ...extra }, combatant: c,
} as unknown as ProjectedActor);
function tv(a: ProjectedActor, enc: object = {}): ViewState {
  return { ...emptyView('s'), actors: { vex: a }, encounter: { active: true, round: 2, order: ['vex'], turnIndex: 0, deathSaveRequiredFor: null, ...enc } as ViewState['encounter'] };
}
const remindersEntry = (seq: number, items: { key: string; text: string }[]) => ({ seq, intentType: 'endTurn', events: [{ type: 'turnReminders', combatantId: 'vex', items } as never] });

describe('Start of Turn card', () => {
  it('drops the Death Save line once they’re healed (the stale-card bug)', () => {
    // The feed still has the Turn-start reminder from when Vex was at −3.
    const feed = [remindersEntry(4, [{ key: 'deathSave', text: 'Vex rolls a Death Save before acting.' }])];
    const healed = tv(pa(combatant({ hp: { max: 40, current: 27 } })));
    expect(startOfTurnItems(healed, 'vex', feed)).toEqual([]);
    const dying = tv(pa(combatant({ hp: { max: 40, current: -3 } })), { deathSaveRequiredFor: 'vex' });
    expect(startOfTurnItems(dying, 'vex', feed).map((r) => r.text)).toContain('Vex rolls a Death Save before acting.');
    // Healed during the Turn while the authority still asks for the save: say so truthfully.
    const owed = tv(pa(combatant({ hp: { max: 40, current: 27 } })), { deathSaveRequiredFor: 'vex' });
    expect(startOfTurnItems(owed, 'vex', feed)[0]!.text).toBe('Vex began this Turn Mortally Wounded and still rolls a Death Save before acting.');
  });
  it('reads Prone, On Fire and grapples from the state, live', () => {
    const v = tv(pa(combatant({ conditions: { prone: true, unconscious: false, dead: false, stabilized: false }, onFire: 2 }), { conditions: { prone: true } }));
    expect(startOfTurnItems(v, 'vex', []).map((r) => r.key)).toEqual(['prone', 'onFire']);
    const up = tv(pa(combatant()));
    expect(startOfTurnItems(up, 'vex', [])).toEqual([]);
    const held: ViewState = { ...up, actors: { ...up.actors, lt: { id: 'lt', controller: 'gm', public: { name: 'Lieutenant' } } as unknown as ProjectedActor }, extras: { grapples: [{ holderId: 'lt', heldId: 'vex' }] } as unknown as ViewState['extras'] };
    expect(startOfTurnItems(held, 'vex', [])[0]!.text).toBe('Vex is held by Lieutenant: can’t move, −2 to Actions, no two-handed weapons.');
  });
  it('a lost Action comes from this Turn’s reminder, only while the Action is spent', () => {
    const feed = [remindersEntry(9, [{ key: 'lostAction', text: 'x' }])];
    const spent = tv(pa(combatant()), { usage: { actorId: 'vex', moveUsed: 0, actionUsed: true, ran: false, attacks: 0, attackWith: null } });
    expect(startOfTurnItems(spent, 'vex', feed, 9).map((r) => r.key)).toEqual(['lostAction']);
    // A reminder from an earlier Turn (before this Turn's seq) doesn't count.
    expect(startOfTurnItems(spent, 'vex', feed, 12)).toEqual([]);
    const ear = tv(pa(combatant()), { usage: { actorId: 'vex', moveUsed: 6, moveBlocked: 6, actionUsed: false, ran: false, attacks: 0, attackWith: null } });
    expect(startOfTurnItems(ear, 'vex', []).map((r) => r.key)).toEqual(['noMove']);
  });
  it('nothing for the dead, or when it isn’t their Turn', () => {
    expect(startOfTurnItems(tv(pa(combatant()), { deathSaveRequiredFor: 'vex', turnIndex: 0, order: ['lt', 'vex'] }), 'vex', [])).toEqual([]);
  });
});

describe('GM roster', () => {
  const players: PlayerInfo[] = [{ playerId: 'p1', name: 'Ana', online: true }, { playerId: 'p2', name: 'Ana 2', online: false }, { playerId: 'p3', name: 'Bo', online: false }];
  const actors = { vex: { id: 'vex', controller: 'p1', public: { name: 'Vex' } }, doc: { id: 'doc', controller: 'p3', public: { name: 'Doc Ruiz' } } } as unknown as Record<string, ProjectedActor>;
  it('rows: online first, characters, idle seats', () => {
    const rows = rosterRows(players, actors);
    expect(rows.map((r) => r.name)).toEqual(['Ana', 'Ana 2', 'Bo']);
    expect(rows.find((r) => r.name === 'Ana 2')).toMatchObject({ idle: true, characters: [] });
    expect(rows.find((r) => r.name === 'Bo')).toMatchObject({ idle: false, characters: ['Doc Ruiz'] });
    expect(mergeTargets(rows, 'p2').map((r) => r.playerId)).toEqual(['p1', 'p3']);
    expect(removeWarning(rows.find((r) => r.name === 'Bo')!)).toBe('Remove Bo? Doc Ruiz goes back to the GM, and Bo would join as a new player.');
  });
  it('rename checks: reserved GM look-alikes, duplicates, empty', () => {
    for (const n of ['GM', 'g.m.', 'Game Master', 'G M', 'gm2']) expect(renameProblem(n, 'p1', players)).toBe('That name is reserved for the GM.');
    expect(renameProblem('bo', 'p1', players)).toBe('Another player already has that name.');
    expect(renameProblem('  ', 'p1', players)).toBe('Enter a name.');
    expect(renameProblem('Gemma', 'p1', players)).toBeNull();
  });
  it('player admin is null until the client has the calls', () => {
    expect(playerAdmin({})).toBeNull();
    const calls: string[] = [];
    const fake = { removePlayer: (id: string) => calls.push(`rm ${id}`), renamePlayer: (id: string, n: string) => calls.push(`mv ${id} ${n}`), mergePlayers: (a: string, b: string) => calls.push(`merge ${a} ${b}`) };
    const admin = playerAdmin(fake)!;
    // Merge p2 into p1: the client keeps p1 and drops p2 (keepId first).
    admin.mergePlayers('p2', 'p1');
    admin.renamePlayer('p1', 'Ana');
    expect(calls).toEqual(['merge p1 p2', 'mv p1 Ana']);
  });
});

describe('help copy', () => {
  it('parentheticals are sentence case', () => {
    for (const [, v] of [...COMMANDS, ...SHORTCUTS]) {
      for (const m of v.matchAll(/\(([^)]+)\)/g)) {
        const words = m[1]!.split(/\s+/).slice(1).filter((w) => !/^(GM|Action|d6|d10|vs|dv)$/.test(w));
        expect(words.filter((w) => /^[A-Z]/.test(w)), `${v}`).toEqual([]);
      }
    }
    expect(COMMANDS.find(([k]) => k.startsWith('/w'))![1]).toContain('(a unique prefix works)');
  });
});
