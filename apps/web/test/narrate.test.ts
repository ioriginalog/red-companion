import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '@cprc/rules-core';
import { narrate } from '../src/narrate.js';
import { effectsFor } from '../src/table/effects.js';

const name = (id: string) => ({ vex: 'Vex', drone: 'Drone' }[id] ?? id);
const check = { base: 14, baseBreakdown: [], modifiers: [], roll: { natural: 10, critDie: 4, kind: 'critSuccess' as const, value: 14 }, total: 28 };

describe('narrate new events', () => {
  it('covers rolls, chat, GM edits and area attacks', () => {
    const ev: CombatEvent[] = [
      { type: 'checkRolled', visibility: 'public', by: 'p1', combatantId: 'vex', label: 'REF + Handgun', check, dv: 15, success: true },
      { type: 'diceRolled', visibility: 'public', by: 'gm', label: 'Damage', dice: [3, 6], sides: 6, bonus: 2, total: 11 },
      { type: 'chatMessage', visibility: 'public', by: 'gm', text: 'Hold.' },
      { type: 'hpAdjusted', visibility: 'gm', targetId: 'drone', delta: -5, hpAfter: 25, reason: 'fire' },
      { type: 'conditionSet', visibility: 'public', targetId: 'vex', condition: 'prone', value: true },
      { type: 'sceneChanged', visibility: 'public', mapId: 'm', name: 'Rooftop' },
      { type: 'areaResolved', visibility: 'public', attackerId: 'vex', kind: 'launcher', at: { x: 1, y: 1 }, targetIds: ['drone'] },
    ];
    const lines = ev.map((e) => narrate(e, name)?.text);
    expect(lines).toEqual([
      'Vex rolls REF + Handgun: 28 (10 crit) vs DV 15: success.',
      'GM rolls Damage: 3 + 6 + 2 = 11.',
      'GM: Hold.',
      'GM removes 5 HP from Drone (fire).',
      'Vex is Prone.',
      'Scene: Rooftop.',
      'Vex lands an explosive, catching Drone.',
    ]);
  });
});

describe('effectsFor', () => {
  it('maps attacks and damage to tracers, floaters and cues', () => {
    const tokens = { vex: { x: 0, y: 0 }, drone: { x: 3, y: 0 } };
    const { effects, cues } = effectsFor([
      { type: 'attackResolved', visibility: 'public', attackerId: 'vex', defenderId: 'drone', attack: check, defenseKind: 'rangeDV', defenseValue: 15, hit: true, margin: 13 },
      { type: 'damageApplied', visibility: 'gm', targetId: 'drone', location: 'body', rawDamage: 20, spBefore: 11, spCounted: 11, through: 9, locationMultiplier: 1, hpBefore: 30, hpAfter: 21 },
    ], tokens);
    expect(effects.map((e) => e.kind)).toEqual(['tracer', 'float']);
    expect(effects[1]).toMatchObject({ text: '−9', tone: 'dmg' });
    expect(cues).toEqual(['shot', 'hit']);
  });
  it('skips tokens the viewer can’t see', () => {
    const { effects } = effectsFor([{ type: 'hpAdjusted', visibility: 'gm', targetId: 'ghost', delta: 3, hpAfter: 3 }], {});
    expect(effects).toEqual([]);
  });
});

describe('round 2 narration', () => {
  it('title-cases Critical Injury names and announces handouts', () => {
    const name = (id: string) => (id === 'vex' ? 'Vex' : id);
    expect(narrate({ type: 'criticalInjury', visibility: 'public', targetId: 'vex', injuryId: 'collapsedLung' } as never, name)!.text).toBe('Critical Injury on Vex: Collapsed Lung.');
    expect(narrate({ type: 'handoutShared', visibility: 'public', id: 'h1', title: 'Job Brief' }, name)!.text).toBe('GM shared a handout: Job Brief.');
  });
});
