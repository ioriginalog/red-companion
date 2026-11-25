/**
 * The remaining Role Abilities as table tools. Solo, Netrunner and Medtech
 * live in roles.ts. Status for every number here: Secondary (community
 * references; confirm in the Core book). Descriptions are our own summaries.
 *
 *   Rockerboy, Charismatic Impact: Rank + 1d10 vs DV 8 (one person), 10 (a small
 *     group, up to 6) or 12 (a huge crowd; needs Rank 3+). Success makes fans or
 *     gets a favor scaled to Rank; failure means those fans can't be asked again
 *     for a week.
 *   Lawman, Backup: an Action. Roll 1d10; at or under Rank, help is dispatched and
 *     arrives in 1d6 Rounds (a 6 upgrades it one tier; Rank 10 sends two groups).
 *   Fixer, Operator: haggling is COOL + Trading + Rank + 1d10, opposed by the seller.
 *   Media, Credibility: publishing is Rank + 1d10 + evidence (+1 hard evidence, +2
 *     smoking gun, max +3) vs a DV the GM sets; then the GM rolls 1d10 for
 *     believability (at or under the Rank's value, most people believe it).
 *     Rumors: Rank + 1d10 vs a GM DV.
 *   Exec, Teamwork: a team member at Ranks 3, 5 and 9 (max 3). New members start at
 *     Loyalty 1d6+1 (max 10). Risky orders: the GM rolls 1d6; at or above Loyalty
 *     they may refuse, botch or betray.
 *   Nomad, Moto: Rank adds to driving, piloting and vehicle-tech checks (applied via
 *     roleMods); each new Rank adds a Family vehicle or upgrade of that Rank or lower.
 *   Tech, Maker: 2 specialty points per Rank, each specialty ≤ Rank. Upgrade,
 *     Fabrication and Invention are TECH + a Tech skill + specialty + 1d10 vs a DV
 *     by price category; Field Expertise jury-rigs without a roll for 10 minutes ×
 *     Field rank. Invention starts at Expensive (DV 21).
 */
import { effectiveStat, skillLevel, standingModifiers } from './character.js';
import { beats, makeCheck } from './checks.js';
import type { Dice } from './dice.js';
import type { CheckResult, Combatant, Modifier, RoleState, TeamMember } from './types.js';

const isWhole = (n: unknown, lo: number, hi: number): n is number => Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi;
const rankOf = (c: Combatant, role: RoleState['id']) => (c.role?.id === role ? c.role.rank : 0);

/** Role rank + 1d10 (Role Ability checks). */
function abilityCheck(label: string, rank: number, dice: Dice, extra: Modifier[] = []): CheckResult {
  return makeCheck([{ label, value: rank }], extra, dice);
}

// ----- Rockerboy -----------------------------------------------------------------------

export type Audience = 'single' | 'small' | 'huge';
export const IMPACT_DV: Record<Audience, number> = { single: 8, small: 10, huge: 12 };
export const IMPACT_MIN_RANK: Record<Audience, number> = { single: 1, small: 1, huge: 3 };

/** What fans will do for you, by Rank band and audience (our summary). */
const FAVORS: Record<Audience, [number, string][]> = {
  single: [[1, 'a small favor (a drink, a ride)'], [3, 'a real favor (vouching for you)'], [5, 'a minor crime'], [7, 'risk their life for you'], [9, 'a major crime'], [10, 'sacrifice themselves']],
  small: [[1, 'autographs and attention'], [3, 'hang out, bring the party'], [5, 'act as your posse'], [7, 'a minor crime'], [9, 'a major crime'], [10, 'risk their lives to protect you']],
  huge: [[3, 'buy your work, local buzz'], [5, 'citywide loyalty and big favors'], [7, 'fight your rivals, feed you information'], [9, 'riot on your word'], [10, 'a worldwide following']],
};
export function favorTier(rank: number, audience: Audience): string {
  const tiers = FAVORS[audience].filter(([r]) => r <= rank);
  return tiers.length ? tiers[tiers.length - 1]![1] : 'nothing yet';
}

export function charismaticImpact(c: Combatant, audience: Audience, dice: Dice) {
  const rank = rankOf(c, 'rockerboy');
  if (rank < IMPACT_MIN_RANK[audience]) return { problem: `Moving a huge crowd needs Charismatic Impact ${IMPACT_MIN_RANK[audience]}+.` } as const;
  const check = abilityCheck('Charismatic Impact', rank, dice);
  const dv = IMPACT_DV[audience];
  return { check, dv, success: beats(check.total, dv), favor: favorTier(rank, audience) } as const;
}

// ----- Lawman ---------------------------------------------------------------------------

/** Generic descriptions by tier (no stat blocks). */
export const BACKUP_TIERS: { minRank: number; name: string }[] = [
  { minRank: 1, name: 'Four private security guards on foot' },
  { minRank: 3, name: 'Four patrol officers in two cars' },
  { minRank: 5, name: 'Two county deputies in a fast car' },
  { minRank: 8, name: 'A zone marshal on a superbike' },
  { minRank: 9, name: 'A two-officer heavy tactical team by air' },
  { minRank: 10, name: 'Two federal agents by air (they stay on the case)' },
];
export function backupTier(rank: number): number {
  let t = 0;
  BACKUP_TIERS.forEach((b, i) => { if (rank >= b.minRank) t = i; });
  return t;
}
export function callBackup(c: Combatant, dice: Dice) {
  const rank = rankOf(c, 'lawman');
  const roll = dice.d10();
  const dispatched = rank > 0 && roll <= rank;
  if (!dispatched) return { rank, roll, dispatched: false as const };
  const arrival = dice.d6();
  const tier = Math.min(BACKUP_TIERS.length - 1, backupTier(rank) + (arrival === 6 ? 1 : 0));
  return { rank, roll, dispatched: true as const, rounds: arrival, tier, groups: rank >= 10 ? 2 : 1, who: BACKUP_TIERS[tier]!.name };
}

// ----- Fixer ----------------------------------------------------------------------------

export const OPERATOR_PERKS: [number, string][] = [
  [1, 'Local contacts; Cheap and Everyday goods; prices within 10% of market'],
  [3, 'City-level contacts; Expensive goods; buy 5+ of an item, get 1 free'],
  [5, 'Major city players; Night Market access monthly; job pay +20%'],
  [7, 'Corp and civic heads; Very Expensive goods; pay half now on Luxury items'],
  [9, 'Divisional and state-level contacts; Luxury goods; prices within 20%'],
  [10, 'World-class contacts; Super Luxury goods; double pay on dangerous jobs'],
];
export const operatorPerks = (rank: number) => OPERATOR_PERKS.filter(([r]) => r <= rank).map(([, p]) => p);

export function haggleCheck(c: Combatant, dice: Dice): CheckResult {
  return makeCheck(
    [{ label: 'COOL', value: effectiveStat(c, 'COOL') }, { label: 'Trading', value: skillLevel(c, 'Trading') }, { label: 'Operator', value: rankOf(c, 'fixer') }],
    standingModifiers(c, 'other'),
    dice,
  );
}

// ----- Media ----------------------------------------------------------------------------

export const BELIEVABILITY = [2, 2, 3, 3, 4, 4, 5, 5, 6, 7] as const;
export const AUDIENCE_BY_RANK = ['Neighborhood', 'Neighborhood', 'Local', 'Local', 'Citywide', 'Citywide', 'Statewide', 'Statewide', 'National', 'Worldwide'] as const;
export const believabilityFor = (rank: number) => BELIEVABILITY[Math.max(1, Math.min(10, rank)) - 1]!;

export function publishStory(c: Combatant, dv: number, evidence: number, dice: Dice) {
  const rank = rankOf(c, 'media');
  const ev = Math.max(0, Math.min(3, evidence));
  const check = abilityCheck('Credibility', rank, dice, ev ? [{ label: 'Evidence', value: ev }] : []);
  const success = beats(check.total, dv);
  const believed = success ? dice.d10() : null;
  return {
    check, dv, success, believabilityRoll: believed,
    believed: believed !== null && rank > 0 && believed <= believabilityFor(rank),
    audience: rank > 0 ? AUDIENCE_BY_RANK[rank - 1]! : 'Nobody yet',
  };
}

export function rumorCheck(c: Combatant, dv: number, dice: Dice) {
  const check = abilityCheck('Credibility', rankOf(c, 'media'), dice);
  return { check, dv, success: beats(check.total, dv) };
}

// ----- Exec -----------------------------------------------------------------------------

export const TEAM_KINDS = ['bodyguard', 'covertOperative', 'driver', 'netrunner', 'technician'] as const;
export const TEAM_KIND_LABEL: Record<(typeof TEAM_KINDS)[number], string> = {
  bodyguard: 'Bodyguard', covertOperative: 'Covert Operative', driver: 'Driver', netrunner: 'Netrunner', technician: 'Technician',
};
export const maxTeam = (rank: number) => (rank >= 9 ? 3 : rank >= 5 ? 2 : rank >= 3 ? 1 : 0);
export const newMemberLoyalty = (dice: Dice) => Math.min(10, dice.d6() + 1);
/** Risky order: 1d6 at or above Loyalty → the member may refuse, botch or betray. */
export function loyaltyCheck(member: TeamMember, dice: Dice) {
  const roll = dice.d6();
  return { roll, holds: roll < member.loyalty };
}

// ----- Nomad ----------------------------------------------------------------------------

export const MOTO_SKILLS = ['Drive Land Vehicle', 'Pilot Air Vehicle', 'Pilot Sea Vehicle', 'Air Vehicle Tech', 'Land Vehicle Tech', 'Sea Vehicle Tech'] as const;
export const MOTORPOOL: { minRank: number; vehicles: string }[] = [
  { minRank: 1, vehicles: 'Compact groundcar, gyrocopter, jetski, roadbike' },
  { minRank: 5, vehicles: 'Helicopter, high-performance groundcar, speedboat' },
  { minRank: 7, vehicles: 'AV-4, cabin cruiser, superbike' },
  { minRank: 9, vehicles: 'Aerozep, AV-9, super groundcar, yacht' },
];
export const motorpoolFor = (rank: number) => MOTORPOOL.filter((t) => t.minRank <= rank).map((t) => t.vehicles);

// ----- Tech -----------------------------------------------------------------------------

export type PriceCategory = 'cheap' | 'costly' | 'premium' | 'expensive' | 'veryExpensive' | 'luxury' | 'superLuxury';
export const PRICE_CATEGORIES: PriceCategory[] = ['cheap', 'costly', 'premium', 'expensive', 'veryExpensive', 'luxury', 'superLuxury'];
export const PRICE_LABEL: Record<PriceCategory, string> = {
  cheap: 'Cheap or Everyday', costly: 'Costly', premium: 'Premium', expensive: 'Expensive', veryExpensive: 'Very Expensive', luxury: 'Luxury', superLuxury: 'Super Luxury',
};
export const MAKER_DV: Record<PriceCategory, number> = { cheap: 9, costly: 13, premium: 17, expensive: 21, veryExpensive: 24, luxury: 29, superLuxury: 29 };
export const MAKER_TIME: Record<PriceCategory, string> = {
  cheap: '1 hour', costly: '6 hours', premium: '1 day', expensive: '1 week', veryExpensive: '2 weeks', luxury: '1 month', superLuxury: '1 month per 10,000eb',
};
export type MakerSpecialty = 'upgrade' | 'fabrication' | 'invention';
export const TECH_SKILLS = ['Basic Tech', 'Cybertech', 'Electronics/Security Tech', 'Weaponstech', 'Land Vehicle Tech', 'Sea Vehicle Tech', 'Air Vehicle Tech'] as const;

export function makerCheck(c: Combatant, specialty: MakerSpecialty, skill: string, price: PriceCategory, dice: Dice) {
  const spec = c.role?.id === 'tech' ? c.role.maker?.[specialty] ?? 0 : 0;
  if (spec < 1) return { problem: `This needs ${specialty === 'upgrade' ? 'Upgrade' : specialty === 'fabrication' ? 'Fabrication' : 'Invention'} Expertise.` } as const;
  const effective = specialty === 'invention' && PRICE_CATEGORIES.indexOf(price) < PRICE_CATEGORIES.indexOf('expensive') ? 'expensive' : price;
  const check = makeCheck(
    [{ label: 'TECH', value: effectiveStat(c, 'TECH') }, { label: skill, value: skillLevel(c, skill) }, { label: 'Maker', value: spec }],
    standingModifiers(c, 'other'),
    dice,
  );
  const dv = MAKER_DV[effective];
  return { check, dv, success: beats(check.total, dv), time: MAKER_TIME[effective], price: effective } as const;
}
export const fieldExpertiseMinutes = (c: Combatant) => 10 * (c.role?.id === 'tech' ? c.role.maker?.field ?? 0 : 0);

// ----- Validation -----------------------------------------------------------------------

/** Null if the Round 3 Role fields are valid, else why not. */
export function roleExtraProblem(role: RoleState): string | null {
  if (role.maker !== undefined) {
    if (role.id !== 'tech') return 'Only Techs have Maker.';
    const mk = role.maker as unknown as Record<string, unknown>;
    if (typeof mk !== 'object' || mk === null) return 'Maker must list its specialties.';
    const keys = ['field', 'upgrade', 'fabrication', 'invention'];
    if (Object.keys(mk).some((k) => !keys.includes(k))) return 'Unknown Maker specialty.';
    let total = 0;
    for (const k of keys) {
      const v = mk[k] ?? 0;
      if (!isWhole(v, 0, role.rank)) return `Each Maker specialty must be 0–${role.rank}.`;
      total += v;
    }
    if (total > role.rank * 2) return `Maker points (${total}) can’t exceed ${role.rank * 2}.`;
  }
  if (role.team !== undefined) {
    if (role.id !== 'exec') return 'Only Execs have a Teamwork team.';
    if (!Array.isArray(role.team) || role.team.length > maxTeam(role.rank)) return `Rank ${role.rank} allows ${maxTeam(role.rank)} team member(s).`;
    for (const t of role.team) {
      if (!t || typeof t.name !== 'string' || !t.name.trim() || t.name.length > 60) return 'Each team member needs a name (up to 60 characters).';
      if (!(TEAM_KINDS as readonly string[]).includes(t.kind)) return 'Unknown team member kind.';
      if (!isWhole(t.loyalty, -10, 10)) return 'Loyalty must be a whole number from −10 to 10.';
    }
  }
  if (role.moto !== undefined) {
    if (role.id !== 'nomad') return 'Only Nomads have Moto.';
    const mo = role.moto;
    const list = (x: unknown) => Array.isArray(x) && x.length <= 20 && x.every((s) => typeof s === 'string' && s.length > 0 && s.length <= 80);
    if (!mo || !list(mo.vehicles) || !list(mo.upgrades)) return 'Moto lists up to 20 vehicles and 20 upgrades by name.';
  }
  return null;
}
