/**
 * Access points, picked on the map: the current scene or any saved map is
 * drawn as a small grid (background, walls, cover, tokens), and clicking a
 * square toggles an access point there. No typed coordinates.
 */
import { useState } from 'react';
import type { Cell } from '@cprc/rules-core';
import type { TacticalMap, ViewState } from '@cprc/session';

export interface AccessMapPickerProps {
  view: ViewState;
  access: { mapId: string; cells: Cell[] }[];
  onChange: (access: { mapId: string; cells: Cell[] }[]) => void;
}

/** Same caps as the session validator. */
const MAX_CELLS = 20;
const MAX_MAPS = 10;

export function AccessMapPicker({ view, access, onChange }: AccessMapPickerProps) {
  const maps: TacticalMap[] = [];
  if (view.map) maps.push(view.map);
  for (const m of Object.values(view.library?.maps ?? {})) if (!maps.some((x) => x.id === m.id)) maps.push(m);
  const [mapId, setMapId] = useState<string>(maps[0]?.id ?? '');
  const map = maps.find((m) => m.id === mapId) ?? maps[0];
  const [hover, setHover] = useState<Cell | null>(null);

  if (!map) return <p className="dim">Load or save a map to place access points.</p>;
  const cells = access.find((x) => x.mapId === map.id)?.cells ?? [];
  const has = (c: Cell) => cells.some((x) => x.x === c.x && x.y === c.y);
  const mapsUsed = access.filter((x) => x.cells.length).length;
  const full = cells.length >= MAX_CELLS;
  const tooManyMaps = !cells.length && mapsUsed >= MAX_MAPS;

  const toggle = (c: Cell) => {
    const nextCells = has(c) ? cells.filter((x) => x.x !== c.x || x.y !== c.y) : full || tooManyMaps ? cells : [...cells, c];
    const others = access.filter((x) => x.mapId !== map.id);
    onChange(nextCells.length ? [...others, { mapId: map.id, cells: nextCells }] : others);
  };

  // Fit the grid into about 560 × 360 px, never under 10 px a square.
  const px = Math.max(10, Math.min(28, Math.floor(Math.min(560 / map.width, 360 / map.height))));
  const w = map.width * px;
  const h = map.height * px;
  const tokens = Object.entries(map.tokens);
  const label = (c: Cell) => `Column ${c.x + 1}, Row ${c.y + 1}`;

  return (
    <div className="net-access">
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {maps.length > 1 && (
          <select aria-label="Map for Access Points" value={map.id} onChange={(e) => setMapId(e.target.value)}>
            {maps.map((m) => <option key={m.id} value={m.id}>{m.name}{view.map?.id === m.id ? ' (Current Scene)' : ''}</option>)}
          </select>
        )}
        <span className="dim">Click squares to add or remove access points ({cells.length}/{MAX_CELLS}).</span>
        {cells.length > 0 && <button className="btn ghost" onClick={() => onChange(access.filter((x) => x.mapId !== map.id))}>Clear This Map</button>}
      </div>
      <div className="net-access-map" style={{ width: w, maxWidth: '100%' }}>
        <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="grid" aria-label={`${map.name}: Access Points`}
          onMouseLeave={() => setHover(null)}>
          {map.background && <image href={map.background} x={0} y={0} width={w} height={h} preserveAspectRatio="none" opacity={0.8} />}
          {Array.from({ length: map.height }, (_, y) => Array.from({ length: map.width }, (_, x) => {
            const t = map.cells[y * map.width + x];
            const bg = !!map.background;
            const fill = t === '#' ? (bg ? 'rgba(42, 47, 85, 0.55)' : '#2a2f55') : t === 'c' ? (bg ? 'rgba(80, 84, 40, 0.5)' : '#3b3f2a') : t === '~' ? 'rgba(19, 50, 74, 0.6)' : bg ? 'transparent' : '#0a1236';
            return <rect key={`${x},${y}`} x={x * px} y={y * px} width={px} height={px} fill={fill} stroke="#1d2a5e" strokeWidth={0.5} />;
          }))}
          {tokens.map(([id, c]) => {
            const name = view.actors[id]?.public.name ?? id;
            return (
              <g key={id} pointerEvents="none">
                <circle cx={c.x * px + px / 2} cy={c.y * px + px / 2} r={px * 0.32} fill="#22e3ff" opacity={0.75} />
                {px >= 18 && <text x={c.x * px + px / 2} y={c.y * px + px / 2 + 3.5} textAnchor="middle" fontSize={10} fill="#04081c" fontWeight={700}>{name.slice(0, 2)}</text>}
              </g>
            );
          })}
          {cells.map((c) => (
            <g key={`a-${c.x},${c.y}`} pointerEvents="none">
              <rect x={c.x * px + 1.5} y={c.y * px + 1.5} width={px - 3} height={px - 3} fill="rgba(255, 230, 0, 0.25)" stroke="#ffe600" strokeWidth={2} />
              <text x={c.x * px + px / 2} y={c.y * px + px / 2 + 4} textAnchor="middle" fontSize={Math.max(9, px * 0.45)} fill="#ffe600" fontWeight={700}>⌁</text>
            </g>
          ))}
          {hover && <rect x={hover.x * px} y={hover.y * px} width={px} height={px} fill="none" stroke="#ff2fb4" strokeWidth={2} pointerEvents="none" />}
          {/* Click targets on top, one per square. */}
          {Array.from({ length: map.height }, (_, y) => Array.from({ length: map.width }, (_, x) => {
            const c = { x, y };
            const on = has(c);
            return (
              <rect key={`h-${x},${y}`} x={x * px} y={y * px} width={px} height={px} fill="transparent" style={{ cursor: on || !(full || tooManyMaps) ? 'pointer' : 'not-allowed' }}
                role="gridcell" aria-label={`${label(c)}${on ? ': Access Point' : ''}`} aria-selected={on}
                onMouseEnter={() => setHover(c)} onClick={() => toggle(c)} />
            );
          }))}
        </svg>
      </div>
      {hover && <div className="dim net-access-hint">{label(hover)}{has(hover) ? ': access point (click to remove)' : full ? ': this map has the most access points allowed' : tooManyMaps ? `: access points fit on at most ${MAX_MAPS} maps` : ''}</div>}
      {access.filter((x) => x.mapId !== map.id && x.cells.length).length > 0 && (
        <p className="dim" style={{ margin: '6px 0 0' }}>
          Also on: {access.filter((x) => x.mapId !== map.id && x.cells.length).map((x) => `${maps.find((m) => m.id === x.mapId)?.name ?? 'an unsaved map'} (${x.cells.length})`).join(', ')}.
        </p>
      )}
    </div>
  );
}
