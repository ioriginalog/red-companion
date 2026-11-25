/** Test-only Programs with fixed numbers the netrun tests do arithmetic on. Not shipped. */
import type { Program } from '@cprc/rules-core';

const p = (x: Omit<Program, 'status' | 'rez'>): Program => ({ ...x, rez: x.maxRez, status: 'ready' });
export const TEST_PROGRAMS: Program[] = [
  p({ id: 'worm', name: 'Test Backdoor Booster', class: 'booster', atk: 0, def: 0, maxRez: 7, boost: { ability: 'backdoor', amount: 2 } }),
  p({ id: 'armor', name: 'Test Brain Padding', class: 'defender', atk: 0, def: 0, maxRez: 7, brainReduce: 4 }),
  p({ id: 'shield', name: 'Test Shield', class: 'defender', atk: 0, def: 0, maxRez: 7, shield: true }),
  p({ id: 'sword', name: 'Test ICE Breaker', class: 'attacker', target: 'ice', atk: 1, def: 0, maxRez: 1, damage: { count: 3, sides: 6 } }),
];
