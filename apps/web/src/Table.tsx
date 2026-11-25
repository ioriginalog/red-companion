import { Fragment, useEffect, useMemo, useState } from 'react';
import { effectiveStat, profileOf, woundState, type Weapon } from '@cprc/rules-core';
import type { Intent, ProjectedActor, ViewState } from '@cprc/session';
import { client, type ClientState } from './net.js';
import { MapView, type MapMode } from './MapView.js';
import { aimOf, isFriendly, previewAttack, type AttackMode } from './tactics.js';
import { narrate } from './narrate.js';
import { pct } from './odds.js';
import { demoIntents } from './demo.js';

const WOUND: Record<string, string> = { unhurt: 'Unhurt', lightly: 'Lightly Wounded', seriously: 'Seriously Wounded', mortally: 'Mortally Wounded' };
const ALLEGIANCE: Record<string, string> = { party: 'Party', ally: 'Ally', neutral: 'Neutral', hostile: 'Hostile' };

function Portrait({ a, big, active }: { a: ProjectedActor; big?: boolean; active?: boolean }) {
  return (
    <div className={`pf${big ? ' big' : ''}${active ? ' active' : ''}${a.public.conditions.dead ? ' dead' : ''}`} data-al={a.public.allegiance}>
      {a.public.portrait ? <img src={a.public.portrait} alt="" /> : <div className="ini">{a.public.name.slice(0, 1)}</div>}
    </div>
  );
}

export function Table({ s }: { s: ClientState }) {
  const view = s.view!;
  const isGm = s.role === 'gm';
  const me = isGm ? 'gm' : s.playerId;
  const enc = view.encounter;
  const currentId = enc.active ? enc.order[enc.turnIndex] ?? null : null;

  const [selected, setSelected] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [weaponId, setWeaponId] = useState<string | null>(null);
  const [mode, setMode] = useState<AttackMode>('single');
  const [mapMode, setMapMode] = useState<MapMode>('move');
  const [partyFog, setPartyFog] = useState(false);

  const mine = (id: string | null) => !!id && (isGm || view.actors[id]?.controller === me);
  // Acting: the current actor in an encounter; otherwise whoever you selected.
  const actingId = currentId ?? (selected && mine(selected) ? selected : null);
  const acting = actingId ? view.actors[actingId] : undefined;
  const canAct = mine(actingId);
  const weapons: Weapon[] = acting?.weapons ?? [];
  const weapon = weapons.find((w) => w.id === weaponId) ?? weapons[0];

  useEffect(() => { setMapMode('move'); setMode('single'); }, [actingId]);
  useEffect(() => { if (targetId && !view.map?.tokens[targetId]) setTargetId(null); }, [view.map, targetId]);

  const attack = useMemo(
    () => (actingId && targetId && weapon && canAct ? previewAttack(view, actingId, targetId, weapon, mode) : null),
    [view, actingId, targetId, weapon, mode, canAct],
  );
  const chances = useMemo(() => {
    const out: Record<string, number | null> = {};
    if (!actingId || !weapon || !canAct || !view.map) return out;
    for (const id of Object.keys(view.map.tokens)) {
      const a = view.actors[id];
      if (!a || isFriendly(a) || a.public.conditions.dead) continue;
      const r = previewAttack(view, actingId, id, weapon, mode);
      if (r.ok && r.chance !== null) out[id] = r.chance;
    }
    return out;
  }, [view, actingId, weapon, mode, canAct]);

  const act = (i: Intent) => client.act(i);
  const name = (id: string) => view.actors[id]?.public.name ?? 'Someone';
  const pending = view.pending;
  const usage = enc.usage?.actorId === actingId ? enc.usage : null;

  const fire = () => {
    if (!actingId || !targetId || !weapon) return;
    if (profileOf(weapon).melee) {
      act({ type: 'meleeAttack', attackerId: actingId, defenderId: targetId, with: { kind: 'weapon', weaponId: weapon.id }, ...(aimOf(mode) ? { aimTarget: aimOf(mode) } : {}) });
    } else {
      act({
        type: 'rangedAttack', attackerId: actingId, defenderId: targetId, weaponId: weapon.id, distance: attack?.distanceM ?? 1,
        ...(mode === 'autofire' ? { mode: 'autofire' as const } : {}), ...(aimOf(mode) ? { aimTarget: aimOf(mode) } : {}),
      });
    }
  };

  // ----- Pending prompts addressed to this device -----
  const prompts: React.ReactNode[] = [];
  if (pending?.kind === 'awaitingDodge' && mine(pending.defenderId)) {
    prompts.push(
      <div className="card prompt" key="dodge">
        <div className="ttl">Incoming Fire</div>
        <p style={{ margin: '0 0 8px' }}>{name(pending.attack.attackerId)} is shooting at {name(pending.defenderId)}. Dodge with DEX + Evasion, or take the range DV?</p>
        <div className="row">
          <button className="btn yellow" onClick={() => act({ type: 'respondDodge', pendingId: pending.id, dodge: true })}>Dodge</button>
          <button className="btn" onClick={() => act({ type: 'respondDodge', pendingId: pending.id, dodge: false })}>Take the DV</button>
        </div>
      </div>,
    );
  }
  if (pending?.kind === 'awaitingDamage' && mine(pending.attackerId)) {
    prompts.push(
      <div className="card prompt" key="dmg">
        <div className="ttl">Hit</div>
        <p style={{ margin: '0 0 8px' }}>{name(pending.attackerId)} hits {name(pending.targetId)}.</p>
        <button className="cta" onClick={() => act({ type: 'rollDamage', pendingId: pending.id })}>Roll Damage</button>
      </div>,
    );
  }
  if (pending?.kind === 'awaitingWatch' && mine(pending.watcherId)) {
    const w = view.actors[pending.watcherId];
    const ww = w?.weapons?.[0];
    prompts.push(
      <div className="card prompt" key="watch">
        <div className="ttl">Watch Triggered</div>
        <p style={{ margin: '0 0 8px' }}>{name(pending.targetId)} stepped into {name(pending.watcherId)}’s cone.</p>
        <div className="row">
          {ww && <button className="btn yellow" onClick={() => act(profileOf(ww).melee
            ? { type: 'meleeAttack', attackerId: pending.watcherId, defenderId: pending.targetId, with: { kind: 'weapon', weaponId: ww.id } }
            : { type: 'rangedAttack', attackerId: pending.watcherId, defenderId: pending.targetId, weaponId: ww.id, distance: 1 })}>Fire {ww.name}</button>}
          <button className="btn" onClick={() => act({ type: 'declineWatch', pendingId: pending.id })}>Hold Fire</button>
        </div>
      </div>,
    );
  }
  if (enc.deathSaveRequiredFor && mine(enc.deathSaveRequiredFor)) {
    const id = enc.deathSaveRequiredFor;
    prompts.push(
      <div className="card prompt" key="ds">
        <div className="ttl">Death Save</div>
        <p style={{ margin: '0 0 8px' }}>{name(id)} is Mortally Wounded and must roll under BODY before acting.</p>
        <button className="cta" onClick={() => act({ type: 'deathSave', actorId: id })}>Roll Death Save</button>
      </div>,
    );
  }
  if (pending && isGm && !prompts.length) {
    prompts.push(
      <div className="card prompt" key="gm-pending">
        <div className="ttl">Waiting on a Player</div>
        <p style={{ margin: '0 0 8px' }} className="dim">{pending.kind === 'awaitingDodge' ? 'Dodge decision' : pending.kind === 'awaitingDamage' ? 'Damage roll' : 'Watch decision'} pending.</p>
        <button className="btn" onClick={() => act({ type: 'cancelPending' })}>Cancel It</button>
      </div>,
    );
  }

  const target = targetId ? view.actors[targetId] : undefined;
  const hp = acting?.combatant?.hp;
  const move = acting?.combatant ? effectiveStat(acting.combatant, 'MOVE') : null;

  // Initiative strip: current → end, round divider, then the wrap.
  const order = enc.active ? [...enc.order.slice(enc.turnIndex), '|', ...enc.order.slice(0, enc.turnIndex)] : [];

  return (
    <div className="table">
      <header className="topbar">
        <div className="brand h"><span className="slash" />Night Shift <b>Companion</b></div>
        <div className="h dim" style={{ fontSize: 15 }}>{view.map?.name ?? 'No Map Loaded'}</div>
        {enc.active && <span className="chip" style={{ color: 'var(--yellow)' }}>Round {enc.round}</span>}
        <div className="spacer" />
        {isGm && s.joinCode && <span className="chip code" title="Players join with this code">Join Code {s.joinCode}</span>}
        {isGm && <span className="chip">{s.players.filter((p) => p.online).length} Online</span>}
        {!isGm && <span className="chip"><span className={`dot ${s.gmOnline ? 'on' : 'off'}`} />GM {s.gmOnline ? 'Online' : 'Offline'}</span>}
        <span className="chip"><span className={`dot ${s.status === 'online' ? 'on' : 'off'}`} />{s.status === 'online' ? 'Synced' : s.status === 'connecting' ? 'Connecting' : 'Offline'}</span>
        <button className="btn ghost" onClick={() => client.leave()}>Leave</button>
      </header>

      <nav className="init" aria-label="Initiative order">
        {!enc.active && <span className="h dim">{isGm ? 'Set up the scene, then start the encounter.' : 'Waiting for the encounter to start.'}</span>}
        {order.map((id, i) => {
          if (id === '|') return <div className="round-div" key="div">Round {enc.round + 1}</div>;
          const a = view.actors[id];
          if (!a) return null;
          return (
            <button key={`${id}-${i}`} className={`init-card${i === 0 ? ' active' : ''}`} style={{ background: 'none', border: 0, padding: 0 }}
              onClick={() => (isFriendly(a) ? setSelected(id) : setTargetId(id))}>
              <Portrait a={a} active={i === 0} />
              <div className="nm">{a.public.name}</div>
            </button>
          );
        })}
      </nav>

      <main className="mapwrap">
        {view.map ? (
          <MapView
            view={view} isGm={isGm} actingId={actingId} canAct={canAct} targetId={targetId} attack={attack} chances={chances}
            mode={mapMode} partyFog={partyFog}
            onToken={(id) => {
              const a = view.actors[id];
              if (!a) return;
              if (isFriendly(a) && id !== actingId && (mine(id) || !enc.active)) { setSelected(id); return; }
              if (id !== actingId) setTargetId(id);
            }}
            onCell={(c, { run }) => {
              if (mapMode === 'place' && isGm && selected) { act({ type: 'placeToken', actorId: selected, at: c }); return; }
              if (!actingId || !canAct) return;
              act({ type: 'moveToken', actorId: actingId, to: c, ...(run ? { run: true } : {}) });
            }}
            onWatchFacing={(deg) => { if (actingId) { act({ type: 'setWatch', actorId: actingId, facing: deg, arc: 90 }); setMapMode('move'); } }}
          />
        ) : (
          <div className="card" style={{ marginTop: 40, maxWidth: 440 }}>
            <div className="ttl">No Map Yet</div>
            {isGm ? (
              <>
                <p>Load the demo to try the tactical view: four of the crew against a gang crew in a neon-lit warehouse yard.</p>
                <button className="cta" onClick={() => client.actAll(demoIntents())}>Load Demo Encounter</button>
              </>
            ) : <p className="dim">The GM hasn’t loaded a map.</p>}
          </div>
        )}
        {view.map && (
          <div className="legend">
            <span><i style={{ background: 'rgba(34,227,255,0.5)' }} />Move</span>
            <span><i style={{ background: 'rgba(255,212,0,0.5)' }} />Run (Uses Action)</span>
            <span><i style={{ background: '#ff2bd6' }} />Watch</span>
            <span><i style={{ background: 'rgba(2,4,14,0.9)', border: '1px solid #445' }} />Unseen</span>
          </div>
        )}
      </main>

      <footer className="actions">
        {canAct && enc.active && (
          <div className="econ">
            <span>Move <b className="mono">{usage?.moveUsed ?? 0}/{move ?? '?'}</b></span>
            <span className={usage?.actionUsed ? 'used' : ''}>Action</span>
          </div>
        )}
        <button className={`btn${mapMode === 'move' ? ' on' : ''}`} disabled={!canAct} onClick={() => setMapMode('move')}>Move</button>
        <button className={`btn${mapMode === 'watch' ? ' on' : ''}`} disabled={!canAct || !view.map || !!usage?.actionUsed} onClick={() => setMapMode(mapMode === 'watch' ? 'move' : 'watch')} title="House rule: spend your Action to watch a 90° cone until your next Turn.">Watch</button>
        <button className="btn" disabled={!canAct || !weapon?.ammo || weapon.ammo.loaded === weapon.ammo.capacity} onClick={() => actingId && weapon && act({ type: 'reload', actorId: actingId, weaponId: weapon.id })}>Reload</button>
        <button className="btn" disabled={!canAct || !targetId} onClick={() => actingId && targetId && act({ type: 'meleeAttack', attackerId: actingId, defenderId: targetId, with: { kind: 'brawling' } })}>Brawl</button>
        {isGm && <button className={`btn${mapMode === 'place' ? ' on' : ''}`} disabled={!view.map} onClick={() => setMapMode(mapMode === 'place' ? 'move' : 'place')} title="Select a token, then click a square to put it there.">Place</button>}
        {isGm && <button className={`btn${partyFog ? ' on' : ''}`} disabled={!view.map} onClick={() => setPartyFog(!partyFog)}>Party View</button>}
        {isGm && <button className="btn" onClick={() => client.undo()}>Undo</button>}
        <div className="spacer" />
        {isGm && !enc.active && view.map && (
          <button className="btn yellow" onClick={() => act({ type: 'startEncounter', participants: Object.keys(view.map!.tokens).map((actorId) => ({ actorId })) })}>Start Encounter</button>
        )}
        {isGm && enc.active && <button className="btn" onClick={() => act({ type: 'endEncounter' })}>End Encounter</button>}
        {enc.active && (isGm || mine(currentId)) && <button className="btn danger" disabled={!!pending} onClick={() => act({ type: 'endTurn' })}>End Turn</button>}
      </footer>

      <aside className="side">
        {prompts}

        {acting ? (
          <section className="card">
            <div className="ttl">{currentId === actingId ? 'Acting Now' : 'Selected'}</div>
            <div className="row">
              <Portrait a={acting} big active={currentId === actingId} />
              <div style={{ flex: 1 }}>
                <div className="h" style={{ fontSize: 26, lineHeight: 1 }}>{acting.public.name}</div>
                <div className="dim h" style={{ fontSize: 13 }}>{ALLEGIANCE[acting.public.allegiance]} · {WOUND[acting.public.woundState]}</div>
                {hp && <>
                  <div className="row mono" style={{ justifyContent: 'space-between', fontSize: 13, marginTop: 6 }}><span>HP</span><span>{hp.current}/{hp.max}</span></div>
                  <div className={`bar${woundState(hp) !== 'unhurt' ? ' hurt' : ''}`}><i style={{ width: `${Math.max(0, (hp.current / hp.max) * 100)}%` }} /></div>
                </>}
                {!canAct && <div className="dim" style={{ fontSize: 13, marginTop: 6 }}>{acting.controller === 'gm' ? 'The GM is acting.' : 'Another player is acting.'}</div>}
              </div>
            </div>
          </section>
        ) : (
          <section className="card"><div className="ttl">Your Character</div><p className="dim" style={{ margin: 0 }}>{isGm ? 'Select a token to act for it.' : 'Waiting for the GM to give you a character, or for your Turn.'}</p></section>
        )}

        {canAct && weapons.length > 0 && (
          <section className="card">
            <div className="ttl">Equipped Weapon</div>
            <div className="weapons">
              {weapons.map((w) => (
                <button key={w.id} className={`weapon${w.id === weapon?.id ? ' sel' : ''}`} onClick={() => { setWeaponId(w.id); setMode('single'); }}>
                  <span><span className="wn">{w.name}</span><br /><span className="dim" style={{ fontSize: 12 }}>{profileOf(w).displayName} · ROF {w.rofOverride ?? profileOf(w).rof}</span></span>
                  {w.ammo && <span className="h mono" style={{ fontSize: 18, color: w.ammo.loaded === 0 ? 'var(--red)' : 'var(--text)' }}>{w.ammo.loaded}<span className="dim" style={{ fontSize: 13 }}>/{w.ammo.capacity}</span></span>}
                </button>
              ))}
            </div>
            {weapon && (
              <div className="modes" role="radiogroup" aria-label="Attack mode">
                {([['single', 'Single'], ...(profileOf(weapon).autofire ? [['autofire', 'Autofire']] : []), ['aimHead', 'Aim: Head'], ['aimLeg', 'Aim: Leg'], ['aimHeld', 'Aim: Held Item']] as [AttackMode, string][]).map(([m, label]) => (
                  <button key={m} role="radio" aria-checked={mode === m} className={`mode${mode === m ? ' sel' : ''}`} onClick={() => setMode(m)}>{label}</button>
                ))}
              </div>
            )}
          </section>
        )}

        {canAct && (
          <section className="card">
            <div className="ttl">Target</div>
            {!target ? <p className="dim" style={{ margin: 0 }}>Tap an enemy on the map.</p> : (
              <>
                <div className="row" style={{ marginBottom: 10 }}>
                  <Portrait a={target} />
                  <div>
                    <div className="h" style={{ fontSize: 22, lineHeight: 1 }}>{target.public.name}</div>
                    <div className="dim h" style={{ fontSize: 13 }}>{ALLEGIANCE[target.public.allegiance]} · {WOUND[target.public.woundState]}</div>
                  </div>
                </div>
                <div className="kv">
                  <div><div className="k">Distance</div><div className="v mono">{attack?.distanceM ?? '—'}<span style={{ fontSize: 13 }}> m</span></div></div>
                  <div><div className="k">Chance to Hit</div><div className={`v mono ${attack?.ok && attack.chance !== null ? (attack.chance >= 0.6 ? 'good' : attack.chance >= 0.35 ? 'mid' : 'bad') : ''}`}>{attack?.ok && attack.chance !== null ? pct(attack.chance) : '—'}</div></div>
                  <div><div className="k">Action Cost</div><div className="v" style={{ fontSize: 16, paddingTop: 4 }}>{attack?.ok ? (attack.perAction > 1 ? `1 of ${attack.perAction}` : 'Full Action') : '—'}</div></div>
                </div>
                {attack && !attack.ok && <div className="warn" style={{ marginTop: 10 }}>{attack.reason}</div>}
                {attack?.ok && (
                  <div className="breakdown" style={{ marginTop: 10 }}>
                    <span>{attack.baseLabel} + {attack.skill}</span><span className="mono">{attack.base}</span>
                    {attack.modifiers.map((m, i) => <Fragment key={i}><span>{m.label}</span><span className="mono">{m.value > 0 ? `+${m.value}` : m.value}</span></Fragment>)}
                    <span>+ 1d10</span><span />
                    <span className="tot">{attack.melee ? 'vs DEX + Evasion + 1d10' : `vs DV ${attack.dv} (${attack.distanceM} m)`}</span><span className="tot mono" />
                    {attack.dodgeChance !== null && <span className="dim" style={{ gridColumn: '1 / -1' }}>If they dodge: {pct(attack.dodgeChance)}</span>}
                    {mode === 'autofire' && <span className="dim" style={{ gridColumn: '1 / -1' }}>Uses 10 rounds. Damage is 2d6 × how much you beat the DV by (capped).</span>}
                  </div>
                )}
                <div style={{ marginTop: 12 }}>
                  <button className="cta" disabled={!attack?.ok || !!pending || (!!usage?.actionUsed && !(usage.attackWith === weapon?.id && usage.attacks < (attack?.ok ? attack.perAction : 0)))} onClick={fire}>
                    {weapon && profileOf(weapon).melee ? 'Strike' : 'Fire'}
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {isGm && <Roster view={view} players={s.players} onSelect={setSelected} />}

        <section className="card">
          <div className="ttl">Combat Feed</div>
          <div className="feed" aria-live="polite">
            {s.feed.flatMap((f) => f.events.map((e, i) => {
              const l = narrate(e, name);
              return l ? <div key={`${f.seq}-${i}`} className={l.tone}>{l.text}</div> : null;
            })).slice(-60)}
            {s.feed.length === 0 && <span className="dim">Nothing yet.</span>}
          </div>
        </section>
      </aside>

      {s.toast && Date.now() - s.toast.at < 5000 && <div className="toast" role="alert">{s.toast.text}</div>}
    </div>
  );
}

function Roster({ view, players, onSelect }: { view: ViewState; players: ClientState['players']; onSelect: (id: string) => void }) {
  const actors = Object.values(view.actors);
  if (!actors.length) return null;
  return (
    <section className="card">
      <div className="ttl">Roster</div>
      <div style={{ display: 'grid', gap: 6 }}>
        {actors.map((a) => (
          <div key={a.id} className="row" style={{ justifyContent: 'space-between' }}>
            <button className="btn ghost" style={{ padding: '4px 6px', textAlign: 'left', flex: 1 }} onClick={() => onSelect(a.id)}>
              <span style={{ color: `var(--${a.public.allegiance})` }}>{a.public.name}</span>
              <span className="dim" style={{ fontSize: 12 }}> · {a.combatant ? `${a.combatant.hp.current}/${a.combatant.hp.max} HP` : ''}</span>
            </button>
            {a.public.allegiance === 'party' && (
              <select aria-label={`Who plays ${a.public.name}`} value={a.controller} onChange={(e) => client.act({ type: 'assignController', actorId: a.id, controller: e.target.value })}>
                <option value="gm">GM</option>
                {players.map((p) => <option key={p.playerId} value={p.playerId}>{p.name}</option>)}
              </select>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
