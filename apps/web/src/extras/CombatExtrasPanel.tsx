/**
 * Grab / Grapple / Choke / Throw / Escape, Get Up (with Martial Arts Recovery),
 * Special Moves and Facedowns for the acting character. Mount under the
 * Table's attack card (CombatPanel), passing the acting and target ids.
 */
import { useState } from 'react';
import {
  effectiveStat, formLevel, GRAPPLE_PENALTY, gridDistance, knownForms, moveRequirementProblem, skillLevel, SPECIAL_MOVES,
  standingModifiers, type Combatant,
} from '@cprc/rules-core';
import type { ExtraOp, Intent, ViewState } from '@cprc/session';
import { chanceToWinContest, pct } from '../odds.js';
import './extras.css';

export interface ExtrasCtx {
  view: ViewState;
  isGm: boolean;
  mine: (id: string | null | undefined) => boolean;
  name: (id: string) => string;
  act: (i: Intent) => boolean;
}

const send = (c: ExtrasCtx, op: ExtraOp) => c.act({ type: 'extra', op });
const brawl = (cb: Combatant, grappling: boolean) =>
  effectiveStat(cb, 'DEX') + skillLevel(cb, 'Brawling') + standingModifiers(cb, 'other').reduce((s, m) => s + m.value, 0) + (grappling ? GRAPPLE_PENALTY : 0);

export function CombatExtrasPanel({ c, actingId, targetId, canAct }: { c: ExtrasCtx; actingId: string | null; targetId: string | null; canAct: boolean }) {
  const { view } = c;
  const [form, setForm] = useState('');
  const [aimHead, setAimHead] = useState(false);
  const [itemId, setItemId] = useState('');
  const x = view.extras;
  const a = actingId ? view.actors[actingId] : undefined;
  const t = targetId && targetId !== actingId ? view.actors[targetId] : undefined;
  const ac = a?.combatant;
  const myFacedowns = (x?.facedowns ?? []).filter((f) => c.isGm || c.mine(f.loserId) || c.mine(f.winnerId));
  if (!a || !ac) {
    return myFacedowns.length ? <FacedownCard c={c} /> : null;
  }

  const holding = x?.grapples.find((g) => g.holderId === a.id);
  const heldBy = x?.grapples.find((g) => g.heldId === a.id);
  const tokens = view.map?.tokens ?? {};
  const near = !!t && (!tokens[a.id] || !tokens[t.id] || gridDistance(tokens[a.id]!, tokens[t.id]!) <= 1);
  const forms = knownForms(ac);
  const pickedForm = forms.includes(form) ? form : forms[0] ?? '';
  const grabOdds = t?.combatant ? chanceToWinContest(brawl(ac, !!holding || !!heldBy), brawl(t.combatant, false)) : null;
  const escapeOdds = heldBy && view.actors[heldBy.holderId]?.combatant
    ? chanceToWinContest(brawl(ac, true) + (heldBy.ironGrip ? -2 : 0), brawl(view.actors[heldBy.holderId]!.combatant!, true))
    : null;
  const usable = canAct && !ac.conditions.unconscious && !ac.conditions.dead;

  return (
    <>
      <section className="card">
        <div className="ttl">Close Quarters</div>
        {(holding || heldBy) && (
          <div className="ex-status" role="status">
            {holding && <span><span className="ex-chip">Holding</span> {c.name(holding.heldId)}{holding.ironGrip ? ' (Iron Grip)' : ''}{holding.chokes ? ` · Choked ${holding.chokes}×` : ''}</span>}
            {heldBy && <span><span className="ex-chip">Held By</span> {c.name(heldBy.holderId)}{heldBy.ironGrip ? ' (Iron Grip: −2 to escape, no ranged attacks)' : ''}</span>}
            <span className="dim">Both sides take −2 to all Actions and can’t use two-handed weapons.</span>
          </div>
        )}
        {!usable ? <p className="dim" style={{ margin: 0 }}>Nothing to do here right now.</p> : (
          <div className="ex-grid">
            {holding ? (
              <>
                <button className="btn" onClick={() => send(c, { kind: 'choke', actorId: a.id })} title="Action: BODY damage to HP, never below 1; three Rounds running knocks them out.">Choke</button>
                <button className="btn" onClick={() => send(c, { kind: 'throw', actorId: a.id })} title="Action: BODY damage to HP; they land Prone and the hold ends.">Throw</button>
                <button className="btn ghost" onClick={() => send(c, { kind: 'release', actorId: a.id })}>Let Go</button>
              </>
            ) : heldBy ? (
              <button className="btn yellow" onClick={() => send(c, { kind: 'escape', actorId: a.id, heldId: a.id })}>
                Break Free{escapeOdds !== null ? ` · ${pct(escapeOdds)}` : ''}
              </button>
            ) : (
              <>
                <button className="btn" disabled={!t || !near} title={!t ? 'Pick a target.' : !near ? 'Needs an adjacent target.' : 'Action: opposed DEX + Brawling.'}
                  onClick={() => t && send(c, { kind: 'grab', actorId: a.id, targetId: t.id, choice: 'grapple' })}>
                  Grab{grabOdds !== null ? ` · ${pct(grabOdds)}` : ''}
                </button>
                <button className="btn" disabled={!t || !near} title="Action: opposed DEX + Brawling to take something they hold."
                  onClick={() => t && send(c, { kind: 'grab', actorId: a.id, targetId: t.id, choice: 'takeItem', ...(itemId ? { weaponId: itemId } : {}) })}>
                  Snatch Item
                </button>
              </>
            )}
            {!heldBy && x?.grapples.some((g) => t && g.heldId === t.id && g.holderId !== a.id) && near && t && (
              <button className="btn" onClick={() => send(c, { kind: 'escape', actorId: a.id, heldId: t.id })}>Pull {t.public.name} Free</button>
            )}
            {ac.conditions.prone && (
              <button className="btn yellow" onClick={() => send(c, { kind: 'getUp', actorId: a.id, ...(pickedForm ? { form: pickedForm } : {}) })}
                title={pickedForm ? `${pickedForm} Recovery: beat DV 13 to stand without spending the Action.` : 'Uses the Action.'}>
                Get Up{pickedForm ? ' (Recovery)' : ''}
              </button>
            )}
            {t && (
              <button className="btn" onClick={() => send(c, { kind: 'facedown', actorId: a.id, targetId: t.id })} title="COOL + Reputation + 1d10 each. The loser backs down or fights on at −2 against the winner.">
                Facedown
              </button>
            )}
          </div>
        )}
        {usable && c.isGm && t?.weapons?.length && !holding && !heldBy ? (
          <label className="ex-form" style={{ marginTop: 8 }}>
            <span className="dim" style={{ fontSize: 12 }}>Item to snatch (GM)</span>
            <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">GM decides later</option>
              {t.weapons.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
        ) : null}
      </section>

      {usable && forms.length > 0 && (
        <section className="card">
          <div className="ttl">Martial Arts</div>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <select aria-label="Martial Arts Form" value={pickedForm} onChange={(e) => setForm(e.target.value)}>
              {forms.map((f) => <option key={f} value={f}>{f} {formLevel(ac, f)}</option>)}
            </select>
            <label className="row" style={{ gap: 4, fontSize: 13 }}><input type="checkbox" checked={aimHead} onChange={(e) => setAimHead(e.target.checked)} />Aim at the Head (−8)</label>
          </div>
          {SPECIAL_MOVES.filter((m) => m.form === pickedForm).map((m) => {
            const why = moveRequirementProblem(ac, m) ?? (m.kind === 'attack' && !t ? 'Pick a target.' : null);
            return (
              <div className="ex-move" key={m.id}>
                <span className="nm">{m.name}</span>
                <button className="btn sm" disabled={!!why} onClick={() => send(c, {
                  kind: 'specialMove', actorId: a.id, moveId: m.id, ...(t ? { targetId: t.id } : {}),
                  ...(aimHead && m.effect.kind === 'strikeInjury' ? { aimHead: true } : {}), ...(itemId ? { weaponId: itemId } : {}),
                })}>
                  {m.kind === 'attack' ? 'Strike' : 'Attempt'}
                </button>
                <span className="sum"><span className="ex-tag">{m.kind === 'triggered' ? 'Free, Once per Turn' : m.kind === 'action' ? 'Action' : m.kind === 'attack' ? 'Replaces Both Attacks' : 'GM Applies'}</span> {m.summary}</span>
                {why && <span className="why">{why}</span>}
              </div>
            );
          })}
          {SPECIAL_MOVES.every((m) => m.form !== pickedForm) && <p className="dim" style={{ margin: 0 }}>No Special Moves are listed for {pickedForm}. The GM can still rule on one.</p>}
        </section>
      )}

      {myFacedowns.length > 0 && <FacedownCard c={c} />}
    </>
  );
}

function FacedownCard({ c }: { c: ExtrasCtx }) {
  const list = (c.view.extras?.facedowns ?? []).filter((f) => c.isGm || c.mine(f.loserId) || c.mine(f.winnerId));
  return (
    <section className="card prompt">
      <div className="ttl">Facedowns</div>
      <ul className="ex-list">
        {list.map((f) => (
          <li key={f.id}>
            <div><b>{c.name(f.winnerId)}</b> stared down <b>{c.name(f.loserId)}</b>{f.status === 'fighting' ? ' (fighting on at −2)' : ''}.</div>
            <div className="row" style={{ gap: 6, marginTop: 4 }}>
              {f.status === 'choosing' && (c.isGm || c.mine(f.loserId)) && <>
                <button className="btn sm" onClick={() => send(c, { kind: 'facedownChoice', facedownId: f.id, choice: 'backDown' })}>Back Down</button>
                <button className="btn sm" onClick={() => send(c, { kind: 'facedownChoice', facedownId: f.id, choice: 'fight' })}>Fight On at −2</button>
              </>}
              {(c.isGm || c.mine(f.winnerId)) && <button className="btn sm ghost" onClick={() => send(c, { kind: 'endFacedown', facedownId: f.id })}>End</button>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
