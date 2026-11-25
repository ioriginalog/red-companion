import { describe, expect, it } from 'vitest';
import { maxHP } from '@cprc/rules-core';
import {
  actorFromDraft, draftFromActor, emptyDraft, exportActors, importActors, newWeaponDraft, numberedNames, safeImageUrl, uniqueId, validateDraft,
} from '../src/editors/actorModel.js';
import {
  commit, downscaleFactor, duplicateMap, exportMap, fitGrid, floodFill, historyOf, importMap, newMap, paintBrush, paintRect, paintStroke,
  redo, resizeCells, tokensOnBlocked, undo,
} from '../src/editors/mapModel.js';
import { STARTER_TEMPLATES } from '../src/data/templates.js';
import { ALL_SKILLS, SKILL_STAT } from '../src/data/skills.js';
import { demoActors, demoMap } from '../src/demo.js';

describe('grid fitting', () => {
  it('crops to whole squares', () => {
    expect(fitGrid(1536, 1024, 64)).toEqual({ width: 24, height: 16, cropW: 1536, cropH: 1024 });
    expect(fitGrid(1000, 700, 64)).toEqual({ width: 15, height: 10, cropW: 960, cropH: 640 });
  });
  it('never upscales and caps the long side', () => {
    expect(downscaleFactor(1000, 500)).toBe(1);
    expect(downscaleFactor(8192, 2048)).toBe(0.5);
  });
});

describe('terrain tools', () => {
  const W = 5, H = 4, blank = '.'.repeat(W * H);
  const row = (cells: string, y: number) => cells.slice(y * W, y * W + W);
  it('brush paints a square of the given size, clipped at edges', () => {
    const c = paintBrush(blank, W, H, { x: 0, y: 0 }, 3, '#');
    expect(row(c, 0)).toBe('##...');
    expect(row(c, 1)).toBe('##...');
  });
  it('stroke leaves no gaps on fast drags', () => {
    expect(row(paintStroke(blank, W, H, { x: 0, y: 2 }, { x: 4, y: 2 }, 1, 'c'), 2)).toBe('ccccc');
  });
  it('rectangle fills or outlines', () => {
    const o = paintRect(blank, W, H, { x: 0, y: 0 }, { x: 4, y: 3 }, '#', true);
    expect(row(o, 1)).toBe('#...#');
    expect(row(paintRect(blank, W, H, { x: 1, y: 1 }, { x: 2, y: 2 }, '~'), 1)).toBe('.~~..');
  });
  it('flood fill stops at walls', () => {
    const walled = paintRect(blank, W, H, { x: 2, y: 0 }, { x: 2, y: 3 }, '#');
    const f = floodFill(walled, W, H, { x: 0, y: 0 }, 'c');
    expect(row(f, 0)).toBe('cc#..');
  });
  it('resize keeps the overlap', () => {
    expect(resizeCells('ab' + 'cd', 2, 2, 3, 1)).toBe('ab.');
  });
  it('undo and redo walk history', () => {
    let h = historyOf('a');
    h = commit(h, 'b');
    h = commit(h, 'c');
    h = undo(h);
    expect(h.present).toBe('b');
    h = redo(h);
    expect(h.present).toBe('c');
    expect(commit(h, 'c')).toBe(h);
  });
});

describe('maps', () => {
  it('flags tokens left on newly blocked squares', () => {
    const m = { ...demoMap(), cells: demoMap().cells.replace(/^(.{294})./, '$1#') };
    expect(tokensOnBlocked(m)).toContain('vex'); // vex at (6,12) = index 294
  });
  it('round-trips JSON without tokens and with a fresh id', () => {
    const m = demoMap();
    const back = importMap(exportMap(m), [m.id]);
    expect(back.cells).toBe(m.cells);
    expect(back.tokens).toEqual({});
    expect(back.id).not.toBe(m.id);
  });
  it('rejects bad imports with readable messages', () => {
    expect(() => importMap('nope', [])).toThrow('valid JSON');
    expect(() => importMap(JSON.stringify({ width: 2, height: 2, cells: '...' }), [])).toThrow('terrain');
    expect(() => importMap(JSON.stringify({ width: 1, height: 1, cells: '.', background: 'https://evil.example/x.png' }), [])).toThrow('URL');
  });
  it('duplicates as a clean library copy', () => {
    const d = duplicateMap(demoMap(), ['warehouse-yard']);
    expect(d.name).toBe('Neon Warehouse Ambush Copy');
    expect(d.tokens).toEqual({});
  });
  it('builds new maps with unique ids', () => {
    expect(newMap({ name: 'Rooftop', width: 3, height: 2, cellPx: 64, taken: ['map-rooftop'] }).id).toBe('map-rooftop-2');
  });
});

describe('actors', () => {
  it('derives HP from BODY and WILL and keeps ids unique', () => {
    const d = { ...emptyDraft(), id: 'x', name: 'Test', stats: { ...emptyDraft().stats, BODY: 8, WILL: 3 } };
    expect(actorFromDraft(d).combatant.hp.max).toBe(maxHP(8, 3));
    const id = uniqueId('Street Thug', ['street-thug']);
    expect(id).toMatch(/^a-[a-z0-9]{10}$/); // opaque: no name, template or count leaks to players
    expect(id).not.toContain('street');
    expect(numberedNames('Thug', 3, ['Thug 2'])).toEqual(['Thug 1', 'Thug 3', 'Thug 4']);
  });
  it('round-trips an actor through the draft', () => {
    const vex = demoActors()[0]!;
    const back = actorFromDraft(draftFromActor(vex), { previous: vex });
    // The builder gives every character a Humanity track (EMP × 10) — Track K.
    const h = vex.combatant.stats.EMP * 10;
    expect(back.combatant).toEqual({ ...vex.combatant, humanity: { current: h, max: h } });
    expect(back.weapons).toEqual(vex.weapons);
  });
  it('preserves damage, ablation and ammo on edit, unless reset', () => {
    const vex = demoActors()[0]!;
    const hurt = {
      ...vex,
      weapons: vex.weapons.map((w) => (w.ammo ? { ...w, ammo: { ...w.ammo, loaded: 3 } } : w)),
      combatant: { ...vex.combatant, hp: { ...vex.combatant.hp, current: 12 }, armor: vex.combatant.armor.map((a) => ({ ...a, currentSP: 9 })) },
    };
    const d = draftFromActor(hurt);
    d.stats.BODY = 9; // max HP goes up
    const kept = actorFromDraft(d, { previous: hurt });
    expect(kept.combatant.hp.current).toBe(12);
    expect(kept.combatant.hp.max).toBeGreaterThan(vex.combatant.hp.max);
    expect(kept.combatant.armor[0]!.currentSP).toBe(9);
    expect(kept.weapons[0]!.ammo!.loaded).toBe(3);
    const reset = actorFromDraft(d, { previous: hurt, resetState: true });
    expect(reset.combatant.hp.current).toBe(reset.combatant.hp.max);
    expect(reset.weapons[0]!.ammo!.loaded).toBe(25);
  });
  it('gives melee weapons no magazine and NPCs the GM as controller', () => {
    const d = { ...emptyDraft(), id: 'n', name: 'N', controller: 'p1' };
    d.weapons = [newWeaponDraft('heavyMelee', [])];
    const a = actorFromDraft(d);
    expect(a.weapons[0]!.ammo).toBeUndefined();
    expect(a.controller).toBe('gm');
    expect(a.combatant.side).toBe('npc');
  });
  it('validates drafts and imports', () => {
    expect(validateDraft(emptyDraft())).toContain('Give the character a name.');
    const json = exportActors(demoActors().slice(0, 2));
    expect(importActors(json).map((a) => a.id)).toEqual(['vex', 'doc']);
    expect(() => importActors('{"id":"x"}')).toThrow('isn’t a character');
  });
  it('only allows same-origin, uploaded or inline portraits', () => {
    expect(safeImageUrl('/u/abc/x.webp')).toBe(true);
    expect(safeImageUrl('data:image/webp;base64,AAAA')).toBe(true);
    expect(safeImageUrl('https://evil.example/a.png')).toBe(false);
    expect(safeImageUrl('//evil.example/a.png')).toBe(false);
    expect(safeImageUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('data', () => {
  it('starter templates build into valid actors with known skills', () => {
    for (const t of STARTER_TEMPLATES) {
      const a = actorFromDraft({ ...t.draft, id: t.key });
      expect(validateDraft({ ...t.draft, id: t.key })).toEqual([]);
      for (const s of Object.keys(a.combatant.skills)) expect(SKILL_STAT[s], `${t.key}: ${s}`).toBeDefined();
    }
  });
  it('skill list has no duplicates', () => {
    expect(new Set(ALL_SKILLS.map((s) => s.name)).size).toBe(ALL_SKILLS.length);
  });
});

describe('freeSquares', async () => {
  const { freeSquares } = await import('../src/editors/mapModel.js');
  it('skips walls, cover and tokens, nearest first', () => {
    const m = demoMap();
    const squares = freeSquares(m, 3, { x: 6, y: 12 }); // vex stands there
    expect(squares).toHaveLength(3);
    for (const c of squares) {
      expect(m.cells[c.y * m.width + c.x]).toBe('.');
      expect(Object.values(m.tokens).some((t) => t.x === c.x && t.y === c.y)).toBe(false);
    }
    expect(Math.max(...squares.map((c) => Math.max(Math.abs(c.x - 6), Math.abs(c.y - 12))))).toBe(1);
  });
});


describe('Track K: role, cyberware and ammo in the builder', async () => {
  const { actorFromDraft, emptyDraft, draftFromActor, humanityFor, validateDraft } = await import('../src/editors/actorModel.js');
  it('builds Humanity from starting EMP and cyberware, and derives mods', () => {
    const d = { ...emptyDraft(), id: 'a-1', name: 'Vex', stats: { ...emptyDraft().stats, EMP: 6 },
      role: { id: 'solo' as const, rank: 4, awareness: { precisionAttack: 3 } },
      cyberware: [{ id: 'cw-1', name: 'Subdermal Armor', humanityLoss: 14, effects: [{ kind: 'armor' as const, location: 'body' as const, sp: 11 }] }] };
    const a = actorFromDraft(d);
    expect(a.combatant.humanity).toEqual({ current: 46, max: 60 });
    expect(a.combatant.stats.EMP).toBe(4);
    expect(a.combatant.mods?.attack).toBe(1);
    expect(a.combatant.armor.some((p) => p.id === 'cw:cw-1:body')).toBe(true);
    const back = draftFromActor(a);
    expect(back.stats.EMP).toBe(6);
    expect(back.cyberware).toHaveLength(1);
    expect(back.armor.body).toEqual({ kind: 'none' });
  });
  it('keeps Humanity changes made in play when the GM edits', () => {
    const prev = actorFromDraft({ ...emptyDraft(), id: 'a-1', name: 'X', stats: { ...emptyDraft().stats, EMP: 5 } });
    const played = { ...prev.combatant, humanity: { current: 41, max: 50 } };
    expect(humanityFor(5, [{ id: 'c', name: 'C', humanityLoss: 3, effects: [] }], played)).toEqual({ current: 38, max: 50 });
  });
  it('validates role, cyberware and ammo', () => {
    const base = { ...emptyDraft(), name: 'X' };
    expect(validateDraft({ ...base, role: { id: 'solo', rank: 2, awareness: { precisionAttack: 3 } } })).toContainEqual(expect.stringMatching(/exceed rank 2/));
    expect(validateDraft({ ...base, cyberware: [{ id: 'bad id!', name: 'X', humanityLoss: 1, effects: [] }] })).toHaveLength(1);
    expect(validateDraft({ ...base, weapons: [{ id: 'w', name: 'P', type: 'heavyPistol', capacity: 8, rofOverride: null, damageDiceOverride: null, ammoType: 'smoke' }] })).toContainEqual(expect.stringMatching(/grenades/));
  });
});
