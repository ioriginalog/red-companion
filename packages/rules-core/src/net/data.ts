/**
 * Netrunning tables and starter content.
 *
 * Tables (NET Actions per Interface rank, DV tiers, deck slots) are RED Core
 * as reported by community references: status Secondary.
 * Program and ICE starters are ORIGINAL: own numbers, own one-line summaries.
 * They are placeholders for the GM to edit against their book.
 */
import type { IceStats, NetDifficulty, Program } from './types.js';

/** NET Actions per Turn by Interface rank: 1–3 → 2, 4–6 → 3, 7–9 → 4, 10 → 5. (Secondary) */
export function netActionsFor(interfaceRank: number): number {
  if (interfaceRank >= 10) return 5;
  if (interfaceRank >= 7) return 4;
  if (interfaceRank >= 4) return 3;
  return 2;
}

/** Floor DV by architecture difficulty. (Secondary) */
export const NET_DV: Record<NetDifficulty, number> = { basic: 6, standard: 8, uncommon: 10, advanced: 12 };

/** Cyberdeck Program slots by quality. (Secondary) */
export const DECK_SLOTS = { poor: 5, standard: 7, excellent: 9 } as const;

/** Jack In range from an access point: 6 m/yds = 3 squares; walls block. (Secondary) */
export const JACK_IN_RANGE_SQUARES = 3;

/** Edgerunners Mission Kit 2070s Quickhack reach: a visible target's neuroport within 50 m/yds = 25 squares. (Secondary, public summaries) */
export const QUICKHACK_RANGE_SQUARES = 25;

/** Restarting a Derezzed Program costs this many NET Actions. (Secondary) */
export const RESTART_COST = 2;

const p = (x: Omit<Program, 'status' | 'rez'> & { rez?: number }): Program => ({ ...x, rez: x.rez ?? x.maxRez, status: 'ready' });

/** Starter Programs. Game-term names; stats and summaries are this tool's own. Edit to match your book. */
export const PROGRAM_TEMPLATES: Program[] = [
  p({ id: 'worm', name: 'Worm', class: 'booster', atk: 0, def: 0, maxRez: 7, boost: { ability: 'backdoor', amount: 2 }, summary: 'Helps you slip past Passwords.' }),
  p({ id: 'see-ya', name: 'See Ya', class: 'booster', atk: 0, def: 0, maxRez: 7, boost: { ability: 'pathfinder', amount: 2 }, summary: 'Sharpens Pathfinder.' }),
  p({ id: 'eraser', name: 'Eraser', class: 'booster', atk: 0, def: 0, maxRez: 7, boost: { ability: 'cloak', amount: 2 }, summary: 'Better at covering your tracks.' }),
  p({ id: 'speedy', name: 'Speedy Gonzalvez', class: 'booster', atk: 0, def: 0, maxRez: 7, boost: { ability: 'speed', amount: 2 }, summary: 'Faster off the mark against Black ICE.' }),
  p({ id: 'armor', name: 'Armor', class: 'defender', atk: 0, def: 0, maxRez: 7, brainReduce: 4, summary: 'Soaks some brain damage while running.' }),
  p({ id: 'shield', name: 'Shield', class: 'defender', atk: 0, def: 0, maxRez: 7, shield: true, summary: 'Eats the first brain damage of the run, then drops.' }),
  p({ id: 'sword', name: 'Sword', class: 'attacker', target: 'ice', atk: 1, def: 0, maxRez: 1, damage: { count: 3, sides: 6 }, summary: 'Hits Black ICE hard.' }),
  p({ id: 'banhammer', name: 'Banhammer', class: 'attacker', target: 'ice', atk: 1, def: 0, maxRez: 1, damage: { count: 2, sides: 6 }, summary: 'Hits Black ICE, lighter than Sword.' }),
];

/** Starter Black ICE. Entirely original designs and numbers. */
export const ICE_TEMPLATES: IceStats[] = [
  { name: 'Tripwire', kind: 'antiPersonnel', per: 2, spd: 4, atk: 4, def: 2, rez: 10, damage: { count: 2, sides: 6 }, effect: 'Pings the owner’s security when it lands.' },
  { name: 'Gatekeeper', kind: 'antiPersonnel', per: 4, spd: 4, atk: 6, def: 4, rez: 20, damage: { count: 3, sides: 6 } },
  { name: 'Lamprey', kind: 'antiProgram', per: 3, spd: 6, atk: 5, def: 3, rez: 15, damage: { count: 3, sides: 6 } },
  { name: 'Bloodhound', kind: 'antiPersonnel', per: 6, spd: 6, atk: 5, def: 4, rez: 20, damage: { count: 2, sides: 6 }, effect: 'Follows the runner between floors.' },
  { name: 'Warden', kind: 'antiPersonnel', per: 4, spd: 2, atk: 8, def: 6, rez: 30, damage: { count: 4, sides: 6 } },
];
