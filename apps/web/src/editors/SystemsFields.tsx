/**
 * Character builder sections for Track K systems: Role and Role Ability,
 * cyberware with Humanity, and the ammunition picker.
 */
import { useRef, useState } from 'react';
import {
  AMMO_TYPES, ammoProblem, AWARENESS, catalogToItem, creationHumanity, empFromHumanity, humanityStatus, ROLES,
  type AmmoTypeId, type AwarenessKey, type CyberwareEffect, type CyberwareItem, type GearItem, type RoleId, type RoleState, type StatKey, type WeaponType,
} from '@cprc/rules-core';
import { uniqueId } from './actorModel.js';
import { cyberwareGroups, importPackText, removePack, usePacks } from '../data/catalog.js';
import { GEAR_PRESETS } from '../data/gear.js';
import { signed } from '../table/format.js';

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
          <input type="number" min={1} max={10} disabled={!role} value={role?.rank ?? ''} aria-label="Role Rank"
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
  stat: 'STAT Bonus', skill: 'Skill Bonus', armor: 'Armor SP', initiative: 'Initiative',
  targetingScope: 'Targeting Scope', neuralLink: 'Neural Link', subdermalGrip: 'Subdermal Grip', interfacePlugs: 'Interface Plugs',
  healingMultiplier: 'Faster Healing', ignoreSeriouslyWounded: 'Ignore Seriously Wounded',
  smartLink: 'Targeting Scope (Old)',
};
/** Effects offered when adding (the legacy alias is display-only). */
const PICKABLE = (Object.keys(EFFECT_LABEL) as CyberwareEffect['kind'][]).filter((k) => k !== 'smartLink');
const INSTALL: Record<string, string> = { mall: 'Mall', clinic: 'Clinic', hospital: 'Hospital', none: 'No Surgery' };

function effectText(e: CyberwareEffect): string {
  switch (e.kind) {
    case 'stat': return `${e.stat} ${signed(e.value)}`;
    case 'skill': return `${e.skill} ${signed(e.value)}`;
    case 'armor': return `${e.location === 'head' ? 'Head' : 'Body'} SP ${e.sp}`;
    case 'initiative': return `Initiative ${signed(e.value)}`;
    case 'healingMultiplier': return `Heal × ${e.value}`;
    default: return EFFECT_LABEL[e.kind];
  }
}

export function CyberwareField({ value, emp, onChange }: { value: CyberwareItem[]; emp: number; onChange: (v: CyberwareItem[]) => void }) {
  const packs = usePacks();
  const groups = cyberwareGroups(packs);
  const [pick, setPick] = useState('custom');
  const h = creationHumanity(emp, value);
  const status = humanityStatus({ current: h.current });
  const add = () => {
    const id = uniqueId('cw', value.map((i) => i.id)).replace(/^a-/, 'cw-');
    const [g, n] = pick.split('::');
    const entry = groups[Number(g)]?.items[Number(n)];
    // At character creation the fixed (parenthetical) Humanity Loss is used.
    const item: CyberwareItem = entry ? catalogToItem(entry, id) : { id, name: 'New Cyberware', humanityLoss: 2, hlDice: '1d6', hlFixed: 2, effects: [] };
    onChange([...value, item]);
  };
  const upd = (i: number, patch: Partial<CyberwareItem>) => onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <section className="card">
      <div className="ttl">Cyberware and Humanity</div>
      <div className={`hum hum-${status}`}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span>Humanity <b className="mono">{h.current}</b> / {h.max}<span className="dim"> (Starting {h.base})</span></span>
          <span>EMP <b className="mono">{empFromHumanity(h.current)}</b> (Starting {emp})</span>
        </div>
        <div className="bar"><i style={{ width: `${Math.max(0, Math.min(100, (h.current / Math.max(1, h.base)) * 100))}%` }} /></div>
        {status !== 'stable' && <div className="note" role="status">{status === 'cyberpsycho' ? 'Cyberpsychosis: at 0 Humanity the character becomes the GM’s.' : status === 'critical' ? 'Close to cyberpsychosis.' : 'Humanity is running low.'}</div>}
      </div>
      {value.length === 0 && <div className="ed-empty">No cyberware.</div>}
      {value.map((item, i) => (
        <div className="cw" key={item.id}>
          <div className="wrow" style={{ gridTemplateColumns: '2fr 1.1fr 0.7fr 0.8fr auto' }}>
            <label className="fld"><span>Name</span><input value={item.name} maxLength={80} onChange={(e) => upd(i, { name: e.target.value })} /></label>
            <label className="fld"><span>Slot</span><input value={item.slot ?? ''} maxLength={40} placeholder="Neuralware" onChange={(e) => upd(i, { slot: e.target.value || undefined })} /></label>
            <label className="fld"><span>HL Dice</span><input value={item.hlDice ?? ''} maxLength={10} placeholder="2d6" onChange={(e) => upd(i, { hlDice: e.target.value.trim() || undefined })} /></label>
            <label className="fld"><span>Humanity Loss</span><input type="number" min={0} max={100} value={item.humanityLoss} onChange={(e) => upd(i, { humanityLoss: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })} /></label>
            <button className="iconbtn" aria-label={`Remove ${item.name}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button>
          </div>
          <div className="chips">
            {item.install && <span className="chip">{INSTALL[item.install]}</span>}
            {item.costEb !== undefined && <span className="chip">{item.costEb} eb</span>}
            <label className="chip"><input type="checkbox" checked={!!item.borgware} onChange={(e) => upd(i, { borgware: e.target.checked || undefined })} /> Borgware</label>
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
      <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
        <select aria-label="Cyberware to Add" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="custom">Custom Item</option>
          {groups.map((g, gi) => (
            <optgroup key={g.label} label={g.label}>
              {g.items.map((x, xi) => <option key={`${gi}-${xi}`} value={`${gi}::${xi}`}>{x.name} ({x.hlDice}{x.hlFixed !== undefined ? `, ${x.hlFixed}` : ''})</option>)}
            </optgroup>
          ))}
        </select>
        <button className="btn" onClick={add}>Add Cyberware</button>
      </div>
      <div className="note" style={{ marginTop: 6 }}>
        At character creation each item takes its fixed Humanity Loss, and every item with a loss lowers maximum Humanity by 2 (borgware 4).
        Later installs are rolled: use Downtime and Upkeep in the Table’s Scene tab.
      </div>
      <RulesPacks />
    </section>
  );
}

/** Import and manage rules packs (catalogs from the GM's own books). */
export function RulesPacks() {
  const packs = usePacks();
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  return (
    <div className="packs" style={{ marginTop: 10 }}>
      <div className="ed-sub">Rules Packs</div>
      {packs.length === 0 && <div className="note">No packs yet. Import a catalog of cyberware or Programs from your own books (JSON). Packs stay on this device.</div>}
      {packs.map((p) => (
        <div key={p.name} className="row" style={{ justifyContent: 'space-between' }}>
          <span>{p.name} <span className="dim">· {p.cyberware?.length ?? 0} Cyberware · {p.programs?.length ?? 0} Programs</span></span>
          <button className="btn sm" onClick={() => { removePack(p.name); setMsg({ text: `Removed ${p.name}.`, bad: false }); }}>Remove</button>
        </div>
      ))}
      <input ref={file} type="file" accept="application/json,.json" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        if (f.size > 2_000_000) { setMsg({ text: 'That file is too big for a rules pack.', bad: true }); return; }
        const err = importPackText(await f.text());
        setMsg(err ? { text: err, bad: true } : { text: `Imported ${f.name}.`, bad: false });
      }} />
      <button className="btn" style={{ marginTop: 6 }} onClick={() => file.current?.click()}>Import Rules Pack</button>
      {msg && <div className={msg.bad ? 'ed-err' : 'note'} role="status">{msg.text}</div>}
    </div>
  );
}

/** Carried gear: pick from a short generic list or type anything. */
export function GearField({ value, onChange }: { value: GearItem[]; onChange: (v: GearItem[]) => void }) {
  const [pick, setPick] = useState(GEAR_PRESETS[0]!.name);
  const upd = (i: number, patch: Partial<GearItem>) => onChange(value.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  return (
    <section className="card">
      <div className="ttl">Gear</div>
      {value.length === 0 && <div className="ed-empty">No gear.</div>}
      {value.map((g, i) => (
        <div className="wrow" key={i} style={{ gridTemplateColumns: '2fr 0.6fr 2fr auto' }}>
          <label className="fld"><span>Item</span><input value={g.name} maxLength={60} onChange={(e) => upd(i, { name: e.target.value })} /></label>
          <label className="fld"><span>Qty</span><input type="number" min={1} max={999} value={g.qty} onChange={(e) => upd(i, { qty: Math.max(1, Math.min(999, Math.round(Number(e.target.value) || 1))) })} /></label>
          <label className="fld"><span>Notes</span><input value={g.notes ?? ''} maxLength={120} onChange={(e) => upd(i, { notes: e.target.value || undefined })} /></label>
          <button className="iconbtn" aria-label={`Remove ${g.name}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
        <select aria-label="Gear to Add" value={pick} onChange={(e) => setPick(e.target.value)}>
          {GEAR_PRESETS.map((g) => <option key={g.name} value={g.name} title={g.summary}>{g.name}</option>)}
          <option value="">Custom Item</option>
        </select>
        <button className="btn" onClick={() => onChange([...value, { name: pick || 'New Item', qty: 1 }])} disabled={value.length >= 60}>Add Gear</button>
      </div>
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
      <select aria-label="Effect Type" value={kind} onChange={(e) => setKind(e.target.value as CyberwareEffect['kind'])}>
        {PICKABLE.map((k) => <option key={k} value={k}>{EFFECT_LABEL[k]}</option>)}
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

export function AmmoSelect({ type, value, onChange, era2070s = false }: { type: WeaponType; value: AmmoTypeId | undefined; onChange: (v: AmmoTypeId | undefined) => void; era2070s?: boolean }) {
  // 2070s ammo only when the GM has the 2070s options on (matches the sheet); keep a current pick visible.
  const options = AMMO_TYPES.filter((a) => !ammoProblem({ id: 'w', name: 'w', type }, a.id) && (era2070s || !a.era2070s || a.id === value));
  if (!options.length) return <label className="fld"><span>Ammo</span><input disabled value="—" /></label>;
  return (
    <label className="fld"><span>Ammo</span>
      <select value={value ?? 'basic'} onChange={(e) => onChange(e.target.value === 'basic' ? undefined : (e.target.value as AmmoTypeId))}>
        {options.map((a) => <option key={a.id} value={a.id} title={a.summary}>{a.name}</option>)}
      </select>
    </label>
  );
}
