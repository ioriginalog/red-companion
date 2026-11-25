import { describe, expect, it } from 'vitest';
import {
  applySystems, backupTier, callBackup, charismaticImpact, favorTier, formLevel, getMove, hpLoss, inflictInjury, knownForms,
  loyaltyCheck, makerCheck, maxTeam, moveRequirementProblem, opposedBrawl, publishStory, resolveFacedown, roleProblem,
  scriptedDice, skillLevel, SPECIAL_MOVES,
} from '../src/index.js';
import { armor, combatant } from './fixtures.js';

describe('grapple', () => {
  it('opposed Brawling: attacker must beat the defender (ties to the defender)', () => {
    const a = combatant({ id: 'a', stats: { DEX: 6 }, skills: { Brawling: 4 } });
    const d = combatant({ id: 'd', stats: { DEX: 6 }, skills: { Brawling: 4 } });
    expect(opposedBrawl(a, d, scriptedDice({ d10: [5, 5] })).attackerWins).toBe(false);
    expect(opposedBrawl(a, d, scriptedDice({ d10: [6, 5] })).attackerWins).toBe(true);
  });
  it('choke damage skips armor and stops at 1 HP, knocking the target out', () => {
    const t = combatant({ hpCurrent: 5, armor: [armor('body', 11)] });
    const r = hpLoss(t, 7, scriptedDice({}), { floorAtOne: true });
    expect(r.target.hp.current).toBe(1);
    expect(r.knockedOut).toBe(true);
    expect(r.target.conditions.unconscious).toBe(true);
    expect(r.target.armor[0]!.currentSP).toBe(11);
  });
  it('throw damage skips armor without a floor', () => {
    const t = combatant({ hpCurrent: 20, armor: [armor('body', 11)] });
    const r = hpLoss(t, 6, scriptedDice({}));
    expect(r.target.hp.current).toBe(14);
    expect(r.knockedOut).toBe(false);
  });
});

describe('Martial Arts special moves', () => {
  it('reads Form levels and known Forms', () => {
    const c = combatant({ skills: { 'Martial Arts (Karate)': 3, 'Martial Arts (Judo)': 0 } });
    expect(formLevel(c, 'Karate')).toBe(3);
    expect(knownForms(c)).toEqual(['Karate']);
  });
  it('checks STAT and Form requirements', () => {
    const strike = getMove('karate.boneBreak')!;
    expect(moveRequirementProblem(combatant({ skills: { 'Martial Arts (Karate)': 2 }, stats: { WILL: 7 } }), strike)).toMatch(/WILL 8/);
    expect(moveRequirementProblem(combatant({ skills: { 'Martial Arts (Karate)': 2 }, stats: { WILL: 8 } }), strike)).toBeNull();
    expect(moveRequirementProblem(combatant({ stats: { WILL: 8 } }), strike)).toMatch(/Karate 1/);
  });
  it('inflicts a named injury with the bonus damage, once', () => {
    const t = combatant({ hpCurrent: 30, armor: [armor('body', 11)] });
    const r = inflictInjury(t, 'brokenRibs', scriptedDice({}));
    expect(r.target.criticalInjuries.map((i) => i.injuryId)).toEqual(['brokenRibs']);
    expect(r.target.hp.current).toBe(25);
    expect(inflictInjury(r.target, 'brokenRibs', scriptedDice({})).events).toEqual([]);
  });
  it('every move has a Form, a summary and a valid effect', () => {
    for (const m of SPECIAL_MOVES) {
      expect(m.form.length).toBeGreaterThan(0);
      expect(m.summary.endsWith('.')).toBe(true);
    }
    expect(SPECIAL_MOVES.filter((m) => m.core)).toHaveLength(8);
  });
});

describe('Facedown', () => {
  it('COOL + Reputation + 1d10; ties mean nothing happens', () => {
    const a = { ...combatant({ id: 'a', stats: { COOL: 6 } }), reputation: 2 };
    const b = { ...combatant({ id: 'b', stats: { COOL: 7 } }), reputation: 1 };
    expect(resolveFacedown(a, b, scriptedDice({ d10: [5, 5] })).winner).toBeNull();
    const r = resolveFacedown(a, b, scriptedDice({ d10: [6, 5] }));
    expect(r.a.total).toBe(14);
    expect(r.winner).toBe('a');
  });
});

describe('Role Abilities', () => {
  const role = (id: never, rank: number, extra = {}) => ({ ...combatant(), role: { id, rank, ...extra } });

  it('Charismatic Impact: Rank + 1d10 must beat the audience DV; huge crowds need Rank 3', () => {
    const c = role('rockerboy' as never, 2);
    expect('problem' in charismaticImpact(c, 'huge', scriptedDice({ d10: [5] }))).toBe(true);
    const r = charismaticImpact(c, 'single', scriptedDice({ d10: [7] }));
    expect('success' in r && r.success).toBe(true); // 2 + 7 = 9 > 8
    const miss = charismaticImpact(c, 'small', scriptedDice({ d10: [8] }));
    expect('success' in miss && miss.success).toBe(false); // 10 vs 10: tie fails
    expect(favorTier(1, 'huge')).toBe('nothing yet');
  });

  it('Backup: 1d10 at or under Rank dispatches; a 6 on arrival upgrades the tier', () => {
    const c = role('lawman' as never, 4);
    expect(callBackup(c, scriptedDice({ d10: [5] })).dispatched).toBe(false);
    const ok = callBackup(c, scriptedDice({ d10: [4], d6: [6] }));
    expect(ok.dispatched && ok.tier).toBe(backupTier(4) + 1);
    expect(ok.dispatched && ok.rounds).toBe(6);
  });

  it('Credibility: evidence caps at +3; believability uses the Rank table', () => {
    const c = role('media' as never, 5);
    const r = publishStory(c, 12, 9, scriptedDice({ d10: [5, 4] }));
    expect(r.check.total).toBe(13);
    expect(r.success).toBe(true);
    expect(r.believed).toBe(true); // 4 ≤ 4 at Rank 5
  });

  it('Teamwork: members at Ranks 3, 5 and 9; loyalty holds under the roll', () => {
    expect([2, 3, 5, 9].map(maxTeam)).toEqual([0, 1, 2, 3]);
    expect(loyaltyCheck({ name: 'Ana', kind: 'driver', loyalty: 4 }, scriptedDice({ d6: [3] })).holds).toBe(true);
    expect(loyaltyCheck({ name: 'Ana', kind: 'driver', loyalty: 4 }, scriptedDice({ d6: [4] })).holds).toBe(false);
  });

  it('Moto adds Rank to driving and vehicle tech', () => {
    const c = applySystems({ ...combatant({ skills: { 'Drive Land Vehicle': 3 } }), role: { id: 'nomad', rank: 4 } });
    expect(skillLevel(c, 'Drive Land Vehicle')).toBe(7);
    expect(skillLevel(c, 'Land Vehicle Tech')).toBe(4);
  });

  it('Maker: needs the specialty; Invention starts at Expensive', () => {
    const c = { ...combatant({ stats: { TECH: 7 }, skills: { Weaponstech: 5 } }), role: { id: 'tech' as const, rank: 3, maker: { field: 1, upgrade: 2, fabrication: 2, invention: 1 } } };
    const r = makerCheck(c, 'invention', 'Weaponstech', 'cheap', scriptedDice({ d10: [6] }));
    expect('dv' in r && r.dv).toBe(21);
    expect('check' in r ? r.check?.total : null).toBe(19);
    const none = { ...c, role: { id: 'tech' as const, rank: 3, maker: { field: 3, upgrade: 0, fabrication: 0, invention: 0 } } };
    expect('problem' in makerCheck(none, 'upgrade', 'Basic Tech', 'cheap', scriptedDice({}))).toBe(true);
  });

  it('validates the new Role fields', () => {
    expect(roleProblem({ id: 'tech', rank: 2, maker: { field: 2, upgrade: 2, fabrication: 1, invention: 0 } })).toMatch(/can’t exceed 4/);
    expect(roleProblem({ id: 'tech', rank: 2, maker: { field: 3, upgrade: 0, fabrication: 0, invention: 0 } })).toMatch(/0–2/);
    expect(roleProblem({ id: 'solo', rank: 2, maker: { field: 1, upgrade: 0, fabrication: 0, invention: 0 } })).toMatch(/Only Techs/);
    expect(roleProblem({ id: 'exec', rank: 3, team: [{ name: 'A', kind: 'driver', loyalty: 3 }, { name: 'B', kind: 'driver', loyalty: 3 }] })).toMatch(/allows 1/);
    expect(roleProblem({ id: 'exec', rank: 3, team: [{ name: 'A', kind: 'pilot' as never, loyalty: 3 }] })).toMatch(/Unknown team/);
    expect(roleProblem({ id: 'nomad', rank: 1, moto: { vehicles: ['Roadbike'], upgrades: [] } })).toBeNull();
  });
});
