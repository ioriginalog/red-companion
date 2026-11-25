import { useState } from 'react';
import { profileOf } from '@cprc/rules-core';
import type { ProjectedActor } from '@cprc/session';
import { client } from '../net.js';
import { dodgeContext, isFriendly } from '../tactics.js';
import { pct } from '../odds.js';
import { isMuted, setMuted } from './sound.js';
import type { TableCtx } from './ctx.js';

export function Portrait({ a, big, small, active }: { a: ProjectedActor; big?: boolean; small?: boolean; active?: boolean }) {
  return (
    <div className={`pf${big ? ' big' : ''}${small ? ' small' : ''}${active ? ' active' : ''}${a.public.conditions.dead ? ' dead' : ''}`} data-al={a.public.allegiance}>
      {a.public.portrait ? <img src={a.public.portrait} alt="" draggable={false} /> : <div className="ini">{a.public.name.slice(0, 1)}</div>}
    </div>
  );
}

export function TopBar({ c, onHelp }: { c: TableCtx; onHelp: () => void }) {
  const { s, view, isGm } = c;
  const enc = view.encounter;
  const [muted, setM] = useState(isMuted());
  const [copied, setCopied] = useState(false);
  const invite = () => {
    const url = `${location.origin}/?join=${s.joinCode}`;
    void navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }, () => client.toast(url));
  };
  return (
    <header className="topbar">
      <div className="brand h"><span className="slash" />Night Shift <b>Companion</b></div>
      <div className="h dim scene-name">{view.map?.name ?? 'No Map Loaded'}</div>
      {enc.active && <span className="chip" style={{ color: 'var(--yellow)' }}>Round {enc.round}</span>}
      <div className="spacer" />
      {isGm && s.joinCode && (
        <button className="chip code" onClick={invite} title="Copy an invite link for your players">
          {copied ? 'Link Copied' : `Invite · ${s.joinCode}`}
        </button>
      )}
      {isGm && <span className="chip hide-sm">{s.players.filter((p) => p.online).length} Online</span>}
      {!isGm && <span className="chip hide-sm"><span className={`dot ${s.gmOnline ? 'on' : 'off'}`} />GM {s.gmOnline ? 'Online' : 'Offline'}</span>}
      <span className="chip" title={s.status === 'online' ? 'Synced' : 'Reconnecting'}><span className={`dot ${s.status === 'online' ? 'on' : 'off'}`} /><span className="hide-sm">{s.status === 'online' ? 'Synced' : s.status === 'connecting' ? 'Connecting' : 'Offline'}</span></span>
      <button className="btn ghost icon" onClick={() => { setMuted(!muted); setM(!muted); }} aria-pressed={!muted} aria-label={muted ? 'Sound Off' : 'Sound On'} title={muted ? 'Sound Off' : 'Sound On'}>{muted ? 'Muted' : 'Sound'}</button>
      <button className="btn ghost icon" onClick={onHelp} title="Help, Shortcuts and About (?)" aria-label="Help and About">?</button>
      <button className="btn ghost hide-sm" onClick={() => client.leave()}>Leave</button>
    </header>
  );
}

export function InitiativeStrip({ c, onPick }: { c: TableCtx; onPick: (id: string, friendly: boolean) => void }) {
  const { view, isGm } = c;
  const enc = view.encounter;
  const order = enc.active ? [...enc.order.slice(enc.turnIndex), '|', ...enc.order.slice(0, enc.turnIndex)] : [];
  return (
    <nav className="init" aria-label="Initiative order">
      {!enc.active && <span className="h dim">{isGm ? 'Set up the scene, then start the encounter.' : 'Waiting for the encounter to start.'}</span>}
      {order.map((id, i) => {
        if (id === '|') return <div className="round-div" key="div">Round {enc.round + 1}</div>;
        const a = view.actors[id];
        if (!a) {
          // Unseen hostiles arrive as opaque placeholders: show them without leaking anything.
          return (
            <div key={`${id}-${i}`} className={`init-card unknown${i === 0 ? ' active' : ''}`} title="Unknown Contact" aria-label="Unknown Contact">
              <div className={`pf${i === 0 ? ' active' : ''}`} data-al="hostile"><div className="ini">?</div></div>
              <div className="nm">Unknown</div>
            </div>
          );
        }
        const mine = c.mine(id) && !isGm;
        return (
          <button key={`${id}-${i}`} className={`init-card${i === 0 ? ' active' : ''}${mine ? ' mine' : ''}`} onClick={() => onPick(id, isFriendly(a))} title={a.public.name}>
            <Portrait a={a} active={i === 0} />
            <div className="nm">{a.public.name}</div>
          </button>
        );
      })}
    </nav>
  );
}

export function Prompts({ c }: { c: TableCtx }) {
  const { view, isGm, mine, name, act } = c;
  const pending = view.pending;
  const enc = view.encounter;
  const out: React.ReactNode[] = [];
  if (pending?.kind === 'awaitingDodge' && mine(pending.defenderId)) {
    out.push(<DodgePrompt key="dodge" c={c} pending={pending} />);
  }
  if (pending?.kind === 'awaitingDamage' && mine(pending.attackerId)) {
    out.push(
      <div className="card prompt" key="dmg">
        <div className="ttl">Hit</div>
        <p>{name(pending.attackerId)} hits {name(pending.targetId)}.</p>
        <button className="cta" onClick={() => act({ type: 'rollDamage', pendingId: pending.id })}>Roll Damage</button>
      </div>,
    );
  }
  if (pending?.kind === 'awaitingWatch' && mine(pending.watcherId)) {
    const ww = view.actors[pending.watcherId]?.weapons?.[0];
    out.push(
      <div className="card prompt" key="watch">
        <div className="ttl">Watch Triggered</div>
        <p>{name(pending.targetId)} stepped into {name(pending.watcherId)}’s cone.</p>
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
    out.push(
      <div className="card prompt" key="ds">
        <div className="ttl">Death Save</div>
        <p>{name(id)} is Mortally Wounded and must roll under BODY before acting.</p>
        <button className="cta" onClick={() => act({ type: 'deathSave', actorId: id })}>Roll Death Save</button>
      </div>,
    );
  }
  if (pending && isGm && !out.length) {
    out.push(
      <div className="card prompt" key="gm-pending">
        <div className="ttl">Waiting on a Player</div>
        <p className="dim">{pending.kind === 'awaitingDodge' ? 'Dodge decision' : pending.kind === 'awaitingDamage' ? 'Damage roll' : 'Watch decision'} pending.</p>
        <button className="btn" onClick={() => act({ type: 'cancelPending' })}>Cancel It</button>
      </div>,
    );
  }
  return <>{out}</>;
}

function DodgePrompt({ c, pending }: { c: TableCtx; pending: Extract<NonNullable<TableCtx['view']['pending']>, { kind: 'awaitingDodge' }> }) {
  const { name, act } = c;
  const ctx = dodgeContext(c.view, pending.attack);
  const dv = ctx.dv;
  const dvTile = !dv ? 'Out' : 'exact' in dv ? `${dv.exact}` : `~${dv.typical}`;
  const odds = ctx.dodgeBeatsDv ? pct('exact' in ctx.dodgeBeatsDv ? ctx.dodgeBeatsDv.exact : ctx.dodgeBeatsDv.atTypical) : null;
  const note = !dv
    ? 'They’re out of range for most weapons.'
    : 'exact' in dv
      ? `Taking it, they need to beat DV ${dv.exact}.`
      : `Their weapon is hidden. At ${ctx.distanceM} m, range DVs run ${dv.min}–${dv.max}; ${dv.typical} is typical.`;
  return (
    <div className="card prompt" role="alertdialog" aria-label="Incoming Fire">
      <div className="ttl">Incoming Fire</div>
      <p>{name(pending.attack.attackerId)} is shooting at {name(pending.defenderId)} from {ctx.distanceM} m{pending.attack.mode === 'autofire' ? ' with Autofire' : ''}.</p>
      <div className="kv dodge-kv">
        <div><div className="k">Range DV</div><div className="v mono">{dvTile}</div></div>
        <div><div className="k">Your Dodge</div><div className="v mono">{ctx.dodgeBase !== null ? `${ctx.dodgeBase}+d10` : '—'}</div></div>
        <div><div className="k">Dodge ≥ DV</div><div className="v mono">{odds ?? '—'}</div></div>
      </div>
      <p className="dim small">{note} Dodging replaces the DV with your DEX + Evasion + 1d10, even if it rolls lower.</p>
      <div className="row">
        <button className="btn yellow" onClick={() => act({ type: 'respondDodge', pendingId: pending.id, dodge: true })}>Dodge</button>
        <button className="btn" onClick={() => act({ type: 'respondDodge', pendingId: pending.id, dodge: false })}>Take the DV</button>
      </div>
    </div>
  );
}

export const DISCLAIMER = 'This is unofficial content provided under the Homebrew Content Policy of R. Talsorian Games and is not approved or endorsed by RTG. This content references materials that are the property of R. Talsorian Games and its licensees.';

export const SHORTCUTS: [string, string][] = [
  ['M', 'Move mode'], ['W', 'Watch (spend your Action)'], ['F', 'Fire at the target'], ['R', 'Ruler'], ['E', 'End your Turn'],
  ['Esc', 'Cancel the current tool'], ['?', 'This help'], ['Alt + Click', 'Ping a square'], ['Long Press', 'Ping (touch)'],
  ['Wheel / Pinch', 'Zoom'], ['Drag Empty Space', 'Pan'], ['Drag a Token', 'Move it'], ['Right-Click a Token', 'GM inspector'],
  ['Tab (on the Map)', 'Cycle through visible tokens'], ['Arrow Keys (on the Map)', 'Move the focus square'],
  ['Enter (on the Map)', 'Act on the focus square: move there or target the token'], ['G (on the Map)', 'Focus the map'],
];
export const COMMANDS: [string, string][] = [
  ['/r 2d6+3 Label', 'Roll dice (d6 or d10)'], ['/check REF+Handgun vs 15', 'Skill check for your character (vs, dv or against)'],
  ['/check 12 vs 15', 'Raw check: a base number plus 1d10'], ['/gm /r 1d10', 'Private roll (only you and the GM see it)'],
  ['/gm message', 'Whisper to the GM'], ['/w Name message', 'Whisper by player or character name (a unique prefix works)'],
];

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Help and About" onClick={onClose}>
      <div className="card help" onClick={(e) => e.stopPropagation()}>
        <div className="ttl">Shortcuts</div>
        <dl>{SHORTCUTS.map(([k, v]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>)}</dl>
        <div className="ttl" style={{ marginTop: 14 }}>Chat Commands</div>
        <dl>{COMMANDS.map(([k, v]) => <div key={k}><dt><code>{k}</code></dt><dd>{v}</dd></div>)}</dl>
        <div className="ttl" style={{ marginTop: 14 }}>About and Legal</div>
        <p className="small legal">{DISCLAIMER}</p>
        <p className="small dim">Night Shift Companion is a free, non-commercial fan tool. Map and portrait art was generated for this project; it contains no R. Talsorian Games or CD PROJEKT RED art.</p>
        <button className="btn" onClick={onClose} style={{ marginTop: 12 }}>Close</button>
      </div>
    </div>
  );
}
