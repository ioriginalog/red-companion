/**
 * Character builder sections for Track K systems: Role and Role Ability,
 * cyberware with Humanity, and the ammunition picker.
 */
import { useState } from 'react';
import {
  AMMO_TYPES, ammoProblem, AWARENESS, EXAMPLE_CYBERWARE, empFromHumanity, humanityStatus, ROLES,
  type AmmoTypeId, type AwarenessKey, type CyberwareEffect, type CyberwareItem, type RoleId, type RoleState, type StatKey, type WeaponType,
} from '@cprc/rules-core';
import { uniqueId } from './actorModel.js';

const STATS: StatKey[] = ['INT', 'REF', 'DEX', 'TECH', 'COOL', 'WILL', 'LUCK', 'MOVE', 'BODY', 'EMP'];

export function RoleField({ value, onChange }: { value: RoleState | null; onChange: (r: RoleState | null) => void }) {
  const role = value;
  const spent = (a: Partial<Record<AwarenessKey, number>> | undefined) => Object.values(a ?? {}).reduce((s, v) => s + (v ?? 0), 0);
  return (
    <section className="card">
      <div className="ttl">Role</div>
      <div className="grid2">
        <label className="fld"><span>Role</span>
          <select value={role?.id ?? ''} onChange={(e) => {
            const id = e.target.value as RoleId | '';
            onChange(id ? { id, rank: role?.rank ?? 4 } : null);
          }}>
            <option value="">None</option>
            {ROLES.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.ability})</option>)}
          </select>
        </label>
        <label className="fld"><span>Rank</span>
          <input type="number" min={1} max={10} disabled={!role} value={role?.rank ?? ''} aria-label="Role rank"
            onChange={(e) => role && onChange({ ...role, rank: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} />
        </label>
      </div>

      {role?.id === 'solo' && (
        <div style={{ marginTop: 10 }}>
          <div className="ed-sub">Combat Awareness · {spent(role.awareness)} of {role.rank} Points</div>
          <div className="aw-grid">
            {AWARENESS.map((a) => {
              const v = role.awareness?.[a.key] ?? 0;
              const ok = a.allowed(v);
              return (
                <label key={a.key} className={`fld aw${ok ? '' : ' bad'}`} title={a.summary}>
                  <span>{a.name}</span>
                  <input type="number" min={0} max={10} value={v} aria-label={`${a.name} points`}
                    onChange={(e) => onChange({ ...role, awareness: { ...role.awareness, [a.key]: Math.max(0, Math.min(10, Number(e.target.value) || 0)) } })} />
                  <small className="dim">{a.summary}</small>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {role?.id === 'medtech' && (
        <div style={{ marginTop: 10 }}>
          <div className="ed-sub">Medicine · {(role.medicine?.surgery ?? 0) + (role.medicine?.pharmaceuticals ?? 0) + (role.medicine?.cryosystem ?? 0)} of {role.rank} Points</div>
          <div className="grid3">
            {([['surgery', 'Surgery', 10], ['pharmaceuticals', 'Pharmaceuticals', 5], ['cryosystem', 'Cryosystem Operation', 5]] as const).map(([k, label, max]) => (
              <label key={k} className="fld"><span>{label}</span>
                <input type="number" min={0} max={max} value={role.medicine?.[k] ?? 0}
                  onChange={(e) => {
                    const med = { surgery: 0, pharmaceuticals: 0, cryosystem: 0, ...role.medicine, [k]: Math.max(0, Math.min(max, Number(e.target.value) || 0)) };
                    onChange({ ...role, medicine: med });
                  }} />
              </label>
            ))}
          </div>
          <div className="note">Surgery gives 2 Surgery skill per point (max 10). Each other point gives 1 Medical Tech.</div>
        </div>
      )}

      {role?.id === 'netrunner' && <div className="note" style={{ marginTop: 8 }}>Interface rank {role.rank}. Netrunning reads it from here.</div>}
      {role && role.id !== 'solo' && role.id !== 'medtech' && role.id !== 'netrunner' && (
        <label className="fld" style={{ marginTop: 8 }}><span>Role Ability Notes</span>
          <textarea value={role.notes ?? ''} maxLength={2000} onChange={(e) => onChange({ ...role, notes: e.target.value })} placeholder="How this character uses their Role Ability." />
        </label>
      )}
    </section>
  );
}

const EFFECT_LABEL: Record<CyberwareEffect['kind'], string> = {
  stat: 'STAT Bonus', skill: 'Skill Bonus', armor: 'Armor SP', initiative: 'Initiative', smartLink: 'Smartgun Link',
  interfacePlugs: 'Interface Plugs', healingMultiplier: 'Faster Healing', ignoreSeriouslyWounded: 'Ignore Seriously Wounded',
};

function effectText(e: CyberwareEffect): string {
  switch (e.kind) {
    case 'stat': return `${e.stat} ${e.value >= 0 ? '+' : ''}${e.value}`;
    case 'skill': return `${e.skill} ${e.value >= 0 ? '+' : ''}${e.value}`;
    case 'armor': return `${e.location === 'head' ? 'Head' : 'Body'} SP ${e.sp}`;
    case 'initiative': return `Initiative ${e.value >= 0 ? '+' : ''}${e.value}`;
    case 'healingMultiplier': return `Heal × ${e.value}`;
    default: return EFFECT_LABEL[e.kind];
  }
}

export function CyberwareField({ value, emp, onChange }: { value: CyberwareItem[]; emp: number; onChange: (v: CyberwareItem[]) => void }) {
  const [pick, setPick] = useState('custom');
  const max = emp * 10;
  const loss = value.reduce((s, i) => s + i.humanityLoss, 0);
  const current = max - loss;
  const status = humanityStatus({ current });
  const add = () => {
    const ex = EXAMPLE_CYBERWARE.find((x) => x.item.name === pick);
    const id = uniqueId('cw', value.map((i) => i.id)).replace(/^a-/, 'cw-');
    const avg = ex ? Math.round(ex.hlDice.count * 3.5 + ex.hlDice.bonus) : 2;
    const item: CyberwareItem = ex ? { ...ex.item, id, humanityLoss: avg, effects: ex.item.effects.map((e) => ({ ...e })) } : { id, name: 'New Cyberware', humanityLoss: 2, effects: [] };
    onChange([...value, item]);
  };
  const upd = (i: number, patch: Partial<CyberwareItem>) => onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <section className="card">
      <div className="ttl">Cyberware and Humanity</div>
      <div className={`hum hum-${status}`}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span>Humanity <b className="mono">{current}</b> / {max}</span>
          <span>EMP <b className="mono">{empFromHumanity(current)}</b> (Starting {emp})</span>
        </div>
        <div className="bar"><i style={{ width: `${Math.max(0, Math.min(100, (current / Math.max(1, max)) * 100))}%` }} /></div>
        {status !== 'stable' && <div className="note" role="status">{status === 'cyberpsycho' ? 'Cyberpsychosis: at 0 Humanity the character becomes the GM’s.' : status === 'critical' ? 'Close to cyberpsychosis.' : 'Humanity is running low.'}</div>}
      </div>
      {value.length === 0 && <div className="ed-empty">No cyberware.</div>}
      {value.map((item, i) => (
        <div className="cw" key={item.id}>
          <div className="wrow" style={{ gridTemplateColumns: '2fr 1.2fr 0.8fr auto' }}>
            <label className="fld"><span>Name</span><input value={item.name} maxLength={80} onChange={(e) => upd(i, { name: e.target.value })} /></label>
            <label className="fld"><span>Slot</span><input value={item.slot ?? ''} maxLength={40} placeholder="Neuralware" onChange={(e) => upd(i, { slot: e.target.value || undefined })} /></label>
            <label className="fld"><span>Humanity Loss</span><input type="number" min={0} max={100} value={item.humanityLoss} onChange={(e) => upd(i, { humanityLoss: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })} /></label>
            <button className="iconbtn" aria-label={`Remove ${item.name}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button>
          </div>
          <div className="chips">
            {item.effects.map((e, k) => (
              <span className="chip" key={k}>{effectText(e)}
                <button className="x" aria-label={`Remove effect ${effectText(e)}`} onClick={() => upd(i, { effects: item.effects.filter((_, j) => j !== k) })}>×</button>
              </span>
            ))}
            <EffectAdder onAdd={(e) => upd(i, { effects: [...item.effects, e] })} />
          </div>
          <label className="fld"><span>Notes</span><input value={item.notes ?? ''} maxLength={300} onChange={(e) => upd(i, { notes: e.target.value || undefined })} placeholder="What it does at the table" /></label>
        </div>
      ))}
      <div className="row" style={{ marginTop: 8 }}>
        <select aria-label="Cyberware to add" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="custom">Custom Item</option>
          {EXAMPLE_CYBERWARE.map((x) => <option key={x.item.name} value={x.item.name}>{x.item.name}</option>)}
        </select>
        <button className="btn" onClick={add}>Add Cyberware</button>
      </div>
      <div className="note" style={{ marginTop: 6 }}>Example items use average Humanity Loss; set each item’s loss from your book. To roll the loss at the table, install it from Downtime and Upkeep in the Table’s Scene tab.</div>
    </section>
  );
}

function EffectAdder({ onAdd }: { onAdd: (e: CyberwareEffect) => void }) {
  const [kind, setKind] = useState<CyberwareEffect['kind']>('stat');
  const [stat, setStat] = useState<StatKey>('REF');
  const [skill, setSkill] = useState('Perception');
  const [num, setNum] = useState(1);
  const [loc, setLoc] = useState<'body' | 'head'>('body');
  const build = (): CyberwareEffect => {
    switch (kind) {
      case 'stat': return { kind, stat, value: num };
      case 'skill': return { kind, skill, value: num };
      case 'armor': return { kind, location: loc, sp: Math.max(1, num) };
      case 'initiative': return { kind, value: num };
      case 'healingMultiplier': return { kind, value: Math.max(1, Math.min(4, num)) };
      default: return { kind } as CyberwareEffect;
    }
  };
  return (
    <span className="eff-add">
      <select aria-label="Effect type" value={kind} onChange={(e) => setKind(e.target.value as CyberwareEffect['kind'])}>
        {Object.entries(EFFECT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {kind === 'stat' && <select aria-label="STAT" value={stat} onChange={(e) => setStat(e.target.value as StatKey)}>{STATS.map((s) => <option key={s}>{s}</option>)}</select>}
      {kind === 'skill' && <input aria-label="Skill" value={skill} maxLength={40} onChange={(e) => setSkill(e.target.value)} style={{ width: 110 }} />}
      {kind === 'armor' && <select aria-label="Location" value={loc} onChange={(e) => setLoc(e.target.value as 'body' | 'head')}><option value="body">Body</option><option value="head">Head</option></select>}
      {['stat', 'skill', 'armor', 'initiative', 'healingMultiplier'].includes(kind) && (
        <input aria-label="Value" type="number" value={num} onChange={(e) => setNum(Math.round(Number(e.target.value) || 0))} style={{ width: 56 }} />
      )}
      <button className="btn sm" onClick={() => onAdd(build())}>Add Effect</button>
    </span>
  );
}

export function AmmoSelect({ type, value, onChange }: { type: WeaponType; value: AmmoTypeId | undefined; onChange: (v: AmmoTypeId | undefined) => void }) {
  const options = AMMO_TYPES.filter((a) => !ammoProblem({ id: 'w', name: 'w', type }, a.id));
  if (!options.length) return <label className="fld"><span>Ammo</span><input disabled value="—" /></label>;
  return (
    <label className="fld"><span>Ammo</span>
      <select value={value ?? 'basic'} onChange={(e) => onChange(e.target.value === 'basic' ? undefined : (e.target.value as AmmoTypeId))}>
        {options.map((a) => <option key={a.id} value={a.id} title={a.summary}>{a.name}</option>)}
      </select>
    </label>
  );
}
