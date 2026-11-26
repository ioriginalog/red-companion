/** Players edit their own character's notes and gear (validated by the authority). */
import { useState } from 'react';
import type { GearItem } from '@cprc/rules-core';
import type { ProjectedActor } from '@cprc/session';
import type { TableCtx } from './ctx.js';

type Row = { name: string; qty: number; notes: string };
const toRows = (g: GearItem[] | undefined): Row[] => (g ?? []).map((x) => ({ name: x.name, qty: x.qty, notes: x.notes ?? '' }));
export const rowsToGear = (rows: Row[]): GearItem[] =>
  rows.filter((r) => r.name.trim()).map((r) => ({ name: r.name.trim(), qty: Math.max(0, Math.min(9999, Math.round(r.qty) || 0)), ...(r.notes.trim() ? { notes: r.notes.trim() } : {}) }));

export function NotesAndGear({ c, a, canEdit }: { c: TableCtx; a: ProjectedActor; canEdit: boolean }) {
  const [draft, setDraft] = useState<{ notes: string; gear: Row[] } | null>(null);
  if (!draft) {
    if (!a.notes && !a.gmNotes && !canEdit) return null;
    return (
      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="ttl">Notes</div>
          {canEdit && <button className="btn sm ghost" onClick={() => setDraft({ notes: a.notes ?? '', gear: toRows(a.combatant?.gear) })}>Edit Notes and Gear</button>}
        </div>
        {a.notes ? <p className="notes">{a.notes}</p> : <p className="dim small">No notes yet.</p>}
        {c.isGm && a.gmNotes && (<><div className="ttl" style={{ marginTop: 8 }}>GM Notes</div><p className="notes dim">{a.gmNotes}</p></>)}
      </section>
    );
  }
  const set = (i: number, patch: Partial<Row>) => setDraft({ ...draft, gear: draft.gear.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const save = () => {
    if (c.act({ type: 'editOwnSheet', actorId: a.id, notes: draft.notes, gear: rowsToGear(draft.gear) })) setDraft(null);
  };
  return (
    <section className="card sheet-edit" aria-label="Edit Notes and Gear">
      <div className="ttl">Edit Notes and Gear</div>
      <label className="fld"><span>Notes</span>
        <textarea value={draft.notes} maxLength={8000} rows={4} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} aria-label="Notes" />
      </label>
      <div className="ttl" style={{ marginTop: 8 }}>Gear</div>
      {draft.gear.length === 0 && <p className="dim small">No gear listed.</p>}
      {draft.gear.map((r, i) => (
        <div key={i} className="gear-row">
          <input aria-label={`Gear ${i + 1} Name`} value={r.name} maxLength={80} placeholder="Item" onChange={(e) => set(i, { name: e.target.value })} />
          <input aria-label={`Gear ${i + 1} Quantity`} type="number" min={0} max={9999} value={r.qty} onChange={(e) => set(i, { qty: Number(e.target.value) })} style={{ width: 70 }} />
          <input aria-label={`Gear ${i + 1} Notes`} value={r.notes} maxLength={500} placeholder="Notes" onChange={(e) => set(i, { notes: e.target.value })} />
          <button className="btn sm ghost" aria-label={`Remove ${r.name || 'Item'}`} onClick={() => setDraft({ ...draft, gear: draft.gear.filter((_, j) => j !== i) })}>Remove</button>
        </div>
      ))}
      <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <button className="btn sm" disabled={draft.gear.length >= 100} onClick={() => setDraft({ ...draft, gear: [...draft.gear, { name: '', qty: 1, notes: '' }] })}>Add Item</button>
        <span className="spacer" />
        <button className="btn ghost" onClick={() => setDraft(null)}>Cancel</button>
        <button className="btn yellow" onClick={save}>Save</button>
      </div>
      <p className="dim small">STATs, skills, weapons and cyberware stay with the GM.</p>
    </section>
  );
}
