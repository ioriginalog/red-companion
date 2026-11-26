import { describe, expect, it } from 'vitest';
import { scriptedDice } from '@cprc/rules-core';
import { applyEntry, emptySession, handleIntent, projectState, type Intent, type SessionState } from '@cprc/session';
import { SKILL_STAT } from '../src/data/skills.js';
import { demoIntents } from '../src/demo.js';
import { extrasPreview, previewAttack } from '../src/tactics.js';

function demo(): SessionState {
  let s = emptySession('t');
  for (const i of demoIntents()) {
    const r = handleIntent(s, i, { role: 'gm' }, { dice: scriptedDice({}) });
    if (!r.ok) throw new Error(r.message);
    s = applyEntry(s, r.entry);
  }
  return s;
}
const run = (s: SessionState, i: Intent) => handleIntent(s, i, { role: 'gm' }, { dice: scriptedDice({ d10: [5, 5, 5, 5], d6: [3, 3, 3, 3] }) });

describe('Martial Arts Forms (#7)', () => {
  it('lists each Form as its own DEX skill the engine can read', () => {
    expect(SKILL_STAT['Martial Arts (Judo)']).toBe('DEX');
    expect(SKILL_STAT['Martial Arts (Aikido)']).toBe('DEX');
    expect(SKILL_STAT['Martial Arts']).toBeUndefined();
  });
});

describe('grapple-aware attack preview (#11)', () => {
  function grappled() {
    let s = demo();
    // Put the ganger next to Vex, then have Vex hold them.
    const r = run(s, { type: 'placeToken', actorId: 'ganger-a', at: { x: s.map!.tokens.vex!.x + 1, y: s.map!.tokens.vex!.y } });
    if (!r.ok) throw new Error(r.message);
    s = applyEntry(s, r.entry);
    return { ...s, extras: { grapples: [{ holderId: 'vex', heldId: 'ganger-a', chokes: 0, lastChokeRound: null, ironGrip: false }], facedowns: [], hits: [], movesUsed: [] } } as SessionState;
  }
  it('refuses two-handed weapons with the authority’s own reason', () => {
    const s = grappled();
    const v = projectState(s, { role: 'gm' });
    const ar = v.actors.vex!.weapons!.find((w) => w.type === 'assaultRifle')!;
    const pv = previewAttack(v, 'vex', 'ganger-a', ar, 'single');
    expect(pv.ok).toBe(false);
    const auth = run(s, { type: 'rangedAttack', attackerId: 'vex', defenderId: 'ganger-a', weaponId: ar.id, distance: 2 });
    expect(auth.ok).toBe(false);
    expect(!pv.ok && pv.reason).toBe(!auth.ok && auth.message);
  });
  it('adds the −2 the authority adds for one-handed weapons', () => {
    const s = grappled();
    const v = projectState(s, { role: 'gm' });
    const pistol = v.actors.vex!.weapons!.find((w) => w.type === 'heavyPistol')!;
    const mods = extrasPreview(v, 'vex', 'ganger-a', pistol, false);
    expect(mods).toEqual([{ label: 'Grappling', value: -2 }]);
    const pv = previewAttack(v, 'vex', 'ganger-a', pistol, 'single');
    expect(pv.ok && pv.modifiers.some((m) => m.label === 'Grappling' && m.value === -2)).toBe(true);
  });
  it('adds nothing when nobody is grappling', () => {
    const v = projectState(demo(), { role: 'gm' });
    expect(extrasPreview(v, 'vex', 'ganger-a', 'brawling', true)).toEqual([]);
  });
});
