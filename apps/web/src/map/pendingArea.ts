/**
 * Where an incoming area attack lands, for everyone at the table while a
 * "Blast Incoming" (area dodge) or "Explosive Missed" (scatter) prompt is up.
 *
 * Redaction: built only from what the viewer's projection already holds.
 * The pending step carries the aim square (`at`) and the kind; the 5 × 5
 * blast uses terrain alone. A shotgun shell's cone starts at the shooter, so
 * it's drawn only when the shooter's token is on the viewer's map; otherwise
 * just the aim square shows (a cone would point back at a hidden shooter).
 */
import { cellKey, type Cell } from '@cprc/rules-core';
import type { ViewState } from '@cprc/session';
import { blastCells, shellCells } from '../table/area.js';

export interface PendingArea {
  /** 'scatter': the explosive missed; it lands somewhere in `cells` (GM placing). */
  kind: 'blast' | 'shell' | 'scatter' | 'aim';
  at: Cell;
  /** Squares of the template (blast: the whole 5 × 5; shell: the cone). */
  cells: Cell[];
  /** Squares the blast reaches (cover between center and square protects). */
  hit: Set<string>;
  label: string;
}

export function pendingArea(view: ViewState): PendingArea | null {
  const p = view.pending;
  const map = view.map;
  if (!p || !map) return null;
  if (p.kind === 'awaitingScatter') {
    const b = blastCells(map, p.at);
    return { kind: 'scatter', at: p.at, cells: b.all, hit: new Set(), label: 'Missed: Lands Near Here' };
  }
  if (p.kind !== 'awaitingAreaDodge') return null;
  if (p.areaKind === 'shotgunShell') {
    const from = map.tokens[p.attackerId];
    if (!from) return { kind: 'aim', at: p.at, cells: [p.at], hit: new Set([cellKey(p.at)]), label: 'Shotgun Shell' };
    const hit = shellCells(map, from, p.at);
    const cells = [...hit].map((k) => { const [x, y] = k.split(',').map(Number); return { x: x!, y: y! }; });
    return { kind: 'shell', at: p.at, cells, hit, label: 'Shotgun Shell' };
  }
  const b = blastCells(map, p.at);
  return { kind: 'blast', at: p.at, cells: b.all, hit: b.hit, label: 'Blast Incoming' };
}
