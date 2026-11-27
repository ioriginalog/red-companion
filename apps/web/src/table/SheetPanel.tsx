import { useState } from 'react';
import {
  currentDeathSavePenalty, effectiveSP, effectiveStat, formLevel, knownForms, SPECIAL_MOVES, getInjury, profileOf, unarmedDamageDice, woundState,
  type Combatant,
} from '@cprc/rules-core';
import type { StatKeyName } from '@cprc/session';
import { STATS } from './commands.js';
import { linkedStat } from './skills.js';
import { NotesAndGear } from './SheetEdit.js';
import { ALLEGIANCE, WOUND, type TableCtx } from './ctx.js';
import { Portrait } from './panels.js';
import { RoleAbilityPanel, SystemsSheet } from './lazy.js';

const STAT_NAMES: Record<StatKeyName, string> = {
  INT: 'Intelligence', REF: 'Reflexes', DEX: 'Dexterity', TECH: 'Technique', COOL: 'Cool', WILL: 'Willpower',
  LUCK: 'Luck', MOVE: 'Movement', BODY: 'Body', EMP: 'Empathy',
};

/** Characters this viewer may open: own ones (players), any with a full sheet (GM / revealed PCs). */
export function sheetCandidates(c: TableCtx): string[] {
  return Object.values(c.view.actors).filter((a) => a.combatant && (c.isGm || c.mine(a.id) || a.public.allegiance === 'party')).map((a) => a.id);
}

export function SheetPanel({ c, preferId }: { c: TableCtx; preferId: string | null }) {
  const ids = sheetCandidates(c);
  const [picked, setPicked] = useState<string | null>(null);
  const id = (picked && ids.includes(picked) ? picked : null) ?? (preferId && ids.includes(preferId) ? preferId : null) ?? ids.find((x) => c.mine(x)) ?? ids[0] ?? null;
  const a = id ? c.view.actors[id] : undefined;
  if (!a?.combatant) return <section className="card"><div className="ttl">Character Sheet</div><p className="dim">No character sheet to show yet.</p></section>;
  const cb: Combatant = a.combatant;
  const canRoll = c.isGm || c.mine(a.id);
  const roll = (label: string, stat?: StatKeyName, skill?: string) => canRoll && c.act({
    type: 'rollCheck', actorId: a.id, label, ...(stat ? { stat } : {}), ...(skill ? { skill } : {}),
  });
  const forms = knownForms(cb);
  const skills = Object.entries(cb.skills).filter(([, v]) => v > 0).sort(([x], [y]) => x.localeCompare(y));
  const dsp = currentDeathSavePenalty(cb);

  return (
    <>
      {ids.length > 1 && (
        <div className="sheet-pick" role="tablist" aria-label="Characters">
          {ids.map((x) => {
            const ax = c.view.actors[x]!;
            return <button key={x} role="tab" aria-selected={x === id} className={`mode${x === id ? ' sel' : ''}`} onClick={() => setPicked(x)}>{ax.public.name}</button>;
          })}
        </div>
      )}
      <section className="card">
        <div className="row">
          <Portrait a={a} big />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="h name-lg">{a.public.name}</div>
            <div className="dim h sub">{ALLEGIANCE[a.public.allegiance]} · {WOUND[woundState(cb.hp)]}</div>
            <div className="row mono hp-row"><span>HP</span><span>{cb.hp.current}/{cb.hp.max}</span></div>
            <div className={`bar${woundState(cb.hp) !== 'unhurt' ? ' hurt' : ''}`}><i style={{ width: `${Math.max(0, (cb.hp.current / cb.hp.max) * 100)}%` }} /></div>
            <div className="sheet-tags">
              <span className="tag">Death Save Penalty <b className="mono">{dsp}</b></span>
              <span className="tag">MOVE <b className="mono">{effectiveStat(cb, 'MOVE')}</b> ({effectiveStat(cb, 'MOVE') * 2} m)</span>
              {Object.entries(cb.conditions).filter(([, v]) => v).map(([k]) => <span key={k} className="tag warn-tag">{k[0]!.toUpperCase() + k.slice(1)}</span>)}
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="ttl">STATs</div>
        <div className="stats">
          {STATS.map((k) => {
            const raw = cb.stats[k];
            const eff = effectiveStat(cb, k);
            return (
              <button key={k} className="stat" disabled={!canRoll} onClick={() => roll(k, k)} title={`${STAT_NAMES[k]}: roll ${k} + 1d10.`}>
                <span className="k">{k}</span>
                <span className="v mono">{eff}</span>
                {eff !== raw && <span className="dim tiny">base {raw}</span>}
              </button>
            );
          })}
        </div>
      </section>

      <section className="card">
        <div className="ttl">Skills</div>
        {skills.length === 0 ? <p className="dim">No skills recorded.</p> : (
          <div className="skills">
            {skills.map(([sk, lvl]) => {
              const st = linkedStat(sk);
              const total = (st ? effectiveStat(cb, st) : 0) + lvl;
              return (
                <button key={sk} className="skill" disabled={!canRoll} onClick={() => roll(st ? `${st} + ${sk}` : sk, st, sk)} title={`Roll ${st ? `${st} + ` : ''}${sk} + 1d10.`}>
                  <span>{sk}</span><span className="dim small">{st ?? '—'}</span><span className="mono lvl">{lvl}</span><span className="mono base">{total}</span>
                </button>
              );
            })}
          </div>
        )}
        {forms.length > 0 && (
          <div className="ma-forms" style={{ marginTop: 8 }}>
            {forms.map((f) => {
              const moves = SPECIAL_MOVES.filter((mv) => mv.form === f);
              return (
                <div key={f} className="small">
                  <b>Martial Arts: {f} {formLevel(cb, f)}</b>
                  {moves.length > 0 && <span className="dim"> · Special Moves: {moves.map((mv) => mv.name).join(', ')}</span>}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="card">
        <div className="ttl">Weapons</div>
        <div className="sheet-list">
          {(a.weapons ?? []).map((w) => {
            const pf = profileOf(w);
            return (
              <div key={w.id} className="sheet-row">
                <div><b className="h">{w.name}</b><div className="dim small">{pf.displayName} · {w.damageDiceOverride ?? pf.damageDice}d6 · ROF {w.rofOverride ?? pf.rof} · {pf.skill}</div></div>
                {w.ammo && <span className={`mono ammo${w.ammo.loaded === 0 ? ' empty' : ''}`}>{w.ammo.loaded}/{w.ammo.capacity}</span>}
                {w.ammo && canRoll && <button className="btn sm" disabled={w.ammo.loaded === w.ammo.capacity} onClick={() => c.act({ type: 'reload', actorId: a.id, weaponId: w.id })}>Reload</button>}
              </div>
            );
          })}
          <div className="sheet-row"><div><b className="h">Brawling</b><div className="dim small">{unarmedDamageDice(cb.stats.BODY)}d6 by BODY · two attacks</div></div></div>
        </div>
      </section>

      <section className="card">
        <div className="ttl">Armor</div>
        {cb.armor.length === 0 ? <p className="dim">No armor.</p> : (
          <div className="sheet-list">
            {(['head', 'body'] as const).map((loc) => (
              <div key={loc} className="armor-loc">
                <div className="row" style={{ justifyContent: 'space-between' }}><span className="h">{loc === 'head' ? 'Head' : 'Body'}</span><span className="mono">SP {effectiveSP(cb, loc)}</span></div>
                {cb.armor.filter((p) => p.location === loc).map((p) => (
                  <div key={p.id} className="armor-piece">
                    <span className="small">{p.name}{p.penalty ? ` (${p.penalty})` : ''}</span>
                    <div className="sp-bar" title={`${p.currentSP} of ${p.maxSP}`}><i style={{ width: `${(p.currentSP / Math.max(1, p.maxSP)) * 100}%` }} /></div>
                    <span className="mono small">{p.currentSP}/{p.maxSP}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>

      <NotesAndGear key={a.id} c={c} a={a} canEdit={canRoll} />

      <section className="card">
        <div className="ttl">Critical Injuries</div>
        {cb.criticalInjuries.length === 0 ? <p className="dim">None.</p> : (
          <div className="sheet-list">
            {cb.criticalInjuries.map((ci, i) => {
              const d = getInjury(ci.injuryId);
              return (
                <div key={`${ci.injuryId}-${i}`} className="injury">
                  <div className="row" style={{ justifyContent: 'space-between' }}><b className="h">{d.name}</b>{ci.quickFixed && <span className="tag good-tag">Quick Fixed</span>}</div>
                  <div className="small">{d.summary}</div>
                  <div className="dim small">
                    Quick Fix: {d.quickFix ? d.quickFix.map((o) => `${o.skill} DV ${o.dv}`).join(' or ') : 'none'} · Treatment: {d.treatment === 'quickFixIsPermanent' ? 'Quick Fix is permanent' : d.treatment.map((o) => `${o.skill} DV ${o.dv}`).join(' or ')}
                  </div>
                  {d.source.verification === 'secondary' && d.table === 'head' && <div className="dim tiny">Head table row: unverified against the book.</div>}
                </div>
              );
            })}
          </div>
        )}
      </section>
      <SystemsSheet c={c} actorId={a.id} />
      <RoleAbilityPanel c={c} actorId={a.id} />{/* */}
    </>
  );
}
