/** Linked STAT for RED skills (game terms only). Unknown skills fall back to the GM's call: no STAT. */
import type { StatKeyName } from '@cprc/session';

const MAP: Record<string, StatKeyName> = {
  Concentration: 'WILL', 'Conceal/Reveal Object': 'INT', 'Lip Reading': 'INT', Perception: 'INT', Tracking: 'INT',
  Athletics: 'DEX', Contortionist: 'DEX', Dance: 'DEX', Endurance: 'WILL', 'Resist Torture/Drugs': 'WILL', Stealth: 'DEX',
  'Drive Land Vehicle': 'REF', 'Pilot Air Vehicle': 'REF', 'Pilot Sea Vehicle': 'REF', Riding: 'REF',
  Accounting: 'INT', 'Animal Handling': 'INT', Bureaucracy: 'INT', Business: 'INT', Composition: 'INT', Criminology: 'INT',
  Cryptography: 'INT', Deduction: 'INT', Education: 'INT', Gamble: 'INT', 'Library Search': 'INT', 'Local Expert': 'INT',
  Science: 'INT', Tactics: 'INT', 'Wilderness Survival': 'INT', Language: 'INT',
  Brawling: 'DEX', Evasion: 'DEX', 'Martial Arts': 'DEX', 'Melee Weapon': 'DEX',
  Acting: 'COOL', 'Play Instrument': 'TECH',
  Archery: 'REF', Autofire: 'REF', Handgun: 'REF', 'Heavy Weapons': 'REF', 'Shoulder Arms': 'REF',
  Bribery: 'COOL', Conversation: 'EMP', 'Human Perception': 'EMP', Interrogation: 'COOL', Persuasion: 'COOL',
  'Personal Grooming': 'COOL', Streetwise: 'COOL', Trading: 'COOL', 'Wardrobe & Style': 'COOL',
  'Air Vehicle Tech': 'TECH', 'Basic Tech': 'TECH', Cybertech: 'TECH', Demolitions: 'TECH', 'Electronics/Security Tech': 'TECH',
  'First Aid': 'TECH', Forgery: 'TECH', 'Land Vehicle Tech': 'TECH', 'Paint/Draw/Sculpt': 'TECH', Paramedic: 'TECH',
  'Photography/Film': 'TECH', 'Pick Lock': 'TECH', 'Pick Pocket': 'TECH', 'Sea Vehicle Tech': 'TECH', Weaponstech: 'TECH',
};

export function linkedStat(skill: string): StatKeyName | undefined {
  if (MAP[skill]) return MAP[skill];
  const k = Object.keys(MAP).find((s) => s.toLowerCase() === skill.toLowerCase());
  return k ? MAP[k] : undefined;
}
