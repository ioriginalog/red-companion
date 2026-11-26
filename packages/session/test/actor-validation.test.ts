import { describe, expect, it } from 'vitest';
import { maxHP, scriptedDice, type Combatant, type Stats } from '@cprc/rules-core';
import { emptySession, handleIntent, type Actor, type Viewer } from '../src/index.js';

const GM: Viewer = { role: 'gm' };
const BASE: Stats = { INT: 6, REF: 6, DEX: 6, TECH: 6, COOL: 6, WILL: 6, LUCK: 6, MOVE: 6, BODY: 6, EMP: 6 };

function good(): Actor {
  const max = maxHP(6, 6);
  const combatant: Combatant = {
    id: 'a1', name: 'Vex', side: 'pc', stats: BASE, skills: { Handgun: 6 }, hp: { max, current: max },
    armor: [{ id: 'jack', name: 'Light Armorjack', location: 'body', maxSP: 11, currentSP: 11, penalty: 0 }],
    criticalInjuries: [], deathSave: { accumulatedPenalty: 0 },
    conditions: { prone: false, unconscious: false, dead: false, stabilized: false },
    role: { id: 'solo', rank: 4, awareness: { precisionAttack: 3 } },
    humanity: { current: 50, max: 58, base: 60 },
    cyberware: [{ id: 'eye', name: 'Cybereye', humanityLoss: 7, effects: [{ kind: 'targetingScope' }], hlDice: '1d6/2', borgware: false, install: 'clinic' }],
    gear: [{ name: 'Agent', qty: 1 }],
    mods: { attack: 1, targetingScope: true, statBonuses: { REF: 1 } },
    reputation: 3,
  };
  return {
    id: 'a1', controller: 'gm', combatant, portrait: '/u/s1/abc.webp', notes: 'Shared.', gmNotes: 'Secret.',
    weapons: [{ id: 'p', name: 'Heavy Pistol', type: 'heavyPistol', ammo: { loaded: 8, capacity: 8 }, ammoType: 'armorPiercing', smartgunLink: true }],
  };
}

const send = (actor: unknown) => handleIntent(emptySession('s1'), { type: 'addActor', actor } as never, GM, { dice: scriptedDice({}) });
const expectInvalid = (actor: unknown) => expect(send(actor)).toMatchObject({ ok: false, code: 'INVALID' });

/** Deep-set a path on a fresh good actor. */
function withField(path: (string | number)[], value: unknown): unknown {
  const a = JSON.parse(JSON.stringify(good())) as Record<string, unknown>;
  let o: Record<string | number, unknown> = a;
  for (const k of path.slice(0, -1)) o = o[k] as Record<string | number, unknown>;
  o[path[path.length - 1]!] = value;
  return a;
}

describe('actor validation', () => {
  it('accepts a full, well-formed sheet', () => {
    expect(send(good()).ok).toBe(true);
  });

  it.each([
    ['weapon type', ['weapons', 0, 'type'], 'railgun'],
    ['ammo type', ['weapons', 0, 'ammoType'], 'antimatter'],
    ['ammo loaded over capacity', ['weapons', 0, 'ammo'], { loaded: 9, capacity: 8 }],
    ['fractional ammo', ['weapons', 0, 'ammo'], { loaded: 1.5, capacity: 8 }],
    ['smart flag', ['weapons', 0, 'smart'], 'yes'],
    ['smartgun link as a string', ['weapons', 0, 'smartgunLink'], 'true'],
    ['2070s class', ['weapons', 0, 'tech2070s'], 'magic'],
    ['improved smart ammo in a normal gun', ['weapons', 0, 'ammoType'], 'improvedSmart'],
    ['smart rebuild of a Power weapon', ['weapons', 0], { id: 'p', name: 'P', type: 'heavyPistol', smart: 'rebuild', tech2070s: 'power' }],
    ['ROF', ['weapons', 0, 'rofOverride'], 3],
    ['unknown Role', ['combatant', 'role'], { id: 'wizard', rank: 3 }],
    ['Role rank', ['combatant', 'role', 'rank'], 11],
    ['Combat Awareness over rank', ['combatant', 'role', 'awareness'], { precisionAttack: 9 }],
    ['Humanity over max', ['combatant', 'humanity'], { current: 70, max: 60 }],
    ['Humanity as text', ['combatant', 'humanity', 'current'], '50'],
    ['cyberware dice', ['combatant', 'cyberware', 0, 'hlDice'], '9d20'],
    ['cyberware effect', ['combatant', 'cyberware', 0, 'effects'], [{ kind: 'godMode' }]],
    ['cyberware STAT effect out of range', ['combatant', 'cyberware', 0, 'effects'], [{ kind: 'stat', stat: 'REF', value: 9 }]],
    ['borgware flag', ['combatant', 'cyberware', 0, 'borgware'], 1],
    ['gear quantity', ['combatant', 'gear', 0, 'qty'], -1],
    ['gear name', ['combatant', 'gear', 0, 'name'], ''],
    ['derived modifier as text', ['combatant', 'mods', 'attack'], 'lots'],
    ['derived modifier too large', ['combatant', 'mods', 'attack'], 1e9],
    ['reputation', ['combatant', 'reputation'], 11],
    ['on fire', ['combatant', 'onFire'], 'yes'],
    ['flag value', ['combatant', 'flags'], { ignoreSeriouslyWoundedPenalty: 'yes' }],
    ['portrait with another scheme', ['portrait'], 'javascript:alert(1)'],
    ['portrait outside asset folders', ['portrait'], '/api/sessions'],
    ['portrait path traversal', ['portrait'], '/u/../../etc/passwd'],
    ['portrait remote URL', ['portrait'], 'https://evil.example/x.png'],
    ['GM notes too long', ['gmNotes'], 'x'.repeat(8001)],
    ['GM notes as a number', ['gmNotes'], 5],
    ['notes too long', ['notes'], 'x'.repeat(8001)],
  ])('rejects bad %s', (_label, path, value) => {
    expectInvalid(withField(path as (string | number)[], value));
  });

  it('caps list lengths, and accepts a large but legal sheet', () => {
    expectInvalid(withField(['combatant', 'gear'], Array.from({ length: 101 }, (_, i) => ({ name: `Item ${i}`, qty: 1 }))));
    expectInvalid(withField(['combatant', 'cyberware'], Array.from({ length: 41 }, (_, i) => ({ id: `c${i}`, name: 'C', humanityLoss: 1, effects: [] }))));
    const huge = withField(['combatant', 'role', 'notes'], 'x'.repeat(1900)) as Actor;
    huge.combatant.cyberware = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, name: 'x'.repeat(80), humanityLoss: 1, effects: [], notes: 'y'.repeat(2000) }));
    huge.combatant.gear = Array.from({ length: 100 }, () => ({ name: 'z'.repeat(80), qty: 1, notes: 'n'.repeat(500) }));
    huge.notes = 'q'.repeat(8000);
    huge.gmNotes = 'g'.repeat(8000);
    // Each field is within its own cap; together they still fit, so this one passes.
    expect(send(huge).ok).toBe(true);
  });

  it('validates library templates and replacements the same way', () => {
    const bad = withField(['weapons', 0, 'type'], 'railgun');
    expect(handleIntent(emptySession('s1'), { type: 'saveToLibrary', kind: 'actor', item: bad } as never, GM, { dice: scriptedDice({}) }))
      .toMatchObject({ ok: false, code: 'INVALID' });
  });

  it('accepts bundled art and inline images for portraits', () => {
    expect(send(withField(['portrait'], '/assets/portraits/vex.webp')).ok).toBe(true);
    expect(send(withField(['portrait'], 'data:image/webp;base64,AAAA')).ok).toBe(true);
  });
});
