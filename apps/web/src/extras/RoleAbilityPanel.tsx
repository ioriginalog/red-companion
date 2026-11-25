/**
 * Role Ability tools for one character (Rockerboy, Lawman, Fixer, Media, Exec,
 * Nomad, Tech) plus Reputation. Mount in the character sheet (SheetPanel),
 * under SystemsSheet. Solo, Netrunner and Medtech live in SystemsSheet / NET.
 */
import { useState } from 'react';
import {
  BACKUP_TIERS, backupTier, favorTier, fieldExpertiseMinutes, IMPACT_DV, IMPACT_MIN_RANK, MAKER_DV, MAKER_TIME, maxTeam, motorpoolFor,
  MOTO_SKILLS, operatorPerks, PRICE_CATEGORIES, PRICE_LABEL, ROLES, TEAM_KIND_LABEL, TEAM_KINDS, TECH_SKILLS, believabilityFor,
  AUDIENCE_BY_RANK, type Audience, type PriceCategory, type TeamMemberKind,
} from '@cprc/rules-core';
import type { ExtraOp } from '@cprc/session';
import type { ExtrasCtx } from './CombatExtrasPanel.js';
import './extras.css';

const send = (c: ExtrasCtx, op: ExtraOp) => c.act({ type: 'extra', op });
const AUDIENCES: [Audience, string][] = [['single', 'One Person'], ['small', 'Small Group'], ['huge', 'Huge Crowd']];

export function RoleAbilityPanel({ c, actorId }: { c: ExtrasCtx; actorId: string }) {
  const a = c.view.actors[actorId];
  const cb = a?.combatant;
  const [dv, setDv] = useState(15);
  const [evidence, setEvidence] = useState(0);
  const [seller, setSeller] = useState('');
  const [price, setPrice] = useState<PriceCategory>('premium');
  const [spec, setSpec] = useState<'upgrade' | 'fabrication' | 'invention'>('fabrication');
  const [skill, setSkill] = useState<string>(TECH_SKILLS[0]);
  const [item, setItem] = useState('');
  const [recruitName, setRecruitName] = useState('');
  const [recruitKind, setRecruitKind] = useState<TeamMemberKind>('bodyguard');
  const [vehicle, setVehicle] = useState('');
  const [rep, setRep] = useState<string>('');
  if (!a || !cb) return null;
  const can = c.isGm || c.mine(actorId);
  const role = cb.role;
  const def = role ? ROLES.find((r) => r.id === role.id) : undefined;
  const reputation = cb.reputation ?? 0;

  return (
    <section className="card">
      <div className="ttl">{def && !['solo', 'netrunner', 'medtech'].includes(def.id) ? def.ability : 'Standing'}</div>
      <div className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
        <span>Reputation <b className="mono">{reputation}</b></span>
        {c.isGm && (
          <span className="row" style={{ gap: 4 }}>
            <input aria-label="Set Reputation" type="number" min={0} max={10} value={rep} placeholder={String(reputation)} onChange={(e) => setRep(e.target.value)} style={{ width: 56, padding: '3px 6px' }} />
            <button className="btn sm" disabled={rep === ''} onClick={() => { send(c, { kind: 'setReputation', actorId, value: Number(rep) }); setRep(''); }}>Set</button>
          </span>
        )}
      </div>

      {role?.id === 'rockerboy' && (
        <>
          <div className="ex-sub">Charismatic Impact {role.rank}</div>
          <div className="ex-grid">
            {AUDIENCES.map(([k, label]) => (
              <button key={k} className="btn" disabled={!can || role.rank < IMPACT_MIN_RANK[k]} onClick={() => send(c, { kind: 'impact', actorId, audience: k })}
                title={`DV ${IMPACT_DV[k]}. Fans will do ${favorTier(role.rank, k)}.`}>
                {label} · DV {IMPACT_DV[k]}
              </button>
            ))}
          </div>
          <p className="dim" style={{ fontSize: 12, margin: '6px 0 0' }}>A failed appeal can’t be repeated to the same fans for a week.</p>
        </>
      )}

      {role?.id === 'lawman' && (
        <>
          <div className="ex-sub">Backup {role.rank}</div>
          <p style={{ fontSize: 13, margin: '0 0 6px' }}>Roll 1d10 at or under {role.rank} to get {BACKUP_TIERS[backupTier(role.rank)]!.name.toLowerCase()} in 1d6 Rounds.</p>
          <button className="btn yellow" disabled={!can} onClick={() => send(c, { kind: 'backup', actorId })}>Call Backup (Action)</button>
        </>
      )}

      {role?.id === 'fixer' && (
        <>
          <div className="ex-sub">Operator {role.rank}</div>
          <ul className="ex-list">{operatorPerks(role.rank).map((p) => <li key={p}>{p}</li>)}</ul>
          <div className="row ex-form" style={{ gap: 6, marginTop: 6 }}>
            {c.isGm && <input aria-label="Seller total" type="number" placeholder="Seller’s total" value={seller} onChange={(e) => setSeller(e.target.value)} />}
            <button className="btn" disabled={!can} onClick={() => send(c, { kind: 'haggle', actorId, ...(c.isGm && seller !== '' ? { sellerTotal: Number(seller) } : {}) })}>Haggle</button>
          </div>
        </>
      )}

      {role?.id === 'media' && (
        <>
          <div className="ex-sub">Credibility {role.rank}</div>
          <p style={{ fontSize: 13, margin: '0 0 6px' }}>Reach: {AUDIENCE_BY_RANK[role.rank - 1]}. Believed on 1d10 ≤ {believabilityFor(role.rank)}.</p>
          <div className="ex-form">
            <div className="row" style={{ gap: 6 }}>
              <label>DV <input type="number" min={1} max={40} value={dv} onChange={(e) => setDv(Number(e.target.value))} /></label>
              <label>Evidence <select value={evidence} onChange={(e) => setEvidence(Number(e.target.value))}>{[0, 1, 2, 3].map((n) => <option key={n} value={n}>+{n}</option>)}</select></label>
            </div>
            <div className="ex-grid">
              <button className="btn" disabled={!can} onClick={() => send(c, { kind: 'publish', actorId, dv, evidence })}>Publish</button>
              <button className="btn" disabled={!can} onClick={() => send(c, { kind: 'rumor', actorId, dv })}>Chase a Rumor</button>
            </div>
          </div>
        </>
      )}

      {role?.id === 'exec' && (
        <>
          <div className="ex-sub">Teamwork {role.rank} · {(role.team ?? []).length} of {maxTeam(role.rank)}</div>
          <ul className="ex-list">
            {(role.team ?? []).map((m, i) => (
              <li key={`${m.name}-${i}`} className="row" style={{ justifyContent: 'space-between' }}>
                <span>{m.name} · {TEAM_KIND_LABEL[m.kind]} · Loyalty <b className="mono">{m.loyalty}</b></span>
                {c.isGm && <button className="btn sm" onClick={() => send(c, { kind: 'loyalty', actorId, member: i })} title="GM rolls 1d6 in secret; at or above Loyalty they may refuse, botch or betray.">Risky Order</button>}
              </li>
            ))}
          </ul>
          {c.isGm && (role.team ?? []).length < maxTeam(role.rank) && (
            <div className="row ex-form" style={{ gap: 6, marginTop: 6 }}>
              <input aria-label="New member name" placeholder="Name" value={recruitName} onChange={(e) => setRecruitName(e.target.value)} />
              <select aria-label="Member kind" value={recruitKind} onChange={(e) => setRecruitKind(e.target.value as TeamMemberKind)}>
                {TEAM_KINDS.map((k) => <option key={k} value={k}>{TEAM_KIND_LABEL[k]}</option>)}
              </select>
              <button className="btn sm" disabled={!recruitName.trim()} onClick={() => { send(c, { kind: 'recruit', actorId, name: recruitName, memberKind: recruitKind }); setRecruitName(''); }}>Recruit</button>
            </div>
          )}
        </>
      )}

      {role?.id === 'nomad' && (
        <>
          <div className="ex-sub">Moto {role.rank}</div>
          <p style={{ fontSize: 13, margin: '0 0 6px' }}>+{role.rank} to {MOTO_SKILLS.join(', ')}.</p>
          <div className="dim" style={{ fontSize: 12 }}>Family motorpool: {motorpoolFor(role.rank).join(' · ')}</div>
          <ul className="ex-list" style={{ marginTop: 6 }}>
            {(role.moto?.vehicles ?? []).map((v) => <li key={v}>{v}</li>)}
            {(role.moto?.upgrades ?? []).map((u) => <li key={u} className="dim">Upgrade: {u}</li>)}
          </ul>
          {c.isGm && (
            <div className="row ex-form" style={{ gap: 6, marginTop: 6 }}>
              <input aria-label="Add a Family vehicle" placeholder="Add a vehicle" value={vehicle} onChange={(e) => setVehicle(e.target.value)} />
              <button className="btn sm" disabled={!vehicle.trim()} onClick={() => {
                send(c, { kind: 'setRoleExtras', actorId, moto: { vehicles: [...(role.moto?.vehicles ?? []), vehicle.trim()], upgrades: role.moto?.upgrades ?? [] } });
                setVehicle('');
              }}>Add</button>
            </div>
          )}
        </>
      )}

      {role?.id === 'tech' && (
        <>
          <div className="ex-sub">Maker {role.rank}</div>
          <p style={{ fontSize: 13, margin: '0 0 6px' }}>
            Field {role.maker?.field ?? 0} · Upgrade {role.maker?.upgrade ?? 0} · Fabrication {role.maker?.fabrication ?? 0} · Invention {role.maker?.invention ?? 0}
          </p>
          <div className="ex-form">
            <input aria-label="Item" placeholder="Item (e.g. a silenced pistol)" value={item} onChange={(e) => setItem(e.target.value)} />
            <div className="row" style={{ gap: 6 }}>
              <select aria-label="Specialty" value={spec} onChange={(e) => setSpec(e.target.value as typeof spec)}>
                <option value="upgrade">Upgrade</option><option value="fabrication">Fabrication</option><option value="invention">Invention</option>
              </select>
              <select aria-label="Price category" value={price} onChange={(e) => setPrice(e.target.value as PriceCategory)}>
                {PRICE_CATEGORIES.map((p) => <option key={p} value={p}>{PRICE_LABEL[p]} · DV {MAKER_DV[p]}</option>)}
              </select>
            </div>
            <select aria-label="Tech skill" value={skill} onChange={(e) => setSkill(e.target.value)}>
              {TECH_SKILLS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="dim" style={{ fontSize: 12 }}>Takes {MAKER_TIME[spec === 'invention' && PRICE_CATEGORIES.indexOf(price) < 3 ? 'expensive' : price]}.</div>
            <div className="ex-grid">
              <button className="btn" disabled={!can || !item.trim()} onClick={() => send(c, { kind: 'maker', actorId, specialty: spec, skill, price, item })}>Roll Maker</button>
              <button className="btn" disabled={!can || !item.trim() || fieldExpertiseMinutes(cb) === 0} onClick={() => send(c, { kind: 'juryRig', actorId, item })}
                title={`Works perfectly for ${fieldExpertiseMinutes(cb)} minutes.`}>Jury-Rig</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
