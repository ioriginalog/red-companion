/** Combat log lines. Sentence case (Chicago); names come from the viewer's projection. */
import type { CheckResult, CombatEvent } from '@cprc/rules-core';

export type Tone = 'hit' | 'miss' | 'info' | 'bad' | 'good';
export interface Line { text: string; tone: Tone }

const LOC: Record<string, string> = { head: 'head', body: 'body' };
const roll = (c: CheckResult) => (c.redacted ? `${c.total}` : `${c.total} (${c.roll.natural}${c.roll.kind === 'critSuccess' ? ' crit' : c.roll.kind === 'critFailure' ? ' fumble' : ''})`);

export function narrate(e: CombatEvent, name: (id: string) => string): Line | null {
  switch (e.type) {
    case 'initiativeRolled':
      return { text: `Initiative: ${e.entries.map((x) => name(x.combatantId)).join(', ')}.`, tone: 'info' };
    case 'attackResolved':
      return {
        text: `${name(e.attackerId)} attacks ${name(e.defenderId)}: ${roll(e.attack)} vs ${e.defense ? `dodge ${roll(e.defense)}` : `DV ${e.defenseValue}`}. ${e.hit ? 'Hit.' : 'Miss.'}`,
        tone: e.hit ? 'hit' : 'miss',
      };
    case 'damageRolled':
      return { text: `Damage ${e.dice.join(' + ')}${e.multiplier > 1 ? ` × ${e.multiplier}` : ''} = ${e.total}${e.critTriggered ? ', critical injury!' : '.'}`, tone: 'hit' };
    case 'damageApplied':
      return e.through > 0
        ? { text: `${name(e.targetId)} takes ${e.hpBefore - e.hpAfter} to the ${LOC[e.location] ?? e.location} (SP ${e.spCounted} stopped ${Math.min(e.rawDamage, e.spCounted)}).`, tone: 'bad' }
        : { text: `${name(e.targetId)}’s armor stops it.`, tone: 'info' };
    case 'criticalInjury':
      return { text: `Critical injury on ${name(e.targetId)}: ${e.injuryId.replace(/([A-Z])/g, ' $1').toLowerCase()}.`, tone: 'bad' };
    case 'woundStateChanged':
      return { text: `${name(e.targetId)} is now ${e.to === 'mortally' ? 'Mortally Wounded' : e.to === 'seriously' ? 'Seriously Wounded' : e.to === 'lightly' ? 'Lightly Wounded' : e.to}.`, tone: e.to === 'mortally' ? 'bad' : 'info' };
    case 'deathSaveRolled':
      return { text: `${name(e.targetId)} rolls a Death Save: ${e.success ? 'holds on.' : 'fails.'}`, tone: e.success ? 'good' : 'bad' };
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
    default:
      return null;
  }
}
