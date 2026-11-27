/**
 * Pure edits on an architecture's floor tree for NET Prep: add, branch,
 * insert, move, reorder, remove, and a tidy layout for the diagram.
 * Every function returns a new architecture (or the same one when the edit
 * isn't possible) and never breaks the tree.
 */
import { NET_DV, parentOf, type NetArchitecture, type NetFloor, type NetFloorKind } from '@cprc/rules-core';

/** The validator's limits (packages/session netrun.ts). */
export const MAX_FLOORS = 60;
export const MAX_BRANCHES = 4;

export function nextFloorId(a: NetArchitecture): string {
  let n = Object.keys(a.floors).length + 1;
  while (a.floors[`f${n}`]) n++;
  return `f${n}`;
}

function blank(a: NetArchitecture, kind: NetFloorKind = 'file'): NetFloor {
  const id = nextFloorId(a);
  return kind === 'password' || kind === 'file' || kind === 'controlNode' ? { id, kind, dv: NET_DV[a.difficulty] } : { id, kind };
}

const kidsOf = (a: NetArchitecture, id: string) => a.children[id] ?? [];

function setKids(children: Record<string, string[]>, id: string, kids: string[]): Record<string, string[]> {
  const next = { ...children };
  if (kids.length) next[id] = kids; else delete next[id];
  return next;
}

/** Why a floor can't go under `parentId`, or null. */
export function cantAddUnder(a: NetArchitecture, parentId: string): string | null {
  if (Object.keys(a.floors).length >= MAX_FLOORS) return `An architecture holds at most ${MAX_FLOORS} floors.`;
  if (kidsOf(a, parentId).length >= MAX_BRANCHES) return `A floor branches into at most ${MAX_BRANCHES} floors.`;
  return null;
}

/** A new floor as the last child of `parentId` (a second child makes a branch). */
export function addBelow(a: NetArchitecture, parentId: string): { arch: NetArchitecture; id: string | null } {
  if (!a.floors[parentId] || cantAddUnder(a, parentId)) return { arch: a, id: null };
  const f = blank(a);
  return { arch: { ...a, floors: { ...a.floors, [f.id]: f }, children: setKids(a.children, parentId, [...kidsOf(a, parentId), f.id]) }, id: f.id };
}

/** A new floor beside `id` (same parent, right after it): a new branch. */
export function addBranch(a: NetArchitecture, id: string): { arch: NetArchitecture; id: string | null } {
  const p = parentOf(a, id);
  if (!p || cantAddUnder(a, p)) return { arch: a, id: null };
  const f = blank(a);
  const kids = [...kidsOf(a, p)];
  kids.splice(kids.indexOf(id) + 1, 0, f.id);
  return { arch: { ...a, floors: { ...a.floors, [f.id]: f }, children: setKids(a.children, p, kids) }, id: f.id };
}

/** A new floor in `id`'s place, with `id` hanging below it. Above the first floor, the new one becomes Floor 1. */
export function insertAbove(a: NetArchitecture, id: string): { arch: NetArchitecture; id: string | null } {
  if (!a.floors[id] || Object.keys(a.floors).length >= MAX_FLOORS) return { arch: a, id: null };
  const f = blank(a);
  const p = parentOf(a, id);
  let children = setKids(a.children, f.id, [id]);
  if (p) children = setKids(children, p, kidsOf(a, p).map((k) => (k === id ? f.id : k)));
  return { arch: { ...a, floors: { ...a.floors, [f.id]: f }, children, rootId: p ? a.rootId : f.id }, id: f.id };
}

/** Is `maybe` inside the subtree rooted at `id` (or `id` itself)? */
export function inSubtree(a: NetArchitecture, id: string, maybe: string): boolean {
  const stack = [id];
  while (stack.length) {
    const x = stack.pop()!;
    if (x === maybe) return true;
    stack.push(...kidsOf(a, x));
  }
  return false;
}

/** Why `id` can't move under `parentId`, or null. */
export function cantMove(a: NetArchitecture, id: string, parentId: string): string | null {
  if (id === a.rootId) return 'The first floor stays on top. Insert a floor above it instead.';
  if (!a.floors[parentId]) return 'No such floor.';
  if (inSubtree(a, id, parentId)) return 'A floor can’t go below itself.';
  if (parentOf(a, id) === parentId) return null;
  if (kidsOf(a, parentId).length >= MAX_BRANCHES) return `A floor branches into at most ${MAX_BRANCHES} floors.`;
  return null;
}

/** Move `id` (with everything below it) to the end of `parentId`'s branches. */
export function moveUnder(a: NetArchitecture, id: string, parentId: string): NetArchitecture {
  if (cantMove(a, id, parentId)) return a;
  const p = parentOf(a, id)!;
  if (p === parentId) return a;
  let children = setKids(a.children, p, kidsOf(a, p).filter((k) => k !== id));
  children = setKids(children, parentId, [...(children[parentId] ?? []), id]);
  return { ...a, children };
}

/** Swap `id` with its previous (-1) or next (+1) sibling. */
export function reorder(a: NetArchitecture, id: string, dir: -1 | 1): NetArchitecture {
  const p = parentOf(a, id);
  if (!p) return a;
  const kids = [...kidsOf(a, p)];
  const i = kids.indexOf(id);
  const j = i + dir;
  if (j < 0 || j >= kids.length) return a;
  [kids[i], kids[j]] = [kids[j]!, kids[i]!];
  return { ...a, children: setKids(a.children, p, kids) };
}

/** Remove `id` and everything below it (never the first floor). */
export function removeFloor(a: NetArchitecture, id: string): NetArchitecture {
  if (id === a.rootId || !a.floors[id]) return a;
  const doomed = new Set<string>();
  const stack = [id];
  while (stack.length) { const x = stack.pop()!; doomed.add(x); stack.push(...kidsOf(a, x)); }
  const floors = Object.fromEntries(Object.entries(a.floors).filter(([k]) => !doomed.has(k)));
  let children: Record<string, string[]> = {};
  for (const [k, kids] of Object.entries(a.children)) {
    if (!doomed.has(k)) children = setKids(children, k, kids.filter((c) => !doomed.has(c)));
  }
  return { ...a, floors, children };
}

/** Floors below `id`, counting `id` itself. */
export function subtreeSize(a: NetArchitecture, id: string): number {
  let n = 0;
  const stack = [id];
  while (stack.length) { const x = stack.pop()!; n++; stack.push(...kidsOf(a, x)); }
  return n;
}

export interface TreeNode { id: string; depth: number; col: number }

/**
 * Tidy layout: one row per depth (Floor 1 on top), leaves in left-to-right
 * order one column apart, each parent centered over its branches.
 */
export function layoutTree(a: NetArchitecture): { nodes: TreeNode[]; cols: number; depth: number } {
  const nodes: TreeNode[] = [];
  let next = 0;
  let maxDepth = 0;
  const place = (id: string, depth: number): number => {
    maxDepth = Math.max(maxDepth, depth);
    const kids = kidsOf(a, id).filter((k) => a.floors[k]);
    let col: number;
    if (!kids.length) col = next++;
    else {
      const cs = kids.map((k) => place(k, depth + 1));
      col = (cs[0]! + cs[cs.length - 1]!) / 2;
    }
    nodes.push({ id, depth, col });
    return col;
  };
  if (a.floors[a.rootId]) place(a.rootId, 0);
  return { nodes, cols: Math.max(1, next), depth: maxDepth + 1 };
}
