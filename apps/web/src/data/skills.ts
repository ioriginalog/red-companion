/**
 * RED Core skill list: game-term names and linked STATs only, grouped by the
 * book's categories. No rules text.
 */
import type { StatKey } from '@cprc/rules-core';

export interface SkillDef { name: string; stat: StatKey }
export interface SkillGroup { category: string; skills: SkillDef[] }

const s = (name: string, stat: StatKey): SkillDef => ({ name, stat });

export const SKILL_GROUPS: SkillGroup[] = [
  { category: 'Awareness', skills: [s('Concentration', 'WILL'), s('Conceal/Reveal Object', 'INT'), s('Lip Reading', 'INT'), s('Perception', 'INT'), s('Tracking', 'INT')] },
  { category: 'Body', skills: [s('Athletics', 'DEX'), s('Contortionist', 'DEX'), s('Dance', 'DEX'), s('Endurance', 'WILL'), s('Resist Torture/Drugs', 'WILL'), s('Stealth', 'DEX')] },
  { category: 'Control', skills: [s('Drive Land Vehicle', 'REF'), s('Pilot Air Vehicle', 'REF'), s('Pilot Sea Vehicle', 'REF'), s('Riding', 'REF')] },
  {
    category: 'Education',
    skills: [
      s('Accounting', 'INT'), s('Animal Handling', 'INT'), s('Bureaucracy', 'INT'), s('Business', 'INT'), s('Composition', 'INT'),
      s('Criminology', 'INT'), s('Cryptography', 'INT'), s('Deduction', 'INT'), s('Education', 'INT'), s('Gamble', 'INT'),
      s('Language', 'INT'), s('Library Search', 'INT'), s('Local Expert', 'INT'), s('Science', 'INT'), s('Tactics', 'INT'),
      s('Wilderness Survival', 'INT'),
    ],
  },
  { category: 'Fighting', skills: [s('Brawling', 'DEX'), s('Evasion', 'DEX'), s('Martial Arts', 'DEX'), s('Melee Weapon', 'DEX')] },
  { category: 'Performance', skills: [s('Acting', 'COOL'), s('Play Instrument', 'TECH')] },
  { category: 'Ranged Weapon', skills: [s('Archery', 'REF'), s('Autofire', 'REF'), s('Handgun', 'REF'), s('Heavy Weapons', 'REF'), s('Shoulder Arms', 'REF')] },
  {
    category: 'Social',
    skills: [
      s('Bribery', 'COOL'), s('Conversation', 'EMP'), s('Human Perception', 'EMP'), s('Interrogation', 'COOL'), s('Persuasion', 'COOL'),
      s('Personal Grooming', 'COOL'), s('Streetwise', 'COOL'), s('Trading', 'COOL'), s('Wardrobe & Style', 'COOL'),
    ],
  },
  {
    category: 'Technique',
    skills: [
      s('Air Vehicle Tech', 'TECH'), s('Basic Tech', 'TECH'), s('Cybertech', 'TECH'), s('Demolitions', 'TECH'), s('Electronics/Security Tech', 'TECH'),
      s('First Aid', 'TECH'), s('Forgery', 'TECH'), s('Land Vehicle Tech', 'TECH'), s('Paint/Draw/Sculpt', 'TECH'), s('Paramedic', 'TECH'),
      s('Photography/Film', 'TECH'), s('Pick Lock', 'TECH'), s('Pick Pocket', 'TECH'), s('Sea Vehicle Tech', 'TECH'), s('Weaponstech', 'TECH'),
    ],
  },
];

export const ALL_SKILLS: SkillDef[] = SKILL_GROUPS.flatMap((g) => g.skills);
export const SKILL_STAT: Record<string, StatKey> = Object.fromEntries(ALL_SKILLS.map((k) => [k.name, k.stat]));
export const STAT_KEYS: StatKey[] = ['INT', 'REF', 'DEX', 'TECH', 'COOL', 'WILL', 'LUCK', 'MOVE', 'BODY', 'EMP'];
