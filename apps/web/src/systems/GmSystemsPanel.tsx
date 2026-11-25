/** GM downtime and bookkeeping: rest and healing, therapy, installing cyberware with a rolled Humanity Loss. */
import { useState } from 'react';
import { EXAMPLE_CYBERWARE, THERAPY, type Care } from '@cprc/rules-core';
import type { SystemsCtx } from './SystemsSheet.js';
import './systems.css';

export function GmSystemsPanel({ c }: { c: SystemsCtx }) {
  const actors = Object.values(c.view.actors).filter((a) => a.combatant && !a.public.conditions.dead);
  const [days, setDays] = useState(1);
  const [care, setCare] = useState<Care>('home');
  const [who, setWho] = useState<string>(actors[0]?.id ?? '');
  const [kind, setKind] = useState<'standard' | 'extreme'>('standard');
  const [base, setBase] = useState(12);
  const [item, setItem] = useState(EXAMPLE_CYBERWARE[0]!.item.name);
  if (!c.isGm) return null;
  const target = c.view.actors[who]?.combatant;
  const fighting = c.view.encounter.active;
  const ex = EXAMPLE_CYBERWARE.find((x) => x.item.name === item)!;
  return (
    <section className="card">
      <div className="ttl">Downtime and Upkeep</div>
      <div className="sys-gm">
        <div className="sys-sub">Rest</div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <label className="row"><span className="dim">Days</span><input type="number" min={1} max={60} value={days} onChange={(e) => setDays(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} style={{ width: 64 }} /></label>
          <select value={care} onChange={(e) => setCare(e.target.value as Care)} aria-label="Where they rest">
            <option value="home">At Home (BODY per Day)</option>
            <option value="hospital">Hospital Bed (BODY × 2)</option>
            <option value="street">On the Street (No Healing)</option>
          </select>
          <button className="btn" disabled={fighting} title={fighting ? 'End the encounter first.' : undefined} onClick={() => c.act({ type: 'rest', days, care })}>Rest Everyone</button>
        </div>

        <div className="sys-sub" style={{ marginTop: 10 }}>Character</div>
        <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Character">
          {actors.map((a) => <option key={a.id} value={a.id}>{a.public.name}</option>)}
        </select>
        {target?.humanity && <div className="dim" style={{ fontSize: 13 }}>Humanity {target.humanity.current} / {target.humanity.max}</div>}

        <div className="row" style={{ flexWrap: 'wrap', marginTop: 6 }}>
          <select value={kind} onChange={(e) => setKind(e.target.value as 'standard' | 'extreme')} aria-label="Therapy">
            <option value="standard">Standard Therapy (DV {THERAPY.standard.dv}, Humanity 40+)</option>
            <option value="extreme">Extreme Therapy (DV {THERAPY.extreme.dv}, Below 40)</option>
          </select>
          <label className="row"><span className="dim">Therapist</span><input type="number" min={0} max={40} value={base} onChange={(e) => setBase(Math.max(0, Math.min(40, Number(e.target.value) || 0)))} style={{ width: 56 }} aria-label="Therapist STAT plus skill" /></label>
          <button className="btn" disabled={!target?.humanity} onClick={() => c.act({ type: 'therapy', actorId: who, kind, therapistBase: base })}>Run a Week of Therapy</button>
        </div>

        <div className="row" style={{ flexWrap: 'wrap', marginTop: 6 }}>
          <select value={item} onChange={(e) => setItem(e.target.value)} aria-label="Cyberware">
            {EXAMPLE_CYBERWARE.map((x) => <option key={x.item.name} value={x.item.name}>{x.item.name} ({x.hlDice.count}d6{x.hlDice.bonus ? ` + ${x.hlDice.bonus}` : ''})</option>)}
          </select>
          <button className="btn" disabled={!who} onClick={() => c.act({
            type: 'installCyberware', actorId: who, rollLoss: ex.hlDice,
            item: { ...ex.item, id: `cw-${Math.random().toString(36).slice(2, 10)}`, humanityLoss: 0, effects: ex.item.effects.map((e) => ({ ...e })) },
          })}>Install and Roll Humanity Loss</button>
        </div>
        <div className="note">Example Humanity Loss dice; use the Characters tab for custom items.</div>
      </div>
    </section>
  );
}
