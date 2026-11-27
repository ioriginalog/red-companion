/**
 * Notes tab: handouts the GM has shared (everyone or chosen players) and,
 * for the GM, private journal pages. Stored in the session log, so they
 * survive reloads and reach players who join later.
 */
import { useMemo, useState } from 'react';
import type { Handout } from '@cprc/session';
import { loadImage, prepareMapImage, scaledSize, storeImage } from '../assets.js';
import { client } from '../net.js';
import type { TableCtx } from './ctx.js';
import { joinNames } from './format.js';

type Draft = { id: string | null; title: string; body: string; imageUrl: string; audience: 'all' | 'gm' | string[] };
const EMPTY: Draft = { id: null, title: '', body: '', imageUrl: '', audience: 'gm' };

const newId = () => `h-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export function audienceLabel(a: Handout['audience'], who: (id: string) => string): string {
  if (a === 'all') return 'Everyone';
  if (a === 'gm') return 'GM Journal';
  return joinNames(a.map(who));
}

export function NotesPanel({ c }: { c: TableCtx }) {
  const { view, isGm, s } = c;
  const all = useMemo(() => Object.values(view.handouts ?? {}), [view.handouts]);
  const shared = all.filter((h) => h.audience !== 'gm');
  const journal = all.filter((h) => h.audience === 'gm');
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const save = (d: Draft) => {
    const ok = c.act({ type: 'setHandout', id: d.id ?? newId(), title: d.title.trim(), body: d.body, audience: d.audience, ...(d.imageUrl.trim() ? { imageUrl: d.imageUrl.trim() } : {}) });
    if (ok) setDraft(null);
  };

  const attach = async (file: File | undefined) => {
    if (!file || !draft) return;
    setBusy(true);
    try {
      const img = await loadImage(file);
      const { w, h } = scaledSize(img, 2048);
      const stored = await storeImage(await prepareMapImage(img, w, h));
      if (stored.where !== 'relay') throw new Error('The image couldn’t be uploaded to the session.');
      setDraft({ ...draft, imageUrl: stored.url });
    } catch (e) {
      client.toast(e instanceof Error ? e.message : 'The image couldn’t be uploaded.');
    } finally {
      setBusy(false);
    }
  };

  const item = (h: Handout) => (
    <article key={h.id} className={`handout${open === h.id ? ' open' : ''}`}>
      <button className="handout-head" aria-expanded={open === h.id} onClick={() => setOpen(open === h.id ? null : h.id)}>
        <span className="h">{h.title}</span>
        <span className="tag">{audienceLabel(h.audience, c.who)}</span>
      </button>
      {open === h.id && (
        <div className="handout-body">
          {h.imageUrl && <img src={h.imageUrl} alt={`Handout image: ${h.title}`} loading="lazy" />}
          {h.body && <p className="notes">{h.body}</p>}
          {isGm && (
            <div className="row">
              <button className="btn" onClick={() => setDraft({ id: h.id, title: h.title, body: h.body, imageUrl: h.imageUrl ?? '', audience: h.audience })}>Edit</button>
              {h.audience === 'gm' && <button className="btn yellow" onClick={() => save({ id: h.id, title: h.title, body: h.body, imageUrl: h.imageUrl ?? '', audience: 'all' })}>Share with Everyone</button>}
              <button className="btn danger" onClick={() => c.act({ type: 'removeHandout', id: h.id })}>Delete</button>
            </div>
          )}
        </div>
      )}
    </article>
  );

  return (
    <>
      {isGm && draft && (
        <section className="card">
          <div className="ttl">{draft.id ? 'Edit Note' : 'New Note'}</div>
          <form className="handout-form" onSubmit={(e) => { e.preventDefault(); save(draft); }}>
            <label>Title<input value={draft.title} maxLength={120} required onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
            <label>Text<textarea value={draft.body} rows={6} maxLength={20000} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></label>
            <div className="row wrap">
              <label className="file-btn btn">{busy ? 'Uploading…' : draft.imageUrl ? 'Replace Image' : 'Add Image'}
                <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={busy} onChange={(e) => void attach(e.target.files?.[0])} />
              </label>
              {draft.imageUrl && <button type="button" className="btn ghost" onClick={() => setDraft({ ...draft, imageUrl: '' })}>Remove Image</button>}
            </div>
            <fieldset className="aud">
              <legend className="k">Who Sees It</legend>
              <label><input type="radio" name="aud" checked={draft.audience === 'gm'} onChange={() => setDraft({ ...draft, audience: 'gm' })} /> Only Me (Journal)</label>
              <label><input type="radio" name="aud" checked={draft.audience === 'all'} onChange={() => setDraft({ ...draft, audience: 'all' })} /> Everyone</label>
              {s.players.map((p) => {
                const list = Array.isArray(draft.audience) ? draft.audience : [];
                const on = list.includes(p.playerId);
                return (
                  <label key={p.playerId}>
                    <input type="checkbox" checked={on} onChange={() => {
                      const next = on ? list.filter((x) => x !== p.playerId) : [...list, p.playerId];
                      setDraft({ ...draft, audience: next.length ? next : 'gm' });
                    }} /> {p.name}
                  </label>
                );
              })}
            </fieldset>
            <div className="row">
              <button className="btn yellow" disabled={!draft.title.trim() || busy}>{draft.audience === 'gm' ? 'Save to Journal' : 'Save and Share'}</button>
              <button type="button" className="btn ghost" onClick={() => setDraft(null)}>Cancel</button>
            </div>
          </form>
        </section>
      )}
      <section className="card">
        <div className="ttl">Handouts</div>
        {isGm && !draft && <button className="btn" onClick={() => setDraft({ ...EMPTY })}>New Note</button>}
        <div className="handouts">
          {shared.length ? shared.map(item) : <p className="dim">{isGm ? 'Nothing shared yet. Write a note, then share it with everyone or chosen players.' : 'The GM hasn’t shared anything yet.'}</p>}
        </div>
      </section>
      {isGm && (
        <section className="card">
          <div className="ttl">GM Journal</div>
          <div className="handouts">{journal.length ? journal.map(item) : <p className="dim">Private notes only you can see.</p>}</div>
        </section>
      )}
    </>
  );
}
