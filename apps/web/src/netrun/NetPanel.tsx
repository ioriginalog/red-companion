/**
 * Runner view: the floors you've found, NET Actions left, Programs, actions with odds.
 * Self-contained: mount it in a side-panel tab and pass the acting/selected actor.
 */
import { useMemo, useState } from 'react';
import { boostFor, iceOn, netActionsFor, type InterfaceAbility, type NetRig } from '@cprc/rules-core';
import { netAvailability, netAvailInputFromView, type Intent, type NetAvail, type NetFloorView, type NetOp, type NetRunView, type ViewState } from '@cprc/session';
import type { FeedItem } from '../net.js';
import { chanceToBeat, chanceToWinContest, pct } from '../odds.js';
import './netrun.css';

export interface NetPanelProps {
  view: ViewState;
  /** The runner to show (usually the acting or selected character). */
  actorId: string | null;
  isGm: boolean;
  /** Whether this viewer may act for the runner right now. */
  canAct: boolean;
  act: (i: Intent) => boolean;
  feed?: FeedItem[];
}

const KIND: Record<NetFloorView['kind'], { glyph: string; label: string }> = {
  password: { glyph: 'PW', label: 'Password' },
  file: { glyph: 'FL', label: 'File' },
  controlNode: { glyph: 'CN', label: 'Control Node' },
  blackIce: { glyph: 'ICE', label: 'Black ICE' },
  demon: { glyph: 'DM', label: 'Demon' },
  empty: { glyph: '··', label: 'Empty Floor' },
};

const net = (op: NetOp): Intent => ({ type: 'net', op });

export function NetPanel({ view, actorId, isGm, canAct, act, feed }: NetPanelProps) {
  const nv = view.netrun;
  const actor = actorId ? view.actors[actorId] : undefined;
  const rig: NetRig | undefined = actorId ? nv?.rigs[actorId] : undefined;
  const run: NetRunView | undefined = actorId ? nv?.runs[actorId] : undefined;
  const full = nv?.full;
  const arch = run && full ? full.architectures[run.archId] : undefined;
  const [targetId, setTargetId] = useState('');

  const log = useMemo(() => (feed ?? [])
    .flatMap((f) => f.events.map((e, i) => ({ e, key: `${f.seq}-${i}` })))
    .filter(({ e }) => e.type === 'netAction' && e.combatantId === actorId)
    .slice(-14).reverse(), [feed, actorId]);

  if (!actor) return <section className="card net"><div className="ttl">NET</div><p className="dim">Select a netrunner.</p></section>;
  if (!rig) {
    return (
      <section className="card net">
        <div className="ttl">NET</div>
        <p className="dim" style={{ margin: 0 }}>{actor.public.name} has no cyberdeck.{isGm ? ' Set one up in NET Prep.' : ''}</p>
      </section>
    );
  }

  const send = (op: NetOp) => canAct && act(net(op));
  const known = (f: NetFloorView | undefined) => f?.dv ?? (arch && f ? arch.floors[f.id]?.dv : undefined);
  const odds = (ability: InterfaceAbility, dv: number | undefined) => (dv === undefined ? null : chanceToBeat(rig.interface + boostFor(rig, ability), dv));
  const here = run ? run.floors[run.floorId] : undefined;
  const liveIce = here?.ice?.map((x, i) => ({ ...x, i })).filter((x) => x.rez > 0) ?? [];
  // GM: ICE stats by position on this floor (followers included).
  const refs = run && full?.runs[actor.id] ? iceOn(full.runs[actor.id]!, run.floorId) : [];
  const iceDef = (i: number) => (arch && refs[i] ? arch.floors[refs[i]!.home]?.ice?.[refs[i]!.index]?.def : undefined);
  const neighbors = run ? neighborList(run) : [];
  // Same rules the authority applies: disabled buttons say why.
  const availFor = (archId?: string) => {
    const input = netAvailInputFromView(view, actor.id, isGm, archId);
    return input ? netAvailability(input) : null;
  };
  const avail = availFor();
  const ok = (k: keyof NonNullable<typeof avail>) => canAct && (avail?.[k].ok ?? true);
  const why = (k: keyof NonNullable<typeof avail>) => (avail && !avail[k].ok ? avail[k].reason : undefined);

  return (
    <section className="card net" aria-label={`${actor.public.name} NET view`}>
      <div className="ttl">NET · {rig.deckName}</div>
      <div className="net-stats">
        <div><span className="k">Interface</span><span className="v">{rig.interface}</span></div>
        <div><span className="k">NET Actions</span><span className="v">{run?.actionsLeft ?? netActionsFor(rig.interface)}<small>/{netActionsFor(rig.interface)}</small></span></div>
        <div><span className="k">Status</span><span className={`v ${run?.engaged ? 'bad' : run ? 'good' : ''}`}>{run ? (run.engaged ? 'Engaged' : 'Jacked In') : 'Offline'}</span></div>
      </div>

      {!run && (
        <div className="net-block">
          <div className="net-sub">Architectures</div>
          {nv!.jackable.length === 0 && <p className="dim" style={{ margin: 0 }}>No access points found. Try Scanner.</p>}
          {nv!.jackable.map((a) => {
            const j: NetAvail | undefined = availFor(a.id)?.jackIn;
            return (
              <div className="net-row-wrap" key={a.id}>
                <div className="row net-row">
                  <span className="h">{a.name}</span>
                  <button className="btn yellow" disabled={!canAct || (j && !j.ok)} title={j && !j.ok ? j.reason : 'Jack In (1 NET Action)'}
                    onClick={() => send({ op: 'jackIn', actorId: actor.id, archId: a.id })}>Jack In</button>
                </div>
                {canAct && j && !j.ok && <p className="net-why">{j.reason}</p>}
              </div>
            );
          })}
          <div className="row" style={{ marginTop: 8, gap: 6, flexWrap: 'wrap' }}>
            <button className="btn" disabled={!ok('scan')} onClick={() => send({ op: 'scan', actorId: actor.id })} title={why('scan') ?? 'Meat Action: find access points nearby.'}>Scanner</button>
            {nv!.quickhacks2070s && (
              <>
                <select aria-label="Quickhack Target" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                  <option value="">Quickhack Target</option>
                  {Object.keys(view.map?.tokens ?? {}).filter((id) => id !== actor.id).map((id) => <option key={id} value={id}>{view.actors[id]?.public.name ?? id}</option>)}
                </select>
                <button className="btn" disabled={!ok('quickhack') || !targetId} title={why('quickhack')} onClick={() => send({ op: 'quickhack', actorId: actor.id, targetId })}>Quickhack</button>
              </>
            )}
          </div>
        </div>
      )}

      {run && (
        <>
          <div className="net-sub">{run.archName}</div>
          <FloorTree run={run} onPick={(id) => neighbors.includes(id) && send({ op: 'move', actorId: actor.id, toFloorId: id })} movable={ok('move') ? neighbors : []} />

          {here && (
            <div className="net-block">
              <div className="net-sub">Floor {here.depth}: {KIND[here.kind].label}{here.label ? ` · ${here.label}` : ''}</div>
              {here.note && <p className="net-note">{here.note}</p>}
              <div className="net-actions">
                {/* Go down without Pathfinder; the floor reveals itself on arrival. */}
                {(here.exitsDown ?? 0) > 0 && Array.from({ length: here.exitsDown! }, (_, b) => (
                  <Act key={`down-${b}`} label={here.exitsDown! > 1 ? `Go Down: Branch ${b + 1}` : 'Go Down a Floor'} p={null}
                    on={() => send({ op: 'descend', actorId: actor.id, branch: b })}
                    dis={!ok('descend')} why={why('descend') ?? (run.engaged ? 'The Black ICE here follows you.' : undefined)} />
                ))}
                {here.kind === 'password' && !here.passed && <Act label="Backdoor" p={odds('backdoor', known(here))} on={() => send({ op: 'ability', actorId: actor.id, ability: 'backdoor' })} dis={!ok('backdoor')} why={why('backdoor')} />}
                {here.kind === 'file' && !here.identified && <Act label="Eye-Dee" p={odds('eyeDee', known(here))} on={() => send({ op: 'ability', actorId: actor.id, ability: 'eyeDee' })} dis={!ok('eyeDee')} why={why('eyeDee')} />}
                {here.kind === 'controlNode' && !here.controlled && <Act label="Control" p={odds('control', known(here))} on={() => send({ op: 'ability', actorId: actor.id, ability: 'control' })} dis={!ok('control')} why={why('control')} />}
                {!run.virusPlaced && <Act label="Virus" p={arch && avail?.virus.ok ? odds('virus', arch.virusDv) : null} on={() => send({ op: 'ability', actorId: actor.id, ability: 'virus' })} dis={!ok('virus')} why={why('virus')} />}
                <Act label="Pathfinder" p={null} on={() => send({ op: 'ability', actorId: actor.id, ability: 'pathfinder' })} dis={!ok('pathfinder')} why={why('pathfinder')} />
                <Act label="Cloak" p={null} on={() => send({ op: 'ability', actorId: actor.id, ability: 'cloak' })} dis={!ok('cloak')} why={why('cloak')} />
              </div>
              {canAct && avail && !avail.pathfinder.ok && <p className="net-why">{avail.pathfinder.reason}</p>}
              {liveIce.map((ice) => (
                <div className="net-ice" key={ice.i}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="h">{ice.name}{ice.following && <span className="net-tag bad" title="Chased you here from another floor.">Following</span>}</span>
                    <span className="mono dim">REZ {ice.rez}/{ice.maxRez}</span>
                  </div>
                  <div className="bar hurt"><i style={{ width: `${(ice.rez / ice.maxRez) * 100}%` }} /></div>
                  <div className="net-actions">
                    <Act label="Zap" p={iceDef(ice.i) === undefined ? null : chanceToWinContest(rig.interface + boostFor(rig, 'zap'), iceDef(ice.i)!)} on={() => send({ op: 'ability', actorId: actor.id, ability: 'zap', index: ice.i })} dis={!ok('zap')} why={why('zap')} />
                    {rig.programs.filter((p) => p.class === 'attacker' && p.target === 'ice' && p.status !== 'destroyed' && p.status !== 'derezzed').map((p) => (
                      <Act key={p.id} label={p.name} p={iceDef(ice.i) === undefined ? null : chanceToWinContest(rig.interface + p.atk + boostFor(rig, 'zap'), iceDef(ice.i)!)} on={() => send({ op: 'program', actorId: actor.id, programId: p.id, index: ice.i })} dis={!ok('program')} why={why('program')} />
                    ))}
                    {run.canSlide && neighbors.map((n) => (
                      <Act key={`s-${n}`} label={`Slide to ${run.floors[n]?.depth ?? '?'}`} p={null} on={() => send({ op: 'ability', actorId: actor.id, ability: 'slide', index: ice.i, toFloorId: n })} dis={!ok('slide')} why={why('slide') ?? 'Slip away; this ICE stays behind.'} />
                    ))}
                    {isGm && <button className="btn danger" onClick={() => act(net({ op: 'iceAttack', actorId: actor.id, index: ice.i }))}>ICE Attacks</button>}
                  </div>
                </div>
              ))}
              {here.demon && here.demon.rez > 0 && (
                <div className="net-ice">
                  <div className="row" style={{ justifyContent: 'space-between' }}><span className="h">Demon: {here.demon.name}</span><span className="mono dim">REZ {here.demon.rez}/{here.demon.maxRez}</span></div>
                  <div className="net-actions">
                    <Act label="Zap" p={null} on={() => send({ op: 'ability', actorId: actor.id, ability: 'zap', index: -1 })} dis={!ok('zap')} why={why('zap')} />
                    {rig.programs.filter((p) => p.class === 'attacker' && p.target === 'ice' && p.status !== 'destroyed' && p.status !== 'derezzed').map((p) => (
                      <Act key={p.id} label={p.name} p={null} on={() => send({ op: 'program', actorId: actor.id, programId: p.id, index: -1 })} dis={!ok('program')} why={why('program')} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="row" style={{ gap: 6, marginTop: 8 }}>
            <button className="btn" disabled={!ok('jackOut')} title={why('jackOut')} onClick={() => send({ op: 'jackOut', actorId: actor.id })}>Jack Out</button>
            {isGm && <button className="btn danger" onClick={() => act(net({ op: 'forceJackOut', actorId: actor.id }))} title="Unsafe: every live Black ICE they met strikes.">Force Jack Out</button>}
          </div>
        </>
      )}

      <div className="net-block">
        <div className="net-sub">Programs ({rig.programs.length}/{rig.slots})</div>
        {rig.programs.map((p) => (
          <div className={`net-prog ${p.status}`} key={p.id}>
            <div>
              <span className="h">{p.name}</span> <span className="dim">{p.class === 'booster' ? 'Booster' : p.class === 'defender' ? 'Defender' : 'Attacker'}</span>
              {p.summary && <div className="dim net-sum">{p.summary}</div>}
            </div>
            <div className="net-prog-r">
              <span className="mono">{p.rez}/{p.maxRez}</span>
              {p.class !== 'attacker' && p.status !== 'destroyed' && run && (
                <button className={`btn ${p.status === 'active' ? 'on' : ''}`} disabled={!ok('activate')} title={why('activate')} onClick={() => send({ op: 'activate', actorId: actor.id, programId: p.id, active: p.status !== 'active' })}>
                  {p.status === 'active' ? 'Stop' : p.status === 'derezzed' ? 'Restart' : 'Run'}
                </button>
              )}
              {p.status === 'destroyed' && <span className="net-tag bad">Destroyed</span>}
            </div>
          </div>
        ))}
      </div>

      {log.length > 0 && (
        <div className="net-log" aria-live="polite" aria-label="NET Log, Newest First">
          {log.map(({ e, key }) => <div key={key}>{e.type === 'netAction' ? e.text : ''}</div>)}
        </div>
      )}
    </section>
  );
}

function Act({ label, p, on, dis, why }: { label: string; p: number | null; on: () => void; dis: boolean; why?: string }) {
  return (
    <button className="btn net-act" disabled={dis} onClick={on} title={why}>
      {label}{p !== null && <span className="net-odds">{pct(p)}</span>}
    </button>
  );
}

/** Up one floor (parent) or down into any revealed branch. Works from the runner's own view. */
function neighborList(run: NetRunView): string[] {
  const parent = Object.values(run.floors).find((f) => f.children.includes(run.floorId))?.id;
  const kids = run.floors[run.floorId]?.children ?? [];
  return [...(parent ? [parent] : []), ...kids];
}

/** Revealed floors as an indented tree; adjacent floors are clickable. */
function FloorTree({ run, movable, onPick }: { run: NetRunView; movable: string[]; onPick: (id: string) => void }) {
  const rows: { f: NetFloorView; level: number }[] = [];
  const walk = (id: string, level: number) => {
    const f = run.floors[id];
    if (!f) return;
    rows.push({ f, level });
    f.children.forEach((k) => walk(k, level + 1));
  };
  walk(run.rootId, 0);
  return (
    <ol className="net-tree" aria-label="Floors">
      {rows.map(({ f, level }) => {
        const here = f.id === run.floorId;
        const can = movable.includes(f.id);
        const liveIce = f.ice?.some((x) => x.rez > 0);
        return (
          <li key={f.id} style={{ paddingLeft: level * 14 }}>
            <button
              className={`net-floor${here ? ' here' : ''}${can ? ' can' : ''}${liveIce ? ' hot' : ''}`}
              disabled={!can} onClick={() => onPick(f.id)} aria-current={here ? 'location' : undefined}
              title={can ? 'Move here (1 NET Action)' : undefined}
            >
              <span className="g">{KIND[f.kind].glyph}</span>
              <span className="d">{f.depth}</span>
              <span className="n">{KIND[f.kind].label}{f.label ? ` · ${f.label}` : ''}</span>
              {f.dv !== undefined && <span className="dv">DV {f.dv}</span>}
              {(f.passed || f.identified || f.controlled) && <span className="ok">{f.passed ? 'Open' : f.identified ? 'Identified' : 'Controlled'}</span>}
              {liveIce && <span className="ice">ICE</span>}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
