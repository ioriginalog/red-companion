/**
 * Starter NPC templates. Original to this tool: generic roles with our own
 * illustrative numbers, not stat blocks from any RTG book.
 */
import type { Stats, WeaponType } from '@cprc/rules-core';
import type { ActorDraft, ArmorChoice } from '../editors/actorModel.js';

const stats = (o: Partial<Stats>): Stats => ({ INT: 4, REF: 5, DEX: 5, TECH: 4, COOL: 5, WILL: 4, LUCK: 3, MOVE: 5, BODY: 5, EMP: 3, ...o });
const w = (id: string, name: string, type: WeaponType, capacity: number | null) => ({ id, name, type, capacity, rofOverride: null, damageDiceOverride: null });
const armor = (typeId: string): ArmorChoice => ({ kind: 'type', typeId });

export interface StarterTemplate { key: string; label: string; blurb: string; draft: Omit<ActorDraft, 'id'> }

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    key: 'street-thug', label: 'Street Thug', blurb: 'Pistol and a bad attitude. Folds when the odds turn.',
    draft: {
      name: 'Street Thug', allegiance: 'hostile', controller: 'gm', role: null, cyberware: [], portrait: '/assets/portraits/ganger.webp',
      stats: stats({ REF: 5, DEX: 5, BODY: 5, WILL: 4, COOL: 4 }),
      skills: { Handgun: 4, Brawling: 4, Evasion: 2, Perception: 2, Streetwise: 3, Athletics: 2 },
      weapons: [w('pistol', 'Heavy Pistol', 'heavyPistol', 8), w('knife', 'Knife', 'lightMelee', null)],
      armor: { head: { kind: 'none' }, body: armor('kevlar') }, notes: 'Runs when Seriously Wounded unless cornered.',
    },
  },
  {
    key: 'corp-security', label: 'Corporate Security', blurb: 'Disciplined guard with an SMG and a radio.',
    draft: {
      name: 'Corporate Security', allegiance: 'hostile', controller: 'gm', role: null, cyberware: [], portrait: null,
      stats: stats({ REF: 6, DEX: 6, BODY: 6, WILL: 5, COOL: 6, INT: 5 }),
      skills: { Handgun: 5, Autofire: 4, Evasion: 4, Perception: 5, Tactics: 3, Brawling: 4, 'First Aid': 2 },
      weapons: [w('smg', 'Security SMG', 'smg', 30), w('baton', 'Stun Baton', 'mediumMelee', null)],
      armor: { head: armor('lightArmorjack'), body: armor('lightArmorjack') }, notes: 'Calls for backup on its first Turn.',
    },
  },
  {
    key: 'heavy-enforcer', label: 'Heavy Enforcer', blurb: 'Big, armored, and happy to close to melee.',
    draft: {
      name: 'Heavy Enforcer', allegiance: 'hostile', controller: 'gm', role: null, cyberware: [], portrait: '/assets/portraits/enforcer.webp',
      stats: stats({ REF: 6, DEX: 7, BODY: 8, WILL: 6, MOVE: 5 }),
      skills: { 'Melee Weapon': 6, Brawling: 6, Evasion: 4, 'Shoulder Arms': 4, Endurance: 5, Perception: 3 },
      weapons: [w('blade', 'Heavy Blade', 'heavyMelee', null), w('shotgun', 'Shotgun', 'shotgun', 4)],
      armor: { head: armor('mediumArmorjack'), body: armor('mediumArmorjack') }, notes: '',
    },
  },
  {
    key: 'sniper', label: 'Sniper', blurb: 'Stays at long range with a clear lane of fire.',
    draft: {
      name: 'Sniper', allegiance: 'hostile', controller: 'gm', portrait: null,
      role: { id: 'solo', rank: 4, awareness: { precisionAttack: 3, initiativeReaction: 1 } },
      cyberware: [{ id: 'scope', name: 'Targeting Scope', slot: 'Cyberoptics', humanityLoss: 3, effects: [{ kind: 'smartLink' }] }],
      stats: stats({ REF: 7, DEX: 5, BODY: 5, WILL: 5, COOL: 6, INT: 5 }),
      skills: { 'Shoulder Arms': 7, Handgun: 4, Evasion: 3, Perception: 6, Stealth: 5, Concentration: 5 },
      weapons: [w('rifle', 'Sniper Rifle', 'sniperRifle', 4), w('pistol', 'Medium Pistol', 'mediumPistol', 12)],
      armor: { head: { kind: 'none' }, body: armor('lightArmorjack') }, notes: 'Prefers Aimed Shots at the head.',
    },
  },
  {
    key: 'security-drone', label: 'Security Drone', blurb: 'Fast, fragile, hits from range.',
    draft: {
      name: 'Security Drone', allegiance: 'hostile', controller: 'gm', role: null, cyberware: [], portrait: null,
      stats: stats({ REF: 6, DEX: 6, BODY: 4, WILL: 4, MOVE: 8, INT: 3, EMP: 1, COOL: 8 }),
      skills: { Handgun: 5, Autofire: 3, Evasion: 3, Perception: 6 },
      weapons: [w('smg', 'Mounted SMG', 'smg', 30)],
      armor: { head: armor('lightArmorjack'), body: armor('lightArmorjack') }, notes: 'Machine: the GM rules on Death Saves and Critical Injuries.',
    },
  },
];
