/**
 * Netrunning tables and starter content.
 *
 * Tables (NET Actions per Interface rank, DV tiers, deck slots) are RED Core
 * as reported by community references: status Secondary.
 * Program and ICE starters are ORIGINAL designs (own names, numbers and
 * summaries), not the book's. Official ones come in through rules packs.
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

/**
 * Starter Programs: ORIGINAL to this tool. Names, numbers and summaries are our
 * own designs, comparable in role to the book's boosters, defenders and
 * attackers but not copies of them. Import your book's Programs as a rules pack
 * (Characters tab → Rules Packs) if you want the official ones.
 */
export const PROGRAM_TEMPLATES: Program[] = [
  p({ id: 'lockpick', name: 'Lockpick', class: 'booster', atk: 0, def: 0, maxRez: 6, boost: { ability: 'backdoor', amount: 1 }, summary: 'Original. A small edge against Passwords.' }),
  p({ id: 'cartographer', name: 'Cartographer', class: 'booster', atk: 0, def: 0, maxRez: 6, boost: { ability: 'pathfinder', amount: 1 }, summary: 'Original. Maps floors a little better.' }),
  p({ id: 'ghostwalk', name: 'Ghostwalk', class: 'booster', atk: 0, def: 0, maxRez: 6, boost: { ability: 'cloak', amount: 1 }, summary: 'Original. Helps hide your trail.' }),
  p({ id: 'quickstep', name: 'Quickstep', class: 'booster', atk: 0, def: 0, maxRez: 6, boost: { ability: 'speed', amount: 1 }, summary: 'Original. A head start against Black ICE.' }),
  p({ id: 'padding', name: 'Static Padding', class: 'defender', atk: 0, def: 0, maxRez: 8, brainReduce: 3, summary: 'Original. Soaks a little brain damage while it runs.' }),
  p({ id: 'decoy', name: 'Decoy Shell', class: 'defender', atk: 0, def: 0, maxRez: 5, shield: true, summary: 'Original. Takes the first brain damage of the run, then drops.' }),
  p({ id: 'cleaver', name: 'Cleaver', class: 'attacker', target: 'ice', atk: 2, def: 0, maxRez: 2, damage: { count: 2, sides: 6 }, summary: 'Original. A reliable hit on Black ICE.' }),
  p({ id: 'needle', name: 'Needle', class: 'attacker', target: 'ice', atk: 3, def: 0, maxRez: 2, damage: { count: 1, sides: 6 }, summary: 'Original. Accurate but light.' }),
];

/** Starter Black ICE. Entirely original designs and numbers. */
export const ICE_TEMPLATES: IceStats[] = [
  { name: 'Tripwire', kind: 'antiPersonnel', per: 2, spd: 4, atk: 4, def: 2, rez: 10, damage: { count: 2, sides: 6 }, effect: 'Pings the owner’s security when it lands.' },
  { name: 'Gatekeeper', kind: 'antiPersonnel', per: 4, spd: 4, atk: 6, def: 4, rez: 20, damage: { count: 3, sides: 6 } },
  { name: 'Lamprey', kind: 'antiProgram', per: 3, spd: 6, atk: 5, def: 3, rez: 15, damage: { count: 3, sides: 6 } },
  { name: 'Bloodhound', kind: 'antiPersonnel', per: 6, spd: 6, atk: 5, def: 4, rez: 20, damage: { count: 2, sides: 6 }, effect: 'Follows the runner between floors.' },
  { name: 'Warden', kind: 'antiPersonnel', per: 4, spd: 2, atk: 8, def: 6, rez: 30, damage: { count: 4, sides: 6 } },
];
