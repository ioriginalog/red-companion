import { describe, expect, it } from 'vitest';
import {
  activeSpeedwareBonus, applyDamage, applySystems, cyberwareMods, cyberwareProblem, endOfTurnInjuries, getInjury, isSpeedware,
  rollInitiative, scriptedDice, startOfTurnInjuries, turnReminders, type CyberwareItem,
} from '../src/index.js';
import { combatant } from './fixtures.js';

const inj = (injuryId: string, quickFixed = false) => ({ injuryId, table: getInjury(injuryId).table, quickFixed });

describe('Spinal Injury: no Action next Turn', () => {
  it('queues the lost Action when the injury lands from damage', () => {
    // Two sixes trigger a crit; the injury roll (2d6) picks Spinal Injury (10 = 4 + 6).
    const t = combatant({ hpCurrent: 40, hp: { max: 40, current: 40 } });
    const spec = { source: 'ranged' as const, diceCount: 2, multiplier: 1, location: 'body' as const, halveSP: false, ablation: 1, critTable: 'body' as const };
    const r = applyDamage(t, spec, { dice: [6, 6], multiplier: 1, total: 12, critTriggered: true }, scriptedDice({ d6: [4, 6] }));
    expect(r.target.criticalInjuries.map((i) => i.injuryId)).toEqual(['spinalInjury']);
    expect(r.target.turnFlags?.loseAction).toBe(true);
  });
  it('is spent at the start of the next Turn, and a Quick Fix first cancels it', () => {
    const c = combatant({ criticalInjuries: [inj('spinalInjury')] });
    const flagged = { ...c, turnFlags: { loseAction: true } };
    const s = startOfTurnInjuries(flagged);
    expect(s.loseAction).toBe(true);
    expect(s.combatant.turnFlags).toBeUndefined();
    expect(s.events[0]).toMatchObject({ type: 'injuryEffect', effect: 'lostAction', injuryId: 'spinalInjury' });
    const fixed = { ...combatant({ criticalInjuries: [inj('spinalInjury', true)] }), turnFlags: { loseAction: true } };
    expect(startOfTurnInjuries(fixed).loseAction).toBe(false);
  });
});

describe('Re-bleeding injuries', () => {
  it('re-inflicts 5 per bleeding injury after moving more than 4 m/yds, never naming HP', () => {
    const c = combatant({ hp: { max: 40, current: 30 }, criticalInjuries: [inj('brokenRibs'), inj('foreignObject')] });
    const r = endOfTurnInjuries(c, 6);
    expect(r.combatant.hp.current).toBe(20);
    const bleeds = r.events.filter((e) => e.type === 'injuryEffect');
    expect(bleeds).toHaveLength(2);
    for (const e of r.events) expect(JSON.stringify(e)).not.toMatch(/hpAfter|hpBefore/);
  });
  it('does nothing at exactly 4 m/yds or when Quick-Fixed', () => {
    const c = combatant({ hp: { max: 40, current: 30 }, criticalInjuries: [inj('brokenRibs')] });
    expect(endOfTurnInjuries(c, 4).combatant.hp.current).toBe(30);
    const q = combatant({ hp: { max: 40, current: 30 }, criticalInjuries: [inj('brokenRibs', true)] });
    expect(endOfTurnInjuries(q, 10).combatant.hp.current).toBe(30);
  });
  it('reports a Wound State change', () => {
    const c = combatant({ hp: { max: 40, current: 21 }, criticalInjuries: [inj('brokenRibs')] });
    expect(endOfTurnInjuries(c, 6).events.some((e) => e.type === 'woundStateChanged')).toBe(true);
  });
});

describe('Ear injuries: no Move Action after running', () => {
  it('queues and spends the lost Move Action', () => {
    const c = combatant({ criticalInjuries: [inj('damagedEar')] });
    const after = endOfTurnInjuries(c, 8).combatant;
    expect(after.turnFlags?.noMove).toBe(true);
    const s = startOfTurnInjuries(after);
    expect(s.noMove).toBe(true);
    expect(s.combatant.turnFlags).toBeUndefined();
  });
});

describe('Turn reminders', () => {
  it('lists actionable items and situational injury effects', () => {
    const c = { ...combatant({ name: 'Vex', hp: { max: 40, current: 0 }, criticalInjuries: [inj('spinalInjury'), inj('lostEye')], conditions: { prone: true, unconscious: false, dead: false, stabilized: false } }), turnFlags: { loseAction: true }, onFire: 2 };
    const keys = turnReminders(c).map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(['deathSave', 'prone', 'lostAction', 'onFire', 'injury']));
  });
  it('lists nothing for the dead', () => {
    expect(turnReminders(combatant({ conditions: { prone: false, unconscious: false, dead: true, stabilized: false } }))).toEqual([]);
  });
});

describe('Speedware', () => {
  const passive: CyberwareItem = { id: 'k', name: 'Reflex Coil', humanityLoss: 0, effects: [{ kind: 'speedware', mode: 'passive', initiative: 2 }] };
  const activated: CyberwareItem = { id: 's', name: 'Burst Rig', humanityLoss: 0, effects: [{ kind: 'speedware', mode: 'activated', initiative: 3 }] };
  it('passive speedware always adds to Initiative', () => {
    expect(cyberwareMods([passive]).initiative).toBe(2);
    const c = applySystems({ ...combatant({ stats: { REF: 6 } }), cyberware: [passive] });
    expect(rollInitiative([{ combatant: c }], scriptedDice({ d10: [5] })).order[0]!.total).toBe(13);
  });
  it('activated speedware adds only while on', () => {
    const c = applySystems({ ...combatant({ stats: { REF: 6 } }), cyberware: [activated] });
    expect(activeSpeedwareBonus(c)).toBe(0);
    const on = { ...c, speedware: { active: true, roundsLeft: 20, spent: true } };
    expect(rollInitiative([{ combatant: on }], scriptedDice({ d10: [5] })).order[0]!.total).toBe(14);
  });
  it('never stacks: only the first piece counts', () => {
    const m = cyberwareMods([passive, { ...passive, id: 'k2' }, activated]);
    expect(m.initiative).toBe(2);
    expect(m.activatedSpeedware).toBeUndefined();
    expect(isSpeedware(activated)).toBe(true);
  });
  it('validates the effect', () => {
    expect(cyberwareProblem({ ...passive, effects: [{ kind: 'speedware', mode: 'passive', initiative: 9 }] })).toMatch(/Speedware/);
    expect(cyberwareProblem({ ...passive, effects: [{ kind: 'speedware', mode: 'sideways' as 'passive', initiative: 2 }] })).toMatch(/Speedware/);
    expect(cyberwareProblem(passive)).toBeNull();
  });
});
