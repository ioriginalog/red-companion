/**
 * GM NET prep: build architectures on a floor diagram (add, branch, move,
 * reorder), pick access points on the map, set up cyberdecks, toggle the
 * 2070s options, and watch every live run at once.
 * Self-contained: mount it as a GM tab or panel.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  architectureProblem, DECK_SLOTS, depthOf, ICE_TEMPLATES, NET_DV,
  type IceStats, type NetArchitecture, type NetDifficulty, type NetFloor, type NetFloorKind, type NetRig,
} from '@cprc/rules-core';
import type { Intent, NetOp, ViewState } from '@cprc/session';
import './netrun.css';
import { programCatalog, usePacks } from '../data/catalog.js';
import { AccessMapPicker } from './AccessMapPicker.js';
import { FloorDiagram } from './FloorDiagram.js';
import { LiveRunOverview } from './LiveRunOverview.js';

export interface NetArchitectureEditorProps {
  view: ViewState;
  act: (i: Intent) => boolean;
}

const net = (op: NetOp): Intent => ({ type: 'net', op });
const KINDS: [NetFloorKind, string][] = [['password', 'Password'], ['file', 'File'], ['controlNode', 'Control Node'], ['blackIce', 'Black ICE'], ['demon', 'Demon'], ['empty', 'Empty Floor']];
const DIFFS: [NetDifficulty, string][] = [['basic', 'Basic'], ['standard', 'Standard'], ['uncommon', 'Uncommon'], ['advanced', 'Advanced']];
const needsDv = (k: NetFloorKind) => k === 'password' || k === 'file' || k === 'controlNode';

function newArchitecture(): NetArchitecture {
  const id = `arch-${Date.now().toString(36)}`;
  return {
    id, name: 'New Architecture', difficulty: 'standard', rootId: 'f1', virusDv: NET_DV.standard, access: [],
    floors: { f1: { id: 'f1', kind: 'password', dv: NET_DV.standard } }, children: {},
  };
}

export function NetArchitectureEditor({ view, act }: NetArchitectureEditorProps) {
  const full = view.netrun?.full;
  const archs = Object.values(full?.architectures ?? {});
  const [selId, setSelId] = useState<string | null>(null);
  const [draft, setDraft] = useState<NetArchitecture | null>(null);
  const [tab, setTab] = useState<'arch' | 'rigs' | 'runs'>('arch');

  useEffect(() => {
    if (selId && full?.architectures[selId]) setDraft(structuredClone(full.architectures[selId]!));
  }, [selId]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = (op: NetOp) => act(net(op));
  const dirty = draft && JSON.stringify(draft) !== JSON.stringify(full?.architectures[draft.id] ?? null);

  return (
    <section className="card net net-editor">
      <div className="ttl">NET Prep</div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <button className={`btn ${tab === 'arch' ? 'on' : ''}`} onClick={() => setTab('arch')}>Architectures</button>
        <button className={`btn ${tab === 'rigs' ? 'on' : ''}`} onClick={() => setTab('rigs')}>Cyberdecks</button>
        <button className={`btn ${tab === 'runs' ? 'on' : ''}`} onClick={() => setTab('runs')}>Live Runs</button>
        <label className="net-check">
          <input type="checkbox" checked={!!full?.quickhacks2070s} onChange={(e) => send({ op: 'setOptions', quickhacks2070s: e.target.checked })} />
          <span>Mission Kit Quickhacks (<span className="net-nocase">2070s</span>)</span>
        </label>
      </div>

      {tab === 'arch' && (
        <>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <select aria-label="Architecture" value={selId ?? ''} onChange={(e) => setSelId(e.target.value || null)}>
              <option value="">Choose an Architecture</option>
              {archs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button className="btn" onClick={() => { const a = newArchitecture(); setSelId(null); setDraft(a); }}>New Architecture</button>
          </div>
          {draft && (
            <ArchForm
              draft={draft} setDraft={setDraft} view={view} dirty={!!dirty}
              saved={!!full?.architectures[draft.id]} found={!!full?.found.includes(draft.id)}
              onSave={() => { if (send({ op: 'saveArchitecture', architecture: draft })) setSelId(draft.id); }}
              onDelete={() => { if (send({ op: 'deleteArchitecture', archId: draft.id })) { setSelId(null); setDraft(null); } }}
              onFound={(f) => send({ op: 'revealAccess', archId: draft.id, found: f })}
            />
          )}
        </>
      )}

      {tab === 'rigs' && <RigList view={view} send={send} />}
      {tab === 'runs' && <LiveRunOverview view={view} send={send} />}
    </section>
  );
}

function ArchForm({ draft, setDraft, view, dirty, saved, found, onSave, onDelete, onFound }: {
  draft: NetArchitecture; setDraft: (a: NetArchitecture) => void; view: ViewState; dirty: boolean; saved: boolean; found: boolean;
  onSave: () => void; onDelete: () => void; onFound: (f: boolean) => void;
}) {
  const [sel, setSel] = useState(draft.rootId);
  useEffect(() => { if (!draft.floors[sel]) setSel(draft.rootId); }, [draft, sel]);
  const problem = architectureProblem(draft);

  return (
    <div className="net-form">
      <div className="net-grid3">
        <label>Name<input value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
        <label>Difficulty
          <select value={draft.difficulty} onChange={(e) => setDraft({ ...draft, difficulty: e.target.value as NetDifficulty })}>
            {DIFFS.map(([k, l]) => <option key={k} value={k}>{l} (DV {NET_DV[k]})</option>)}
          </select>
        </label>
        <label>Virus DV<input type="number" min={1} max={40} value={draft.virusDv} onChange={(e) => setDraft({ ...draft, virusDv: Number(e.target.value) })} /></label>
      </div>

      <div className="net-sub">Floors</div>
      <div className="net-prep-split">
        <FloorDiagram arch={draft} selected={sel} onSelect={setSel} onChange={setDraft} />
        {draft.floors[sel] && <FloorInspector arch={draft} floor={draft.floors[sel]!} onChange={(f) => setDraft({ ...draft, floors: { ...draft.floors, [f.id]: f } })} />}
      </div>

      <div className="net-sub">Access Points</div>
      <AccessMapPicker view={view} access={draft.access} onChange={(access) => setDraft({ ...draft, access })} />

      {problem && <p className="net-why">{problem}</p>}
      <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn yellow" disabled={!dirty || !!problem} onClick={onSave}>{saved ? 'Save Changes' : 'Save Architecture'}</button>
        {saved && <label className="net-check"><input type="checkbox" checked={found} onChange={(e) => onFound(e.target.checked)} />Party Knows the Access Points</label>}
        {saved && <button className="btn danger" onClick={onDelete}>Delete</button>}
      </div>
    </div>
  );
}

function FloorInspector({ arch, floor: f, onChange }: { arch: NetArchitecture; floor: NetFloor; onChange: (f: NetFloor) => void }) {
  return (
    <div className="net-inspector" aria-label="Selected Floor">
      <div className="net-sub" style={{ marginTop: 0 }}>Floor {depthOf(arch, f.id)}</div>
      <label className="net-field">Kind
        <select value={f.kind} onChange={(e) => {
          const kind = e.target.value as NetFloorKind;
          const next: NetFloor = { id: f.id, kind, ...(f.label ? { label: f.label } : {}) };
          if (needsDv(kind)) next.dv = f.dv ?? NET_DV[arch.difficulty];
          if (kind === 'blackIce') next.ice = [{ ...ICE_TEMPLATES[0]! }];
          if (kind === 'demon') next.demon = { name: 'Demon', rez: 15, interface: 3, netActions: 2 };
          if ((kind === 'file' || kind === 'controlNode') && f.note) next.note = f.note;
          onChange(next);
        }}>
          {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      <label className="net-field">Label
        <input placeholder="Lobby, Camera Grid…" value={f.label ?? ''} maxLength={40} onChange={(e) => onChange({ ...f, label: e.target.value || undefined })} />
      </label>
      {needsDv(f.kind) && (
        <label className="net-field">DV
          <input type="number" min={1} max={40} value={f.dv ?? 8} onChange={(e) => onChange({ ...f, dv: Number(e.target.value) })} />
        </label>
      )}
      {(f.kind === 'file' || f.kind === 'controlNode') && (
        <label className="net-field">{f.kind === 'file' ? 'What the File Holds' : 'What This Node Runs'}
          <input value={f.note ?? ''} maxLength={500} onChange={(e) => onChange({ ...f, note: e.target.value || undefined })} />
        </label>
      )}
      {f.kind === 'blackIce' && <IceList ice={f.ice ?? []} onChange={(ice) => onChange({ ...f, ice })} />}
      {f.kind === 'demon' && f.demon && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          <input aria-label="Demon Name" value={f.demon.name} maxLength={40} onChange={(e) => onChange({ ...f, demon: { ...f.demon!, name: e.target.value } })} />
          {(['rez', 'interface', 'netActions'] as const).map((k) => (
            <label key={k} className="net-mini">{k === 'rez' ? 'REZ' : k === 'interface' ? 'Interface' : 'NET Actions'}
              <input type="number" value={f.demon![k]} onChange={(e) => onChange({ ...f, demon: { ...f.demon!, [k]: Number(e.target.value) } })} />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function IceList({ ice, onChange }: { ice: IceStats[]; onChange: (ice: IceStats[]) => void }) {
  const set = (i: number, patch: Partial<IceStats>) => onChange(ice.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="net-icelist">
      {ice.map((x, i) => (
        <div className="net-ice" key={i}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <input aria-label="ICE Name" value={x.name} maxLength={40} style={{ width: 120 }} onChange={(e) => set(i, { name: e.target.value })} />
            <select aria-label="ICE Kind" value={x.kind} onChange={(e) => set(i, { kind: e.target.value as IceStats['kind'] })}>
              <option value="antiPersonnel">Anti-Personnel</option>
              <option value="antiProgram">Anti-Program</option>
            </select>
            {(['per', 'spd', 'atk', 'def', 'rez'] as const).map((k) => (
              <label key={k} className="net-mini">{k.toUpperCase()}<input type="number" min={0} max={k === 'rez' ? 200 : 30} value={x[k]} onChange={(e) => set(i, { [k]: Number(e.target.value) })} /></label>
            ))}
            <label className="net-mini">d6<input type="number" min={1} max={10} value={x.damage.count} onChange={(e) => set(i, { damage: { count: Number(e.target.value), sides: 6 } })} /></label>
            {ice.length > 1 && <button className="btn ghost" onClick={() => onChange(ice.filter((_, j) => j !== i))}>Remove</button>}
          </div>
          <input className="net-noteinput" placeholder="Extra effect (GM prompt when it hits)" value={x.effect ?? ''} maxLength={200} onChange={(e) => set(i, { effect: e.target.value || undefined })} />
        </div>
      ))}
      {ice.length < 3 && (
        <select aria-label="Add ICE" value="" onChange={(e) => { const t = ICE_TEMPLATES.find((x) => x.name === e.target.value); if (t) onChange([...ice, { ...t }]); }}>
          <option value="">Add ICE from a Template</option>
          {ICE_TEMPLATES.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
        </select>
      )}
    </div>
  );
}

function RigList({ view, send }: { view: ViewState; send: (op: NetOp) => boolean }) {
  const rigs = view.netrun?.full?.rigs ?? {};
  const actors = Object.values(view.actors);
  return (
    <div className="net-form">
      <p className="dim" style={{ marginTop: 0 }}>Interface is the Netrunner Role Ability rank. Starter Programs are placeholders with this tool’s own numbers; edit them to match your book.</p>
      {actors.map((a) => <RigRow key={a.id} actorId={a.id} name={a.public.name} rig={rigs[a.id]} send={send} />)}
    </div>
  );
}

function RigRow({ actorId, name, rig, send }: { actorId: string; name: string; rig: NetRig | undefined; send: (op: NetOp) => boolean }) {
  const [draft, setDraft] = useState<NetRig | null>(rig ?? null);
  useEffect(() => setDraft(rig ?? null), [rig]);
  const chosen = useMemo(() => new Set(draft?.programs.map((p) => p.id)), [draft]);
  const catalog = programCatalog(usePacks()); // Original starters + the GM's imported Programs
  if (!draft) {
    return (
      <div className="row net-row">
        <span className="h">{name}</span>
        <button className="btn" onClick={() => setDraft({ interface: 4, deckName: 'Standard Cyberdeck', slots: DECK_SLOTS.standard, programs: [] })}>Add Cyberdeck</button>
      </div>
    );
  }
  const toggle = (id: string) => {
    const t = catalog.find((p) => p.id === id)!;
    setDraft({ ...draft, programs: chosen.has(id) ? draft.programs.filter((p) => p.id !== id) : [...draft.programs, { ...t }] });
  };
  return (
    <div className="net-rig">
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span className="h" style={{ minWidth: 90 }}>{name}</span>
        <label className="net-mini">Interface<input type="number" min={1} max={10} value={draft.interface} onChange={(e) => setDraft({ ...draft, interface: Number(e.target.value) })} /></label>
        <select aria-label="Deck Quality" value={draft.slots} onChange={(e) => setDraft({ ...draft, slots: Number(e.target.value) })}>
          <option value={DECK_SLOTS.poor}>Poor (5 Slots)</option>
          <option value={DECK_SLOTS.standard}>Standard (7 Slots)</option>
          <option value={DECK_SLOTS.excellent}>Excellent (9 Slots)</option>
        </select>
        <input aria-label="Deck Name" value={draft.deckName} maxLength={40} onChange={(e) => setDraft({ ...draft, deckName: e.target.value })} />
      </div>
      <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
        {catalog.map((p) => (
          <button key={p.id} className={`mode ${chosen.has(p.id) ? 'sel' : ''}`} onClick={() => toggle(p.id)} title={p.summary}>{p.name}</button>
        ))}
      </div>
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        <span className="dim">{draft.programs.length}/{draft.slots} slots</span>
        <button className="btn yellow" onClick={() => send({ op: 'setRig', actorId, rig: draft })}>Save Deck</button>
        {rig && <button className="btn ghost" onClick={() => send({ op: 'setRig', actorId, rig: null })}>Remove Deck</button>}
      </div>
    </div>
  );
}
