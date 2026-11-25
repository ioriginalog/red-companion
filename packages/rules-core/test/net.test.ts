import { describe, expect, it } from 'vitest';
import { architectureProblem, boostFor, brainDamage, depthOf, netActionsFor, neighborsOf, PROGRAM_TEMPLATES, type NetArchitecture, type NetRig } from '../src/index.js';

const A: NetArchitecture = {
  id: 'a', name: 'A', difficulty: 'basic', rootId: 'r', virusDv: 6, access: [],
  floors: { r: { id: 'r', kind: 'empty' }, b: { id: 'b', kind: 'file', dv: 6 }, c: { id: 'c', kind: 'empty' } },
  children: { r: ['b'], b: ['c'] },
};

describe('net engine', () => {
  it('NET Actions by Interface rank', () => {
    expect([1, 3, 4, 6, 7, 9, 10].map(netActionsFor)).toEqual([2, 2, 3, 3, 4, 4, 5]);
  });
  it('walks the floor tree', () => {
    expect(depthOf(A, 'c')).toBe(3);
    expect(neighborsOf(A, 'b')).toEqual(['r', 'c']);
  });
  it('finds structural problems', () => {
    expect(architectureProblem(A)).toBeNull();
    expect(architectureProblem({ ...A, children: { r: ['b'] } })).toMatch(/hang below/);
    expect(architectureProblem({ ...A, children: { r: ['b'], b: ['c'], c: ['r'] } })).toMatch(/loop|hang/);
    expect(architectureProblem({ ...A, floors: { ...A.floors, b: { id: 'b', kind: 'file' } } })).toMatch(/needs a DV/);
  });
  it('stacks Boosters and takes the best Armor-type Defender', () => {
    const p = (id: string) => ({ ...PROGRAM_TEMPLATES.find((x) => x.id === id)!, status: 'active' as const });
    const rig: NetRig = { interface: 4, deckName: 'D', slots: 7, programs: [p('worm'), { ...p('worm'), id: 'worm2' }, p('armor'), { ...p('armor'), id: 'a2' }] };
    expect(boostFor(rig, 'backdoor')).toBe(4);
    expect(brainDamage(rig, null, 10)).toEqual({ taken: 6, reducedBy: 4, shieldUsedId: null });
  });
});
