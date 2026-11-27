import { gridDistance } from '@cprc/rules-core';
import type { ProjectedActor, ViewState } from '@cprc/session';
import { isFriendly } from '../../tactics.js';
import { pct } from '../../odds.js';

export interface Chip { id: string; name: string; portrait?: string; allegiance: ProjectedActor['public']['allegiance']; chance: number | null; squares: number; wound: string }

/**
 * Visible opponents of the acting character, nearest first, with the hit chance
 * for the current weapon and mode (null = no line of sight or out of range).
 */
export function targetChips(view: ViewState, actingId: string | null, chances: Record<string, number | null>): Chip[] {
  const map = view.map;
  const acting = actingId ? view.actors[actingId] : undefined;
  const from = actingId ? map?.tokens[actingId] : undefined;
  if (!map || !acting || !from) return [];
  const out: Chip[] = [];
  for (const [id, at] of Object.entries(map.tokens)) {
    const a = view.actors[id];
    if (!a || a.placeholder || id === actingId || a.public.conditions.dead) continue;
    if (isFriendly(a) === isFriendly(acting)) continue;
    out.push({
      id, name: a.public.name, portrait: a.public.portrait, allegiance: a.public.allegiance,
      chance: chances[id] ?? null, squares: gridDistance(from, at), wound: a.public.woundState,
    });
  }
  return out.sort((x, y) => x.squares - y.squares || x.name.localeCompare(y.name));
}

interface StripProps {
  chips: Chip[];
  targetId: string | null;
  onPick: (id: string) => void;
  /** Folded to one pill so the map gets the room (landscape phones start folded). */
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
}

/** Phone target strip: tap a chip to target. Sits over the bottom of the map and folds away. */
export function TargetChips({ chips, targetId, onPick, collapsed, onCollapse }: StripProps) {
  if (!chips.length) return null;
  if (collapsed) {
    const t = chips.find((x) => x.id === targetId);
    return (
      <div className="target-chips folded">
        <button className="tchip tchip-toggle" aria-expanded={false} aria-label={`Show Targets (${chips.length})`} onClick={() => onCollapse(false)}>
          <span className="tchip-txt">
            <span className="tchip-name">{t ? t.name : 'Targets'}</span>
            <span className="tchip-sub mono">{t ? (t.chance == null ? 'No Shot' : pct(t.chance)) : `${chips.length} in View`}</span>
          </span>
          <span className="tchip-caret" aria-hidden="true">▸</span>
        </button>
      </div>
    );
  }
  return (
    <div className="target-chips">
      <button className="tchip tchip-toggle tchip-hide" aria-expanded aria-label="Hide Targets" title="Hide Targets" onClick={() => onCollapse(true)}>
        <span className="tchip-caret" aria-hidden="true">◂</span>
      </button>
      <div className="tchip-list" role="listbox" aria-label="Targets">
        {chips.map((t) => (
          <button
            key={t.id} role="option" aria-selected={t.id === targetId}
            className={`tchip${t.id === targetId ? ' sel' : ''}${t.chance == null ? ' blocked' : ''}`} data-al={t.allegiance}
            onClick={() => onPick(t.id)}
            aria-label={`${t.name}, ${t.squares * 2} m, ${t.chance == null ? 'No Clear Shot' : `${pct(t.chance)} to Hit`}`}
          >
            <span className="tchip-pf">{t.portrait ? <img src={t.portrait} alt="" /> : <span>{t.name.slice(0, 1)}</span>}</span>
            <span className="tchip-txt">
              <span className="tchip-name">{t.name}</span>
              <span className="tchip-sub mono">{t.squares * 2} m · {t.chance == null ? 'No Shot' : pct(t.chance)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
