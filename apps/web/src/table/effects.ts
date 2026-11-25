/** Map animations derived from log events. Pure mapping + a timestamp. */
import type { Cell, CombatEvent } from '@cprc/rules-core';
import type { Cue } from './sound.js';

export type Effect =
  | { id: number; t: number; kind: 'tracer'; from: Cell; to: Cell; hit: boolean }
  | { id: number; t: number; kind: 'float'; at: Cell; text: string; tone: 'dmg' | 'heal' | 'miss' | 'crit' }
  | { id: number; t: number; kind: 'flash'; at: Cell; color: string }
  | { id: number; t: number; kind: 'blast'; at: Cell; radius: number };

export const EFFECT_MS = 1700;
let n = 0;

/** Turn events into effects and sound cues. Tokens unknown to this viewer are skipped. */
export function effectsFor(events: CombatEvent[], tokens: Record<string, Cell>): { effects: Effect[]; cues: Cue[] } {
  const t = Date.now();
  const effects: Effect[] = [];
  const cues: Cue[] = [];
  for (const e of events) {
    switch (e.type) {
      case 'attackResolved': {
        const a = tokens[e.attackerId], d = tokens[e.defenderId];
        if (a && d) effects.push({ id: ++n, t, kind: 'tracer', from: a, to: d, hit: e.hit });
        if (d && !e.hit) effects.push({ id: ++n, t, kind: 'float', at: d, text: 'Miss', tone: 'miss' });
        cues.push('shot', e.hit ? 'hit' : 'miss');
        break;
      }
      case 'damageApplied': {
        const d = tokens[e.targetId];
        const lost = e.hpBefore - e.hpAfter;
        if (d) effects.push({ id: ++n, t, kind: 'float', at: d, text: lost > 0 ? `−${lost}` : 'Blocked', tone: lost > 0 ? 'dmg' : 'miss' });
        break;
      }
      case 'hpAdjusted': {
        const d = tokens[e.targetId];
        if (d) effects.push({ id: ++n, t, kind: 'float', at: d, text: e.delta >= 0 ? `+${e.delta}` : `−${-e.delta}`, tone: e.delta >= 0 ? 'heal' : 'dmg' });
        break;
      }
      case 'criticalInjury': {
        const d = tokens[e.targetId];
        if (d) {
          effects.push({ id: ++n, t, kind: 'flash', at: d, color: '#ff3b4e' });
          effects.push({ id: ++n, t: t + 250, kind: 'float', at: d, text: 'Critical', tone: 'crit' });
        }
        cues.push('crit');
        break;
      }
      case 'died':
        cues.push('death');
        break;
      case 'stabilized': {
        const d = tokens[e.targetId];
        if (d) effects.push({ id: ++n, t, kind: 'flash', at: d, color: '#3dff8a' });
        break;
      }
      case 'areaResolved':
        effects.push({ id: ++n, t, kind: 'blast', at: e.at, radius: e.kind === 'shotgunShell' ? 0 : 2.5 });
        cues.push('shot');
        break;
      case 'watchTriggered': {
        const d = tokens[e.targetId];
        if (d) effects.push({ id: ++n, t, kind: 'flash', at: d, color: '#ff2bd6' });
        cues.push('ping');
        break;
      }
      case 'checkRolled':
      case 'diceRolled':
        cues.push('dice');
        break;
      case 'chatMessage':
        cues.push('chat');
        break;
      default:
        break;
    }
  }
  return { effects, cues };
}
