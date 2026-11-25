import { describe, expect, it } from 'vitest';
import {
  applyAreaDamage, applyDamage, baseDeathSavePenalty, currentDeathSavePenalty, damageCover, effectiveSP,
  resolveAreaAttack, resolveSuppressiveFire, rollDamage, rollDeathSave, rollInitiative, scriptedDice, stabilize,
  turnStartChecklist, RANGE_DV, WEAPON_TYPES, BODY_CRITS, HEAD_CRITS, type DamageSpec,
} from '../src/index.js';
import { armor, combatant, weapon } from './fixtures.js';

const spec = (o: Partial<DamageSpec> = {}): DamageSpec => ({ source: 'ranged', diceCount: 3, multiplier: 1, location: 'body', halveSP: false, ablation: 1, critTable: 'body', ...o });
const hit = (t: ReturnType<typeof combatant>, s: DamageSpec, d6: number[], extraD6: number[] = []) =>
  applyDamage(t, s, rollDamage(s, scriptedDice({ d6 })), scriptedDice({ d6: extraD6 }));

describe('armor and ablation', () => {
  it('damage ≤ SP: no HP loss and NO ablation', () => {
    const t = combatant({ armor: [armor('body', 11)] });
    const r = hit(t, spec(), [3, 4, 4]); // 11
    expect(r.hpLost).toBe(0);
    expect(effectiveSP(r.target, 'body')).toBe(11);
  });
  it('damage > SP: HP loss and ablate 1', () => {
    const t = combatant({ armor: [armor('body', 11)] });
    const r = hit(t, spec(), [5, 4, 3]); // 12
    expect(r.hpLost).toBe(1);
    expect(effectiveSP(r.target, 'body')).toBe(10);
  });
  it('SP doesn’t stack: highest piece counts, every piece ablates', () => {
    const t = combatant({ armor: [armor('body', 11, 0, 'jack'), armor('body', 7, 0, 'skinweave')] });
    const r = hit(t, spec(), [5, 5, 5]);
    expect(r.hpLost).toBe(4);
    expect(r.target.armor.map((a) => a.currentSP)).toEqual([10, 6]);
  });
  it('body hits never touch head armor', () => {
    const t = combatant({ armor: [armor('body', 4), armor('head', 11)] });
    const r = hit(t, spec(), [5, 5, 5]);
    expect(r.hpLost).toBe(11);
    expect(effectiveSP(r.target, 'head')).toBe(11);
  });
});

describe('Aimed Shots', () => {
  it('head: through-damage × 2 against head SP', () => {
    const t = combatant({ armor: [armor('head', 7), armor('body', 11)] });
    const r = hit(t, spec({ location: 'head', aimTarget: 'head', critTable: 'head' }), [5, 4, 3]); // 12 − 7 = 5 × 2
    expect(r.hpLost).toBe(10);
    expect(effectiveSP(r.target, 'head')).toBe(6);
  });
  it('head with Cracked Skull: × 3', () => {
    const t = combatant({ criticalInjuries: [{ injuryId: 'crackedSkull', table: 'head', quickFixed: false }] });
    const r = hit(t, spec({ location: 'head', aimTarget: 'head', critTable: 'head' }), [1, 1, 2]);
    expect(r.hpLost).toBe(12);
  });
  it('leg: Broken Leg + 5 bonus if damage gets through, once', () => {
    const t = combatant({ armor: [armor('body', 4)] });
    const r = hit(t, spec({ aimTarget: 'leg' }), [2, 2, 1]); // 5 − 4 = 1, +5
    expect(r.hpLost).toBe(6);
    expect(r.target.criticalInjuries.map((i) => i.injuryId)).toEqual(['brokenLeg']);
    const again = hit(r.target, spec({ aimTarget: 'leg' }), [2, 2, 1]);
    expect(again.hpLost).toBe(2); // SP ablated 4 → 3, so 5 − 3; no second Broken Leg
    expect(again.target.criticalInjuries).toHaveLength(1);
  });
  it('leg: nothing if armor stops it', () => {
    const r = hit(combatant({ armor: [armor('body', 11)] }), spec({ aimTarget: 'leg' }), [2, 2, 1]);
    expect(r.target.criticalInjuries).toEqual([]);
  });
  it('held item: drop event only if damage gets through', () => {
    const r = hit(combatant(), spec({ aimTarget: 'heldItem' }), [1, 1, 1]);
    expect(r.events.some((e) => e.type === 'heldItemDropped')).toBe(true);
    const r2 = hit(combatant({ armor: [armor('body', 11)] }), spec({ aimTarget: 'heldItem' }), [1, 1, 1]);
    expect(r2.events.some((e) => e.type === 'heldItemDropped')).toBe(false);
  });
});

describe('Critical Injuries', () => {
  it('two 6s trigger even when armor stops everything; bonus 5 ignores armor and doesn’t ablate', () => {
    const t = combatant({ armor: [armor('body', 18)] });
    // 6 + 6 + 1 = 13 vs SP 18. Crit roll 4+4 = 8 → Broken Leg.
    const r = hit(t, spec(), [6, 6, 1], [4, 4]);
    expect(r.hpLost).toBe(5);
    expect(effectiveSP(r.target, 'body')).toBe(18);
    expect(r.target.criticalInjuries[0]!.injuryId).toBe('brokenLeg');
  });
  it('bonus damage isn’t doubled on headshots', () => {
    const t = combatant();
    const r = hit(t, spec({ location: 'head', aimTarget: 'head', critTable: 'head' }), [6, 6, 1], [1, 1]); // 13 × 2 + 5
    expect(r.hpLost).toBe(31);
    expect(r.target.criticalInjuries[0]!.table).toBe('head');
  });
  it('rerolls injuries the target already has', () => {
    const t = combatant({ criticalInjuries: [{ injuryId: 'brokenLeg', table: 'body', quickFixed: true }] });
    const r = hit(t, spec(), [6, 6, 1], [4, 4, 3, 3]); // 8 (owned) → 6 Broken Arm
    expect(r.target.criticalInjuries.map((i) => i.injuryId)).toEqual(['brokenLeg', 'brokenArm']);
    expect(r.events.some((e) => e.type === 'heldItemDropped')).toBe(true);
  });
  it('full table → GM ruling, no bonus damage, no infinite loop', () => {
    const ids = ['dismemberedArm', 'dismemberedHand', 'collapsedLung', 'brokenRibs', 'brokenArm', 'foreignObject', 'brokenLeg', 'tornMuscle', 'spinalInjury', 'crushedFingers', 'dismemberedLeg'];
    const t = combatant({ hpCurrent: 30, criticalInjuries: ids.map((injuryId) => ({ injuryId, table: 'body' as const, quickFixed: false })) });
    const r = hit(t, spec(), [6, 6, 1]);
    expect(r.hpLost).toBe(13);
    expect(r.events.some((e) => e.type === 'gmRulingRequired')).toBe(true);
  });
  it('Autofire crits on both 2d6 showing 6', () => {
    const s = spec({ source: 'autofire', diceCount: 2, multiplier: 3 });
    const r = hit(combatant({ armor: [armor('body', 11)] }), s, [6, 6], [2, 1]); // 36 − 11 = 25, + 5
    expect(r.hpLost).toBe(30);
  });
});

describe('Mortally Wounded', () => {
  it('a hit that DROPS you to Mortally Wounded doesn’t add the extra crit', () => {
    const r = hit(combatant({ hpCurrent: 5 }), spec(), [3, 3, 3]);
    expect(r.target.hp.current).toBe(-4);
    expect(r.target.criticalInjuries).toEqual([]);
    expect(r.events.find((e) => e.type === 'woundStateChanged')).toMatchObject({ from: 'seriously', to: 'mortally' });
  });
  it('damage while already Mortally Wounded: extra crit and Death Save Penalty +1', () => {
    const r = hit(combatant({ hpCurrent: 0 }), spec(), [3, 3, 3], [5, 5]);
    expect(r.target.criticalInjuries.map((i) => i.injuryId)).toEqual(['spinalInjury']);
    expect(r.target.hp.current).toBe(-14);
    expect(r.target.deathSave.accumulatedPenalty).toBe(1);
  });
  it('armor stopping everything while Mortally Wounded: no extra crit', () => {
    const r = hit(combatant({ hpCurrent: 0, armor: [armor('body', 11)] }), spec(), [3, 3, 3]);
    expect(r.target.criticalInjuries).toEqual([]);
    expect(r.target.deathSave.accumulatedPenalty).toBe(0);
  });
});

describe('Death Saves', () => {
  it('success only if d10 + penalty is UNDER BODY', () => {
    const c = combatant({ hpCurrent: 0, stats: { BODY: 6 } });
    expect(rollDeathSave(c, scriptedDice({ d10: [5] })).success).toBe(true);
    expect(rollDeathSave(c, scriptedDice({ d10: [6] })).success).toBe(false);
  });
  it('natural 10 always fails, even at BODY 12', () => {
    const r = rollDeathSave(combatant({ hpCurrent: 0, stats: { BODY: 12 } }), scriptedDice({ d10: [10] }));
    expect(r.success).toBe(false);
    expect(r.combatant.conditions.dead).toBe(true);
  });
  it('natural 1 doesn’t trigger a Critical Failure die', () => {
    const d = scriptedDice({ d10: [1] });
    rollDeathSave(combatant({ hpCurrent: 0 }), d);
    expect(d.remaining().d10).toBe(0);
  });
  it('penalty climbs each roll and includes injury base penalty', () => {
    let c = combatant({ hpCurrent: 0, stats: { BODY: 8 }, criticalInjuries: [{ injuryId: 'collapsedLung', table: 'body', quickFixed: false }] });
    expect(baseDeathSavePenalty(c)).toBe(1);
    c = rollDeathSave(c, scriptedDice({ d10: [2] })).combatant; // 2 + 1 = 3 < 8
    expect(currentDeathSavePenalty(c)).toBe(2);
    const r = rollDeathSave(c, scriptedDice({ d10: [6] })); // 6 + 2 = 8, not under 8
    expect(r.success).toBe(false);
  });
  it('refuses when not Mortally Wounded', () => {
    expect(() => rollDeathSave(combatant(), scriptedDice({ d10: [1] }))).toThrow();
  });
});

describe('Stabilization', () => {
  const medic = combatant({ id: 'm', stats: { TECH: 7 }, skills: { Paramedic: 6 } });
  it('Mortally Wounded: DV15; success → 1 HP, Unconscious, accumulated penalty reset, base stays', () => {
    const t = combatant({ hpCurrent: -3, deathSave: { accumulatedPenalty: 3 }, criticalInjuries: [{ injuryId: 'spinalInjury', table: 'body', quickFixed: false }] });
    const fail = stabilize(medic, t, 'Paramedic', scriptedDice({ d10: [2] })); // 15, must beat 15
    expect(fail.success).toBe(false);
    const ok = stabilize(medic, t, 'Paramedic', scriptedDice({ d10: [3] }));
    expect(ok.dv).toBe(15);
    expect(ok.combatant.hp.current).toBe(1);
    expect(ok.combatant.conditions.unconscious).toBe(true);
    expect(currentDeathSavePenalty(ok.combatant)).toBe(1);
  });
  it('DV by state: Lightly 10, Seriously 13', () => {
    expect(stabilize(medic, combatant({ hpCurrent: 39 }), 'Paramedic', scriptedDice({ d10: [5] })).dv).toBe(10);
    expect(stabilize(medic, combatant({ hpCurrent: 10 }), 'Paramedic', scriptedDice({ d10: [5] })).dv).toBe(13);
  });
  it('turn-start checklist flags the Death Save', () => {
    expect(turnStartChecklist(combatant({ hpCurrent: 0 })).deathSaveRequired).toBe(true);
  });
});

describe('initiative', () => {
  it('REF (after armor) + d10, ties reroll until settled', () => {
    const a = combatant({ id: 'a', stats: { REF: 7 } });
    const b = combatant({ id: 'b', stats: { REF: 9 }, armor: [armor('body', 13, -2)] });
    const c = combatant({ id: 'c', stats: { REF: 5 } });
    // totals: a 7+5=12, b 7+5=12, c 5+9=14. Tiebreak a vs b: 4,4 then 2,8.
    const { order } = rollInitiative([{ combatant: a }, { combatant: b }, { combatant: c }], scriptedDice({ d10: [5, 5, 9, 4, 4, 2, 8] }));
    expect(order.map((e) => e.combatantId)).toEqual(['c', 'b', 'a']);
  });
});

describe('area attacks', () => {
  const grenadier = combatant({ id: 'g', stats: { REF: 7, DEX: 7 }, skills: { 'Heavy Weapons': 5, Athletics: 5, 'Shoulder Arms': 5, Autofire: 5 } });
  it('Shotgun Shell: DV13, 3d6 rolled once for all targets', () => {
    const o = resolveAreaAttack(grenadier, { kind: 'shotgunShell', weapon: weapon('shotgun') }, scriptedDice({ d10: [2] }));
    expect(o).toMatchObject({ dv: 13, hit: true, damageDice: 3 });
    const { roll, results } = applyAreaDamage(o, [{ combatant: combatant({ id: 'x' }) }, { combatant: combatant({ id: 'y', armor: [armor('body', 7)] }) }], scriptedDice({ d6: [4, 4, 4] }));
    expect(roll.total).toBe(12);
    expect(results.map((r) => 40 - r.target.hp.current)).toEqual([12, 5]);
  });
  it('explosive miss scatters (GM places it)', () => {
    const o = resolveAreaAttack(grenadier, { kind: 'launcher', weapon: weapon('grenadeLauncher'), distance: 20 }, scriptedDice({ d10: [2] }));
    expect(o).toMatchObject({ dv: 15, hit: false, scattered: true, damageDice: 6 });
  });
  it('explosive vs cover: protected if blast < cover HP, else cover gone and full damage', () => {
    const o = resolveAreaAttack(grenadier, { kind: 'thrownGrenade', distance: 10, damageDice: 6 }, scriptedDice({ d10: [8] }));
    const { results } = applyAreaDamage(o, [
      { combatant: combatant({ id: 'p' }), coverHp: 25 },
      { combatant: combatant({ id: 'q' }), coverHp: 20 },
    ], scriptedDice({ d6: [4, 4, 4, 4, 3, 2] })); // 21
    expect(results[0]).toMatchObject({ protectedByCover: true });
    expect(results[1]).toMatchObject({ coverDestroyed: true });
    expect(40 - results[1]!.target.hp.current).toBe(21);
  });
  it('REF 8+ target dodges an area attack by matching the attack total', () => {
    const o = resolveAreaAttack(grenadier, { kind: 'launcher', weapon: weapon('grenadeLauncher'), distance: 5 }, scriptedDice({ d10: [5] })); // 17
    const dodger = combatant({ id: 'd', stats: { REF: 8, DEX: 8 }, skills: { Evasion: 4 } });
    const { results } = applyAreaDamage(o, [{ combatant: dodger, dodges: true }], scriptedDice({ d10: [5], d6: [1, 1, 1, 1, 1, 1] })); // 17 tie → defender
    expect(results[0]!.avoided).toBe(true);
  });
  it('Suppressive Fire: ties go to the target', () => {
    const t = combatant({ id: 's', stats: { WILL: 7 }, skills: { Concentration: 5 } });
    const r = resolveSuppressiveFire(grenadier, weapon('assaultRifle'), [t], scriptedDice({ d10: [5, 5] }));
    expect(r.results[0]!.mustSeekCover).toBe(false);
  });
  it('cover absorbs damage; excess is lost', () => {
    expect(damageCover(10, 25)).toEqual({ hpAfter: 0, destroyed: true });
  });
});

describe('data pack integrity', () => {
  it('every ranged type has a range row; autofire caps are 3 (SMGs) and 4 (AR)', () => {
    for (const p of Object.values(WEAPON_TYPES)) {
      if (!p.melee) expect(RANGE_DV[p.rangeRow!]).toHaveLength(8);
    }
    expect(WEAPON_TYPES.smg.autofire?.cap).toBe(3);
    expect(WEAPON_TYPES.heavySmg.autofire?.cap).toBe(3);
    expect(WEAPON_TYPES.assaultRifle.autofire?.cap).toBe(4);
  });
  it('crit tables cover 2–12 exactly once each', () => {
    for (const t of [BODY_CRITS, HEAD_CRITS]) expect(t.map((d) => d.roll).sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});
