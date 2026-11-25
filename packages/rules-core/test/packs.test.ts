import { describe, expect, it } from 'vitest';
import { catalogToItem, cyberwareProblem, packProgram, parseRulesPack, PROGRAM_TEMPLATES } from '../src/index.js';

const good = {
  format: 'nsc-rules-pack', version: 1, name: 'Test Pack',
  cyberware: [
    { name: 'Widget Eye', slot: 'Cyberoptics', hlDice: '2d6', hlFixed: 7, install: 'clinic', costEb: 100, effects: [{ kind: 'targetingScope' }] },
    { name: 'Tiny Thing', hlDice: '1d6/2', install: 'mall' },
    { name: 'Free Thing', hlDice: '0' },
  ],
  programs: [{ id: 'x', name: 'X', class: 'booster', atk: 0, def: 0, maxRez: 7, boost: { ability: 'backdoor', amount: 2 } }],
};

describe('rules packs', () => {
  it('accepts a valid pack and builds installable items with fixed loss', () => {
    const r = parseRulesPack(good);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const eye = catalogToItem(r.pack.cyberware![0]!, 'cw-1');
    expect(eye).toMatchObject({ id: 'cw-1', humanityLoss: 7, hlDice: '2d6', hlFixed: 7, install: 'clinic' });
    expect(cyberwareProblem(eye)).toBeNull();
    expect(catalogToItem(r.pack.cyberware![1]!, 'cw-2').humanityLoss).toBe(2);
    expect(catalogToItem(r.pack.cyberware![2]!, 'cw-3').humanityLoss).toBe(0);
    expect(packProgram(r.pack.programs![0]!)).toMatchObject({ rez: 7, status: 'ready' });
  });
  it('rejects hostile or malformed packs with a reason', () => {
    const bad = (patch: object) => parseRulesPack({ ...good, ...patch });
    expect(parseRulesPack(null)).toMatchObject({ ok: false });
    expect(bad({ format: 'other' })).toMatchObject({ ok: false });
    expect(bad({ version: 2 })).toMatchObject({ ok: false });
    expect(bad({ name: '' })).toMatchObject({ ok: false });
    expect(bad({ cyberware: [], programs: [] })).toMatchObject({ ok: false });
    expect(bad({ cyberware: [{ name: 'A', hlDice: '9d20' }] })).toMatchObject({ ok: false });
    expect(bad({ cyberware: [{ name: 'A', hlDice: '2d6', hlFixed: 1e9 }] })).toMatchObject({ ok: false });
    expect(bad({ cyberware: [{ name: 'A', hlDice: '2d6', effects: [{ kind: 'stat', stat: 'REF', value: 99 }] }] })).toMatchObject({ ok: false });
    expect(bad({ cyberware: [{ name: 'A', hlDice: '2d6', effects: [{ kind: 'nuke' }] }] })).toMatchObject({ ok: false });
    expect(bad({ cyberware: Array(501).fill({ name: 'A', hlDice: '1d6' }) })).toMatchObject({ ok: false });
    expect(bad({ programs: [{ id: 'x', name: 'X', class: 'booster', atk: 99, def: 0, maxRez: 7 }] })).toMatchObject({ ok: false });
    expect(bad({ programs: [{ id: '../x', name: 'X', class: 'booster', atk: 0, def: 0, maxRez: 7 }] })).toMatchObject({ ok: false });
    expect(bad({ programs: [{ id: 'x', name: 'X', class: 'booster', atk: 0, def: 0, maxRez: 7, boost: { ability: 'rm -rf', amount: 2 } }] })).toMatchObject({ ok: false });
  });
  it('shipped starter Programs are original (no book names)', () => {
    const book = ['Worm', 'See Ya', 'Eraser', 'Speedy Gonzalvez', 'Armor', 'Shield', 'Sword', 'Banhammer'];
    expect(PROGRAM_TEMPLATES.some((p) => book.includes(p.name))).toBe(false);
  });
});
