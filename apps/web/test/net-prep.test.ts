import { describe, expect, it } from 'vitest';
import { architectureProblem, depthOf, type NetArchitecture } from '@cprc/rules-core';
import {
  addBelow, addBranch, cantMove, insertAbove, layoutTree, MAX_BRANCHES, moveUnder, removeFloor, reorder,
} from '../src/netrun/archTree.js';

/** f1 Password → f2 File → f3 File */
const base = (): NetArchitecture => ({
  id: 'a', name: 'Test', difficulty: 'standard', rootId: 'f1', virusDv: 8, access: [],
  floors: { f1: { id: 'f1', kind: 'password', dv: 8 }, f2: { id: 'f2', kind: 'file', dv: 8 }, f3: { id: 'f3', kind: 'file', dv: 8 } },
  children: { f1: ['f2'], f2: ['f3'] },
});
const valid = (a: NetArchitecture) => expect(architectureProblem(a)).toBeNull();

describe('NET Prep floor tree edits', () => {
  it('adds below and branches beside', () => {
    const below = addBelow(base(), 'f3');
    expect(below.id).toBe('f4');
    expect(below.arch.children.f3).toEqual(['f4']);
    valid(below.arch);
    const branch = addBranch(below.arch, 'f2');
    expect(branch.arch.children.f1).toEqual(['f2', 'f5']);
    valid(branch.arch);
    // Floor 1 has no parent, so it can't branch sideways.
    expect(addBranch(base(), 'f1').id).toBeNull();
  });

  it('inserts above a floor, and above Floor 1 a new Floor 1', () => {
    const mid = insertAbove(base(), 'f3');
    expect(mid.arch.children.f2).toEqual([mid.id]);
    expect(mid.arch.children[mid.id!]).toEqual(['f3']);
    expect(depthOf(mid.arch, 'f3')).toBe(4);
    valid(mid.arch);
    const top = insertAbove(base(), 'f1');
    expect(top.arch.rootId).toBe(top.id);
    expect(depthOf(top.arch, 'f1')).toBe(2);
    valid(top.arch);
  });

  it('moves a floor with everything below it, never under itself or past four branches', () => {
    const a = addBranch(base(), 'f2').arch; // f1: [f2, f4]
    const moved = moveUnder(a, 'f2', 'f4');
    expect(moved.children.f1).toEqual(['f4']);
    expect(moved.children.f4).toEqual(['f2']);
    expect(depthOf(moved, 'f3')).toBe(4);
    valid(moved);
    expect(cantMove(a, 'f2', 'f3')).toMatch(/below itself/);
    expect(moveUnder(a, 'f2', 'f3')).toBe(a);
    expect(cantMove(a, 'f1', 'f4')).toMatch(/first floor/);
    let wide = base();
    for (let i = 1; i < MAX_BRANCHES; i++) wide = addBranch(wide, 'f2').arch;
    expect(wide.children.f1).toHaveLength(MAX_BRANCHES);
    expect(cantMove(wide, 'f3', 'f1')).toMatch(/at most 4/);
    expect(addBranch(wide, 'f2').id).toBeNull();
  });

  it('reorders branches and removes a whole subtree', () => {
    const a = addBranch(base(), 'f2').arch; // f1: [f2, f4]
    expect(reorder(a, 'f4', -1).children.f1).toEqual(['f4', 'f2']);
    expect(reorder(a, 'f4', 1)).toBe(a);
    const gone = removeFloor(a, 'f2');
    expect(Object.keys(gone.floors).sort()).toEqual(['f1', 'f4']);
    expect(gone.children).toEqual({ f1: ['f4'] });
    valid(gone);
    expect(removeFloor(a, 'f1')).toBe(a);
  });

  it('lays out parents centered over their branches', () => {
    const a = addBranch(base(), 'f2').arch; // f1 → [f2 → f3, f4]
    const { nodes, cols, depth } = layoutTree(a);
    const at = Object.fromEntries(nodes.map((n) => [n.id, n]));
    expect(cols).toBe(2);
    expect(depth).toBe(3);
    expect(at.f3!.col).toBe(0);
    expect(at.f4!.col).toBe(1);
    expect(at.f1!.col).toBe(0.5);
    expect(at.f1!.depth).toBe(0);
  });
});
