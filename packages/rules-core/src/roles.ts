/**
 * Roles and Role Abilities. Ranks are 1–10.
 *
 * Solo Combat Awareness: rank points are split among sub-abilities (total ≤ rank).
 * Costs (Secondary, community references):
 *   Damage Deflection 2/4/6/8/10 → −1..−5 to the first damage taken each Round.
 *   Fumble Recovery 4 → attack rolls of a natural 1 don't subtract a second die.
 *   Initiative Reaction 1 per +1 Initiative.
 *   Precision Attack 3/6/9 → +1/+2/+3 to attacks.
 *   Spot Weakness 1 per +1 damage (before armor) on the first successful attack each Round.
 *   Threat Detection 1 per +1 Perception.
 * Medtech Medicine: one specialty point per rank. Surgery gives 2 Surgery skill
 * per point (max 10); Pharmaceuticals and Cryosystem Operation each give 1
 * Medical Tech per point (max 5 points each).
 * Netrunner: Interface rank = role rank (read by Netrunning via `interfaceRank`).
 */
import type { AwarenessKey, CombatMods, Combatant, RoleId, RoleState } from './types.js';
import { MOTO_SKILLS, roleExtraProblem } from './roles-extra.js'; // Round 3 X

export const ROLES: { id: RoleId; name: string; ability: string }[] = [
  { id: 'rockerboy', name: 'Rockerboy', ability: 'Charismatic Impact' },
  { id: 'solo', name: 'Solo', ability: 'Combat Awareness' },
  { id: 'netrunner', name: 'Netrunner', ability: 'Interface' },
  { id: 'tech', name: 'Tech', ability: 'Maker' },
  { id: 'medtech', name: 'Medtech', ability: 'Medicine' },
  { id: 'media', name: 'Media', ability: 'Credibility' },
  { id: 'exec', name: 'Exec', ability: 'Teamwork' },
  { id: 'lawman', name: 'Lawman', ability: 'Backup' },
  { id: 'fixer', name: 'Fixer', ability: 'Operator' },
  { id: 'nomad', name: 'Nomad', ability: 'Moto' },
];

export interface AwarenessDef { key: AwarenessKey; name: string; summary: string; allowed: (pts: number) => boolean }

export const AWARENESS: AwarenessDef[] = [
  { key: 'damageDeflection', name: 'Damage Deflection', summary: 'Reduce the first damage you take each Round by 1 per 2 points (max 5).', allowed: (p) => p % 2 === 0 && p <= 10 },
  { key: 'fumbleRecovery', name: 'Fumble Recovery', summary: '4 points: a natural 1 on an attack is just a 1.', allowed: (p) => p === 0 || p === 4 },
  { key: 'initiativeReaction', name: 'Initiative Reaction', summary: '+1 Initiative per point.', allowed: (p) => p <= 10 },
  { key: 'precisionAttack', name: 'Precision Attack', summary: '+1 to attacks per 3 points (max +3).', allowed: (p) => p % 3 === 0 && p <= 9 },
  { key: 'spotWeakness', name: 'Spot Weakness', summary: '+1 damage per point on your first hit each Round (before armor).', allowed: (p) => p <= 10 },
  { key: 'threatDetection', name: 'Threat Detection', summary: '+1 Perception per point.', allowed: (p) => p <= 10 },
];

const isWhole = (n: unknown, lo: number, hi: number): n is number => Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi;

/** Null if valid, else the reason. */
export function roleProblem(role: RoleState): string | null {
  if (!role || !ROLES.some((r) => r.id === role.id)) return 'Unknown Role.';
  if (!isWhole(role.rank, 1, 10)) return 'Role rank must be 1–10.';
  if (role.awareness !== undefined) {
    if (role.id !== 'solo') return 'Only Solos have Combat Awareness.';
    const p = awarenessProblem(role.awareness, role.rank);
    if (p) return p;
  }
  if (role.medicine !== undefined) {
    if (role.id !== 'medtech') return 'Only Medtechs have Medicine.';
    const { surgery, pharmaceuticals, cryosystem } = role.medicine;
    if (!isWhole(surgery, 0, 10) || !isWhole(pharmaceuticals, 0, 5) || !isWhole(cryosystem, 0, 5)) return 'Medicine points: Surgery 0–10, Pharmaceuticals and Cryosystem 0–5.';
    if (surgery + pharmaceuticals + cryosystem > role.rank) return `Medicine points can’t exceed rank ${role.rank}.`;
  }
  if (role.notes !== undefined && (typeof role.notes !== 'string' || role.notes.length > 2000)) return 'Role notes are too long.';
  return roleExtraProblem(role); // Round 3 X: Maker, Teamwork, Moto
}

export function awarenessProblem(alloc: Partial<Record<AwarenessKey, number>>, rank: number): string | null {
  if (typeof alloc !== 'object' || alloc === null) return 'Allocation must be an object.';
  let total = 0;
  for (const [k, v] of Object.entries(alloc)) {
    const def = AWARENESS.find((d) => d.key === k);
    if (!def) return `Unknown Combat Awareness ability: ${k}.`;
    if (!isWhole(v, 0, 10) || !def.allowed(v)) return `${def.name} can’t take ${String(v)} points.`;
    total += v;
  }
  if (total > rank) return `Combat Awareness points (${total}) can’t exceed rank ${rank}.`;
  return null;
}

export function roleMods(role: RoleState | undefined): CombatMods {
  if (!role) return {};
  const m: CombatMods = {};
  if (role.id === 'solo' && role.awareness) {
    const a = role.awareness;
    if (a.damageDeflection) m.damageDeflection = a.damageDeflection / 2;
    if (a.fumbleRecovery) m.fumbleRecovery = true;
    if (a.initiativeReaction) m.initiative = a.initiativeReaction;
    if (a.precisionAttack) m.attack = a.precisionAttack / 3;
    if (a.spotWeakness) m.spotWeakness = a.spotWeakness;
    if (a.threatDetection) m.skillBonuses = { Perception: a.threatDetection };
  }
  if (role.id === 'medtech' && role.medicine) {
    const { surgery, pharmaceuticals, cryosystem } = role.medicine;
    m.skillBonuses = { Surgery: Math.min(10, surgery * 2), 'Medical Tech': pharmaceuticals + cryosystem };
  }
  // --- Round 3 X --- Nomad Moto: Rank adds to driving, piloting and vehicle-tech checks.
  if (role.id === 'nomad') m.skillBonuses = Object.fromEntries(MOTO_SKILLS.map((s) => [s, role.rank]));
  return m;
}

/** Interface rank for Netrunning: a Netrunner's role rank, else 0. */
export function interfaceRank(c: Pick<Combatant, 'role'>): number {
  return c.role?.id === 'netrunner' ? c.role.rank : 0;
}
