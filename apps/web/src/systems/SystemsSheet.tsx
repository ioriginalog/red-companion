/**
 * Character-sheet sections for Track K systems. Mount `SystemsSheet` inside
 * the Table's SheetPanel, under the existing sheet, for the selected actor.
 */
import { useState } from 'react';
import {
  AMMO_TYPES, ammoProblem, AWARENESS, awarenessProblem, getInjury, humanityStatus, profileOf, ROLES, treatmentDv, wieldProblem,
  type AmmoTypeId, type AwarenessKey, type Combatant,
} from '@cprc/rules-core';
import type { Intent, ProjectedActor, ViewState } from '@cprc/session';
import './systems.css';

export interface SystemsCtx {
  view: ViewState;
  isGm: boolean;
  mine: (id: string | null | undefined) => boolean;
  name: (id: string) => string;
  act: (i: Intent) => boolean;
}

const ROLE_NAME = Object.fromEntries(ROLES.map((r) => [r.id, `${r.name} (${r.ability})`]));

export function SystemsSheet({ c, actorId }: { c: SystemsCtx; actorId: string }) {
  const a = c.view.actors[actorId];
  const cb = a?.combatant;
  if (!a || !cb) return null;
  const can = c.isGm || c.mine(actorId);
  return (
    <>
      {cb.onFire ? (
        <section className="card sys-fire" role="status">
          <div className="ttl">On Fire</div>
          <p style={{ margin: '0 0 8px' }}>{cb.name} burns for {cb.onFire} HP at the start of each Turn until the flames are out.</p>
          {can && <button className="btn yellow" onClick={() => c.act({ type: 'extinguish', actorId })}>Put It Out (Action)</button>}
        </section>
      ) : null}
      <RoleSection c={c} a={a} cb={cb} can={can} />
      <HumanitySection cb={cb} />
      <SpeedwareSection c={c} cb={cb} actorId={actorId} can={can} />
      <GearSection cb={cb} a={a} />
      <AmmoSection c={c} a={a} cb={cb} can={can} />
      <InjurySection c={c} a={a} cb={cb} />
    </>
  );
}

function RoleSection({ c, a, cb, can }: { c: SystemsCtx; a: ProjectedActor; cb: Combatant; can: boolean }) {
  const role = cb.role;
  const [draft, setDraft] = useState<Partial<Record<AwarenessKey, number>> | null>(null);
  if (!role) return null;
  const alloc = draft ?? role.awareness ?? {};
  const spent = Object.values(alloc).reduce((s, v) => s + (v ?? 0), 0);
  const problem = draft ? awarenessProblem(draft, role.rank) : null;
  return (
    <section className="card">
      <div className="ttl">Role</div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>{ROLE_NAME[role.id] ?? role.id}</b><span className="h mono">Rank {role.rank}</span>
      </div>
      {role.id === 'solo' && (
        <div style={{ marginTop: 8 }}>
          <div className="dim h" style={{ fontSize: 12 }}>Combat Awareness · {spent} of {role.rank} Points</div>
          <div className="sys-aw">
            {AWARENESS.map((d) => (
              <label key={d.key} title={d.summary} className={draft && !d.allowed(alloc[d.key] ?? 0) ? 'bad' : ''}>
                <span>{d.name}</span>
                <input type="number" min={0} max={10} value={alloc[d.key] ?? 0} disabled={!can} aria-label={`${d.name} points`}
                  onChange={(e) => setDraft({ ...alloc, [d.key]: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })} />
              </label>
            ))}
          </div>
          {problem && <div className="warn" style={{ marginTop: 6 }}>{problem}</div>}
          {can && draft && (
            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn yellow" disabled={!!problem} onClick={() => { if (c.act({ type: 'setAwareness', actorId: a.id, allocation: draft })) setDraft(null); }}>
                {c.view.encounter.active ? 'Re-Allocate (Action)' : 'Save Allocation'}
              </button>
              <button className="btn ghost" onClick={() => setDraft(null)}>Cancel</button>
            </div>
          )}
        </div>
      )}
      {role.id === 'medtech' && role.medicine && (
        <div className="dim" style={{ fontSize: 13, marginTop: 6 }}>
          Surgery {role.medicine.surgery} · Pharmaceuticals {role.medicine.pharmaceuticals} · Cryosystem {role.medicine.cryosystem}
        </div>
      )}
      {role.notes && <p className="dim" style={{ fontSize: 13, margin: '6px 0 0' }}>{role.notes}</p>}
    </section>
  );
}

/** Round 4 U4: activated (Sandevistan-type) speedware: Activate button and its state. */
function SpeedwareSection({ c, cb, actorId, can }: { c: SystemsCtx; cb: Combatant; actorId: string; can: boolean }) {
  const piece = (cb.cyberware ?? []).find((i) => i.effects.some((e) => e.kind === 'speedware'));
  const eff = piece?.effects.find((e) => e.kind === 'speedware');
  if (!piece || !eff || eff.kind !== 'speedware') return null;
  const st = cb.speedware;
  return (
    <section className="card">
      <div className="ttl">Speedware</div>
      <p style={{ margin: '0 0 8px' }}>
        <b>{piece.name}</b>: {eff.mode === 'passive'
          ? `always on, +${eff.initiative} to Initiative.`
          : st?.active ? `active, ${st.roundsLeft} ${st.roundsLeft === 1 ? 'Round' : 'Rounds'} left (+${eff.initiative} to Initiative rolls made while on).`
            : st?.spent ? 'spent. It recharges with rest.' : `ready: +${eff.initiative} to Initiative rolls while active.`}
      </p>
      {eff.mode === 'activated' && can && !st?.active && !st?.spent && (
        <button className="btn yellow" onClick={() => c.act({ type: 'activateSpeedware', actorId })}>Activate Speedware (Action)</button>
      )}
    </section>
  );
}

function HumanitySection({ cb }: { cb: Combatant }) {
  const h = cb.humanity;
  if (!h && !cb.cyberware?.length) return null;
  const status = h ? humanityStatus(h) : 'stable';
  return (
    <section className="card">
      <div className="ttl">Cyberware</div>
      {h && (
        <div className={`sys-hum sys-hum-${status}`}>
          <div className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}><span>Humanity</span><span className="mono">{h.current} / {h.max}{h.base !== undefined && h.base !== h.max ? ` (of ${h.base})` : ''} · EMP {cb.stats.EMP}</span></div>
          <div className="bar"><i style={{ width: `${Math.max(0, Math.min(100, (h.current / Math.max(1, h.max)) * 100))}%` }} /></div>
          {status !== 'stable' && <div className="note">{status === 'cyberpsycho' ? 'Cyberpsychosis.' : status === 'critical' ? 'On the edge of cyberpsychosis.' : 'Humanity is running low.'}</div>}
        </div>
      )}
      <ul className="sys-list">
        {(cb.cyberware ?? []).map((i) => (
          <li key={i.id}><b>{i.name}</b>{i.slot ? <span className="dim"> · {i.slot}</span> : null}{i.notes ? <div className="dim" style={{ fontSize: 12 }}>{i.notes}</div> : null}</li>
        ))}
        {!cb.cyberware?.length && <li className="dim">None installed.</li>}
      </ul>
    </section>
  );
}

function GearSection({ cb, a }: { cb: Combatant; a: ProjectedActor }) {
  const smart = (a.weapons ?? []).filter((w) => w.smartgunLink || w.smart);
  if (!cb.gear?.length && !smart.length) return null;
  return (
    <section className="card">
      <div className="ttl">Gear</div>
      <ul className="sys-list">
        {smart.map((w) => (
          <li key={w.id}><b>{w.name}</b><span className="dim"> · {[w.smartgunLink ? 'Smartgun Link' : '', w.smart === 'built' ? 'Smart Weapon' : w.smart === 'rebuild' ? 'Smart Rebuild' : ''].filter(Boolean).join(' · ')}</span></li>
        ))}
        {(cb.gear ?? []).map((g, i) => (
          <li key={`g${i}`}><b>{g.name}</b>{g.qty > 1 ? <span className="mono"> × {g.qty}</span> : null}{g.notes ? <div className="dim" style={{ fontSize: 12 }}>{g.notes}</div> : null}</li>
        ))}
      </ul>
    </section>
  );
}

function AmmoSection({ c, a, cb, can }: { c: SystemsCtx; a: ProjectedActor; cb: Combatant; can: boolean }) {
  const guns = (a.weapons ?? []).filter((w) => !profileOf(w).melee);
  if (!guns.length) return null;
  return (
    <section className="card">
      <div className="ttl">Ammunition</div>
      {guns.map((w) => {
        // Round 3 P (#11): 2070s ammo only when the GM has the 2070s options on.
        const era = !!c.view.netrun?.quickhacks2070s;
        const options = AMMO_TYPES.filter((t) => !ammoProblem(w, t.id) && (era || !t.era2070s || t.id === w.ammoType));
        const cur = w.ammoType ?? 'basic';
        const def = AMMO_TYPES.find((t) => t.id === cur)!;
        const hands = wieldProblem(cb, w);
        return (
          <div key={w.id} className="sys-ammo">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b>{w.name}</b>
              <select disabled={!can} value={cur} aria-label={`Ammunition for ${w.name}`}
                onChange={(e) => c.act({ type: 'setAmmoType', actorId: a.id, weaponId: w.id, ammoType: e.target.value as AmmoTypeId })}>
                {options.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="dim" style={{ fontSize: 12 }}>{def.summary}{def.automated ? '' : ' (GM resolves)'}</div>
            {hands && <div className="warn" style={{ marginTop: 4 }}>{hands}</div>}
          </div>
        );
      })}
      {can && <div className="note">Changing ammunition reloads the weapon and uses your Action in combat.</div>}
    </section>
  );
}

/** Quick Fix and Treatment: the patient's sheet lists what can be done; a medic the viewer controls rolls it. */
function InjurySection({ c, a, cb }: { c: SystemsCtx; a: ProjectedActor; cb: Combatant }) {
  const medics = Object.values(c.view.actors).filter((m) => m.combatant && (c.isGm ? m.public.allegiance === 'party' || m.public.allegiance === 'ally' || m.id === a.id : c.mine(m.id)) && !m.public.conditions.dead);
  const [medicId, setMedicId] = useState<string | null>(null);
  if (!cb.criticalInjuries.length) return null;
  const medic = medics.find((m) => m.id === medicId) ?? medics.find((m) => c.mine(m.id)) ?? medics[0];
  return (
    <section className="card">
      <div className="ttl">Treat Injuries</div>
      {medics.length > 1 && (
        <label className="row" style={{ marginBottom: 6 }}><span className="dim">Medic</span>
          <select value={medic?.id ?? ''} onChange={(e) => setMedicId(e.target.value)}>{medics.map((m) => <option key={m.id} value={m.id}>{m.public.name}</option>)}</select>
        </label>
      )}
      <ul className="sys-list">
        {cb.criticalInjuries.map((inst, i) => {
          const def = getInjury(inst.injuryId);
          const options: { kind: 'quickFix' | 'treatment'; skill: string; dv: number }[] = [];
          if (!inst.quickFixed) for (const o of def.quickFix ?? []) options.push({ kind: 'quickFix', skill: o.skill, dv: o.dv });
          if (def.treatment !== 'quickFixIsPermanent') for (const o of def.treatment) options.push({ kind: 'treatment', skill: o.skill, dv: o.dv });
          return (
            <li key={`${inst.injuryId}-${i}`}>
              <b>{def.name}</b>{inst.quickFixed ? <span className="dim"> · Quick-Fixed</span> : null}
              <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {medic && options.map((o) => {
                  const ok = 'dv' in treatmentDv(inst.injuryId, o.kind, o.skill);
                  const lvl = medic.combatant!.skills[o.skill] ?? 0;
                  return (
                    <button key={`${o.kind}-${o.skill}`} className="btn sm" disabled={!ok || (!c.isGm && !c.mine(medic.id))}
                      title={`${medic.public.name}: TECH + ${o.skill} (${lvl}) vs DV ${o.dv}`}
                      onClick={() => c.act({ type: 'treatInjury', medicId: medic.id, targetId: a.id, injuryIndex: i, kind: o.kind, skill: o.skill })}>
                      {o.kind === 'quickFix' ? 'Quick Fix' : 'Treat'}: {o.skill} DV {o.dv}
                    </button>
                  );
                })}
                {!options.length && <span className="dim" style={{ fontSize: 12 }}>{def.quickFix ? 'Quick-Fixed; a Quick Fix is the whole treatment.' : 'No field treatment.'}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
