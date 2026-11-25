import { describe, expect, it } from 'vitest';
import { chanceToBeat, chanceToWinContest } from '../src/odds.js';

describe('odds', () => {
  it('sums to 1 across the distribution', () => {
    expect(chanceToBeat(0, -100)).toBeCloseTo(1, 10);
    expect(chanceToBeat(0, 100)).toBe(0);
  });
  it('matches hand-computed values', () => {
    // base 14 vs DV 20: need 7+ → 7,8,9 (0.3) + any 10 (0.1) = 0.4
    expect(chanceToBeat(14, 20)).toBeCloseTo(0.4, 10);
    // Aimed (−8): base 6 vs 20: need 15+ → natural 10 then 5+ on the extra d10 = 0.1 × 0.6
    expect(chanceToBeat(6, 20)).toBeCloseTo(0.06, 10);
  });
  it('gives the defender ties in a contest', () => {
    expect(chanceToWinContest(10, 10)).toBeLessThan(0.5);
  });
});
