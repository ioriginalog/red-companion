/** Combat log lines. Sentence case (Chicago); names come from the viewer's projection. */
import { getInjury, type CheckResult, type CombatEvent } from '@cprc/rules-core';
import { narrateSystems } from './systems/narrate.js'; // Track K
import { narrateExtras } from './extras/narrate.js'; // Round 3 X

export type Tone = 'hit' | 'miss' | 'info' | 'bad' | 'good' | 'chat' | 'roll';
export interface Line { text: string; tone: Tone }

const LOC: Record<string, string> = { head: 'head', body: 'body' };
const roll = (c: CheckResult) => (c.redacted ? `${c.total}` : `${c.total} (${c.roll.natural}${c.roll.kind === 'critSuccess' ? ' crit' : c.roll.kind === 'critFailure' ? ' fumble' : ''})`);

const CONDITION: Record<string, string> = { prone: 'Prone', unconscious: 'Unconscious', dead: 'Dead', stabilized: 'Stabilized' };

/** Critical Injuries are game terms: title case from the rules data, else from the id. */
export function injuryName(id: string): string {
  try { return getInjury(id).name; } catch { return id.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim(); }
}

/** `who` names a viewer id ('gm' or a player id); defaults to 'GM'/'A player'. */
export function narrate(e: CombatEvent, name: (id: string) => string, who: (by: string) => string = (b) => (b === 'gm' ? 'GM' : 'A player')): Line | null {
  const k = narrateSystems(e, name); // Track K events
  if (k !== undefined) return k;
  if (e.type === 'extraResolved') return narrateExtras(e); // Round 3 X
  switch (e.type) {
    case 'initiativeRolled':
      if (e.entries.length === 1) return { text: `${name(e.entries[0]!.combatantId)} joins the Turn order.`, tone: 'info' }; // Round 3 P
      return { text: `Initiative: ${e.entries.map((x) => name(x.combatantId)).join(', ')}.`, tone: 'info' };
    case 'attackResolved':
      return {
        text: `${name(e.attackerId)} attacks ${name(e.defenderId)}: ${roll(e.attack)} vs ${e.defense ? `dodge ${roll(e.defense)}` : `DV ${e.defenseValue}`}. ${e.hit ? 'Hit.' : 'Miss.'}`,
        tone: e.hit ? 'hit' : 'miss',
      };
    case 'damageRolled':
      return { text: `Damage ${damageMath(e.dice, e.multiplier)} = ${e.total}${e.critTriggered ? '. Critical Injury!' : '.'}`, tone: 'hit' };
    case 'damageApplied':
      // Redacted for players: HP and SP fields are gone, so say only that it landed.
      if (e.redacted) return { text: `${name(e.targetId)} is hit in the ${LOC[e.location] ?? e.location}.`, tone: 'bad' };
      return e.through > 0
        ? { text: `${name(e.targetId)} takes ${e.hpBefore - e.hpAfter} to the ${LOC[e.location] ?? e.location} (SP ${e.spCounted} stopped ${Math.min(e.rawDamage, e.spCounted)}).`, tone: 'bad' }
        : { text: `${name(e.targetId)}’s armor stops it.`, tone: 'info' };
    case 'criticalInjury':
      return { text: `Critical Injury on ${name(e.targetId)}: ${injuryName(e.injuryId)}.`, tone: 'bad' };
    case 'woundStateChanged':
      return { text: `${name(e.targetId)} is now ${e.to === 'mortally' ? 'Mortally Wounded' : e.to === 'seriously' ? 'Seriously Wounded' : e.to === 'lightly' ? 'Lightly Wounded' : e.to}.`, tone: e.to === 'mortally' ? 'bad' : 'info' };
    case 'deathSaveRolled':
      return { text: `${name(e.targetId)} rolls a Death Save: ${deathSaveMath(e)} ${e.success ? 'Holds on.' : 'Fails.'}`, tone: e.success ? 'good' : 'bad' };
    case 'died':
      return { text: `${name(e.targetId)} is dead.`, tone: 'bad' };
    case 'stabilized':
      return { text: `${name(e.targetId)} is stabilized.`, tone: 'good' };
    case 'stabilizationAttempted':
      return e.success ? null : { text: `${name(e.medicId)} fails to stabilize ${name(e.targetId)}.`, tone: 'miss' };
    case 'heldItemDropped':
      return { text: `${name(e.targetId)} drops what they were holding.`, tone: 'info' };
    case 'tokenMoved':
      return { text: `${name(e.combatantId)} ${e.ran ? 'runs' : 'moves'} ${e.cost * 2} m.`, tone: 'info' };
    case 'watchSet':
      return { text: `${name(e.combatantId)} watches a ${e.arc}° arc.`, tone: 'info' };
    case 'watchTriggered':
      return { text: `${name(e.targetId)} moves into ${name(e.combatantId)}’s watch!`, tone: 'hit' };
    case 'gmRulingRequired':
      return { text: `GM ruling needed: ${e.reason}`, tone: 'info' };
    case 'checkRolled': {
      const subject = e.combatantId ? name(e.combatantId) : who(e.by);
      const res = e.dv !== undefined ? ` vs DV ${e.dv}: ${e.success ? 'success' : 'failure'}.` : '.';
      return { text: `${subject} rolls ${e.label}: ${roll(e.check)}${res}`, tone: 'roll' };
    }
    case 'diceRolled':
      return { text: `${who(e.by)} rolls ${e.label}: ${e.dice.join(' + ')}${e.bonus ? ` ${e.bonus > 0 ? '+' : '−'} ${Math.abs(e.bonus)}` : ''} = ${e.total}.`, tone: 'roll' };
    case 'chatMessage':
      return { text: `${e.asCombatantId ? name(e.asCombatantId) : who(e.by)}: ${e.text}`, tone: 'chat' };
    case 'hpAdjusted':
      return { text: `GM ${e.delta >= 0 ? 'restores' : 'removes'} ${Math.abs(e.delta)} HP ${e.delta >= 0 ? 'to' : 'from'} ${name(e.targetId)}${e.reason ? ` (${e.reason})` : ''}.`, tone: e.delta >= 0 ? 'good' : 'bad' };
    case 'conditionSet':
      return { text: `${name(e.targetId)} is ${e.value ? '' : 'no longer '}${CONDITION[e.condition] ?? e.condition}.`, tone: 'info' };
    case 'netAction':
      return { text: e.text, tone: e.success === false ? 'miss' : 'info' };
    case 'handoutShared':
      return { text: `GM shared a handout: ${e.title}.`, tone: 'info' };
    case 'sceneChanged':
      return { text: `Scene: ${e.name}.`, tone: 'info' };
    case 'areaResolved': {
      // Round 3 P: an explosive's areaResolved only comes once it has gone off (hit or placed scatter).
      const caught = e.targetIds.length ? e.targetIds.map(name).join(', ') : '';
      if (e.kind === 'shotgunShell') return { text: caught ? `${name(e.attackerId)}’s shotgun shell catches ${caught}.` : `${name(e.attackerId)}’s shotgun shell hits no one.`, tone: caught ? 'hit' : 'miss' };
      return { text: caught ? `The blast catches ${caught}.` : 'The blast catches no one.', tone: caught ? 'hit' : 'miss' };
    }
    // --- Round 3 P ---
    case 'explosiveMissed':
      return { text: `${name(e.attackerId)}’s explosive misses and scatters. The GM places where it lands.`, tone: 'miss' };
    case 'explosiveScattered':
      return { text: `The explosive lands ${Math.max(Math.abs(e.to.x - e.from.x), Math.abs(e.to.y - e.from.y)) * 2} m from the aim point${e.rolled ? ' (rolled)' : ''}.`, tone: 'info' };
    case 'noEffect':
      return { text: `No effect on ${name(e.targetId)}.`, tone: 'miss' };
    case 'turnDelayed':
      return { text: `${name(e.combatantId)} delays${e.after ? ` until after ${name(e.after)}` : ' to the end of the Round'}.`, tone: 'info' };
    case 'leftInitiative':
      return { text: `${name(e.combatantId)} leaves the Turn order.`, tone: 'info' };
    // --- end Round 3 P ---
    case 'suppressiveFireResolved':
      return { text: `${name(e.attackerId)} lays down Suppressive Fire${e.results.some((r) => r.mustSeekCover) ? `; ${e.results.filter((r) => r.mustSeekCover).map((r) => name(r.targetId)).join(', ')} must take cover` : ''}.`, tone: 'hit' };
    default:
      return null;
  }
}

/** "(1 + 2) × 4", never "1 + 2 × 4" (#20). */
export function damageMath(dice: number[], multiplier: number): string {
  const sum = dice.join(' + ');
  if (multiplier <= 1) return sum;
  return dice.length > 1 ? `(${sum}) × ${multiplier}` : `${sum} × ${multiplier}`;
}

/** The roll against BODY (#21); fields can be missing on redacted NPC rolls. */
export function deathSaveMath(e: { natural?: number; penalty?: number; total?: number; body?: number }): string {
  if (typeof e.total !== 'number') return '';
  const pen = e.penalty ? ` + ${e.penalty} penalty` : '';
  const nat = typeof e.natural === 'number' ? `${e.natural}${pen} = ` : '';
  const vs = typeof e.body === 'number' ? ` vs BODY ${e.body} (needs under)` : '';
  return `${nat}${e.total}${vs}${e.natural === 10 ? ', natural 10 always fails' : ''}.`;
}
