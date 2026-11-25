/** Combat log lines for Track K events (sentence case). Merge into narrate.ts's switch via `narrateSystems`. */
import { AMMO_TYPES, getInjury, type CombatEvent } from '@cprc/rules-core';

type Tone = 'hit' | 'miss' | 'info' | 'bad' | 'good';
export interface SystemsLine { text: string; tone: Tone }

const ammoName = (id: string) => AMMO_TYPES.find((a) => a.id === id)?.name ?? id;

export function narrateSystems(e: CombatEvent, name: (id: string) => string): SystemsLine | null | undefined {
  switch (e.type) {
    case 'injuryTreated': {
      const inj = getInjury(e.injuryId).name;
      if (e.outcome === 'failed') return { text: `${name(e.medicId)} fails to treat ${name(e.targetId)}’s ${inj} (${e.check.total} vs DV ${e.dv}).`, tone: 'miss' };
      return { text: e.outcome === 'quickFixed' ? `${name(e.medicId)} Quick-Fixes ${name(e.targetId)}’s ${inj}.` : `${name(e.medicId)} treats ${name(e.targetId)}’s ${inj}. It’s gone.`, tone: 'good' };
    }
    case 'humanityChanged':
      return { text: `${name(e.combatantId)}’s Humanity ${e.to < e.from ? 'drops' : 'rises'} to ${e.to}${e.empTo !== e.empFrom ? ` (EMP ${e.empTo})` : ''}.`, tone: e.to < e.from ? 'bad' : 'good' };
    case 'cyberwareInstalled':
      return { text: `${name(e.combatantId)} has ${e.name} installed (Humanity Loss ${e.humanityLoss}${e.rolled ? `, rolled ${e.rolled.join(' + ')}` : e.lossMode === 'fixed' ? ', fixed' : e.lossMode === 'none' ? ', waived' : ''}${e.maxTo !== undefined && e.maxFrom !== undefined && e.maxTo !== e.maxFrom ? `; maximum Humanity ${e.maxTo}` : ''}).`, tone: 'info' };
    case 'cyberwareRemoved':
      return { text: `${name(e.combatantId)} has ${e.name} removed${e.maxTo !== undefined && e.maxFrom !== undefined && e.maxTo !== e.maxFrom ? ` (maximum Humanity back to ${e.maxTo})` : ''}.`, tone: 'info' };
    case 'therapyResolved':
      return { text: e.success ? `Therapy works: ${name(e.combatantId)} recovers ${e.recovered} Humanity.` : `Therapy doesn’t take this week (${e.check.total} vs DV ${e.dv}).`, tone: e.success ? 'good' : 'miss' };
    case 'awarenessSet':
      return { text: `${name(e.combatantId)} shifts their Combat Awareness.`, tone: 'info' };
    case 'rested':
      return e.blocked
        ? { text: `${name(e.targetId)} doesn’t heal: ${e.blocked}.`, tone: 'bad' }
        : { text: `${name(e.targetId)} rests ${e.days} day${e.days > 1 ? 's' : ''} and heals ${e.healed} HP.`, tone: 'good' };
    case 'coverDamaged':
      return { text: e.destroyed ? `The ${e.material.toLowerCase()} cover is destroyed.` : `The ${e.material.toLowerCase()} cover takes ${e.hpBefore - e.hpAfter} (${e.hpAfter} HP left).`, tone: e.destroyed ? 'hit' : 'info' };
    case 'burning':
      return { text: `${name(e.targetId)} burns for ${e.damage}.`, tone: 'bad' };
    case 'ignited':
      return { text: `${name(e.targetId)} catches fire!`, tone: 'hit' };
    case 'extinguished':
      return { text: `${name(e.targetId)} puts out the flames.`, tone: 'good' };
    case 'ammoLoaded':
      return { text: `${name(e.combatantId)} loads ${ammoName(e.ammoType)} ammunition.`, tone: 'info' };
    case 'smartAmmoRetry':
      return { text: `${e.kind === 'improvedSmart' ? 'Improved Smart' : 'Smart'} rounds track: ${e.total} vs ${e.defense ? 'a fresh dodge of' : 'DV'} ${e.dv}. ${e.hit ? 'Hit.' : 'Miss.'}`, tone: e.hit ? 'hit' : 'miss' };
    case 'damageDeflected':
      return { text: `${name(e.targetId)} deflects ${e.amount} damage.`, tone: 'good' };
    case 'spotWeakness':
      return { text: `${name(e.combatantId)} finds a weak spot (+${e.bonus} damage).`, tone: 'hit' };
    case 'areaDodgeRequested':
      return { text: `${name(e.combatantId)} can try to dodge the blast.`, tone: 'info' };
    default:
      return undefined; // not a Track K event
  }
}
