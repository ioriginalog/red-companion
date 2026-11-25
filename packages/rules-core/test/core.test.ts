import { describe, expect, it } from 'vitest';
import {
  applyDamage, attacksPerAction, beats, effectiveSP, effectiveStat, maxHP, rangeBandIndex, resolveMeleeAttack,
  resolveRangedAttack, rollD10, rollDamage, scriptedDice, seriouslyWoundedThreshold, standingModifiers, woundState,
  RulesError, type DamageSpec,
} from '../src/index.js';
import { armor, combatant, weapon } from './fixtures.js';

const bodySpec = (o: Partial<DamageSpec> = {}): DamageSpec => ({ source: 'ranged', diceCount: 3, multiplier: 1, location: 'body', halveSP: false, ablation: 1, critTable: 'body', ...o });

describe('derived stats', () => {
  it('HP = 10 + 5 × ceil((BODY + WILL)/2)', () => {
    expect(maxHP(6, 6)).toBe(40);
    expect(maxHP(5, 6)).toBe(40); // 5.5 → 6
    expect(maxHP(8, 3)).toBe(40); // Easy Mode Rockerboy sheet: BODY 8, WILL 3 → 40
    expect(maxHP(2, 2)).toBe(20);
  });
  it('Seriously Wounded threshold rounds up', () => {
    expect(seriouslyWoundedThreshold(35)).toBe(18);
    expect(seriouslyWoundedThreshold(40)).toBe(20);
  });
});

describe('wound states (Core: strictly less than half, rounded up)', () => {
  it.each([
    [40, 40, 'unhurt'], [40, 39, 'lightly'], [40, 20, 'lightly'], [40, 19, 'seriously'],
    [35, 18, 'lightly'], [35, 17, 'seriously'], [40, 1, 'seriously'], [40, 0, 'mortally'], [40, -7, 'mortally'],
  ] as const)('max %i, current %i → %s', (max, current, state) => {
    expect(woundState({ max, current })).toBe(state);
  });
  it('Seriously Wounded −2, Mortally −4 and −6 MOVE (min 1)', () => {
    expect(standingModifiers(combatant({ hpCurrent: 10 }), 'other')).toEqual([{ label: 'Seriously Wounded', value: -2 }]);
    const m = combatant({ hpCurrent: 0, stats: { MOVE: 4 } });
    expect(standingModifiers(m, 'other')).toEqual([{ label: 'Mortally Wounded', value: -4 }]);
    expect(effectiveStat(m, 'MOVE')).toBe(1);
  });
  it('Pain Editor flag ignores only the Seriously Wounded penalty', () => {
    expect(standingModifiers(combatant({ hpCurrent: 10, flags: { ignoreSeriouslyWoundedPenalty: true } }), 'other')).toEqual([]);
    expect(standingModifiers(combatant({ hpCurrent: 0, flags: { ignoreSeriouslyWoundedPenalty: true } }), 'other')).toHaveLength(1);
  });
});

describe('d10 checks', () => {
  it('natural 10 adds one more d10, which never chains', () => {
    expect(rollD10(scriptedDice({ d10: [10, 10] }))).toMatchObject({ kind: 'critSuccess', value: 20 });
  });
  it('natural 1 subtracts one more d10', () => {
    expect(rollD10(scriptedDice({ d10: [1, 7] }))).toMatchObject({ kind: 'critFailure', value: -6 });
  });
  it('ties go to the defender', () => {
    expect(beats(15, 15)).toBe(false);
    expect(beats(16, 15)).toBe(true);
  });
});

describe('range bands', () => {
  it.each([[0, 0], [6, 0], [6.1, 1], [7, 1], [12, 1], [13, 2], [800, 7], [801, -1]])('%f m → band %i', (d, i) => {
    expect(rangeBandIndex(d)).toBe(i);
  });
});

describe('ranged attacks', () => {
  const shooter = combatant({ id: 'a', stats: { REF: 8 }, skills: { Handgun: 6, Autofire: 6, 'Shoulder Arms': 5 } });
  const target = combatant({ id: 't', stats: { REF: 6, DEX: 7 }, skills: { Evasion: 6 } });

  it('uses range DV; pistol at 10 m is DV15', () => {
    const r = resolveRangedAttack({ attacker: shooter, defender: target, weapon: weapon('heavyPistol'), distance: 10 }, scriptedDice({ d10: [2] }));
    expect(r.defenseValue).toBe(15);
    expect(r.attack.total).toBe(16);
    expect(r.hit).toBe(true);
    expect(r.damage).toMatchObject({ diceCount: 3, location: 'body', halveSP: false });
  });

  it('rejects out-of-range (pistol past 200 m)', () => {
    expect(() => resolveRangedAttack({ attacker: shooter, defender: target, weapon: weapon('heavyPistol'), distance: 250 }, scriptedDice({}))).toThrow(RulesError);
  });

  it('only REF 8+ may dodge; dodge replaces the DV even when lower', () => {
    expect(() => resolveRangedAttack({ attacker: shooter, defender: target, weapon: weapon('heavyPistol'), distance: 30, defenderDodges: true }, scriptedDice({ d10: [5, 5] }))).toThrow(/REF 8/);
    const nimble = combatant({ id: 'n', stats: { REF: 8, DEX: 2 } });
    // Pistol DV at 30 m is 25; dodge total 2 + 0 + 3 = 5 → shooter hits easily.
    const r = resolveRangedAttack({ attacker: shooter, defender: nimble, weapon: weapon('heavyPistol'), distance: 30, defenderDodges: true }, scriptedDice({ d10: [2, 3] }));
    expect(r.defenseValue).toBe(5);
    expect(r.hit).toBe(true);
  });

  it('armor penalty lowers REF below the dodge threshold', () => {
    const flak = combatant({ id: 'f', stats: { REF: 9 }, armor: [armor('body', 15, -4)] });
    expect(effectiveStat(flak, 'REF')).toBe(5);
    expect(() => resolveRangedAttack({ attacker: shooter, defender: flak, weapon: weapon('heavyPistol'), distance: 5, defenderDodges: true }, scriptedDice({ d10: [5, 5] }))).toThrow(RulesError);
  });

  it('Aimed Shot: −8 and one attack regardless of ROF', () => {
    const r = resolveRangedAttack({ attacker: shooter, defender: target, weapon: weapon('heavyPistol'), distance: 5, aimTarget: 'head' }, scriptedDice({ d10: [9] }));
    expect(r.attack.total).toBe(8 + 6 + 9 - 8);
    expect(r.damage).toMatchObject({ location: 'head', critTable: 'head', aimTarget: 'head' });
    expect(attacksPerAction(weapon('heavyPistol'))).toBe(2);
    expect(attacksPerAction(weapon('heavyPistol'), { aimed: true })).toBe(1);
  });

  it('Autofire: errata table, 2d6 × min(margin, cap), 10 rounds, no Aimed Shot', () => {
    // Core example: REF 8 + Autofire 6 + 7 = 21 vs AR Autofire DV17 at 14 m → beats by 4 → 2d6 (10) × 4 = 40.
    const ar = weapon('assaultRifle', { ammo: { loaded: 25, capacity: 25 } });
    const r = resolveRangedAttack({ attacker: shooter, defender: target, weapon: ar, distance: 14, mode: 'autofire' }, scriptedDice({ d10: [7] }));
    expect(r.defenseValue).toBe(17);
    expect(r.damage).toMatchObject({ diceCount: 2, multiplier: 4 });
    expect(r.ammoSpent).toBe(10);
    expect(rollDamage(r.damage!, scriptedDice({ d6: [4, 6] })).total).toBe(40);

    const big = resolveRangedAttack({ attacker: shooter, defender: target, weapon: weapon('smg'), distance: 10, mode: 'autofire' }, scriptedDice({ d10: [10, 10] }));
    expect(big.damage!.multiplier).toBe(3); // SMG cap

    expect(() => resolveRangedAttack({ attacker: shooter, defender: target, weapon: ar, distance: 14, mode: 'autofire', aimTarget: 'head' }, scriptedDice({}))).toThrow(/Aimed/);
    expect(() => resolveRangedAttack({ attacker: shooter, defender: target, weapon: weapon('assaultRifle', { ammo: { loaded: 9, capacity: 25 } }), distance: 14, mode: 'autofire' }, scriptedDice({}))).toThrow(/10 rounds/);
    expect(() => resolveRangedAttack({ attacker: shooter, defender: target, weapon: ar, distance: 150, mode: 'autofire' }, scriptedDice({}))).toThrow(/reach/);
    expect(() => resolveRangedAttack({ attacker: shooter, defender: target, weapon: weapon('heavyPistol'), distance: 5, mode: 'autofire' }, scriptedDice({}))).toThrow(/Autofire/);
  });
});

describe('melee', () => {
  const fighter = combatant({ id: 'a', stats: { DEX: 7, BODY: 8 }, skills: { 'Melee Weapon': 6, Brawling: 6, 'Martial Arts (Karate)': 4 } });
  const target = combatant({ id: 't', stats: { DEX: 5 }, skills: { Evasion: 2 }, armor: [armor('body', 11)] });

  it('defender always Evades with DEX + Evasion + 1d10; ties to defender', () => {
    const r = resolveMeleeAttack({ attacker: fighter, defender: target, with: { kind: 'weapon', weapon: weapon('heavyMelee') } }, scriptedDice({ d10: [2, 8] }));
    expect(r.attack.total).toBe(15);
    expect(r.defenseValue).toBe(15);
    expect(r.hit).toBe(false);
  });

  it('melee weapons count half SP rounded up and ablate the real SP', () => {
    const spec = bodySpec({ source: 'melee', halveSP: true });
    const res = applyDamage(target, spec, rollDamage(spec, scriptedDice({ d6: [5, 5, 4] })), scriptedDice({}));
    // SP 11 → counts 6. 14 − 6 = 8.
    expect(res.target.hp.current).toBe(target.hp.current - 8);
    expect(effectiveSP(res.target, 'body')).toBe(10);
  });

  it('Brawling faces full SP and uses BODY damage (BODY 8 → 3d6)', () => {
    const r = resolveMeleeAttack({ attacker: fighter, defender: target, with: { kind: 'brawling' } }, scriptedDice({ d10: [9, 2] }));
    expect(r.damage).toMatchObject({ diceCount: 3, halveSP: false, source: 'brawling' });
    expect(attacksPerAction('brawling')).toBe(2);
  });

  it('Martial Arts: BODY damage, half SP', () => {
    const r = resolveMeleeAttack({ attacker: fighter, defender: target, with: { kind: 'martialArts', form: 'Karate' } }, scriptedDice({ d10: [9, 2] }));
    expect(r.damage).toMatchObject({ diceCount: 3, halveSP: true, source: 'martialArts' });
  });

  it('defender who can’t Evade needs a GM DV', () => {
    const legless = combatant({ id: 'l', criticalInjuries: [{ injuryId: 'dismemberedLeg', table: 'body', quickFixed: false }] });
    expect(() => resolveMeleeAttack({ attacker: fighter, defender: legless, with: { kind: 'brawling' } }, scriptedDice({ d10: [5] }))).toThrow(/Set a DV/);
    const r = resolveMeleeAttack({ attacker: fighter, defender: legless, with: { kind: 'brawling' }, gmDvIfDefenderCannotEvade: 10 }, scriptedDice({ d10: [5] }));
    expect(r.hit).toBe(true);
  });

  it('Torn Muscle applies −2 to melee attacks only', () => {
    const hurt = combatant({ criticalInjuries: [{ injuryId: 'tornMuscle', table: 'body', quickFixed: false }] });
    expect(standingModifiers(hurt, 'meleeAttack')).toEqual([{ label: 'Torn Muscle', value: -2 }]);
    expect(standingModifiers(hurt, 'rangedAttack')).toEqual([]);
  });
});

describe('previewRangedAttack stays in lockstep with resolveRangedAttack', async () => {
  const { previewRangedAttack, resolveRangedAttack, scriptedDice } = await import('../src/index.js');
  const { combatant } = await import('./fixtures.js');
  const solo = () => combatant({ id: 'a', stats: { REF: 8 }, skills: { Handgun: 6 } });
  const ganger = () => combatant({ id: 'b', stats: { REF: 5 } });
  it.each([
    ['single at 10 m', { distance: 10 }],
    ['aimed head at 4 m', { distance: 4, aimTarget: 'head' as const }],
  ])('%s', (_label, extra) => {
    const weapon = { id: 'p', name: 'Heavy Pistol', type: 'heavyPistol' as const, ammo: { loaded: 8, capacity: 8 } };
    const pv = previewRangedAttack({ attacker: solo(), defender: ganger(), weapon, ...extra });
    const out = resolveRangedAttack({ attacker: solo(), defender: ganger(), weapon, defenderDodges: false, ...extra }, scriptedDice({ d10: [5], d6: [] }));
    expect(out.attack.total).toBe(pv.base + pv.modifiers.reduce((s, m) => s + m.value, 0) + 5);
    expect(out.defenseValue).toBe(pv.dv);
  });
});
