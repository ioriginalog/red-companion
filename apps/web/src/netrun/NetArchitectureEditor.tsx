/**
 * GM NET prep: build architectures (floors, branches, ICE, access points),
 * set up cyberdecks, toggle the 2070s options, and run live ICE.
 * Self-contained: mount it as a GM tab or panel.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  DECK_SLOTS, depthOf, ICE_TEMPLATES, NET_DV, PROGRAM_TEMPLATES,
  type IceStats, type NetArchitecture, type NetDifficulty, type NetFloor, type NetFloorKind, type NetRig,
} from '@cprc/rules-core';
import type { Intent, NetOp, ViewState } from '@cprc/session';
import './netrun.css';

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

function nextFloorId(a: NetArchitecture): string {
  let n = Object.keys(a.floors).length + 1;
  while (a.floors[`f${n}`]) n++;
  return `f${n}`;
}

function withFloor(a: NetArchitecture, parentId: string): NetArchitecture {
  const id = nextFloorId(a);
  return {
    ...a,
    floors: { ...a.floors, [id]: { id, kind: 'file', dv: NET_DV[a.difficulty] } },
    children: { ...a.children, [parentId]: [...(a.children[parentId] ?? []), id] },
  };
}

function withoutFloor(a: NetArchitecture, id: string): NetArchitecture {
  if (id === a.rootId) return a;
  const doomed = new Set<string>();
  const stack = [id];
  while (stack.length) { const x = stack.pop()!; doomed.add(x); stack.push(...(a.children[x] ?? [])); }
  const floors = Object.fromEntries(Object.entries(a.floors).filter(([k]) => !doomed.has(k)));
  const children = Object.fromEntries(Object.entries(a.children)
    .filter(([k]) => !doomed.has(k))
    .map(([k, kids]) => [k, kids.filter((c) => !doomed.has(c))])
    .filter(([, kids]) => (kids as string[]).length));
  return { ...a, floors, children };
}

/** Floors in tree order with their depth. */
function ordered(a: NetArchitecture): string[] {
  const out: string[] = [];
  const walk = (id: string) => { out.push(id); (a.children[id] ?? []).forEach(walk); };
  if (a.floors[a.rootId]) walk(a.rootId);
  return out;
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
      {tab === 'runs' && <LiveRuns view={view} send={send} />}
    </section>
  );
}

function ArchForm({ draft, setDraft, view, dirty, saved, found, onSave, onDelete, onFound }: {
  draft: NetArchitecture; setDraft: (a: NetArchitecture) => void; view: ViewState; dirty: boolean; saved: boolean; found: boolean;
  onSave: () => void; onDelete: () => void; onFound: (f: boolean) => void;
}) {
  const setFloor = (f: NetFloor) => setDraft({ ...draft, floors: { ...draft.floors, [f.id]: f } });
  const map = view.map;
  const access = map ? draft.access.find((x) => x.mapId === map.id)?.cells ?? [] : [];
  const [ax, setAx] = useState(0);
  const [ay, setAy] = useState(0);
  const setAccess = (cells: { x: number; y: number }[]) => {
    if (!map) return;
    const others = draft.access.filter((x) => x.mapId !== map.id);
    setDraft({ ...draft, access: cells.length ? [...others, { mapId: map.id, cells }] : others });
  };

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
      <ol className="net-floors">
        {ordered(draft).map((fid) => {
          const f = draft.floors[fid]!;
          return (
            <li key={fid} style={{ marginLeft: (depthOf(draft, fid) - 1) * 14 }}>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <span className="net-depth">{depthOf(draft, fid)}</span>
                <select aria-label={`Floor ${fid} kind`} value={f.kind} onChange={(e) => {
                  const kind = e.target.value as NetFloorKind;
                  const next: NetFloor = { id: f.id, kind, ...(f.label ? { label: f.label } : {}) };
                  if (needsDv(kind)) next.dv = f.dv ?? NET_DV[draft.difficulty];
                  if (kind === 'blackIce') next.ice = [{ ...ICE_TEMPLATES[0]! }];
                  if (kind === 'demon') next.demon = { name: 'Demon', rez: 15, interface: 3, netActions: 2 };
                  setFloor(next);
                }}>
                  {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <input aria-label="Label" placeholder="Label" value={f.label ?? ''} maxLength={40} style={{ width: 110 }} onChange={(e) => setFloor({ ...f, label: e.target.value || undefined })} />
                {needsDv(f.kind) && <span className="net-dvlabel">DV</span>}
                {needsDv(f.kind) && <input aria-label="DV" type="number" min={1} max={40} value={f.dv ?? 8} style={{ width: 64 }} onChange={(e) => setFloor({ ...f, dv: Number(e.target.value) })} />}
                <button className="btn" onClick={() => setDraft(withFloor(draft, fid))} title="Add a floor below this one (a second one makes a branch).">Add Below</button>
                {fid !== draft.rootId && <button className="btn ghost" onClick={() => setDraft(withoutFloor(draft, fid))}>Remove</button>}
              </div>
              {(f.kind === 'file' || f.kind === 'controlNode') && (
                <input className="net-noteinput" placeholder={f.kind === 'file' ? 'What the File holds' : 'What this node runs'} value={f.note ?? ''} maxLength={500}
                  onChange={(e) => setFloor({ ...f, note: e.target.value || undefined })} />
              )}
              {f.kind === 'blackIce' && <IceList ice={f.ice ?? []} onChange={(ice) => setFloor({ ...f, ice })} />}
              {f.kind === 'demon' && f.demon && (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  <input aria-label="Demon name" value={f.demon.name} maxLength={40} onChange={(e) => setFloor({ ...f, demon: { ...f.demon!, name: e.target.value } })} />
                  {(['rez', 'interface', 'netActions'] as const).map((k) => (
                    <label key={k} className="net-mini">{k === 'rez' ? 'REZ' : k === 'interface' ? 'Interface' : 'NET Actions'}
                      <input type="number" value={f.demon![k]} onChange={(e) => setFloor({ ...f, demon: { ...f.demon!, [k]: Number(e.target.value) } })} />
                    </label>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="net-sub">Access Points{map ? ` on ${map.name}` : ''}</div>
      {!map ? <p className="dim">Load a map to place access points.</p> : (
        <>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {access.map((c, i) => (
              <span className="chip" key={`${c.x},${c.y}`}>{c.x},{c.y}
                <button className="btn ghost" aria-label={`Remove access point ${c.x},${c.y}`} onClick={() => setAccess(access.filter((_, j) => j !== i))}>×</button>
              </span>
            ))}
          </div>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <label className="net-mini">Column<input type="number" min={0} max={map.width - 1} value={ax} onChange={(e) => setAx(Number(e.target.value))} /></label>
            <label className="net-mini">Row<input type="number" min={0} max={map.height - 1} value={ay} onChange={(e) => setAy(Number(e.target.value))} /></label>
            <button className="btn" onClick={() => setAccess([...access.filter((c) => c.x !== ax || c.y !== ay), { x: ax, y: ay }])}>Add Access Point</button>
          </div>
        </>
      )}

      <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn yellow" disabled={!dirty} onClick={onSave}>{saved ? 'Save Changes' : 'Save Architecture'}</button>
        {saved && <label className="net-check"><input type="checkbox" checked={found} onChange={(e) => onFound(e.target.checked)} />Party Knows the Access Points</label>}
        {saved && <button className="btn danger" onClick={onDelete}>Delete</button>}
      </div>
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
            <input aria-label="ICE name" value={x.name} maxLength={40} style={{ width: 120 }} onChange={(e) => set(i, { name: e.target.value })} />
            <select aria-label="ICE kind" value={x.kind} onChange={(e) => set(i, { kind: e.target.value as IceStats['kind'] })}>
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
          <option value="">Add ICE From a Template</option>
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
  if (!draft) {
    return (
      <div className="row net-row">
        <span className="h">{name}</span>
        <button className="btn" onClick={() => setDraft({ interface: 4, deckName: 'Standard Cyberdeck', slots: DECK_SLOTS.standard, programs: [] })}>Add Cyberdeck</button>
      </div>
    );
  }
  const toggle = (id: string) => {
    const t = PROGRAM_TEMPLATES.find((p) => p.id === id)!;
    setDraft({ ...draft, programs: chosen.has(id) ? draft.programs.filter((p) => p.id !== id) : [...draft.programs, { ...t }] });
  };
  return (
    <div className="net-rig">
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span className="h" style={{ minWidth: 90 }}>{name}</span>
        <label className="net-mini">Interface<input type="number" min={1} max={10} value={draft.interface} onChange={(e) => setDraft({ ...draft, interface: Number(e.target.value) })} /></label>
        <select aria-label="Deck quality" value={draft.slots} onChange={(e) => setDraft({ ...draft, slots: Number(e.target.value) })}>
          <option value={DECK_SLOTS.poor}>Poor (5 Slots)</option>
          <option value={DECK_SLOTS.standard}>Standard (7 Slots)</option>
          <option value={DECK_SLOTS.excellent}>Excellent (9 Slots)</option>
        </select>
        <input aria-label="Deck name" value={draft.deckName} maxLength={40} onChange={(e) => setDraft({ ...draft, deckName: e.target.value })} />
      </div>
      <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
        {PROGRAM_TEMPLATES.map((p) => (
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

function LiveRuns({ view, send }: { view: ViewState; send: (op: NetOp) => boolean }) {
  const full = view.netrun?.full;
  const runs = Object.entries(full?.runs ?? {});
  if (!runs.length) return <p className="dim">Nobody is jacked in.</p>;
  return (
    <div className="net-form">
      {runs.map(([aid, run]) => {
        const arch = full!.architectures[run.archId];
        const floor = arch?.floors[run.floorId];
        return (
          <div className="net-rig" key={aid}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="h">{view.actors[aid]?.public.name ?? aid}</span>
              <span className="dim">{arch?.name} · Floor {arch ? depthOf(arch, run.floorId) : '?'}</span>
            </div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {floor?.ice?.map((ice, i) => (run.ice[floor.id]?.[i] ?? 0) > 0 && (
                <button key={i} className="btn danger" onClick={() => send({ op: 'iceAttack', actorId: aid, index: i })}>{ice.name} Attacks</button>
              ))}
              <button className="btn danger" onClick={() => send({ op: 'forceJackOut', actorId: aid })}>Force Jack Out</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
