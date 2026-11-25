/**
 * Dice are injected so the engine stays pure and every result is replayable.
 * The authority device uses `seededDice` (or crypto); tests use `scriptedDice`.
 */
export interface Dice {
  d10(): number;
  d6(): number;
}

/** mulberry32: small, fast, good enough for game dice. Not for security. */
export function seededDice(seed: number): Dice {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    d10: () => 1 + Math.floor(next() * 10),
    d6: () => 1 + Math.floor(next() * 6),
  };
}

/** Uses crypto.getRandomValues with rejection sampling (no modulo bias). */
export function cryptoDice(): Dice {
  const roll = (sides: number) => {
    const buf = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / sides) * sides;
    let x: number;
    do {
      globalThis.crypto.getRandomValues(buf);
      x = buf[0]!;
    } while (x >= limit);
    return 1 + (x % sides);
  };
  return { d10: () => roll(10), d6: () => roll(6) };
}

export class DiceExhaustedError extends Error {}

/** Deterministic dice for tests and for replaying logged rolls. Throws when a queue runs dry. */
export function scriptedDice(script: { d10?: number[]; d6?: number[] }): Dice & { remaining(): { d10: number; d6: number } } {
  const d10 = [...(script.d10 ?? [])];
  const d6 = [...(script.d6 ?? [])];
  const take = (q: number[], name: string, sides: number) => {
    const v = q.shift();
    if (v === undefined) throw new DiceExhaustedError(`Scripted ${name} queue is empty`);
    if (!Number.isInteger(v) || v < 1 || v > sides) throw new RangeError(`Invalid ${name} value ${v}`);
    return v;
  };
  return {
    d10: () => take(d10, 'd10', 10),
    d6: () => take(d6, 'd6', 6),
    remaining: () => ({ d10: d10.length, d6: d6.length }),
  };
}
