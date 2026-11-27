/**
 * NET Prep floor tree, drawn as a diagram: Floor 1 on top, branches fanning
 * out below. Click a floor to edit it; drag a floor onto another to move it
 * (with everything below it) under that floor. The toolbar does the same
 * from the keyboard: add below, add a branch, insert above, reorder, move,
 * remove.
 */
import { useState } from 'react';
import { depthOf, parentOf, type NetArchitecture, type NetFloorKind } from '@cprc/rules-core';
import {
  addBelow, addBranch, cantAddUnder, cantMove, insertAbove, layoutTree, moveUnder, removeFloor, reorder, subtreeSize,
} from './archTree.js';

export const FLOOR_KIND: Record<NetFloorKind, { glyph: string; label: string }> = {
  password: { glyph: 'PW', label: 'Password' },
  file: { glyph: 'FL', label: 'File' },
  controlNode: { glyph: 'CN', label: 'Control Node' },
  blackIce: { glyph: 'ICE', label: 'Black ICE' },
  demon: { glyph: 'DM', label: 'Demon' },
  empty: { glyph: '··', label: 'Empty Floor' },
};

const NODE_W = 132;
const NODE_H_EDIT = 52;
const NODE_H_MARKED = 66;
const GAP_X = 16;
const GAP_Y = 30;

export interface FloorDiagramProps {
  arch: NetArchitecture;
  selected: string;
  onSelect: (id: string) => void;
  onChange: (a: NetArchitecture) => void;
  /** Floors to mark, e.g. where runners are and where chasing ICE sits (live overview). */
  marks?: Record<string, string[]>;
  /** Read-only (live overview). */
  readOnly?: boolean;
}

export function FloorDiagram({ arch, selected, onSelect, onChange, marks, readOnly }: FloorDiagramProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const NODE_H = readOnly ? NODE_H_MARKED : NODE_H_EDIT;
  const { nodes, cols, depth } = layoutTree(arch);
  const pos = new Map(nodes.map((n) => [n.id, n]));
  const x = (col: number) => col * (NODE_W + GAP_X);
  const y = (d: number) => d * (NODE_H + GAP_Y);
  const w = cols * (NODE_W + GAP_X) - GAP_X;
  const h = depth * (NODE_H + GAP_Y) - GAP_Y;

  const edit = (r: { arch: NetArchitecture; id: string | null }) => { if (r.id) { onChange(r.arch); onSelect(r.id); } };
  const sel = arch.floors[selected] ? selected : arch.rootId;
  const parent = parentOf(arch, sel);
  const sibs = parent ? arch.children[parent] ?? [] : [];
  const idx = sibs.indexOf(sel);
  const moveTargets = Object.keys(arch.floors).filter((id) => id !== parent && !cantMove(arch, sel, id));
  const name = (id: string) => {
    const f = arch.floors[id]!;
    return `Floor ${depthOf(arch, id)}: ${f.label ? f.label : FLOOR_KIND[f.kind].label}`;
  };

  return (
    <div className="net-diagram-wrap">
      {!readOnly && (
        <div className="net-diagram-tools" role="toolbar" aria-label="Floor Tools">
          <span className="net-sel">{name(sel)}</span>
          <button className="btn" disabled={!!cantAddUnder(arch, sel)} title={cantAddUnder(arch, sel) ?? 'A new floor below this one.'} onClick={() => edit(addBelow(arch, sel))}>Add Below</button>
          <button className="btn" disabled={!parent || !!cantAddUnder(arch, parent)} title={!parent ? 'Floor 1 can’t branch sideways. Add floors below it.' : cantAddUnder(arch, parent) ?? 'A new branch beside this floor.'} onClick={() => edit(addBranch(arch, sel))}>Add Branch</button>
          <button className="btn" onClick={() => edit(insertAbove(arch, sel))} title="A new floor between this one and the floor above.">Insert Above</button>
          <button className="btn ghost" disabled={idx <= 0} aria-label="Move Left" title="Swap with the branch to the left." onClick={() => onChange(reorder(arch, sel, -1))}>◀</button>
          <button className="btn ghost" disabled={idx < 0 || idx >= sibs.length - 1} aria-label="Move Right" title="Swap with the branch to the right." onClick={() => onChange(reorder(arch, sel, 1))}>▶</button>
          <select aria-label="Move Under" value="" disabled={sel === arch.rootId || moveTargets.length === 0}
            onChange={(e) => { if (e.target.value) onChange(moveUnder(arch, sel, e.target.value)); }}>
            <option value="">Move Under…</option>
            {moveTargets.map((id) => <option key={id} value={id}>{name(id)}</option>)}
          </select>
          <button className="btn danger" disabled={sel === arch.rootId}
            title={sel === arch.rootId ? 'Floor 1 stays.' : `Removes ${subtreeSize(arch, sel)} floor${subtreeSize(arch, sel) === 1 ? '' : 's'}.`}
            onClick={() => { const p = parentOf(arch, sel); onChange(removeFloor(arch, sel)); if (p) onSelect(p); }}>
            {subtreeSize(arch, sel) > 1 ? `Remove (${subtreeSize(arch, sel)} Floors)` : 'Remove'}
          </button>
        </div>
      )}
      <div className="net-diagram" style={{ width: w, height: h }} role="tree" aria-label="Floor Diagram">
        <svg className="net-diagram-lines" width={w} height={h} aria-hidden="true">
          {nodes.map((n) => (arch.children[n.id] ?? []).map((k) => {
            const c = pos.get(k);
            if (!c) return null;
            const x1 = x(n.col) + NODE_W / 2;
            const y1 = y(n.depth) + NODE_H;
            const x2 = x(c.col) + NODE_W / 2;
            const y2 = y(c.depth);
            const my = (y1 + y2) / 2;
            const locked = arch.floors[n.id]!.kind === 'password';
            return <path key={`${n.id}-${k}`} d={`M${x1},${y1} V${my} H${x2} V${y2}`} fill="none" stroke={locked ? '#ffe600' : '#2c4aa8'} strokeWidth={2} strokeDasharray={locked ? '5 4' : undefined} />;
          }))}
        </svg>
        {nodes.map((n) => {
          const f = arch.floors[n.id]!;
          const k = FLOOR_KIND[f.kind];
          const isDrop = dropId === n.id && dragId && !cantMove(arch, dragId, n.id);
          const badDrop = dropId === n.id && dragId && dragId !== n.id && !!cantMove(arch, dragId, n.id);
          const m = marks?.[n.id] ?? [];
          return (
            <button
              key={n.id} type="button" role="treeitem" aria-selected={n.id === sel}
              aria-label={`${name(n.id)}${f.dv !== undefined ? `, DV ${f.dv}` : ''}${m.length ? `, ${m.join(', ')}` : ''}`}
              className={`net-node k-${f.kind}${n.id === sel && !readOnly ? ' sel' : ''}${isDrop ? ' drop' : ''}${badDrop ? ' nodrop' : ''}${m.length ? ' marked' : ''}`}
              style={{ left: x(n.col), top: y(n.depth), width: NODE_W, height: NODE_H }}
              onClick={() => onSelect(n.id)}
              draggable={!readOnly && n.id !== arch.rootId}
              onDragStart={(e) => { setDragId(n.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', n.id); }}
              onDragEnd={() => { setDragId(null); setDropId(null); }}
              onDragOver={(e) => { if (dragId && !cantMove(arch, dragId, n.id)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } setDropId(n.id); }}
              onDragLeave={() => setDropId((d) => (d === n.id ? null : d))}
              onDrop={(e) => { e.preventDefault(); if (dragId) onChange(moveUnder(arch, dragId, n.id)); setDragId(null); setDropId(null); }}
            >
              <span className="net-node-top">
                <span className="g">{k.glyph}</span>
                <span className="d">{n.depth + 1}</span>
                {f.dv !== undefined && <span className="dv">DV {f.dv}</span>}
                {f.kind === 'blackIce' && <span className="dv">{f.ice?.length ?? 0} ICE</span>}
              </span>
              <span className="net-node-name">{f.label || k.label}</span>
              {m.length > 0 && <span className="net-node-marks">{m.join(' · ')}</span>}
            </button>
          );
        })}
      </div>
      {!readOnly && <p className="dim net-diagram-hint">Drag a floor onto another to move it (and everything below it) there. Dashed lines lead past a Password.</p>}
    </div>
  );
}
