/**
 * Exact hit chances for RED's d10 check: a natural 10 adds one more d10, a
 * natural 1 subtracts one (no chaining). Ties go to the defender.
 */

/** Probability of each final d10 value (after the crit roll). */
const D10: ReadonlyMap<number, number> = (() => {
  const m = new Map<number, number>();
  const add = (v: number, p: number) => m.set(v, (m.get(v) ?? 0) + p);
  for (let n = 2; n <= 9; n++) add(n, 0.1);
  for (let k = 1; k <= 10; k++) { add(10 + k, 0.01); add(1 - k, 0.01); }
  return m;
})();

/** P(base + d10 > dv). */
export function chanceToBeat(base: number, dv: number): number {
  let p = 0;
  for (const [v, pv] of D10) if (base + v > dv) p += pv;
  return p;
}

/** P(attack + d10 > defense + d10). */
export function chanceToWinContest(attack: number, defense: number): number {
  let p = 0;
  for (const [d, pd] of D10) p += pd * chanceToBeat(attack, defense + d);
  return p;
}

export const pct = (p: number) => `${Math.round(p * 100)}%`;
