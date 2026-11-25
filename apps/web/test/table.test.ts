import { describe, expect, it } from 'vitest';
import { parseCommand, parseDice, type CommandContext } from '../src/table/commands.js';
import { clampBox, fitBox, zoomAt } from '../src/table/viewport.js';
import { areaKindFor, autofireMaxMeters, blastCells, canSuppress, shellCells } from '../src/table/area.js';
import { linkedStat } from '../src/table/skills.js';

const ctx: CommandContext = {
  actorId: 'vex', skills: ['Handgun', 'Shoulder Arms', 'Evasion'],
  recipients: [{ name: 'GM', id: 'gm' }, { name: 'Doc', id: 'p9' }, { name: 'Doc Ruiz', id: 'p2' }],
};

describe('parseDice', () => {
  it('reads RED dice', () => {
    expect(parseDice('2d6+3')).toEqual({ count: 2, sides: 6, bonus: 3 });
    expect(parseDice('d10')).toEqual({ count: 1, sides: 10, bonus: 0 });
    expect(parseDice('3d6 - 1')).toEqual({ count: 3, sides: 6, bonus: -1 });
    expect(parseDice('1d20')).toBeNull();
    expect(parseDice('21d6')).toBeNull();
  });
});

describe('parseCommand', () => {
  it('rolls dice publicly and privately', () => {
    expect(parseCommand('/r 2d6+3 Damage', ctx)).toEqual({ kind: 'intent', intent: { type: 'rollDice', label: 'Damage', dice: { count: 2, sides: 6, bonus: 3 } } });
    const p = parseCommand('/gm /r 1d10', ctx);
    expect(p.kind === 'intent' && p.intent).toMatchObject({ type: 'rollDice', private: true });
  });
  it('builds a skill check with a DV and modifiers', () => {
    const p = parseCommand('/check ref + handgun - 2 vs 15', ctx);
    expect(p).toEqual({ kind: 'intent', intent: {
      type: 'rollCheck', label: 'REF + Handgun', actorId: 'vex', stat: 'REF', skill: 'Handgun',
      modifiers: [{ label: 'Penalty', value: -2 }], dv: 15,
    } });
  });
  it('allows multi-word skills and raw bases', () => {
    const p = parseCommand('/check REF+Shoulder Arms', ctx);
    expect(p.kind === 'intent' && p.intent).toMatchObject({ stat: 'REF', skill: 'Shoulder Arms' });
    const raw = parseCommand('/check 12 vs 13', { ...ctx, actorId: null });
    expect(raw.kind === 'intent' && raw.intent).toMatchObject({ type: 'rollCheck', base: 12, dv: 13 });
  });
  it('needs a character for STAT checks', () => {
    expect(parseCommand('/check REF', { ...ctx, actorId: null }).kind).toBe('error');
  });
  it('whispers to the longest matching name', () => {
    expect(parseCommand('/w Doc Ruiz patch me up', ctx)).toEqual({ kind: 'intent', intent: { type: 'chat', text: 'patch me up', to: ['p2'] } });
    expect(parseCommand('/gm I pocket the chip', ctx)).toEqual({ kind: 'intent', intent: { type: 'chat', text: 'I pocket the chip', to: ['gm'] } });
    expect(parseCommand('/w Nobody hi', ctx).kind).toBe('error');
  });
  it('chats, helps and rejects unknown commands', () => {
    expect(parseCommand('hello', ctx)).toEqual({ kind: 'intent', intent: { type: 'chat', text: 'hello' } });
    expect(parseCommand('/help', ctx).kind).toBe('help');
    expect(parseCommand('/nope', ctx).kind).toBe('error');
    expect(parseCommand('   ', ctx).kind).toBe('empty');
  });
});

describe('viewport', () => {
  it('fits the map at the container aspect', () => {
    const b = fitBox(1536, 1024, 2, 0);
    expect(b.h).toBe(1024);
    expect(b.w).toBe(2048);
    expect(b.x).toBe(-256);
  });
  it('zooms around the cursor point', () => {
    const b = zoomAt({ x: 0, y: 0, w: 1000, h: 500 }, 2, 500, 250, 100, 4000);
    expect(b).toEqual({ x: 250, y: 125, w: 500, h: 250 });
    expect(zoomAt(b, 100, 0, 0, 100, 4000).w).toBe(100);
  });
  it('clamps so the map stays on screen', () => {
    expect(clampBox({ x: 5000, y: 0, w: 400, h: 200 }, 1000, 1000).x).toBe(900);
  });
});

describe('area templates', () => {
  const map = { width: 9, height: 7, cells: ['.........', '.........', '.........', '....#....', '.........', '.........', '.........'].join('') };
  it('builds a 5 × 5 blast and lets cover protect squares behind it', () => {
    const b = blastCells(map, { x: 4, y: 4 });
    expect(b.all).toHaveLength(25);
    expect(b.hit.has('4,3')).toBe(false); // the wall square itself
    expect(b.hit.has('4,2')).toBe(false); // behind the wall
    expect(b.hit.has('2,6')).toBe(true);
  });
  it('builds a 3-square 90° shell cone', () => {
    const s = shellCells(map, { x: 0, y: 3 }, { x: 5, y: 3 });
    expect(s.has('3,3')).toBe(true);
    expect(s.has('4,3')).toBe(false);
    expect(s.has('0,5')).toBe(false);
  });
  it('knows which weapons use templates and can suppress', () => {
    expect(areaKindFor({ id: 'g', name: 'G', type: 'grenadeLauncher' })).toBe('blast');
    expect(areaKindFor({ id: 's', name: 'S', type: 'shotgun' })).toBe('shell');
    expect(areaKindFor({ id: 'p', name: 'P', type: 'heavyPistol' })).toBeNull();
    expect(autofireMaxMeters({ id: 'a', name: 'AR', type: 'assaultRifle' })).toBe(100);
    expect(canSuppress({ id: 'a', name: 'AR', type: 'assaultRifle', ammo: { loaded: 9, capacity: 25 } })).toBe(false);
  });
});

describe('skills', () => {
  it('links skills to STATs', () => {
    expect(linkedStat('Handgun')).toBe('REF');
    expect(linkedStat('paramedic')).toBe('TECH');
    expect(linkedStat('Netrunning Basics')).toBeUndefined();
  });
});
