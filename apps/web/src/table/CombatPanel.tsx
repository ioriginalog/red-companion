import { Fragment } from 'react';
import { profileOf, woundState, type Weapon } from '@cprc/rules-core';
import type { TurnUsage } from '@cprc/session';
import { pct } from '../odds.js';
import { nearestTarget, type Attack, type AttackMode } from '../tactics.js';
import type { MapMode } from '../MapView.js';
import { areaKindFor, canSuppress, suppressiveTargets } from './area.js';
import { ALLEGIANCE, WOUND, type TableCtx } from './ctx.js';
import { Portrait } from './panels.js';

interface Props {
  c: TableCtx;
  actingId: string | null;
  currentId: string | null;
  canAct: boolean;
  weapon: Weapon | undefined;
  setWeaponId: (id: string) => void;
  mode: AttackMode;
  setMode: (m: AttackMode) => void;
  targetId: string | null;
  setTargetId: (id: string | null) => void;
  attack: Attack | null;
  usage: TurnUsage | null;
  mapMode: MapMode;
  setMapMode: (m: MapMode) => void;
  setHighlight: (ids: string[]) => void;
  onFire: () => void;
  /** This player's characters, for picking one when no Turn is active. */
  ownIds?: string[];
  onSelectOwn?: (id: string) => void;
}

export function fireBlocked(p: Pick<Props, 'attack' | 'usage' | 'weapon'>, pending: boolean): boolean {
  const { attack, usage, weapon } = p;
  if (!attack?.ok || pending) return true;
  if (usage?.actionUsed && !(usage.attackWith === weapon?.id && usage.attacks < attack.perAction)) return true;
  return false;
}

export function CombatPanel(p: Props) {
  const { c, actingId, canAct, weapon, attack, usage } = p;
  const { view } = c;
  const a0 = actingId ? view.actors[actingId] : undefined;
  const acting = a0 && !a0.placeholder ? a0 : undefined;
  const t0 = p.targetId ? view.actors[p.targetId] : undefined;
  const target = t0 && !t0.placeholder ? t0 : undefined;
  const hp = acting?.combatant?.hp;
  const weapons = acting?.weapons ?? [];
  const area = areaKindFor(weapon);
  const suppress = canAct && actingId && weapon && canSuppress(weapon) ? suppressiveTargets(view, actingId, weapon) : null;
  const actionGone = !!usage?.actionUsed;

  return (
    <>
      {acting ? (
        <section className="card">
          <div className="ttl">{p.currentId === actingId ? 'Acting Now' : 'Selected'}</div>
          <div className="row">
            <Portrait a={acting} big active={p.currentId === actingId} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="h name-lg">{acting.public.name}</div>
              <div className="dim h sub">{ALLEGIANCE[acting.public.allegiance]} · {WOUND[acting.public.woundState]}</div>
              {hp && <>
                <div className="row mono hp-row"><span>HP</span><span>{hp.current}/{hp.max}</span></div>
                <div className={`bar${woundState(hp) !== 'unhurt' ? ' hurt' : ''}`}><i style={{ width: `${Math.max(0, (hp.current / hp.max) * 100)}%` }} /></div>
              </>}
              {!canAct && <div className="dim note">{acting.controller === 'gm' ? 'The GM is acting.' : 'Another player is acting.'}</div>}
            </div>
          </div>
        </section>
      ) : (
        p.currentId
          ? <section className="card"><div className="ttl">Acting Now</div><p className="dim">An unknown contact is acting. Wait for your Turn.</p></section>
          : <OwnPicker c={c} ownIds={p.ownIds ?? []} onSelect={p.onSelectOwn} />
      )}

      {canAct && weapons.length > 0 && (
        <section className="card">
          <div className="ttl">Equipped Weapon</div>
          <div className="weapons">
            {weapons.map((w) => (
              <button key={w.id} className={`weapon${w.id === weapon?.id ? ' sel' : ''}`} onClick={() => { p.setWeaponId(w.id); p.setMode('single'); }}>
                <span><span className="wn">{w.name}</span><br /><span className="dim small">{profileOf(w).displayName} · ROF {w.rofOverride ?? profileOf(w).rof}</span></span>
                {w.ammo && <span className={`h mono ammo${w.ammo.loaded === 0 ? ' empty' : ''}`}>{w.ammo.loaded}<span className="dim">/{w.ammo.capacity}</span></span>}
              </button>
            ))}
          </div>
          {weapon && (
            <div className="modes" role="radiogroup" aria-label="Attack mode">
              {([['single', 'Single'], ...(profileOf(weapon).autofire ? [['autofire', 'Autofire']] : []), ['aimHead', 'Aim: Head'], ['aimLeg', 'Aim: Leg'], ['aimHeld', 'Aim: Held Item']] as [AttackMode, string][]).map(([m, label]) => (
                <button key={m} role="radio" aria-checked={p.mode === m} className={`mode${p.mode === m ? ' sel' : ''}`} onClick={() => p.setMode(m)}>{label}</button>
              ))}
            </div>
          )}
          {(area || suppress) && (
            <div className="modes">
              {area && (
                <button className={`mode${p.mapMode === 'area' ? ' sel' : ''}`} disabled={actionGone} onClick={() => p.setMapMode(p.mapMode === 'area' ? 'move' : 'area')}
                  title={area === 'blast' ? 'Aim a 10 × 10 m/yds blast' : 'Fire a shell: 6 m/yds cone'}>
                  {area === 'blast' ? 'Blast Template' : 'Shell Template'}
                </button>
              )}
              {suppress && (
                <button className="mode" disabled={actionGone || suppress.length === 0}
                  onMouseEnter={() => p.setHighlight(suppress)} onMouseLeave={() => p.setHighlight([])} onFocus={() => p.setHighlight(suppress)} onBlur={() => p.setHighlight([])}
                  onClick={() => { p.setHighlight([]); c.act({ type: 'suppressiveFire', attackerId: actingId!, weaponId: weapon!.id }); }}>
                  Suppressive Fire ({suppress.length})
                </button>
              )}
            </div>
          )}
          {p.mapMode === 'area' && <p className="dim small" style={{ marginTop: 8 }}>Tap a square to fire. Orange squares are hit; hatched squares are shielded by cover.</p>}
        </section>
      )}

      {canAct && (
        <section className="card">
          <div className="ttl row" style={{ justifyContent: 'space-between' }}>
            <span>Target</span>
            {actingId && <button className="link" onClick={() => p.setTargetId(nearestTarget(view, actingId))}>Nearest</button>}
          </div>
          {!target ? <p className="dim">Tap an enemy on the map.</p> : (
            <>
              <div className="row" style={{ marginBottom: 10 }}>
                <Portrait a={target} />
                <div>
                  <div className="h name-md">{target.public.name}</div>
                  <div className="dim h sub">{ALLEGIANCE[target.public.allegiance]} · {WOUND[target.public.woundState]}</div>
                </div>
              </div>
              <div className="kv">
                <div><div className="k">Distance</div><div className="v mono">{attack?.distanceM ?? '—'}<span className="unit"> m</span></div></div>
                <div><div className="k">Chance to Hit</div><div className={`v mono ${attack?.ok && attack.chance !== null ? (attack.chance >= 0.6 ? 'good' : attack.chance >= 0.35 ? 'mid' : 'bad') : ''}`}>{attack?.ok && attack.chance !== null ? pct(attack.chance) : '—'}</div></div>
                <div><div className="k">Action Cost</div><div className="v cost">{attack?.ok ? (attack.perAction > 1 ? `1 of ${attack.perAction}` : 'Full Action') : '—'}</div></div>
              </div>
              {attack && !attack.ok && <div className="warn" style={{ marginTop: 10 }}>{attack.reason}</div>}
              {attack?.ok && (
                <div className="breakdown" style={{ marginTop: 10 }}>
                  <span>{attack.baseLabel} + {attack.skill}</span><span className="mono">{attack.base}</span>
                  {attack.modifiers.map((m, i) => <Fragment key={i}><span>{m.label}</span><span className="mono">{m.value > 0 ? `+${m.value}` : m.value}</span></Fragment>)}
                  <span>+ 1d10</span><span />
                  <span className="tot">{attack.melee ? 'vs DEX + Evasion + 1d10' : `vs DV ${attack.dv} (${attack.distanceM} m)`}</span><span className="tot mono" />
                  {attack.dodgeChance !== null && <span className="dim full">If they dodge: {pct(attack.dodgeChance)}</span>}
                  {p.mode === 'autofire' && <span className="dim full">Uses 10 rounds. Damage is 2d6 × how much you beat the DV by (capped).</span>}
                </div>
              )}
              <div style={{ marginTop: 12 }}>
                <button className="cta" disabled={fireBlocked(p, !!view.pending)} onClick={p.onFire} title="Fire (F)">
                  {weapon && profileOf(weapon).melee ? 'Strike' : 'Fire'}
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}

/** Shown when nothing is selected: the GM gets a hint; a player picks one of their characters. */
function OwnPicker({ c, ownIds, onSelect }: { c: TableCtx; ownIds: string[]; onSelect?: (id: string) => void }) {
  if (c.isGm) return <section className="card"><div className="ttl">Acting As</div><p className="dim">Select a token to act for it.</p></section>;
  const own = ownIds.map((id) => c.view.actors[id]).filter((a): a is NonNullable<typeof a> => !!a);
  if (!own.length) return <section className="card"><div className="ttl">Your Character</div><p className="dim">Waiting for the GM to give you a character.</p></section>;
  return (
    <section className="card">
      <div className="ttl">{own.length > 1 ? 'Your Characters' : 'Your Character'}</div>
      <p className="dim">{own.length > 1 ? 'Choose who you’re playing right now.' : 'Tap to select.'}</p>
      <div className="own-list">
        {own.map((a) => (
          <button key={a.id} className="own-pick" onClick={() => onSelect?.(a.id)} aria-label={`Select ${a.public.name}`}>
            <Portrait a={a} small />
            <span><span className="h">{a.public.name}</span><br /><span className="dim sub">{WOUND[a.public.woundState]}</span></span>
          </button>
        ))}
      </div>
    </section>
  );
}
