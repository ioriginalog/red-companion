import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COVER_MATERIALS, coverMaterial, DEFAULT_COVER_MATERIAL, type Cell, type CoverMaterialId, type Terrain } from '@cprc/rules-core';
import type { TacticalMap } from '@cprc/session';
import { client, type ClientState } from '../net.js';
import { demoMap } from '../demo.js';
import { downloadText, loadImage, pickFile, prepareMapImage, scaledSize, storeImage } from '../assets.js';
import {
  commit, duplicateMap, exportMap, fitGrid, floodFill, historyOf, importMap, newMap, paintRect, paintStroke, redo, terrainCounts,
  TERRAINS, tokensOnBlocked, undo, uniqueMapId, type History, MAX_SQUARES,
} from './mapModel.js';
import './editors.css';
import { joinNames } from '../table/format.js';

type Source = 'active' | 'library' | 'new';
type Tool = 'brush' | 'rect' | 'fill';
interface Pending { img: HTMLImageElement; preview: string; name: string; cellPx: number }

const TOOL_LABEL: Record<Tool, string> = { brush: 'Brush', rect: 'Rectangle', fill: 'Fill' };

export function MapEditor({ s }: { s: ClientState }) {
  const view = s.view!;
  const library = view.library?.maps ?? {};
  const active = view.map;
  const takenIds = useMemo(() => [...Object.keys(library), ...(active ? [active.id] : [])], [library, active]);

  const [draft, setDraft] = useState<TacticalMap | null>(null);
  const [source, setSource] = useState<Source>('new');
  const [hist, setHist] = useState<History>(historyOf(''));
  const [tool, setTool] = useState<Tool>('brush');
  const [terrain, setTerrain] = useState<Terrain>('#');
  const [size, setSize] = useState(1);
  const [outline, setOutline] = useState(false);
  const [zoom, setZoom] = useState(0.6);
  const [pending, setPending] = useState<Pending | null>(null);
  const [blank, setBlank] = useState<{ name: string; w: number; h: number } | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [coverMat, setCoverMat] = useState<CoverMaterialId>(DEFAULT_COVER_MATERIAL);

  const open = useCallback((m: TacticalMap, src: Source) => {
    setDraft(m);
    setSource(src);
    setHist(historyOf(m.cells));
    setPending(null);
    setBlank(null);
    setMsg(null);
  }, []);

  // Open the active map by default.
  useEffect(() => { if (!draft && active) open(active, 'active'); }, [active, draft, open]);

  const cells = hist.present;
  const dirty = !!draft && (cells !== draft.cells || draft.name !== (source === 'library' ? library[draft.id]?.name : source === 'active' ? active?.name : undefined)
    || draft.sightRange !== (source === 'library' ? library[draft.id]?.sightRange : source === 'active' ? active?.sightRange : undefined));
  const current: TacticalMap | null = draft ? { ...draft, cells, cover: coverFor(cells, draft.width, draft.cover, coverMat) } : null;

  // ----- Keyboard shortcuts (editor tab only) -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); setHist((h) => (e.shiftKey ? redo(h) : undo(h))); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); setHist(redo); return; }
      if (mod) return;
      const k = e.key.toLowerCase();
      if (k === 'b') setTool('brush');
      else if (k === 'r') setTool('rect');
      else if (k === 'f') setTool('fill');
      else if (k === '[') setSize((n) => Math.max(1, n - 1));
      else if (k === ']') setSize((n) => Math.min(5, n + 1));
      else if (['1', '2', '3', '4'].includes(k)) setTerrain(TERRAINS[Number(k) - 1]!.code);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ----- Creating maps -----
  async function startFromImage() {
    const f = await pickFile('image/png,image/jpeg,image/webp');
    if (!f) return;
    try {
      const img = await loadImage(f);
      setPending({ img, preview: img.src, name: f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 60) || 'New Map', cellPx: 64 });
      setBlank(null);
    } catch (e) { setMsg({ tone: 'warn', text: (e as Error).message }); }
  }

  async function createFromImage() {
    if (!pending) return;
    const { w, h } = scaledSize(pending.img);
    const fit = fitGrid(w, h, pending.cellPx);
    if (fit.width * fit.height > MAX_SQUARES) { setMsg({ tone: 'warn', text: `That makes ${fit.width * fit.height} squares; the limit is ${MAX_SQUARES}. Use bigger squares.` }); return; }
    setBusy(true);
    try {
      const blob = await prepareMapImage(pending.img, fit.cropW, fit.cropH);
      const stored = await storeImage(blob);
      const m = newMap({ name: pending.name, width: fit.width, height: fit.height, cellPx: Math.round(pending.cellPx), background: stored.url, taken: takenIds });
      open(m, 'new');
      setMsg(stored.where === 'local'
        ? { tone: 'warn', text: 'The relay couldn’t store the image, so it only shows on this device until you reload. Players won’t see it.' }
        : { tone: 'ok', text: `Grid set: ${fit.width} × ${fit.height} squares. Paint walls and cover next.` });
    } catch (e) { setMsg({ tone: 'warn', text: (e as Error).message }); }
    setBusy(false);
  }

  async function importJson() {
    const f = await pickFile('application/json,.json');
    if (!f) return;
    try { open(importMap(await f.text(), takenIds), 'new'); setMsg({ tone: 'ok', text: 'Map imported. Save it to the library to keep it.' }); }
    catch (e) { setMsg({ tone: 'warn', text: (e as Error).message }); }
  }

  // ----- Saving and activating -----
  const act = (i: Parameters<typeof client.act>[0]) => client.act(i);

  function saveToLibrary(m = current): boolean {
    if (!m) return false;
    const { tokens: _t, watches: _w, ...rest } = m;
    // Keep tokens a parked scene already has; the live map is saved as a clean copy.
    const parked = library[m.id];
    const item = parked && m.id !== active?.id ? { ...rest, tokens: parked.tokens, watches: {}, spotted: parked.spotted } : { ...rest, tokens: {}, watches: {}, spotted: [] };
    const ok = act({ type: 'saveToLibrary', kind: 'map', item });
    if (ok) {
      setDraft(m);
      setSource((src) => (src === 'new' ? 'library' : src));
      setMsg({ tone: 'ok', text: `Saved “${m.name}” to the library.` });
    }
    return ok;
  }

  function useNow() {
    if (!current) return;
    if (source === 'active' && active) {
      const next: TacticalMap = { ...current, tokens: active.tokens, watches: active.watches, spotted: active.spotted, ...(active.lighting ? { lighting: active.lighting } : {}) };
      const stuck = tokensOnBlocked(next);
      if (act({ type: 'setMap', map: next })) {
        setDraft(next);
        setMsg(stuck.length
          ? { tone: 'warn', text: `Updated the live map. ${stuck.length} token${stuck.length > 1 ? 's stand' : ' stands'} on a blocked square: ${joinNames(stuck.map((id) => view.actors[id]?.public.name ?? id))}.` }
          : { tone: 'ok', text: 'Updated the live map. Tokens stayed where they were.' });
      }
      return;
    }
    if (source === 'library') {
      if (dirty && !saveToLibrary()) return;
      if (act({ type: 'switchScene', mapId: current.id })) { setSource('active'); setMsg({ tone: 'ok', text: `“${current.name}” is now the live map.` }); }
      return;
    }
    // New scene: save it, then switch. Switching parks the live map (tokens and all) in the library.
    if (!active) {
      if (act({ type: 'setMap', map: current })) { setSource('active'); setDraft(current); setMsg({ tone: 'ok', text: `“${current.name}” is now the live map. Place tokens from the Table with Place.` }); }
      return;
    }
    if (!saveToLibrary()) return;
    if (act({ type: 'switchScene', mapId: current.id })) {
      setSource('active');
      setMsg({ tone: 'ok', text: `“${current.name}” is now the live map. “${active.name}” was parked in the library with its tokens. Place tokens from the Table with Place.` });
    }
  }

  function duplicate() {
    if (!current) return;
    open(duplicateMap(current, takenIds), 'new');
    setMsg({ tone: 'ok', text: 'Duplicated. Save the copy to keep it.' });
  }

  function remove() {
    if (!draft || source !== 'library') return;
    if (!window.confirm(`Delete “${draft.name}” from the library? This can be undone from the Table with Undo.`)) return;
    if (act({ type: 'removeFromLibrary', kind: 'map', id: draft.id })) { setDraft(null); setMsg({ tone: 'ok', text: 'Deleted from the library.' }); }
  }

  const bgWarn = current?.background?.startsWith('blob:');

  return (
    <div className="ed">
      <aside className="ed-col ed-list" aria-label="Maps">
        <div className="btnrow">
          <button className="btn yellow" onClick={() => void startFromImage()}>New from Image</button>
          <button className="btn" onClick={() => { setBlank({ name: 'Blank Map', w: 20, h: 14 }); setPending(null); }}>New Blank Map</button>
          <button className="btn" onClick={() => void importJson()}>Import JSON</button>
        </div>
        <div>
          <div className="ed-sub">Live Map</div>
          {active
            ? <MapItem m={active} sel={source === 'active' && draft?.id === active.id} live onClick={() => open(active, 'active')} />
            : <div className="ed-empty">No map on the table yet.</div>}
        </div>
        <div>
          <div className="ed-sub">Library</div>
          <div className="u-grid u-gap-6">
            {Object.values(library).length === 0 && <div className="ed-empty">Saved maps appear here.</div>}
            {Object.values(library).map((m) => (
              <MapItem key={m.id} m={m} sel={source === 'library' && draft?.id === m.id} live={active?.id === m.id} onClick={() => open(m, 'library')} />
            ))}
          </div>
        </div>
        <div>
          <div className="ed-sub">Starter Maps</div>
          <MapItem m={demoMap()} onClick={() => open({ ...demoMap(), id: uniqueMapId(demoMap().name, takenIds), tokens: {} }, 'new')} />
        </div>
      </aside>

      <main className="ed-col ed-main">
        {pending ? <ImageSetup p={pending} setP={setPending} busy={busy} onCreate={() => void createFromImage()} onCancel={() => setPending(null)} />
          : blank ? <BlankSetup b={blank} setB={setBlank} onCreate={() => { open(newMap({ name: blank.name, width: blank.w, height: blank.h, cellPx: 64, taken: takenIds }), 'new'); }} onCancel={() => setBlank(null)} />
          : current ? (
            <>
              <div className="row u-between u-wrap u-gap-8 u-mb-8">
                <h1 className="ed-h">{current.name}</h1>
                <span className="note">{source === 'active' ? 'Editing the Live Map' : source === 'library' ? 'Editing a Library Map' : 'Unsaved New Map'}{dirty ? ' · Unsaved Changes' : ''}</span>
              </div>
              <div className="toolbar" role="toolbar" aria-label="Terrain Tools">
                {(Object.keys(TOOL_LABEL) as Tool[]).map((t) => (
                  <button key={t} className={`mode${tool === t ? ' sel' : ''}`} aria-pressed={tool === t} onClick={() => setTool(t)} title={`${TOOL_LABEL[t]} (${t === 'rect' ? 'R' : t[0]!.toUpperCase()})`}>{TOOL_LABEL[t]}</button>
                ))}
                <span className="sep" />
                {TERRAINS.map((t, i) => (
                  <button key={t.code} className={`mode swatch${terrain === t.code ? ' sel' : ''}`} aria-pressed={terrain === t.code} onClick={() => setTerrain(t.code)} title={`${t.hint} (${i + 1})`}>
                    <i style={{ background: t.code === '.' ? '#222a' : t.color }} />{t.label}
                  </button>
                ))}
                <span className="sep" />
                {tool === 'brush' && (
                  <label className="ed-ctl lbl">Size
                    <select value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Brush Size">{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} × {n}</option>)}</select>
                  </label>
                )}
                {tool === 'rect' && <label className="ed-ctl lbl"><input type="checkbox" checked={outline} onChange={(e) => setOutline(e.target.checked)} />Outline Only</label>}
                {terrain === 'c' && (
                  <>
                    <label className="ed-ctl lbl">New Cover
                      <select value={coverMat} onChange={(e) => setCoverMat(e.target.value as CoverMaterialId)} aria-label="Material for New Cover Squares">
                        {COVER_MATERIALS.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.hp} HP)</option>)}
                      </select>
                    </label>
                    <button className="btn sm" title="Set every cover square on this map to the selected material, at full HP."
                      onClick={() => draft && setDraft({ ...draft, cover: allCover(cells, draft.width, coverMat) })}>Apply to All Cover</button>
                  </>
                )}
                <span className="sep" />
                <button className="btn sm" disabled={!hist.past.length} onClick={() => setHist(undo)} title="Undo (Ctrl+Z)">Undo</button>
                <button className="btn sm" disabled={!hist.future.length} onClick={() => setHist(redo)} title="Redo (Ctrl+Shift+Z)">Redo</button>
                <span className="sep" />
                <label className="ed-ctl lbl">Zoom
                  <input type="range" min={0.2} max={2} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" />
                  <span className="mono">{Math.round(zoom * 100)}%</span>
                </label>
              </div>
              <PaintCanvas map={current} tool={tool} terrain={terrain} size={size} outline={outline} zoom={zoom}
                actors={view.actors}
                onPaint={(next, final) => setHist((h) => (final ? commit(h, next) : { ...h, present: next }))}
                onStrokeStart={() => setHist((h) => ({ ...h, past: [...h.past, h.present].slice(-100), future: [] }))}
              />
              <div className="statusline">
                <span>{current.width} × {current.height} squares · {current.width * 2} × {current.height * 2} m</span>
                {(() => { const c = terrainCounts(cells); return <span>Wall {c['#']} · Cover {c.c} · Difficult {c['~']}</span>; })()}
                <span><span className="kbd">B</span> <span className="kbd">R</span> <span className="kbd">F</span> tools · <span className="kbd">1</span>–<span className="kbd">4</span> terrain · <span className="kbd">[</span> <span className="kbd">]</span> size</span>
              </div>
            </>
          ) : (
            <div className="card u-maxw-520">
              <div className="ttl">Map Editor</div>
              <p className="u-mt-0">Upload a top-down battle map, set the grid, then paint walls and cover so line of sight and movement work. Start from the warehouse to see how it’s set up.</p>
              <div className="btnrow"><button className="btn yellow" onClick={() => void startFromImage()}>New from Image</button></div>
            </div>
          )}
      </main>

      <aside className="ed-col ed-side" aria-label="Map Settings">
        {msg && <div className={msg.tone === 'ok' ? 'ok' : 'warn'} role="status">{msg.text}</div>}
        {current && !pending && !blank && (
          <>
            <section className="card">
              <div className="ttl">Map Settings</div>
              <div className="u-grid u-gap-10">
                <label className="fld"><span>Name</span>
                  <input value={draft!.name} maxLength={60} onChange={(e) => setDraft({ ...draft!, name: e.target.value })} />
                </label>
                <label className="fld"><span>Sight Range (Squares)</span>
                  <input type="number" min={1} max={200} value={draft!.sightRange} onChange={(e) => setDraft({ ...draft!, sightRange: Math.max(1, Math.min(200, Number(e.target.value) || 1)) })} />
                </label>
                <div className="note">Use a short sight range for dark scenes; the party sees that many squares around each character.</div>
                {bgWarn && <div className="warn">This background only exists on this device. Re-upload it once the relay can store images.</div>}
              </div>
            </section>
            <section className="card">
              <div className="ttl">Save and Use</div>
              <div className="u-grid u-gap-8">
                <button className="cta u-fs-18 u-p-10" onClick={useNow}>{source === 'active' ? 'Update Live Map' : 'Use This Map Now'}</button>
                <button className="btn full" onClick={() => saveToLibrary()}>Save to Library</button>
                <div className="btnrow">
                  <button className="btn sm" onClick={duplicate}>Duplicate</button>
                  <button className="btn sm" onClick={() => downloadText(`${current.id}.json`, exportMap(current))}>Export JSON</button>
                  {source === 'library' && <button className="btn sm mag" onClick={remove}>Delete</button>}
                  {dirty && <button className="btn sm" onClick={() => setHist(historyOf(draft!.cells))}>Discard Changes</button>}
                </div>
                <div className="note">{source === 'active'
                  ? 'Updating keeps every token where it stands.'
                  : 'Switching parks the live map in the library with its tokens, so you can come back to it. Tokens start off a new map.'}</div>
              </div>
            </section>
            <section className="card">
              <div className="ttl">Legend</div>
              <div className="legend-list">
                {TERRAINS.map((t) => <div key={t.code}><i style={{ background: t.code === '.' ? 'transparent' : t.color }} /><b>{t.label}:</b> <span className="dim">{t.hint}.</span></div>)}
              </div>
            </section>
          </>
        )}
      </aside>
    </div>
  );
}

function MapItem({ m, sel, live, onClick }: { m: TacticalMap; sel?: boolean; live?: boolean; onClick: () => void }) {
  return (
    <button className={`li${sel ? ' sel' : ''}`} onClick={onClick} aria-current={sel ? 'true' : undefined}>
      {m.background ? <img className="thumb" src={m.background} alt="" loading="lazy" /> : <span className="thumb" />}
      <span className="u-minw-0">
        <span className="nm u-block">{m.name}</span>
        <span className="meta">{m.width} × {m.height} squares {live && <span className="tag live">Live</span>}</span>
      </span>
    </button>
  );
}

function ImageSetup({ p, setP, busy, onCreate, onCancel }: { p: Pending; setP: (p: Pending) => void; busy: boolean; onCreate: () => void; onCancel: () => void }) {
  const { w, h, factor } = scaledSize(p.img);
  const fit = fitGrid(w, h, p.cellPx);
  const across = fit.width;
  return (
    <div className="card u-maxw-680">
      <div className="ttl">Set Up the Grid</div>
      <img className="preview-img" src={p.preview} alt="Uploaded map preview" />
      <div className="u-grid u-gap-10 u-mt-10">
        <label className="fld"><span>Map Name</span><input value={p.name} maxLength={60} onChange={(e) => setP({ ...p, name: e.target.value })} /></label>
        <div className="grid2">
          <label className="fld"><span>Square Size (Px)</span>
            <input type="number" min={16} max={512} value={Math.round(p.cellPx)} onChange={(e) => setP({ ...p, cellPx: Math.max(16, Number(e.target.value) || 16) })} />
          </label>
          <label className="fld"><span>Squares Across</span>
            <input type="number" min={1} max={200} value={across} onChange={(e) => { const n = Math.max(1, Number(e.target.value) || 1); setP({ ...p, cellPx: w / n }); }} />
          </label>
        </div>
        <div className="note">
          Image {p.img.naturalWidth} × {p.img.naturalHeight} px{factor < 1 ? `, scaled to ${w} × ${h} px` : ''}. Grid: <b>{fit.width} × {fit.height} squares</b> ({fit.width * 2} × {fit.height * 2} m).
          {(w - fit.cropW > 0 || h - fit.cropH > 0) && ` Crops ${w - fit.cropW} px from the right and ${h - fit.cropH} px from the bottom so squares stay whole.`}
          {' '}Tip: count the squares drawn on the image and enter that number across.
        </div>
        <div className="btnrow">
          <button className="btn yellow" disabled={busy} onClick={onCreate}>{busy ? 'Processing…' : 'Create Map'}</button>
          <button className="btn" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function BlankSetup({ b, setB, onCreate, onCancel }: { b: { name: string; w: number; h: number }; setB: (b: { name: string; w: number; h: number }) => void; onCreate: () => void; onCancel: () => void }) {
  return (
    <div className="card u-maxw-480">
      <div className="ttl">New Blank Map</div>
      <div className="u-grid u-gap-10">
        <label className="fld"><span>Map Name</span><input value={b.name} maxLength={60} onChange={(e) => setB({ ...b, name: e.target.value })} /></label>
        <div className="grid2">
          <label className="fld"><span>Width (Squares)</span><input type="number" min={2} max={100} value={b.w} onChange={(e) => setB({ ...b, w: Math.max(2, Math.min(100, Number(e.target.value) || 2)) })} /></label>
          <label className="fld"><span>Height (Squares)</span><input type="number" min={2} max={100} value={b.h} onChange={(e) => setB({ ...b, h: Math.max(2, Math.min(100, Number(e.target.value) || 2)) })} /></label>
        </div>
        <div className="note">{b.w * 2} × {b.h * 2} m. No background image; paint the layout with terrain.</div>
        <div className="btnrow"><button className="btn yellow" onClick={onCreate}>Create Map</button><button className="btn" onClick={onCancel}>Cancel</button></div>
      </div>
    </div>
  );
}

interface CanvasProps {
  map: TacticalMap;
  tool: Tool;
  terrain: Terrain;
  size: number;
  outline: boolean;
  zoom: number;
  actors: NonNullable<ClientState['view']>['actors'];
  onPaint: (cells: string, final: boolean) => void;
  onStrokeStart: () => void;
}

function PaintCanvas({ map, tool, terrain, size, outline, zoom, actors, onPaint, onStrokeStart }: CanvasProps) {
  const S = map.cellPx;
  const W = map.width * S;
  const H = map.height * S;
  const ref = useRef<SVGSVGElement>(null);
  const stroke = useRef<{ last: Cell; cells: string } | null>(null);
  const [rect, setRect] = useState<{ a: Cell; b: Cell } | null>(null);
  const [hover, setHover] = useState<Cell | null>(null);

  const cellAt = (e: React.PointerEvent): Cell | null => {
    const m = ref.current?.getScreenCTM();
    if (!m) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    const c = { x: Math.floor(pt.x / S), y: Math.floor(pt.y / S) };
    return c.x >= 0 && c.y >= 0 && c.x < map.width && c.y < map.height ? c : null;
  };

  const overlay = useMemo(() => {
    const paths: Record<string, string> = { '#': '', c: '', '~': '' };
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      const t = map.cells[y * map.width + x]!;
      if (t in paths) paths[t] += `M${x * S},${y * S}h${S}v${S}h${-S}z`;
    }
    return paths;
  }, [map.cells, map.width, map.height, S]);

  return (
    <div className="canvas-wrap">
      <svg
        ref={ref}
        width={W * zoom}
        height={H * zoom}
        viewBox={`0 0 ${W} ${H}`}
        role="application"
        aria-label={`Terrain Painter for ${map.name}`} aria-description="Use the toolbar to pick a tool and terrain."
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const c = cellAt(e);
          if (!c) return;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          if (tool === 'fill') { onPaint(floodFill(map.cells, map.width, map.height, c, terrain), true); return; }
          if (tool === 'rect') { setRect({ a: c, b: c }); return; }
          onStrokeStart();
          const first = paintStroke(map.cells, map.width, map.height, c, c, size, terrain);
          stroke.current = { last: c, cells: first };
          onPaint(first, false);
        }}
        onPointerMove={(e) => {
          const c = cellAt(e);
          setHover(c);
          if (!c) return;
          if (rect) { setRect({ ...rect, b: c }); return; }
          const st = stroke.current;
          if (st && (st.last.x !== c.x || st.last.y !== c.y)) {
            // Paint onto the stroke's own copy: pointer events can outrun React renders.
            st.cells = paintStroke(st.cells, map.width, map.height, st.last, c, size, terrain);
            st.last = c;
            onPaint(st.cells, false);
          }
        }}
        onPointerUp={() => {
          if (rect) { onPaint(paintRect(map.cells, map.width, map.height, rect.a, rect.b, terrain, outline), true); setRect(null); }
          stroke.current = null;
        }}
        onPointerLeave={() => setHover(null)}
      >
        {map.background ? <image href={map.background} width={W} height={H} preserveAspectRatio="none" /> : <rect width={W} height={H} fill="#0b1230" />}
        <path d={overlay['#']} fill={TERRAINS[1]!.color} stroke="rgba(255,59,78,0.9)" strokeWidth={1} />
        <path d={overlay.c} fill={TERRAINS[2]!.color} stroke="rgba(34,227,255,0.9)" strokeWidth={1} />
        <path d={overlay['~']} fill={TERRAINS[3]!.color} stroke="rgba(255,212,0,0.9)" strokeWidth={1} />
        <g stroke="rgba(160,190,255,0.25)" strokeWidth={1} pointerEvents="none">
          {Array.from({ length: map.width + 1 }, (_, x) => <line key={`x${x}`} x1={x * S} y1={0} x2={x * S} y2={H} />)}
          {Array.from({ length: map.height + 1 }, (_, y) => <line key={`y${y}`} x1={0} y1={y * S} x2={W} y2={y * S} />)}
        </g>
        {Object.entries(map.tokens).map(([id, c]) => (
          <g key={id} transform={`translate(${c.x * S + S / 2},${c.y * S + S / 2})`} pointerEvents="none">
            <circle r={S * 0.35} fill="rgba(255,43,214,0.35)" stroke="var(--magenta)" strokeWidth={3} />
            <text textAnchor="middle" dy="0.35em" fontFamily="Barlow Condensed" fontWeight={700} fontSize={S * 0.3} fill="#fff">{(actors[id]?.public.name ?? id).slice(0, 2)}</text>
          </g>
        ))}
        {rect && (() => {
          const x0 = Math.min(rect.a.x, rect.b.x), y0 = Math.min(rect.a.y, rect.b.y);
          return <rect x={x0 * S} y={y0 * S} width={(Math.abs(rect.a.x - rect.b.x) + 1) * S} height={(Math.abs(rect.a.y - rect.b.y) + 1) * S} fill="rgba(255,212,0,0.18)" stroke="var(--yellow)" strokeWidth={3} strokeDasharray="10 6" pointerEvents="none" />;
        })()}
        {hover && !rect && (() => {
          const n = tool === 'brush' ? size : 1;
          const r0 = -Math.floor((n - 1) / 2);
          return <rect x={(hover.x + r0) * S} y={(hover.y + r0) * S} width={n * S} height={n * S} fill="none" stroke="#fff" strokeWidth={2} pointerEvents="none" />;
        })()}
      </svg>
    </div>
  );
}

// Cover materials -------------------------------------------------

/** Cover record for the painted cells: keep existing entries on cover squares, new cover gets `mat` at full HP. */
function coverFor(cells: string, width: number, prev: TacticalMap['cover'], mat: CoverMaterialId): NonNullable<TacticalMap['cover']> {
  const out: NonNullable<TacticalMap['cover']> = {};
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== 'c') continue;
    const key = `${i % width},${Math.floor(i / width)}`;
    out[key] = prev?.[key] ?? { material: mat, hp: coverMaterial(mat).hp };
  }
  return out;
}

function allCover(cells: string, width: number, mat: CoverMaterialId): NonNullable<TacticalMap['cover']> {
  return coverFor(cells, width, {}, mat);
}
