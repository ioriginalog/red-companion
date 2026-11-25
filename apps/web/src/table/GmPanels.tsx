import { useState } from 'react';
import type { ConditionKey } from '@cprc/session';
import { client } from '../net.js';
import type { MapMode } from '../MapView.js';
import { ALLEGIANCE, WOUND, type TableCtx } from './ctx.js';
import { Portrait } from './panels.js';

const CONDITIONS: [ConditionKey, string][] = [['prone', 'Prone'], ['unconscious', 'Unconscious'], ['stabilized', 'Stabilized'], ['dead', 'Dead']];

/** GM inspector for one token: HP, conditions, map presence. */
export function Inspector({ c, id, onClose, onTarget }: { c: TableCtx; id: string; onClose: () => void; onTarget: (id: string) => void }) {
  const a = c.view.actors[id];
  const [custom, setCustom] = useState('');
  const [reason, setReason] = useState('');
  if (!a) return null;
  const hp = a.combatant?.hp;
  const at = c.view.map?.tokens[id];
  const adjust = (delta: number) => { if (delta) c.act({ type: 'adjustHp', actorId: id, delta, ...(reason.trim() ? { reason: reason.trim() } : {}) }); };
  return (
    <section className="card inspector" aria-label={`Inspector for ${a.public.name}`}>
      <div className="ttl row" style={{ justifyContent: 'space-between' }}><span>Inspector</span><button className="link" onClick={onClose} aria-label="Close Inspector">Close</button></div>
      <div className="row">
        <Portrait a={a} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="h name-md">{a.public.name}</div>
          <div className="dim h sub">{ALLEGIANCE[a.public.allegiance]} · {WOUND[a.public.woundState]}{hp ? ` · ${hp.current}/${hp.max} HP` : ''}</div>
        </div>
      </div>
      <div className="hp-adjust">
        {[-5, -1, 1, 5].map((d) => <button key={d} className={`btn sm${d < 0 ? ' danger' : ''}`} onClick={() => adjust(d)}>{d > 0 ? `+${d}` : `−${-d}`}</button>)}
        <input aria-label="Custom HP change" inputMode="numeric" placeholder="±HP" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^\d-]/g, ''))} style={{ width: 64 }} />
        <button className="btn sm" disabled={!Number(custom)} onClick={() => { adjust(Number(custom)); setCustom(''); }}>Apply</button>
      </div>
      <input aria-label="Reason (optional)" placeholder="Reason (optional), e.g. fire, fall" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: '100%', marginTop: 6 }} />
      <div className="modes" style={{ marginTop: 10 }}>
        {CONDITIONS.map(([k, label]) => (
          <button key={k} className={`mode${a.public.conditions[k] ? ' sel' : ''}`} aria-pressed={a.public.conditions[k]}
            onClick={() => c.act({ type: 'setCondition', actorId: id, condition: k, value: !a.public.conditions[k] })}>{label}</button>
        ))}
      </div>
      <div className="modes" style={{ marginTop: 10 }}>
        <button className="mode" onClick={() => onTarget(id)}>Make Target</button>
        {at && <button className="mode" onClick={() => client.signal({ kind: 'ping', at })}>Ping</button>}
        {at && <button className="mode" onClick={() => c.act({ type: 'placeToken', actorId: id, at: null })}>Remove from Map</button>}
        <button className="mode danger-mode" onClick={() => { if (confirm(`Remove ${a.public.name} from the session? Undo can bring them back.`)) { c.act({ type: 'removeActor', actorId: id }); onClose(); } }}>Delete</button>
      </div>
    </section>
  );
}

/** GM scene controls: lighting and the roster. */
export function ScenePanel({ c, mapMode, setMapMode, onFocus }: { c: TableCtx; mapMode: MapMode; setMapMode: (m: MapMode) => void; onFocus: (id: string) => void }) {
  const { view } = c;
  const lighting = view.map?.lighting ?? {};
  const actors = Object.values(view.actors);
  return (
    <>
      {view.map && (
        <section className="card">
          <div className="ttl">Lighting</div>
          <div className="modes">
            <button className={`mode${lighting.revealAll ? ' sel' : ''}`} aria-pressed={!!lighting.revealAll} onClick={() => c.act({ type: 'setLighting', lighting: { ...lighting, revealAll: !lighting.revealAll } })}>Reveal All</button>
            <button className={`mode${mapMode === 'reveal' ? ' sel' : ''}`} onClick={() => setMapMode(mapMode === 'reveal' ? 'move' : 'reveal')}>Paint Revealed Squares</button>
            <button className="mode" disabled={!lighting.revealed?.length} onClick={() => c.act({ type: 'setLighting', lighting: { ...lighting, revealed: [] } })}>Clear Revealed</button>
          </div>
          <p className="dim small" style={{ marginTop: 8 }}>
            {mapMode === 'reveal' ? 'Drag over squares to reveal them to players; drag over revealed squares to hide them again.' : 'Players always see revealed squares, even without line of sight (lit areas, windows, cameras).'}
          </p>
        </section>
      )}
      {actors.length > 0 && (
        <section className="card">
          <div className="ttl">Roster</div>
          <div className="roster">
            {actors.map((a) => (
              <div key={a.id} className="row roster-row">
                <button className="btn ghost roster-name" onClick={() => onFocus(a.id)}>
                  <span style={{ color: `var(--${a.public.allegiance})` }}>{a.public.name}</span>
                  <span className="dim small"> · {a.combatant ? `${a.combatant.hp.current}/${a.combatant.hp.max} HP` : ''}{view.map && !view.map.tokens[a.id] ? ' · Off Map' : ''}</span>
                </button>
                {a.public.allegiance === 'party' && (
                  <select aria-label={`Who plays ${a.public.name}`} value={a.controller} onChange={(e) => c.act({ type: 'assignController', actorId: a.id, controller: e.target.value })}>
                    <option value="gm">GM</option>
                    {c.s.players.map((p) => <option key={p.playerId} value={p.playerId}>{p.name}</option>)}
                  </select>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
