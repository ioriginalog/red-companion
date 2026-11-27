/**
 * Shields, human shields, drugs and vehicles for the acting character, plus
 * the GM's vehicle spawner. Mount under the Table's attack card next to
 * CombatExtrasPanel, passing the acting and target ids.
 */
import { useState } from 'react';
import { DRUG_TEMPLATES, gridDistance, QUALITY_LABEL, SHIELD_TEMPLATES, VEHICLE_AIM_PENALTY, VEHICLE_TEMPLATES, type Cell } from '@cprc/rules-core';
import type { GearOp, Intent, TacticalMap, ViewState } from '@cprc/session';
import { actionSpent } from '../table/hints.js';
import './gear.css';

export interface GearCtx {
  view: ViewState;
  isGm: boolean;
  mine: (id: string | null | undefined) => boolean;
  name: (id: string) => string;
  act: (i: Intent) => boolean;
}

const gear = (c: GearCtx, op: GearOp) => c.act({ type: 'gear', op });

export function GearPanel({ c, actingId, targetId, canAct }: { c: GearCtx; actingId: string | null; targetId: string | null; canAct: boolean }) {
  const { view } = c;
  const [drugId, setDrugId] = useState(DRUG_TEMPLATES[0]!.id);
  const [shieldId, setShieldId] = useState(SHIELD_TEMPLATES[0]!.id);
  const [weaponId, setWeaponId] = useState('');
  const [aimed, setAimed] = useState(false);
  const [picking, setPicking] = useState<null | 'drive' | 'spawn'>(null);
  const [spawn, setSpawn] = useState({ templateId: VEHICLE_TEMPLATES[0]!.id, allegiance: 'party' as 'party' | 'hostile' | 'neutral' });
  const a = actingId ? view.actors[actingId] : undefined;
  const ac = a?.combatant;
  const t = targetId && targetId !== actingId ? view.actors[targetId] : undefined;
  const map = view.map;

  const vehicles = Object.values(view.actors).filter((x) => x.public.vehicle);
  const aboard = ac ? vehicles.find((v) => v.combatant?.vehicle?.passengers.includes(ac.id)) : undefined;
  const near = (id: string) => {
    const p = map?.tokens[a?.id ?? ''], q = map?.tokens[id];
    return !p || !q || gridDistance(p, q) <= 1;
  };
  const boardable = ac && !aboard && !ac.vehicle ? vehicles.filter((v) => near(v.id) && !v.public.conditions.dead) : [];
  const grappling = ac ? view.extras?.grapples.find((g) => g.holderId === ac.id) : undefined;
  const tVehicle = t?.public.vehicle ? t : undefined;
  const weapons = a?.weapons ?? [];
  const wid = weaponId && weapons.some((w) => w.id === weaponId) ? weaponId : weapons[0]?.id ?? '';

  const gmSpawn = c.isGm && (
    <div className="gear-block">
      <div className="gear-sub">Vehicles</div>
      <div className="row gear-row">
        <select className="gear-wide" aria-label="Vehicle" value={spawn.templateId} onChange={(e) => setSpawn({ ...spawn, templateId: e.target.value })}>
          {VEHICLE_TEMPLATES.map((v) => <option key={v.id} value={v.id}>{v.name} (SDP {v.sdp}, {v.seats} {v.seats === 1 ? 'Seat' : 'Seats'}, MOVE {v.move})</option>)}
        </select>
        <select aria-label="Vehicle Allegiance" value={spawn.allegiance} onChange={(e) => setSpawn({ ...spawn, allegiance: e.target.value as typeof spawn.allegiance })}>
          <option value="party">Party</option><option value="neutral">Neutral</option><option value="hostile">Hostile</option>
        </select>
        <button className={`btn ${picking === 'spawn' ? 'on' : ''}`} disabled={!map} onClick={() => setPicking(picking === 'spawn' ? null : 'spawn')}>Place Vehicle</button>
      </div>
      {picking === 'spawn' && map && (
        <SquarePicker map={map} view={view} hint="Click a square for the vehicle." onPick={(at) => {
          const base = spawn.templateId;
          let n = 1; while (view.actors[`${base}-${n}`]) n++;
          if (gear(c, { op: 'spawnVehicle', templateId: base, id: `${base}-${n}`, at, allegiance: spawn.allegiance })) setPicking(null);
        }} />
      )}
    </div>
  );

  if (!a || !ac) return gmSpawn ? <section className="card gear">{gmSpawn}</section> : null;
  if (ac.vehicle) {
    const v = ac.vehicle;
    return (
      <section className="card gear" aria-label={`${ac.name} Vehicle`}>
        <div className="ttl">Vehicle · {ac.name}</div>
        <p className="gear-line">SDP {ac.hp.current}/{ac.hp.max} · {v.passengers.length}/{v.seats} {v.seats === 1 ? 'Seat' : 'Seats'} · MOVE {v.move}{v.topSpeed ? ` · Top Speed ${v.topSpeed}` : ''}{v.sp ? ` · Plating SP ${v.sp}` : ''}</p>
        <p className="gear-line dim">Aboard: {v.passengers.length ? v.passengers.map((p) => `${c.name(p)}${p === v.driverId ? ' (Driver)' : ''}`).join(', ') : 'nobody'}.</p>
        {gmSpawn}
      </section>
    );
  }
  const shield = ac.shield;
  // Shield and drug actions take the Action: once it's spent, say so instead of offering them.
  const spent = actionSpent(view.encounter, ac.id);
  const needsAction = !canAct || spent;
  const SPENT = 'Your Action is spent this Turn.';
  const spentNote = spent && canAct ? <p className="gear-line gear-why" role="note">Action spent this Turn. These wait until the next Turn.</p> : null;

  return (
    <section className="card gear" aria-label={`${ac.name} Gear`}>
      <div className="ttl">Gear · {ac.name}</div>

      <div className="gear-block">
        <div className="gear-sub">Shield</div>
        {shield ? (
          <>
            <div className="row gear-row">
              <span className="h">{shield.name}</span>
              <span className={`gear-tag ${shield.hp > 0 ? (shield.raised ? 'good' : '') : 'bad'}`}>{shield.hp <= 0 ? 'Destroyed' : shield.raised ? 'Raised' : 'Lowered'}</span>
              <span className="mono dim">HP {shield.hp}/{shield.maxHp}</span>
            </div>
            <div className="bar"><i style={{ width: `${(shield.hp / shield.maxHp) * 100}%` }} /></div>
            <div className="row gear-row">
              {shield.hp > 0 && <button className="btn" disabled={!canAct && !c.mine(ac.id)} onClick={() => gear(c, { op: 'raiseShield', actorId: ac.id, raised: !shield.raised })}
                title={shield.raised ? 'Lowered, it blocks nothing and you can dodge again.' : 'Raised, it takes the hits and you can’t dodge them.'}>{shield.raised ? 'Lower Shield' : 'Raise Shield'}</button>}
              <button className="btn ghost" disabled={needsAction} onClick={() => gear(c, { op: 'dropShield', actorId: ac.id })} title={spent ? SPENT : 'Uses your Action.'}>Drop Shield</button>
            </div>
          </>
        ) : (
          <div className="row gear-row">
            <select aria-label="Shield" value={shieldId} onChange={(e) => setShieldId(e.target.value)}>
              {SHIELD_TEMPLATES.map((s) => <option key={s.id} value={s.id}>{s.name} (HP {s.hp})</option>)}
            </select>
            <button className="btn" disabled={needsAction} onClick={() => gear(c, { op: 'equipShield', actorId: ac.id, templateId: shieldId })} title={spent ? SPENT : 'Uses your Action and one hand.'}>Equip Shield</button>
            {grappling && !grappling.humanShield && (
              <button className="btn" disabled={needsAction} onClick={() => gear(c, { op: 'humanShield', actorId: ac.id })} title={spent ? SPENT : 'Uses your Action. Blocks ranged attacks, except head shots.'}>
                Use {c.name(grappling.heldId)} as a Human Shield
              </button>
            )}
            {grappling?.humanShield && <span className="gear-tag good">Human Shield: {c.name(grappling.heldId)}</span>}
          </div>
        )}
        {spentNote}
      </div>

      <div className="gear-block">
        <div className="gear-sub">Drugs</div>
        <div className="row gear-row">
          <select aria-label="Drug" value={drugId} onChange={(e) => setDrugId(e.target.value)}>
            {DRUG_TEMPLATES.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.duration})</option>)}
          </select>
          <button className="btn" disabled={needsAction} onClick={() => gear(c, { op: 'takeDrug', actorId: ac.id, drugId })} title={spent ? SPENT : 'Uses your Action.'}>Take a Dose</button>
          {t && !t.public.vehicle && t.public.allegiance !== 'hostile' && (
            <button className="btn" disabled={needsAction} onClick={() => gear(c, { op: 'takeDrug', actorId: ac.id, targetId: t.id, drugId })} title={spent ? SPENT : 'A willing target next to you. Uses your Action.'}>Dose {t.public.name}</button>
          )}
        </div>
        {spentNote}
        <p className="gear-line dim">{DRUG_TEMPLATES.find((d) => d.id === drugId)?.effect.note}</p>
        {(ac.drugs?.active ?? []).map((d) => (
          <div className="row gear-row gear-dose" key={`a-${d.id}`}>
            <span className="h">{d.name}</span><span className="gear-tag good">Active</span><span className="dim">{d.duration}</span>
            {c.isGm && <button className="btn ghost" onClick={() => gear(c, { op: 'drugWearsOff', actorId: ac.id, drugId: d.id })} title={`WILL + Resist Torture/Drugs vs DV ${d.addictionDv}`}>Wears Off</button>}
          </div>
        ))}
        {(ac.drugs?.addictions ?? []).map((d) => (
          <div className="row gear-row gear-dose" key={`x-${d.id}`}>
            <span className="h">{d.name}</span><span className="gear-tag bad">Addicted</span><span className="dim gear-note">{d.secondary.note}</span>
            {c.isGm && <button className="btn ghost" onClick={() => gear(c, { op: 'cureAddiction', actorId: ac.id, drugId: d.id })}>Cured</button>}
          </div>
        ))}
      </div>

      {(aboard || boardable.length > 0 || tVehicle) && (
        <div className="gear-block">
          <div className="gear-sub">Vehicle</div>
          {aboard && (
            <>
              <p className="gear-line">In {aboard.public.name}{aboard.combatant?.vehicle?.driverId === ac.id ? ', driving' : ''}.</p>
              <div className="row gear-row">
                {aboard.combatant?.vehicle?.driverId === ac.id && (
                  <button className={`btn ${picking === 'drive' ? 'on' : ''}`} disabled={!canAct || !map} onClick={() => setPicking(picking === 'drive' ? null : 'drive')}
                    title={`Uses your Move Action: up to ${aboard.combatant?.vehicle?.move ?? 0} squares.`}>Drive</button>
                )}
                <button className="btn ghost" disabled={!canAct} onClick={() => gear(c, { op: 'exit', actorId: ac.id })} title="Uses your Move Action.">Get Out</button>
              </div>
              {picking === 'drive' && map && (
                <SquarePicker map={map} view={view} hint={`Click where to drive (up to ${aboard.combatant?.vehicle?.move ?? 0} squares).`}
                  onPick={(to) => { if (gear(c, { op: 'drive', actorId: ac.id, to })) setPicking(null); }} />
              )}
            </>
          )}
          {boardable.map((v) => (
            <div className="row gear-row" key={v.id}>
              <span className="h">{v.public.name}</span>
              <button className="btn" disabled={!canAct} onClick={() => gear(c, { op: 'board', actorId: ac.id, vehicleId: v.id, drive: true })} title="Uses your Move Action.">Take the Wheel</button>
              <button className="btn ghost" disabled={!canAct} onClick={() => gear(c, { op: 'board', actorId: ac.id, vehicleId: v.id })} title="Uses your Move Action.">Get In</button>
            </div>
          ))}
          {tVehicle && (
            <div className="row gear-row">
              <select aria-label="Weapon for the Vehicle" value={wid} onChange={(e) => setWeaponId(e.target.value)}>
                {weapons.map((w) => <option key={w.id} value={w.id}>{w.name}{w.quality && w.quality !== 'standard' ? ` (${QUALITY_LABEL[w.quality]})` : ''}</option>)}
              </select>
              <label className="gear-check"><input type="checkbox" checked={aimed} onChange={(e) => setAimed(e.target.checked)} />Weak Spot ({VEHICLE_AIM_PENALTY}, Double Damage)</label>
              <button className="btn yellow" disabled={!canAct || !wid} onClick={() => gear(c, { op: 'attackVehicle', attackerId: ac.id, vehicleId: tVehicle.id, weaponId: wid, ...(aimed ? { aimed: true } : {}) })}>
                Attack {tVehicle.public.name}
              </button>
              {aboard?.combatant?.vehicle?.driverId === ac.id && (
                <button className="btn danger" disabled={!canAct} onClick={() => gear(c, { op: 'ram', vehicleId: aboard.id, targetId: tVehicle.id })}>Ram</button>
              )}
            </div>
          )}
          {aboard?.combatant?.vehicle?.driverId === ac.id && t && !tVehicle && (
            <button className="btn danger" disabled={!canAct} onClick={() => gear(c, { op: 'ram', vehicleId: aboard.id, targetId: t.id })}>Ram {t.public.name}</button>
          )}
        </div>
      )}
      {gmSpawn}
    </section>
  );
}

/** A small clickable copy of the map for picking one square. */
function SquarePicker({ map, view, hint, onPick }: { map: TacticalMap; view: ViewState; hint: string; onPick: (c: Cell) => void }) {
  const px = Math.max(8, Math.min(20, Math.floor(300 / map.width)));
  const w = map.width * px, h = map.height * px;
  const [hover, setHover] = useState<Cell | null>(null);
  return (
    <div className="gear-picker">
      <p className="gear-line dim">{hint}{hover ? ` Column ${hover.x + 1}, Row ${hover.y + 1}.` : ''}</p>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="grid" aria-label="Pick a Square" onMouseLeave={() => setHover(null)}>
        {map.background && <image href={map.background} x={0} y={0} width={w} height={h} preserveAspectRatio="none" opacity={0.7} />}
        {Array.from({ length: map.height }, (_, y) => Array.from({ length: map.width }, (_, x) => {
          const t = map.cells[y * map.width + x];
          return (
            <rect key={`${x},${y}`} x={x * px} y={y * px} width={px} height={px} role="gridcell" aria-label={`Column ${x + 1}, Row ${y + 1}`}
              fill={t === '#' ? 'rgba(42, 47, 85, 0.6)' : hover && hover.x === x && hover.y === y ? 'rgba(255, 43, 214, 0.35)' : 'transparent'}
              stroke="#1d2a5e" strokeWidth={0.5} style={{ cursor: t === '#' ? 'not-allowed' : 'pointer' }}
              onMouseEnter={() => setHover({ x, y })} onClick={() => t !== '#' && onPick({ x, y })} />
          );
        }))}
        {Object.entries(map.tokens).map(([id, at]) => (
          <circle key={id} cx={at.x * px + px / 2} cy={at.y * px + px / 2} r={px * 0.32} pointerEvents="none"
            fill={view.actors[id]?.public.vehicle ? '#ffd400' : view.actors[id]?.public.allegiance === 'hostile' ? '#ff3b4e' : '#22e3ff'} />
        ))}
      </svg>
    </div>
  );
}
