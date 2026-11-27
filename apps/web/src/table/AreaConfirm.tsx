/** Confirm step for blasts, shells and scatter placement (#13): what will be hit, and the odds. */
import { metersBetween, type Cell, type Weapon } from '@cprc/rules-core';
import type { ViewState } from '@cprc/session';
import { chanceToBeat, pct } from '../odds.js';
import { isFriendly } from '../tactics.js';
import { areaOdds, blastCells, shellCells, tokensIn, type AreaKind } from './area.js';

export interface AreaConfirmProps {
  view: ViewState;
  actingId: string | null;
  weapon: Weapon | undefined;
  kind: AreaKind;
  aim: Cell;
  /** GM placing where a missed explosive lands: no roll, just the blast. */
  scatter: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function areaSummary(view: ViewState, actingId: string | null, weapon: Weapon | undefined, kind: AreaKind, aim: Cell, scatter: boolean) {
  const map = view.map!;
  const from = actingId ? map.tokens[actingId] : undefined;
  const cells = kind === 'blast' ? blastCells(map, aim).hit : from ? shellCells(map, from, aim) : new Set<string>();
  const ids = tokensIn(map.tokens, cells, kind === 'shell' ? actingId ?? undefined : undefined);
  const me = actingId ? view.actors[actingId] : undefined;
  const targets = ids.map((id) => {
    const a = view.actors[id];
    return { id, name: a?.public.name ?? 'Unknown Contact', friendly: !!a && !!me && isFriendly(a) === isFriendly(me), self: id === actingId };
  });
  let chance: number | null = null;
  let dv: number | null = null;
  let distanceM: number | null = null;
  if (!scatter && me?.combatant && weapon && from) {
    distanceM = Math.max(1, metersBetween(from, aim));
    const o = areaOdds(me.combatant, weapon, kind, distanceM);
    dv = o.dv;
    if (o.dv !== null) chance = chanceToBeat(o.base + o.modifiers.reduce((s, m) => s + m.value, 0), o.dv);
  }
  return { targets, chance, dv, distanceM };
}

export function AreaConfirm(p: AreaConfirmProps) {
  const s = areaSummary(p.view, p.actingId, p.weapon, p.kind, p.aim, p.scatter);
  const ownSide = s.targets.filter((t) => t.friendly || t.self);
  const title = p.scatter ? 'Confirm Landing Square' : p.kind === 'blast' ? 'Confirm Blast' : 'Confirm Shotgun Shell';
  return (
    <div className="area-confirm" role="dialog" aria-label={title}>
      <div className="h ttl-sm">{title}</div>
      {!p.scatter && (
        <div className="small mono">
          {s.distanceM !== null && <>{s.distanceM} m · </>}
          {s.dv === null ? 'Out of Range' : <>DV {s.dv} · {s.chance === null ? '—' : pct(s.chance)} to Hit</>}
        </div>
      )}
      <div className="small">
        {s.targets.length === 0 ? <span className="dim">No one in the area.</span>
          : <>In the Area: {s.targets.map((t, i) => <span key={t.id} className={t.friendly || t.self ? 'warn-txt' : ''}>{i ? ', ' : ''}{t.name}{t.self ? ' (You)' : t.friendly ? ' (Ally)' : ''}</span>)}</>}
      </div>
      {ownSide.length > 0 && <div className="small warn-txt">Your own side is in the area.</div>}
      <div className="row u-gap-8 u-mt-6">
        <button className="btn yellow" onClick={p.onConfirm} disabled={!p.scatter && s.dv === null}>{p.scatter ? 'Land It Here' : 'Confirm'}</button>
        <button className="btn ghost" onClick={p.onCancel}>Cancel</button>
      </div>
      <div className="dim small">Tap another square to re-aim.</div>
    </div>
  );
}
