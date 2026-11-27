/**
 * GM live-run overview: every runner at once, with where they are, NET
 * Actions left this Turn, every Black ICE's state (waiting, fighting,
 * following, derezzed) and the Demon, on a read-only floor diagram, plus the
 * GM's ICE controls.
 */
import { depthOf, iceLocation, iceOn, interfaceRank, isEngaged, netActionsFor, type NetArchitecture, type NetRun } from '@cprc/rules-core';
import type { NetOp, NetState, ViewState } from '@cprc/session';
import { FloorDiagram } from './FloorDiagram.js';

const turnKeyOf = (v: ViewState) => (v.encounter.active ? `${v.encounter.round}:${v.encounter.turnIndex}` : 'free');

interface IceRow { name: string; home: string; at: string; rez: number; max: number; state: 'fighting' | 'following' | 'waiting' | 'unmet' | 'derezzed' }

function iceRows(arch: NetArchitecture, run: NetRun): IceRow[] {
  const rows: IceRow[] = [];
  for (const [home, list] of Object.entries(run.ice)) {
    list.forEach((rez, i) => {
      const st = arch.floors[home]?.ice?.[i];
      if (!st) return;
      const at = iceLocation(run, home, i);
      const state: IceRow['state'] = rez <= 0 ? 'derezzed'
        : at === run.floorId ? (at === home ? 'fighting' : 'following')
        : run.encountered.includes(home) ? 'waiting' : 'unmet';
      rows.push({ name: st.name, home, at, rez, max: st.rez, state });
    });
  }
  return rows;
}

const STATE_LABEL: Record<IceRow['state'], string> = {
  fighting: 'Fighting', following: 'Following', waiting: 'Lying in Wait', unmet: 'Not Met Yet', derezzed: 'Derezzed',
};

export function LiveRunOverview({ view, send }: { view: ViewState; send: (op: NetOp) => boolean }) {
  const full: NetState | undefined = view.netrun?.full;
  if (!full) return null;
  const key = turnKeyOf(view);
  const current = view.encounter.active ? view.encounter.order[view.encounter.turnIndex] : undefined;
  const runners = Object.keys(full.rigs);
  if (!runners.length) return <p className="dim">No cyberdecks yet. Set them up under Cyberdecks.</p>;
  const name = (id: string) => view.actors[id]?.public.name ?? id;
  const live = runners.filter((id) => full.runs[id]);
  const offline = runners.filter((id) => !full.runs[id]);

  // Runners per architecture, for the shared diagram marks.
  const byArch = new Map<string, string[]>();
  for (const id of live) { const a = full.runs[id]!.archId; byArch.set(a, [...(byArch.get(a) ?? []), id]); }

  return (
    <div className="net-form net-live">
      {live.length === 0 && <p className="dim" style={{ margin: 0 }}>Nobody is jacked in.</p>}
      {[...byArch.entries()].map(([archId, ids]) => {
        const arch = full.architectures[archId];
        if (!arch) return null;
        const marks: Record<string, string[]> = {};
        const mark = (fid: string, text: string) => { marks[fid] = [...(marks[fid] ?? []), text]; };
        for (const id of ids) {
          const run = full.runs[id]!;
          mark(run.floorId, name(id));
          // ICE state is each runner's own, so only one runner's ICE goes on the shared diagram.
          if (ids.length === 1) {
            for (const r of iceRows(arch, run)) {
              if (r.state === 'waiting') mark(r.at, `${r.name} Waits`);
              if (r.state === 'following') mark(r.at, `${r.name} Follows`);
            }
          }
        }
        return (
          <div className="net-rig" key={archId}>
            <div className="net-sub" style={{ marginTop: 0 }}>{arch.name}</div>
            <div className="net-live-diagram">
              <FloorDiagram arch={arch} selected="" onSelect={() => {}} onChange={() => {}} marks={marks} readOnly />
            </div>
            {ids.map((id) => <RunnerCard key={id} id={id} name={name(id)} arch={arch} run={full.runs[id]!} view={view} full={full} turnKey={key} isCurrent={current === id} send={send} />)}
          </div>
        );
      })}
      {offline.length > 0 && (
        <div className="net-rig">
          <div className="net-sub" style={{ marginTop: 0 }}>Offline</div>
          {offline.map((id) => {
            const used = full.turns?.[id]?.turn === key ? full.turns[id]!.used : 0;
            const max = netActionsFor(interfaceOf(view, id, full.rigs[id]!.interface));
            return (
              <div className="row net-row" key={id}>
                <span className="h">{name(id)}</span>
                <span className="dim">{full.rigs[id]!.deckName} · {current === id ? `${max - used}/${max} NET Actions` : `Interface ${interfaceOf(view, id, full.rigs[id]!.interface)}`}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function interfaceOf(view: ViewState, id: string, fallback: number): number {
  const c = view.actors[id]?.combatant;
  const r = c ? interfaceRank(c) : 0;
  return r > 0 ? r : fallback;
}

function RunnerCard({ id, name, arch, run, view, full, turnKey, isCurrent, send }: {
  id: string; name: string; arch: NetArchitecture; run: NetRun; view: ViewState; full: NetState; turnKey: string; isCurrent: boolean;
  send: (op: NetOp) => boolean;
}) {
  const rig = full.rigs[id]!;
  const max = netActionsFor(interfaceOf(view, id, rig.interface));
  const used = full.turns?.[id]?.turn === turnKey ? full.turns[id]!.used : 0;
  const here = iceOn(run, run.floorId);
  const rows = iceRows(arch, run);
  const demon = arch.floors[run.floorId]?.demon;
  const demonRez = run.demonRez[run.floorId] ?? 0;
  const hp = view.actors[id]?.combatant?.hp;
  const active = rig.programs.filter((p) => p.status === 'active').map((p) => p.name);
  return (
    <div className="net-runner">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <span className="h">{name}</span>
        <span className={`net-tag ${isEngaged(run) ? 'bad' : 'good'}`}>{isEngaged(run) ? 'Engaged' : 'Jacked In'}</span>
      </div>
      <dl className="net-live-stats">
        <div><dt>Floor</dt><dd>{depthOf(arch, run.floorId)}</dd></div>
        <div><dt>NET Actions</dt><dd>{isCurrent ? `${max - used}/${max}` : <span title="Not their Turn">{max}</span>}</dd></div>
        {hp && <div><dt>HP</dt><dd>{hp.current}/{hp.max}</dd></div>}
        <div><dt>Cloak</dt><dd>{run.cloakDv ?? 'None'}</dd></div>
        <div><dt>Virus</dt><dd>{run.virusDv !== null ? `DV ${run.virusDv}` : 'None'}</dd></div>
      </dl>
      {active.length > 0 && <div className="dim net-sum">Running: {active.join(', ')}</div>}
      {rows.length > 0 && (
        <table className="net-ice-table">
          <thead><tr><th>Black ICE</th><th>Floor</th><th>REZ</th><th>State</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.home}-${r.name}-${r.at}`} className={`s-${r.state}`}>
                <td>{r.name}</td>
                <td>{depthOf(arch, r.at)}{r.at !== r.home ? ` (from ${depthOf(arch, r.home)})` : ''}</td>
                <td className="mono">{r.rez}/{r.max}</td>
                <td>{STATE_LABEL[r.state]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        {here.some((r) => r.rez > 0) && <button className="btn danger" onClick={() => send({ op: 'iceTurn', actorId: id })} title="Every live Black ICE on their floor attacks once.">ICE Turn</button>}
        {here.map((r, i) => r.rez > 0 && (
          <button key={`${r.home}:${r.index}`} className="btn danger" onClick={() => send({ op: 'iceAttack', actorId: id, index: i })}>{arch.floors[r.home]!.ice![r.index]!.name} Attacks</button>
        ))}
        {demon && demonRez > 0 && <button className="btn danger" onClick={() => send({ op: 'demonZap', actorId: id, count: demon.netActions })}>{demon.name} Zaps ({demon.netActions})</button>}
        <button className="btn danger" onClick={() => send({ op: 'forceJackOut', actorId: id })} title="Unsafe: every live Black ICE they met strikes.">Force Jack Out</button>
      </div>
    </div>
  );
}
