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

describe('round 2 parser fixes', () => {
  const base: CommandContext = {
    actorId: 'vex', skills: ['Handgun', 'Evasion'],
    recipients: [{ name: 'GM', id: 'gm' }, { name: 'Bob', id: 'p2' }, { name: 'Kestrel', id: 'p2' }, { name: 'Alice', id: 'p1' }, { name: 'Alicia', id: 'p3' }],
  };
  it.each(['vs 15', 'vs. 15', 'VS DV 15', 'dv 15', 'DV15', 'against 15'])('accepts a DV written as "%s"', (dv) => {
    const p = parseCommand(`/check REF+Handgun ${dv}`, base);
    expect(p).toMatchObject({ kind: 'intent', intent: { type: 'rollCheck', stat: 'REF', skill: 'Handgun', dv: 15 } });
  });
  it('rejects unknown skills with a suggestion instead of rolling 0', () => {
    const p = parseCommand('/check REF+Handgn vs 15', base);
    expect(p.kind).toBe('error');
    expect(p.kind === 'error' && p.message).toContain('Did you mean Handgun');
  });
  it('rolls a RED skill the character lacks (level 0) and specializations', () => {
    expect(parseCommand('/check INT+Perception', base)).toMatchObject({ kind: 'intent', intent: { skill: 'Perception' } });
    expect(parseCommand('/check INT+Local Expert (Watson)', base)).toMatchObject({ kind: 'intent', intent: { skill: 'Local Expert (Watson)' } });
    expect(parseCommand('/check REF+shoulder', base)).toMatchObject({ kind: 'intent', intent: { skill: 'Shoulder Arms' } });
  });
  it('whispers by player name, character name or unique prefix', () => {
    expect(parseCommand('/w bob hi', base)).toMatchObject({ intent: { to: ['p2'], text: 'hi' } });
    expect(parseCommand('/w Kestrel hi', base)).toMatchObject({ intent: { to: ['p2'], text: 'hi' } });
    expect(parseCommand('/w kes hi', base)).toMatchObject({ intent: { to: ['p2'], text: 'hi' } });
    const amb = parseCommand('/w ali hi', base);
    expect(amb.kind === 'error' && amb.message).toContain('Which one');
    expect(parseCommand('/w alice hi', base)).toMatchObject({ intent: { to: ['p1'] } });
    expect(parseCommand('/w zed hi', base).kind).toBe('error');
  });
});

describe('token labels', async () => {
  const { tokenLabels, labelSpots } = await import('../src/table/labels.js');
  it('keeps labels unique and short', () => {
    const l = tokenLabels({ a: 'Street Ganger', b: 'Street Ganger B', c: 'Vex', d: 'Corporate Security', e: 'Corporate Security' });
    expect(new Set(Object.values(l)).size).toBe(5);
    expect(l.c).toBe('Vex');
    for (const v of Object.values(l)) expect(v.length).toBeLessThanOrEqual(10);
    expect(l.b!.endsWith('B')).toBe(true);
  });
  it('moves labels above when the square below is taken, and hides them when boxed in', () => {
    const s = labelSpots({ a: { x: 1, y: 1 }, b: { x: 1, y: 2 }, c: { x: 1, y: 3 }, d: { x: 5, y: 5 } });
    expect(s).toEqual({ a: 'above', b: 'hidden', c: 'below', d: 'below' });
    expect(labelSpots({ a: { x: 1, y: 1 }, b: { x: 1, y: 2 } }, new Set(['a'])).a).toBe('hidden');
  });
});

describe('dodge prompt context', async () => {
  const { applyEntry, emptySession, handleIntent, projectState } = await import('@cprc/session');
  const { scriptedDice } = await import('@cprc/rules-core');
  const { demoIntents } = await import('../src/demo.js');
  const { dodgeContext } = await import('../src/tactics.js');
  let s = emptySession('x');
  for (const i of demoIntents()) { const r = handleIntent(s, i, { role: 'gm' }, { dice: scriptedDice({}) }); if (r.ok) s = applyEntry(s, r.entry); }
  s = applyEntry(s, (handleIntent(s, { type: 'assignController', actorId: 'vex', controller: 'p1' }, { role: 'gm' }, { dice: scriptedDice({}) }) as { ok: true; entry: never }).entry);
  const p1 = projectState(s, { role: 'player', playerId: 'p1' });
  it('shows a DV span when the attacker’s weapon is hidden, and the defender’s dodge odds', () => {
    const ctx = dodgeContext(p1, { attackerId: 'lt', defenderId: 'vex', weaponId: 'ar', distance: 10 });
    expect(ctx.dv && 'min' in ctx.dv).toBe(true);
    expect(ctx.dodgeBase).toBe(7 + 6); // DEX 7 + Evasion 6
    expect(ctx.dodgeBeatsDv && 'atMin' in ctx.dodgeBeatsDv).toBe(true);
    expect(ctx.weaponKnown).toBe(false);
  });
  it('uses the exact DV when the projection shares the weapon type (#15)', () => {
    const ctx = dodgeContext(p1, { attackerId: 'lt', defenderId: 'vex', weaponId: 'ar', distance: 10, weaponType: 'assaultRifle' });
    expect(ctx.dv).toEqual({ exact: 16 });
    expect(ctx.weaponKnown).toBe(true);
  });
  it('shows the exact DV when the attacker’s weapon is visible', () => {
    const gm = projectState(s, { role: 'gm' });
    const ctx = dodgeContext(gm, { attackerId: 'lt', defenderId: 'vex', weaponId: 'ar', distance: 10 });
    expect(ctx.dv).toEqual({ exact: 16 }); // Assault Rifle, 7–12 m
  });
});
