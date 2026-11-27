import { describe, expect, it } from 'vitest';
import { emptyView, type ProjectedActor, type ViewState } from '@cprc/session';
import { requiredPrompt } from '../src/table/required.js';

const actor = (id: string, controller: string): ProjectedActor => ({ id, controller, public: { name: id } } as unknown as ProjectedActor);
function view(patch: Partial<ViewState>): ViewState {
  const v = emptyView('s');
  return { ...v, actors: { vex: actor('vex', 'p1'), lt: actor('lt', 'gm') }, ...patch };
}
const enc = (extra: object) => ({ active: true, round: 2, order: ['vex', 'lt'], turnIndex: 0, deathSaveRequiredFor: null, ...extra });

describe('requiredPrompt', () => {
  it('asks the owner for a Death Save, not the GM', () => {
    const v = view({ encounter: enc({ deathSaveRequiredFor: 'vex' }) as ViewState['encounter'] });
    expect(requiredPrompt(v, 'p1')).toMatchObject({ title: 'Death Save', choices: [{ intent: { type: 'deathSave', actorId: 'vex' } }] });
    expect(requiredPrompt(v, 'gm')).toBeNull();
  });
  it('asks the defender to dodge, and only them', () => {
    const v = view({ pending: { kind: 'awaitingDodge', id: 'p9', defenderId: 'vex', attack: { attackerId: 'lt' } } as unknown as ViewState['pending'] });
    expect(requiredPrompt(v, 'p1')?.choices.map((c) => c.label)).toEqual(['Dodge', 'Take the DV']);
    expect(requiredPrompt(v, 'p2')).toBeNull();
  });
  it('a pending step outranks a Death Save', () => {
    const v = view({
      encounter: enc({ deathSaveRequiredFor: 'vex' }) as ViewState['encounter'],
      pending: { kind: 'awaitingDamage', id: 'd1', attackerId: 'vex', targetId: 'lt' } as unknown as ViewState['pending'],
    });
    expect(requiredPrompt(v, 'p1')?.title).toBe('Hit');
  });
  it('blast dodge: one tap for one character, the panel for several', () => {
    const one = view({ pending: { kind: 'awaitingAreaDodge', id: 'a1', decisions: { vex: null, lt: null } } as unknown as ViewState['pending'] });
    expect(requiredPrompt(one, 'p1')?.choices).toHaveLength(2);
    const two = view({ actors: { vex: actor('vex', 'p1'), kes: actor('kes', 'p1') }, pending: { kind: 'awaitingAreaDodge', id: 'a1', decisions: { vex: null, kes: null } } as unknown as ViewState['pending'] });
    expect(requiredPrompt(two, 'p1')?.choices).toHaveLength(0);
  });
});

describe('contrast (WCAG AA)', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const v = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))![1]!;
  const lum = (h: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };
  const backgrounds = ['bg', 'panel', 'panel-2'].map(v).concat(['#071030']);
  it.each(['text', 'dim', 'cyan', 'yellow', 'red', 'purple', 'green', 'magenta'])('--%s text is at least 4.5:1 on every panel', (fg) => {
    for (const bg of backgrounds) expect(ratio(v(fg), bg)).toBeGreaterThanOrEqual(4.5);
  });
  it('read-only STAT tiles are not dimmed', () => {
    expect(css).toMatch(/\.stat:disabled[^{]*\{[^}]*opacity:\s*1/);
  });
});

describe('/check with a character name', async () => {
  const { parseCommand, joinNames } = await import('../src/table/commands.js');
  const rollable = [
    { id: 'enf', name: 'Enforcer', skills: ['Brawling'] },
    { id: 'g1', name: 'Street Ganger', skills: ['Handgun'] },
    { id: 'g2', name: 'Street Ganger B', skills: ['Handgun'] },
  ];
  const ctx = { actorId: null, skills: [], recipients: [], rollable };
  it('rolls for the named NPC', () => {
    expect(parseCommand('/check Enforcer COOL vs 15', ctx)).toMatchObject({ kind: 'intent', intent: { type: 'rollCheck', actorId: 'enf', stat: 'COOL', dv: 15 } });
    expect(parseCommand('/check enf Brawling', ctx)).toMatchObject({ intent: { actorId: 'enf', skill: 'Brawling' } });
  });
  it('prefers the exact multi-word name and reports ambiguity', () => {
    expect(parseCommand('/check Street Ganger REF+Handgun', ctx)).toMatchObject({ intent: { actorId: 'g1' } });
    expect(parseCommand('/check Street Ganger B REF', ctx)).toMatchObject({ intent: { actorId: 'g2' } });
    expect(parseCommand('/check Str REF', ctx)).toMatchObject({ kind: 'error' });
  });
  it('still works without a name', () => {
    expect(parseCommand('/check REF+Handgun vs 13', { ...ctx, actorId: 'g1', skills: ['Handgun'] })).toMatchObject({ intent: { actorId: 'g1', skill: 'Handgun' } });
  });
  it('joins lists the Chicago way', () => {
    expect(joinNames(['A'])).toBe('A');
    expect(joinNames(['A', 'B'])).toBe('A and B');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B, and C');
  });
});
