import { describe, expect, it } from 'vitest';
import {
  ammoProblem, applySystems, creationHumanity, handsFree, hlAverage, HANDS, humanityMax, maxHumanityPenalty, parseHlDice,
  previewRangedAttack, resolveRangedAttack, rollHl, scriptedDice, smartWeaponProblem, wieldProblem, type Combatant, type CyberwareItem,
} from '../src/index.js';
import { combatant, weapon } from './fixtures.js';

const cw = (id: string, effects: CyberwareItem['effects'], extra: Partial<CyberwareItem> = {}): CyberwareItem => ({ id, name: id, humanityLoss: 2, effects, ...extra });
const kit = (c: Combatant, items: CyberwareItem[]) => applySystems({ ...c, cyberware: items });
const shooter = () => combatant({ id: 's', stats: { REF: 6 }, skills: { Handgun: 4 } }); // base 10

describe('Smart ammo (Core)', () => {
  it('needs a Targeting Scope; a near miss gets 10 + 1d10 vs the same DV', () => {
    const w = weapon('heavyPistol', { ammoType: 'smart' });
    const s = kit(shooter(), [cw('ts', [{ kind: 'targetingScope' }])]);
    // 10 + 2 = 12 vs DV 13: miss by 1 → 10 + 8 = 18 hits.
    const out = resolveRangedAttack({ attacker: s, defender: combatant({ id: 'd' }), weapon: w, distance: 4, defenderDodges: false }, scriptedDice({ d10: [2, 8] }));
    expect(out.hit).toBe(true);
    expect(out.events.find((e) => e.type === 'smartAmmoRetry')).toMatchObject({ total: 18, kind: 'smart' });
    // Without the scope: no retry.
    const bare = resolveRangedAttack({ attacker: shooter(), defender: combatant({ id: 'd' }), weapon: w, distance: 4, defenderDodges: false }, scriptedDice({ d10: [2] }));
    expect(bare.hit).toBe(false);
  });
  it('doesn’t track a miss by more than 4, or Autofire', () => {
    const s = kit(shooter(), [cw('ts', [{ kind: 'targetingScope' }])]);
    // 26 m (DV 20): 12 vs 20 → miss by 8, no retry.
    const big = resolveRangedAttack({ attacker: s, defender: combatant({ id: 'd' }), weapon: weapon('heavyPistol', { ammoType: 'smart' }), distance: 26, defenderDodges: false }, scriptedDice({ d10: [2] }));
    expect(big.events.some((e) => e.type === 'smartAmmoRetry')).toBe(false);
  });
  it('the second attack faces a fresh dodge when they dodged', () => {
    const s = kit(shooter(), [cw('ts', [{ kind: 'targetingScope' }])]);
    const dodger = combatant({ id: 'd', stats: { REF: 8, DEX: 6 }, skills: { Evasion: 4 } }); // dodge base 10
    // Attack 10 + 3 = 13 vs dodge 10 + 4 = 14 → miss by 1; retry 10 + 9 = 19 vs new dodge 10 + 2 = 12 → hit.
    const out = resolveRangedAttack({ attacker: s, defender: dodger, weapon: weapon('heavyPistol', { ammoType: 'smart' }), distance: 4, defenderDodges: true }, scriptedDice({ d10: [3, 4, 9, 2] }));
    const r = out.events.find((e) => e.type === 'smartAmmoRetry');
    expect(r).toMatchObject({ total: 19, dv: 12, hit: true });
    expect(out.hit).toBe(true);
  });
});

describe('Smart gear modifiers', () => {
  it('Smartgun Link gives +1 only when wired in', () => {
    const w = weapon('heavyPistol', { smartgunLink: true });
    const d = combatant({ id: 'd' });
    expect(previewRangedAttack({ attacker: shooter(), defender: d, weapon: w, distance: 4 }).modifiers).toEqual([]);
    const wired = kit(shooter(), [cw('nl', [{ kind: 'neuralLink' }]), cw('ip', [{ kind: 'interfacePlugs' }])]);
    expect(previewRangedAttack({ attacker: wired, defender: d, weapon: w, distance: 4 }).modifiers).toContainEqual({ label: 'Smartgun Link', value: 1 });
    const grip = kit(shooter(), [cw('nl', [{ kind: 'neuralLink' }]), cw('sg', [{ kind: 'subdermalGrip' }])]);
    expect(previewRangedAttack({ attacker: grip, defender: d, weapon: w, distance: 4 }).modifiers).toContainEqual({ label: 'Smartgun Link', value: 1 });
  });
  it('Targeting Scope adds +1 to ranged Aimed Shots; legacy smartLink still counts as a scope', () => {
    const d = combatant({ id: 'd' });
    const legacy = kit(shooter(), [cw('old', [{ kind: 'smartLink' }])]);
    const pv = previewRangedAttack({ attacker: legacy, defender: d, weapon: weapon('heavyPistol'), distance: 4, aimTarget: 'head' });
    expect(pv.modifiers).toContainEqual({ label: 'Targeting Scope', value: 1 });
  });
  it('Smart Rebuild refuses Power and Tech weapons; Improved Smart needs a Smart Weapon', () => {
    expect(smartWeaponProblem(weapon('assaultRifle', { smart: 'rebuild', tech2070s: 'tech' }))).toMatch(/Smart Rebuild/);
    expect(smartWeaponProblem(weapon('assaultRifle', { smart: 'rebuild' }))).toBeNull();
    expect(ammoProblem(weapon('heavyPistol'), 'improvedSmart')).toMatch(/Smart Weapon/);
    expect(ammoProblem(weapon('heavyPistol', { smart: 'built' }), 'improvedSmart')).toBeNull();
  });
});

describe('Humanity Loss dice and maximum Humanity', () => {
  it('parses book notation', () => {
    expect(parseHlDice('2d6')).toEqual({ count: 2, halve: false, bonus: 0 });
    expect(parseHlDice('1d6/2')).toEqual({ count: 1, halve: true, bonus: 0 });
    expect(parseHlDice('1d3')).toEqual({ count: 1, halve: true, bonus: 0 });
    expect(parseHlDice('0')).toEqual({ count: 0, halve: false, bonus: 0 });
    expect(parseHlDice('2d8')).toBeNull();
    expect(parseHlDice('1d3/2')).toBeNull();
    expect(hlAverage(parseHlDice('2d6')!)).toBe(7);
    expect(hlAverage(parseHlDice('4d6')!)).toBe(14);
    expect(hlAverage(parseHlDice('1d6/2')!)).toBe(2);
    expect(hlAverage(parseHlDice('1d6')!)).toBe(3);
    expect(hlAverage(parseHlDice('3d6')!)).toBe(10);
  });
  it('rolls halved dice rounding up', () => {
    let i = 0; const faces = [5];
    expect(rollHl(parseHlDice('1d6/2')!, () => faces[i++]!).total).toBe(3);
  });
  it('lowers max by 2 per costly item (4 borgware) and never lets current exceed max', () => {
    expect(maxHumanityPenalty({ humanityLoss: 0 })).toBe(0);
    expect(maxHumanityPenalty({ humanityLoss: 7 })).toBe(2);
    expect(maxHumanityPenalty({ humanityLoss: 14, borgware: true })).toBe(4);
    const items = [cw('a', [], { humanityLoss: 7 }), cw('b', [], { humanityLoss: 0 }), cw('c', [], { humanityLoss: 1 })];
    expect(humanityMax(60, items)).toBe(56);
    expect(creationHumanity(6, items)).toEqual({ base: 60, max: 56, current: 52 });
    expect(creationHumanity(6, [cw('x', [], { humanityLoss: 1 })])).toEqual({ base: 60, max: 58, current: 58 });
  });
  it('applySystems keeps max in step with installed cyberware and derives EMP', () => {
    const c = applySystems({ ...combatant({ id: 'h' }), humanity: { base: 60, max: 60, current: 53 }, cyberware: [cw('a', [], { humanityLoss: 7 })] });
    expect(c.humanity).toEqual({ base: 60, max: 58, current: 53 });
    expect(c.stats.EMP).toBe(5);
  });
});

describe('Hands (user ruling)', () => {
  it('Heavy Melee is two-handed; Heavy SMG and grenades one-handed', () => {
    expect(HANDS.heavyMelee).toBe(2);
    expect(HANDS.heavySmg).toBe(1);
    expect(HANDS.grenade).toBe(1);
    const hurt = combatant({ id: 'h' });
    hurt.criticalInjuries = [{ injuryId: 'brokenArm', table: 'body', quickFixed: false }];
    expect(handsFree(hurt)).toBe(1);
    expect(wieldProblem(hurt, weapon('heavyMelee'))).toMatch(/two hands/);
  });
  it('thrown grenades can’t be fired directly at a person', () => {
    expect(() => resolveRangedAttack({ attacker: shooter(), defender: combatant({ id: 'd' }), weapon: weapon('grenade'), distance: 10 }, scriptedDice({}))).toThrow(/area attack/);
  });
});

describe('Improved Smart ammo penalties', () => {
  it('carries the first shot’s penalties into the second attempt', () => {
    const w = weapon('heavyPistol', { ammoType: 'improvedSmart', smart: 'built' });
    // Aimed head: 10 + 1 − 8 + 9 = 12 vs 13 → miss by 1; retry 14 + 7 − 8 = 13 → tie, miss.
    const out = resolveRangedAttack({ attacker: shooter(), defender: combatant({ id: 'd' }), weapon: w, distance: 4, aimTarget: 'head', defenderDodges: false }, scriptedDice({ d10: [9, 7] }));
    expect(out.events.find((e) => e.type === 'smartAmmoRetry')).toMatchObject({ total: 13, hit: false });
  });
});
