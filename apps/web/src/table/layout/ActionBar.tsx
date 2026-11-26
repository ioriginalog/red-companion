import { useEffect, useRef, useState, type ReactNode } from 'react';
import { effectiveStat, profileOf, type Weapon } from '@cprc/rules-core';
import type { ProjectedActor, TurnUsage } from '@cprc/session';
import { client } from '../../net.js';
import { isFriendly, type Attack } from '../../tactics.js';
import { pct } from '../../odds.js';
import type { MapMode } from '../../MapView.js';
import type { TableCtx } from '../ctx.js';

export interface ActionBarProps {
  c: TableCtx;
  compact: boolean;
  mapMode: MapMode;
  setMapMode: (m: MapMode) => void;
  actingId: string | null;
  acting: ProjectedActor | undefined;
  canAct: boolean;
  usage: TurnUsage | null;
  weapon: Weapon | undefined;
  targetId: string | null;
  attack: Attack | null;
  fireNow: boolean;
  onFire: () => void;
  canEndTurn: boolean;
  partyFog: boolean;
  setPartyFog: (v: boolean) => void;
  /** Extra primary actions (e.g. Delay/Hold from the play-loop track), shown in both layouts. */
  extra?: ReactNode;
}

interface Item { key: string; label: string; on?: boolean; disabled?: boolean; title?: string; tone?: 'yellow' | 'danger'; run: () => void }

/**
 * The action bar. Desktop and tablet: one row of buttons. Compact (phones):
 * a dock with the three things you need every Turn (Move, Fire, End Turn),
 * everything else behind More, so nothing ever scrolls off the edge.
 */
export function ActionBar(p: ActionBarProps) {
  const { c, compact, mapMode, setMapMode, actingId, acting, canAct, usage, weapon, targetId } = p;
  const { view, isGm, mine } = c;
  const enc = view.encounter;
  const currentId = enc.active ? enc.order[enc.turnIndex] ?? null : null;
  const move = acting?.combatant ? effectiveStat(acting.combatant, 'MOVE') : null;
  const toggle = (m: MapMode) => setMapMode(mapMode === m ? 'move' : m);

  // Stabilize a friendly who's Mortally Wounded (or down): Paramedic if trained, else First Aid.
  const t = targetId ? view.actors[targetId] : undefined;
  const stabilize = canAct && actingId && t && acting && isFriendly(t) === isFriendly(acting) && !t.public.conditions.dead && !t.public.conditions.stabilized
    && (t.public.woundState === 'mortally' || t.public.conditions.unconscious)
    ? ((acting.combatant?.skills.Paramedic ?? 0) > 0 ? 'Paramedic' as const : 'First Aid' as const)
    : null;

  const secondary: Item[] = [
    { key: 'watch', label: 'Watch', on: mapMode === 'watch', disabled: !canAct || !view.map || !!usage?.actionUsed, title: 'House rule: spend your Action to watch a 90° cone until your next Turn. (W)', run: () => toggle('watch') },
    { key: 'ruler', label: 'Ruler', on: mapMode === 'ruler', disabled: !view.map, title: 'Ruler (R)', run: () => toggle('ruler') },
    { key: 'reload', label: 'Reload', disabled: !canAct || !weapon?.ammo || weapon.ammo.loaded === weapon.ammo.capacity, run: () => { if (actingId && weapon) c.act({ type: 'reload', actorId: actingId, weaponId: weapon.id }); } },
    { key: 'brawl', label: 'Brawl', disabled: !canAct || !targetId, run: () => { if (actingId && targetId) c.act({ type: 'meleeAttack', attackerId: actingId, defenderId: targetId, with: { kind: 'brawling' } }); } },
    ...(stabilize && t ? [{ key: 'stab', label: 'Stabilize', disabled: !!usage?.actionUsed || !!view.pending, title: `Stabilize ${t.public.name} with ${stabilize} (uses your Action; must be adjacent)`, run: () => { if (actingId) c.act({ type: 'stabilize', medicId: actingId, targetId: t.id, skill: stabilize }); } }] : []),
    ...(isGm ? [
      { key: 'place', label: 'Place', on: mapMode === 'place', disabled: !view.map, title: 'Select a token, then tap a square to put it there.', run: () => toggle('place') },
      { key: 'party', label: 'Party View', on: p.partyFog, disabled: !view.map, title: 'Show what the party can see', run: () => p.setPartyFog(!p.partyFog) },
      { key: 'undo', label: 'Undo', run: () => client.undo() },
      ...(enc.active ? [{ key: 'endenc', label: 'End Encounter', run: () => { c.act({ type: 'endEncounter' }); } }] : []),
    ] : []),
  ];

  const startEncounter = isGm && !enc.active && view.map
    ? () => c.act({ type: 'startEncounter', participants: Object.keys(view.map!.tokens).map((actorId) => ({ actorId })) })
    : null;
  const showEndTurn = enc.active && (isGm || mine(currentId));
  const fireLabel = weapon && profileOf(weapon).melee ? 'Strike' : 'Fire';
  const chance = p.attack?.ok && p.attack.chance != null ? pct(p.attack.chance) : null;

  if (!compact) {
    return (
      <footer className="actions" aria-label="Actions">
        {canAct && enc.active && (
          <div className="econ" aria-label="Turn Economy">
            <span>Move <b className="mono">{usage?.moveUsed ?? 0}/{move ?? '?'}</b></span>
            <span className={usage?.actionUsed ? 'used' : ''}>Action</span>
          </div>
        )}
        <button className={`btn${mapMode === 'move' ? ' on' : ''}`} onClick={() => setMapMode('move')} title="Move (M)">Move</button>
        {secondary.map((i) => (
          <button key={i.key} className={`btn${i.on ? ' on' : ''}`} disabled={i.disabled} onClick={i.run} title={i.title} aria-pressed={i.on ?? undefined}>{i.label}</button>
        ))}
        {p.extra}
        <div className="spacer" />
        {canAct && targetId && weapon && <button className="btn yellow fire-btn" disabled={!p.fireNow} onClick={p.onFire} title="Fire (F)">{fireLabel}{chance && <span className="chance"> {chance}</span>}</button>}
        {startEncounter && <button className="btn yellow" onClick={startEncounter}>Start Encounter</button>}
        {showEndTurn && <button className="btn danger" disabled={!p.canEndTurn} onClick={() => c.act({ type: 'endTurn' })} title="End Turn (E)">End Turn</button>}
      </footer>
    );
  }

  return (
    <footer className="actions dock" aria-label="Actions">
      <button className={`btn dock-move${mapMode === 'move' ? ' on' : ''}`} onClick={() => setMapMode('move')} title="Move (M)">
        Move{canAct && enc.active && move != null && <span className="sub mono">{usage?.moveUsed ?? 0}/{move}</span>}
      </button>
      <MoreMenu items={secondary} />
      {p.extra}
      <div className="spacer" />
      {canAct && weapon && enc.active && (
        <button className="btn yellow dock-fire" disabled={!p.fireNow} onClick={p.onFire} title="Fire (F)" aria-label={targetId ? `${fireLabel}${chance ? `, ${chance} to hit` : ''}` : `${fireLabel}: pick a target first`}>
          {fireLabel}{chance && targetId && <span className="sub mono">{chance}</span>}
        </button>
      )}
      {startEncounter && <button className="btn yellow" onClick={startEncounter}>Start</button>}
      {showEndTurn && (
        <button className={`btn danger dock-end${canAct && usage?.actionUsed ? ' nudge' : ''}`} disabled={!p.canEndTurn} onClick={() => c.act({ type: 'endTurn' })} title="End Turn (E)">End Turn</button>
      )}
    </footer>
  );
}

function MoreMenu({ items }: { items: Item[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const active = items.find((i) => i.on);
  return (
    <div className="more" ref={ref}>
      <button className={`btn${active ? ' on' : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {active ? active.label : 'More'} <span aria-hidden>▴</span>
      </button>
      {open && (
        <div className="more-menu" role="menu">
          {items.map((i) => (
            <button key={i.key} role="menuitem" className={`btn${i.on ? ' on' : ''}`} disabled={i.disabled} title={i.title}
              onClick={() => { i.run(); setOpen(false); }}>{i.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
