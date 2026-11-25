import { describe, expect, it } from 'vitest';
import type { Weapon } from '@cprc/rules-core';
import type { TacticalMap } from '@cprc/session';
import { directModes } from '../src/table/CombatPanel.js';
import { coverAt, coverLabel } from '../src/table/cover.js';
import { narrate } from '../src/narrate.js';

const w = (type: Weapon['type']): Weapon => ({ id: 'w', name: 'W', type });

describe('attack modes (#11)', () => {
  it('offers no direct modes for launchers', () => {
    expect(directModes(w('grenadeLauncher'))).toEqual([]);
    expect(directModes(w('rocketLauncher'))).toEqual([]);
  });
  it('offers Autofire only when the weapon can', () => {
    expect(directModes(w('heavyPistol')).map(([m]) => m)).toEqual(['single', 'aimHead', 'aimLeg', 'aimHeld']);
    expect(directModes(w('assaultRifle')).map(([m]) => m)).toContain('autofire');
  });
});

describe('cover readout (#5)', () => {
  const map: TacticalMap = {
    id: 'm', name: 'M', width: 3, height: 1, cells: '.c.', cellPx: 64, sightRange: 10, tokens: {}, watches: {}, spotted: [],
    cover: { '1,0': { material: 'thinSteel', hp: 10 } },
  };
  it('shows exact HP to the GM and only a damage state to players', () => {
    const info = coverAt(map, { x: 1, y: 0 })!;
    expect(coverLabel(info, true)).toBe('Thin Steel · 10/25 HP');
    expect(coverLabel(info, false)).toBe('Cover · Badly Damaged');
    expect(coverAt(map, { x: 0, y: 0 })).toBeNull();
  });
});

describe('narration (#4, #9, #3)', () => {
  const name = (id: string) => id.toUpperCase();
  it('says what happened to a missed explosive', () => {
    expect(narrate({ type: 'explosiveMissed', visibility: 'public', attackerId: 'lt', at: { x: 1, y: 1 } }, name)!.text).toContain('misses and scatters');
    expect(narrate({ type: 'explosiveScattered', visibility: 'public', attackerId: 'lt', from: { x: 1, y: 1 }, to: { x: 3, y: 1 }, rolled: true }, name)!.text).toBe('The explosive lands 4 m from the aim point (rolled).');
    expect(narrate({ type: 'areaResolved', visibility: 'public', attackerId: 'lt', kind: 'launcher', at: { x: 3, y: 1 }, targetIds: [] }, name)!.text).toBe('The blast catches no one.');
  });
  it('reports no effect, delays and late joins', () => {
    expect(narrate({ type: 'noEffect', visibility: 'public', targetId: 'tank' }, name)!.text).toBe('No effect on TANK.');
    expect(narrate({ type: 'turnDelayed', visibility: 'public', combatantId: 'vex', after: null }, name)!.text).toBe('VEX delays to the end of the Round.');
    expect(narrate({ type: 'initiativeRolled', visibility: 'public', entries: [{ combatantId: 'late', base: 6, roll: 4, total: 10, tiebreaks: [] }] }, name)!.text).toBe('LATE joins the Turn order.');
  });
});
