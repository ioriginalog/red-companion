/** GM downtime and bookkeeping: rest and healing, therapy, installing cyberware with a rolled Humanity Loss. */
import { useState } from 'react';
import { catalogToItem, THERAPY, type Care } from '@cprc/rules-core';
import { cyberwareGroups, usePacks } from '../data/catalog.js';
import type { SystemsCtx } from './SystemsSheet.js';
import './systems.css';

export function GmSystemsPanel({ c }: { c: SystemsCtx }) {
  const actors = Object.values(c.view.actors).filter((a) => a.combatant && !a.public.conditions.dead);
  const [days, setDays] = useState(1);
  const [care, setCare] = useState<Care>('home');
  const [who, setWho] = useState<string>(actors[0]?.id ?? '');
  const [kind, setKind] = useState<'standard' | 'extreme'>('standard');
  const [base, setBase] = useState(12);
  const groups = cyberwareGroups(usePacks());
  const [item, setItem] = useState('0::0');
  const [lossMode, setLossMode] = useState<'roll' | 'fixed' | 'none'>('roll');
  if (!c.isGm) return null;
  const target = c.view.actors[who]?.combatant;
  const fighting = c.view.encounter.active;
  const [gi, ii] = item.split('::').map(Number);
  const entry = groups[gi!]?.items[ii!] ?? groups[0]!.items[0]!;
  return (
    <section className="card">
      <div className="ttl">Downtime and Upkeep</div>
      <div className="sys-gm">
        <div className="sys-sub">Rest</div>
        <div className="row u-wrap">
          <label className="row"><span className="dim">Days</span><input className="u-w-64" type="number" min={1} max={60} value={days} onChange={(e) => setDays(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} /></label>
          <select value={care} onChange={(e) => setCare(e.target.value as Care)} aria-label="Where They Rest">
            <option value="home">At Home (BODY per Day)</option>
            <option value="hospital">Hospital Bed (BODY × 2)</option>
            <option value="street">On the Street (no healing)</option>
          </select>
          <button className="btn" disabled={fighting} title={fighting ? 'End the encounter first.' : undefined} onClick={() => c.act({ type: 'rest', days, care })}>Rest Everyone</button>
        </div>

        <div className="sys-sub u-mt-10">Character</div>
        <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Character">
          {actors.map((a) => <option key={a.id} value={a.id}>{a.public.name}</option>)}
        </select>
        {target?.humanity && <div className="dim u-fs-13">Humanity {target.humanity.current} / {target.humanity.max}</div>}

        <div className="row u-wrap u-mt-6">
          <select value={kind} onChange={(e) => setKind(e.target.value as 'standard' | 'extreme')} aria-label="Therapy">
            <option value="standard">Standard Therapy (DV {THERAPY.standard.dv}, Humanity 40+)</option>
            <option value="extreme">Extreme Therapy (DV {THERAPY.extreme.dv}, Below 40)</option>
          </select>
          <label className="row"><span className="dim">Therapist</span><input className="u-w-56" type="number" min={0} max={40} value={base} onChange={(e) => setBase(Math.max(0, Math.min(40, Number(e.target.value) || 0)))} aria-label="Therapist STAT plus Skill" /></label>
          <button className="btn" disabled={!target?.humanity} onClick={() => c.act({ type: 'therapy', actorId: who, kind, therapistBase: base })}>Run a Week of Therapy</button>
        </div>

        <div className="row u-wrap u-mt-6">
          <select value={item} onChange={(e) => setItem(e.target.value)} aria-label="Cyberware">
            {groups.map((g, a) => (
              <optgroup key={g.label} label={g.label}>
                {g.items.map((x, b) => <option key={`${a}-${b}`} value={`${a}::${b}`}>{x.name} ({x.hlDice}{x.hlFixed !== undefined ? `, Fixed ${x.hlFixed}` : ''})</option>)}
              </optgroup>
            ))}
          </select>
          <select value={lossMode} onChange={(e) => setLossMode(e.target.value as 'roll' | 'fixed' | 'none')} aria-label="Humanity Loss">
            <option value="roll">Roll Humanity Loss</option>
            <option value="fixed">Take the Fixed Value</option>
            <option value="none">No Humanity Loss (GM Option)</option>
          </select>
          <button className="btn" disabled={!who} onClick={() => c.act({
            type: 'installCyberware', actorId: who, lossMode,
            item: catalogToItem(entry, `cw-${Math.random().toString(36).slice(2, 10)}`),
          })}>Install</button>
        </div>
        <div className="note">Installs after character creation roll their Humanity Loss; each item with a loss also lowers maximum Humanity by 2 (borgware 4). Import your book’s catalog under Characters → Rules Packs.</div>
      </div>
    </section>
  );
}
