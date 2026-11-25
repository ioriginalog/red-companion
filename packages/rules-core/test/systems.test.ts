import { describe, expect, it } from 'vitest';
import {
  ammoProblem, applyAmmo, applyDamage, applySystems, awarenessProblem, cyberwareProblem, empFromHumanity, interfaceRank,
  naturalHealing, previewRangedAttack, raySteps, resolveMeleeAttack, resolveRangedAttack, rollInitiative, roleProblem,
  scriptedDice, standingModifiers, treatInjury, treatmentDv, wieldProblem,
  type Combatant, type DamageSpec,
} from '../src/index.js';
import { armor, combatant, weapon } from './fixtures.js';

const withK = (c: Combatant, extra: Partial<Combatant>): Combatant => applySystems({ ...c, ...extra });
const solo = (alloc: Record<string, number>, rank = 10) =>
  withK(combatant({ id: 'solo', stats: { REF: 8 }, skills: { Handgun: 6 } }), { role: { id: 'solo', rank, awareness: alloc } });
const body: DamageSpec = { source: 'ranged', diceCount: 3, multiplier: 1, location: 'body', halveSP: false, ablation: 1, critTable: 'body' };
const roll = (dice: number[]) => ({ dice, multiplier: 1, total: dice.reduce((a, b) => a + b, 0), critTriggered: dice.filter((d) => d === 6).length >= 2 });

describe('Roles', () => {
  it('validates Combat Awareness costs and the rank cap', () => {
    expect(awarenessProblem({ precisionAttack: 3, damageDeflection: 4 }, 7)).toBeNull();
    expect(awarenessProblem({ precisionAttack: 4 }, 10)).toMatch(/Precision Attack/);
    expect(awarenessProblem({ fumbleRecovery: 2 }, 10)).toMatch(/Fumble Recovery/);
    expect(awarenessProblem({ initiativeReaction: 6 }, 5)).toMatch(/exceed rank 5/);
    expect(awarenessProblem({ bogus: 1 } as never, 5)).toMatch(/Unknown/);
    expect(roleProblem({ id: 'netrunner', rank: 4, awareness: {} })).toMatch(/Only Solos/);
    expect(roleProblem({ id: 'medtech', rank: 3, medicine: { surgery: 2, pharmaceuticals: 1, cryosystem: 1 } })).toMatch(/exceed rank 3/);
    expect(roleProblem({ id: 'solo', rank: 11 })).toMatch(/1–10/);
  });
  it('derives Solo mods: Precision Attack, Initiative Reaction, Threat Detection', () => {
    const s = solo({ precisionAttack: 6, initiativeReaction: 2, threatDetection: 1 }, 9);
    expect(s.mods).toMatchObject({ attack: 2, initiative: 2, skillBonuses: { Perception: 1 } });
    expect(standingModifiers(s, 'rangedAttack')).toContainEqual({ label: 'Precision Attack', value: 2 });
    expect(standingModifiers(s, 'other').some((m) => m.label === 'Precision Attack')).toBe(false);
    const init = rollInitiative([{ combatant: s }], scriptedDice({ d10: [5] }));
    expect(init.order[0]!.total).toBe(8 + 2 + 5);
  });
  it('derives Medtech skills and Netrunner Interface rank', () => {
    const m = withK(combatant(), { role: { id: 'medtech', rank: 4, medicine: { surgery: 2, pharmaceuticals: 1, cryosystem: 1 } } });
    expect(m.mods?.skillBonuses).toEqual({ Surgery: 4, 'Medical Tech': 2 });
    expect(interfaceRank({ role: { id: 'netrunner', rank: 6 } })).toBe(6);
    expect(interfaceRank({ role: { id: 'solo', rank: 6 } })).toBe(0);
  });
  it('Fumble Recovery turns a natural 1 into a plain 1', () => {
    const s = solo({ fumbleRecovery: 4 });
    const out = resolveRangedAttack({ attacker: s, defender: combatant({ id: 'd' }), weapon: weapon('heavyPistol'), distance: 4, defenderDodges: false }, scriptedDice({ d10: [1, 9] }));
    expect(out.attack.roll).toEqual({ natural: 1, kind: 'normal', value: 1 });
    expect(out.attack.total).toBe(8 + 6 + 1);
  });
});

describe('Cyberware and Humanity', () => {
  it('EMP is the tens digit of Humanity', () => {
    expect(empFromHumanity(44)).toBe(4);
    expect(empFromHumanity(39)).toBe(3);
    expect(empFromHumanity(-5)).toBe(0);
  });
  it('applies STAT, skill and armor effects and keeps cyberware armor ablation', () => {
    const c = withK(combatant({ armor: [armor('body', 11)] }), {
      humanity: { current: 47, max: 60 },
      cyberware: [{ id: 'sub', name: 'Subdermal Armor', humanityLoss: 6, effects: [{ kind: 'armor', location: 'body', sp: 12 }, { kind: 'stat', stat: 'REF', value: 1 }, { kind: 'skill', skill: 'Handgun', value: 2 }] }],
    });
    expect(c.stats.EMP).toBe(4);
    expect(c.armor.map((a) => a.id)).toContain('cw:sub:body');
    expect(c.mods).toMatchObject({ statBonuses: { REF: 1 }, skillBonuses: { Handgun: 2 } });
    const worn = { ...c, armor: c.armor.map((a) => (a.id === 'cw:sub:body' ? { ...a, currentSP: 9 } : a)) };
    expect(applySystems(worn).armor.find((a) => a.id === 'cw:sub:body')!.currentSP).toBe(9);
    const removed = applySystems({ ...worn, cyberware: [] });
    expect(removed.armor.map((a) => a.id)).toEqual(['body-11']);
    expect(removed.mods).toBeUndefined();
  });
  it('rejects hostile cyberware payloads', () => {
    const ok = { id: 'x', name: 'X', humanityLoss: 3, effects: [] };
    expect(cyberwareProblem(ok)).toBeNull();
    expect(cyberwareProblem({ ...ok, id: '../evil' })).toMatch(/id/);
    expect(cyberwareProblem({ ...ok, humanityLoss: 2.5 })).toMatch(/whole number/);
    expect(cyberwareProblem({ ...ok, humanityLoss: '3' as never })).toMatch(/whole number/);
    expect(cyberwareProblem({ ...ok, effects: [{ kind: 'stat', stat: 'REF', value: 99 }] })).toMatch(/STAT/);
    expect(cyberwareProblem({ ...ok, effects: [{ kind: 'nuke' } as never] })).toMatch(/Unknown/);
    expect(cyberwareProblem({ ...ok, name: '' })).toMatch(/name/);
  });
});

describe('Ammunition', () => {
  it('only loads sensible ammo', () => {
    expect(ammoProblem(weapon('heavyPistol'), 'armorPiercing')).toBeNull();
    expect(ammoProblem(weapon('heavyPistol'), 'smoke')).toMatch(/grenades/);
    expect(ammoProblem(weapon('grenadeLauncher'), 'smoke')).toBeNull();
    expect(ammoProblem(weapon('heavyMelee'), 'basic')).toMatch(/ammunition/);
    expect(ammoProblem(weapon('heavyPistol'), 'laser' as never)).toMatch(/Unknown/);
  });
  it('Armor-Piercing ablates 2', () => {
    const t = combatant({ armor: [armor('body', 11)] });
    const r = applyDamage(t, applyAmmo(body, 'armorPiercing'), roll([5, 5, 4]), scriptedDice({}));
    expect(r.target.armor[0]!.currentSP).toBe(9);
  });
  it('Rubber never crits, never ablates, never drops below 1 HP', () => {
    const t = combatant({ armor: [armor('body', 4)], hpCurrent: 6 });
    const r = applyDamage(t, applyAmmo(body, 'rubber'), roll([6, 6, 6]), scriptedDice({}));
    expect(r.target.hp.current).toBe(1);
    expect(r.target.criticalInjuries).toEqual([]);
    expect(r.target.armor[0]!.currentSP).toBe(4);
  });
  it('Incendiary sets the target On Fire when it gets through', () => {
    const t = combatant({ armor: [armor('body', 4)] });
    expect(applyDamage(t, applyAmmo(body, 'incendiary'), roll([5, 2, 1]), scriptedDice({})).target.onFire).toBe(2);
    expect(applyDamage(t, applyAmmo(body, 'incendiary'), roll([1, 1, 1]), scriptedDice({})).target.onFire).toBeUndefined();
  });
  it('Smart ammo with a smartlink gets a second try on a near miss', () => {
    const shooter = withK(combatant({ id: 's', stats: { REF: 6 }, skills: { Handgun: 4 } }), { cyberware: [{ id: 'ts', name: 'Targeting Scope', humanityLoss: 2, effects: [{ kind: 'smartLink' }] }] });
    const w = weapon('heavyPistol', { ammoType: 'smart' });
    // 10 + 2 = 12 vs DV 13 (0–6 m): miss by 1; retry 10 + 8 = 18 hits.
    const out = resolveRangedAttack({ attacker: shooter, defender: combatant({ id: 'd' }), weapon: w, distance: 4, defenderDodges: false }, scriptedDice({ d10: [2, 8] }));
    expect(out.hit).toBe(true);
    expect(out.events.some((e) => e.type === 'smartAmmoRetry')).toBe(true);
    const noLink = resolveRangedAttack({ attacker: combatant({ id: 's', skills: { Handgun: 4 } }), defender: combatant({ id: 'd' }), weapon: w, distance: 4, defenderDodges: false }, scriptedDice({ d10: [2] }));
    expect(noLink.hit).toBe(false);
  });
  it('refuses direct fire and Aimed Shots with launchers', () => {
    const a = combatant({ id: 'a' });
    expect(() => resolveRangedAttack({ attacker: a, defender: combatant({ id: 'd' }), weapon: weapon('grenadeLauncher'), distance: 20 }, scriptedDice({}))).toThrow(/area attack/);
    expect(() => previewRangedAttack({ attacker: a, defender: combatant({ id: 'd' }), weapon: weapon('rocketLauncher'), distance: 20, aimTarget: 'head' })).toThrow(/area attack/);
  });
});

describe('Solo defenses', () => {
  it('Damage Deflection reduces the first damage taken each Round only', () => {
    const t = solo({ damageDeflection: 6 }); // −3
    const spec = { ...body, round: 2 };
    const first = applyDamage(t, spec, roll([5, 5, 4]), scriptedDice({}));
    expect(t.hp.current - first.target.hp.current).toBe(14 - 3);
    const second = applyDamage(first.target, spec, roll([5, 5, 4]), scriptedDice({}));
    expect(first.target.hp.current - second.target.hp.current).toBe(14);
    const nextRound = applyDamage(second.target, { ...spec, round: 3 }, roll([5, 5, 4]), scriptedDice({}));
    expect(second.target.hp.current - nextRound.target.hp.current).toBe(11);
  });
  it('armor stopping everything doesn’t use Damage Deflection', () => {
    const t = withK({ ...solo({ damageDeflection: 2 }), armor: [armor('body', 20)] }, {});
    const r = applyDamage(t, { ...body, round: 1 }, roll([1, 1, 1]), scriptedDice({}));
    expect(r.target.perRound).toBeUndefined();
  });
  it('Spot Weakness damage is added before armor', () => {
    const t = combatant({ armor: [armor('body', 11)] });
    const r = applyDamage(t, { ...body, bonusDamage: 3 }, roll([4, 4, 2]), scriptedDice({}));
    expect(t.hp.current - r.target.hp.current).toBe(13 - 11);
  });
});

describe('Wielding with arm injuries', () => {
  const hurt = (id: string, quickFixed = false) => combatant({ criticalInjuries: [{ injuryId: id, table: 'body', quickFixed }] });
  it('a Broken Arm blocks two-handed weapons but not pistols; a Quick Fix restores the arm', () => {
    expect(wieldProblem(hurt('brokenArm'), weapon('assaultRifle'))).toMatch(/two hands/);
    expect(wieldProblem(hurt('brokenArm'), weapon('heavyPistol'))).toBeNull();
    expect(wieldProblem(hurt('brokenArm', true), weapon('assaultRifle'))).toBeNull();
  });
  it('two lost arms block everything', () => {
    const c = combatant({ criticalInjuries: [{ injuryId: 'brokenArm', table: 'body', quickFixed: false }, { injuryId: 'dismemberedArm', table: 'body', quickFixed: false }] });
    expect(wieldProblem(c, weapon('heavyPistol'))).toMatch(/no working arm/);
    expect(wieldProblem(c, 'brawling')).toMatch(/no working arm/);
  });
});

describe('Healing and treatment', () => {
  it('heals BODY per day at home, double in hospital or with antibodies, nothing on the street', () => {
    const c = combatant({ stats: { BODY: 6 }, hpCurrent: 10 });
    expect(naturalHealing(c, 2, 'home').healed).toBe(12);
    expect(naturalHealing(c, 1, 'hospital').healed).toBe(12);
    expect(naturalHealing(c, 1, 'street').healed).toBe(0);
    const ab = withK(c, { cyberware: [{ id: 'ab', name: 'Enhanced Antibodies', humanityLoss: 2, effects: [{ kind: 'healingMultiplier', value: 2 }] }] });
    expect(naturalHealing(ab, 1, 'home').healed).toBe(12);
    expect(naturalHealing(c, 99, 'home').combatant.hp.current).toBe(c.hp.max);
  });
  it('a Mortally Wounded character must be Stabilized first', () => {
    const dying = combatant({ hpCurrent: 0 });
    expect(naturalHealing(dying, 1, 'home').blocked).toMatch(/Stabilization/);
    expect(naturalHealing({ ...dying, conditions: { ...dying.conditions, stabilized: true } }, 1, 'home').healed).toBeGreaterThan(0);
  });
  it('uses the injury table for Quick Fix and Treatment', () => {
    expect(treatmentDv('brokenArm', 'quickFix', 'Paramedic')).toEqual({ dv: 13 });
    expect(treatmentDv('brokenArm', 'quickFix', 'First Aid')).toHaveProperty('problem');
    expect(treatmentDv('dismemberedArm', 'quickFix', 'Paramedic')).toHaveProperty('problem');
    expect(treatmentDv('foreignObject', 'treatment', 'Paramedic')).toHaveProperty('problem');
    const medic = combatant({ id: 'm', stats: { TECH: 7 }, skills: { Paramedic: 6 } });
    const pt = combatant({ id: 'p', criticalInjuries: [{ injuryId: 'brokenArm', table: 'body', quickFixed: false }] });
    const qf = treatInjury(medic, pt, 0, 'quickFix', 'Paramedic', 13, scriptedDice({ d10: [5] }));
    expect(qf.target.criticalInjuries[0]!.quickFixed).toBe(true);
    const tr = treatInjury(medic, pt, 0, 'treatment', 'Paramedic', 15, scriptedDice({ d10: [5] }));
    expect(tr.target.criticalInjuries).toEqual([]);
    const fail = treatInjury(medic, pt, 0, 'treatment', 'Paramedic', 15, scriptedDice({ d10: [2] }));
    expect(fail.success).toBe(false);
    const fo = combatant({ id: 'p', criticalInjuries: [{ injuryId: 'foreignObject', table: 'body', quickFixed: false }] });
    expect(treatInjury(medic, fo, 0, 'quickFix', 'Paramedic', 13, scriptedDice({ d10: [5] })).target.criticalInjuries).toEqual([]);
  });
});

describe('raySteps', () => {
  it('lists the squares between two centers, with corner pairs', () => {
    expect(raySteps({ x: 0, y: 0 }, { x: 3, y: 0 })).toEqual([{ cell: { x: 1, y: 0 } }, { cell: { x: 2, y: 0 } }]);
    expect(raySteps({ x: 0, y: 0 }, { x: 2, y: 2 })).toEqual([{ pair: [{ x: 1, y: 0 }, { x: 0, y: 1 }] }, { cell: { x: 1, y: 1 } }, { pair: [{ x: 2, y: 1 }, { x: 1, y: 2 }] }]);
  });
});

describe('melee keeps working', () => {
  it('Precision Attack applies to melee too', () => {
    const s = withK(combatant({ id: 's', stats: { DEX: 7 }, skills: { 'Melee Weapon': 5 } }), { role: { id: 'solo', rank: 3, awareness: { precisionAttack: 3 } } });
    const out = resolveMeleeAttack({ attacker: s, defender: combatant({ id: 'd' }), with: { kind: 'weapon', weapon: weapon('mediumMelee') } }, scriptedDice({ d10: [5, 5] }));
    expect(out.attack.modifiers).toContainEqual({ label: 'Precision Attack', value: 1 });
  });
});

describe('Improved Smart ammo', () => {
  it('rerolls the whole attack once on a near miss (with a smartlink)', () => {
    const shooter = withK(combatant({ id: 's', stats: { REF: 6 }, skills: { Handgun: 4 } }), { cyberware: [{ id: 'ts', name: 'Targeting Scope', humanityLoss: 2, effects: [{ kind: 'smartLink' }] }] });
    const w = weapon('heavyPistol', { ammoType: 'improvedSmart' });
    // 10 + 2 = 12 vs DV 13: miss by 1; reroll 10 + 6 = 16 hits.
    const out = resolveRangedAttack({ attacker: shooter, defender: combatant({ id: 'd' }), weapon: w, distance: 4, defenderDodges: false }, scriptedDice({ d10: [2, 6] }));
    expect(out.hit).toBe(true);
    expect(out.events.find((e) => e.type === 'smartAmmoRetry')).toMatchObject({ total: 16 });
  });
});
