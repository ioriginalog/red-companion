import { maxHP } from '../src/character.js';
import type { ArmorPiece, Combatant, Stats, Weapon } from '../src/types.js';

const DEFAULT_STATS: Stats = { INT: 6, REF: 6, DEX: 6, TECH: 6, COOL: 6, WILL: 6, LUCK: 6, MOVE: 6, BODY: 6, EMP: 6 };

export function armor(location: 'body' | 'head', sp: number, penalty = 0, id = `${location}-${sp}`): ArmorPiece {
  return { id, name: `SP${sp} ${location}`, location, maxSP: sp, currentSP: sp, penalty };
}

export function combatant(over: Partial<Omit<Combatant, 'stats'>> & { stats?: Partial<Stats>; hpCurrent?: number } = {}): Combatant {
  const stats = { ...DEFAULT_STATS, ...over.stats };
  const max = over.hp?.max ?? maxHP(stats.BODY, stats.WILL);
  return {
    id: over.id ?? 'c1',
    name: over.name ?? 'Test Subject',
    side: over.side ?? 'npc',
    stats,
    skills: over.skills ?? {},
    hp: over.hp ?? { max, current: over.hpCurrent ?? max },
    armor: over.armor ?? [],
    criticalInjuries: over.criticalInjuries ?? [],
    deathSave: over.deathSave ?? { accumulatedPenalty: 0 },
    conditions: { prone: false, unconscious: false, dead: false, stabilized: false, ...over.conditions },
    flags: over.flags,
  };
}

export function weapon(type: Weapon['type'], over: Partial<Weapon> = {}): Weapon {
  return { id: `w-${type}`, name: type, type, ...over };
}
