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
