/**
 * Toolbar for the map's drawing and lighting tools. The GM gets both;
 * players get Draw only while the GM allows temporary marks.
 */
import { DEFAULT_DRAW_RULES, lightPosition, type AmbientLight, type LightSource, type TacticalMap } from '@cprc/session';
import { COLORS, COLOR_NAME, NEON } from './geometry.js';
import type { DrawShape, MapTools as Tools } from './useMapTools.js';
import './map-tools.css';

const SHAPES: { id: DrawShape; label: string; title: string }[] = [
  { id: 'select', label: 'Select', title: 'Select a drawing to move it (drag) or delete it' },
  { id: 'path', label: 'Freehand', title: 'Draw freehand' },
  { id: 'line', label: 'Line', title: 'Drag a straight line' },
  { id: 'rect', label: 'Rectangle', title: 'Drag a rectangle' },
  { id: 'circle', label: 'Circle', title: 'Drag from the center outward' },
  { id: 'text', label: 'Text', title: 'Type a label, then tap where it goes' },
];
const AMBIENT: { id: AmbientLight; label: string }[] = [{ id: 'bright', label: 'Bright' }, { id: 'dim', label: 'Dim' }, { id: 'dark', label: 'Dark' }];
const TTL = [30, 60, 120, 300];
const ttlLabel = (s: number) => (s < 60 ? `${s} Seconds` : s === 60 ? '1 Minute' : `${s / 60} Minutes`);

export function MapToolsBar({ t, map, isGm, nameOf }: { t: Tools; map: TacticalMap; isGm: boolean; nameOf: (id: string) => string }) {
  if (!isGm && !t.mayDraw) return null;
  return (
    <div className="map-tools" onPointerDown={(e) => e.stopPropagation()}>
      <div className="tool-toggles" role="group" aria-label="Map Tools">
        {t.mayDraw && <button className={`btn${t.panel === 'draw' ? ' on' : ''}`} aria-pressed={t.panel === 'draw'} onClick={() => t.setPanel(t.panel === 'draw' ? null : 'draw')}>Draw</button>}
        {isGm && <button className={`btn${t.panel === 'light' ? ' on' : ''}`} aria-pressed={t.panel === 'light'} onClick={() => t.setPanel(t.panel === 'light' ? null : 'light')}>Lights</button>}
      </div>
      {t.panel === 'draw' && <DrawPanel t={t} map={map} isGm={isGm} />}
      {t.panel === 'light' && isGm && <LightPanel t={t} map={map} nameOf={nameOf} />}
      {t.hint && <div className="tool-hint" role="status">{t.hint}</div>}
    </div>
  );
}

function Swatches({ value, onPick, label }: { value: string; onPick: (c: (typeof COLORS)[number]) => void; label: string }) {
  return (
    <div className="tool-row" role="radiogroup" aria-label={label}>
      {COLORS.map((c) => (
        <button key={c} role="radio" aria-checked={value === c} aria-label={COLOR_NAME[c]} title={COLOR_NAME[c]}
          className={`swatch-btn${value === c ? ' sel' : ''}`} style={{ background: NEON[c], color: NEON[c] }} onClick={() => onPick(c)} />
      ))}
    </div>
  );
}

function DrawPanel({ t, map, isGm }: { t: Tools; map: TacticalMap; isGm: boolean }) {
  const rules = map.drawRules ?? DEFAULT_DRAW_RULES;
  const mineCount = t.annotations.filter((a) => isGm ? a.by === 'gm' : a.by !== 'gm').length;
  return (
    <div className="tool-panel" aria-label="Drawing Tools">
      <div className="ttl">Draw</div>
      <div className="tool-row" role="toolbar" aria-label="Shapes">
        {SHAPES.map((s) => (
          <button key={s.id} className={`mode${t.shape === s.id ? ' sel' : ''}`} aria-pressed={t.shape === s.id} title={s.title} onClick={() => { t.setShape(s.id); t.setSelAnn(null); }}>{s.label}</button>
        ))}
      </div>
      {t.shape === 'text' && (
        <input type="text" aria-label="Label Text" placeholder="Label text" maxLength={80} value={t.label} onChange={(e) => t.setLabel(e.target.value)} />
      )}
      <Swatches value={t.color} onPick={t.setColor} label="Drawing Color" />
      {isGm && (
        <div className="tool-row" role="radiogroup" aria-label="Who Sees New Drawings">
          <button role="radio" aria-checked={t.visibility === 'all'} className={`mode${t.visibility === 'all' ? ' sel' : ''}`} onClick={() => t.setVisibility('all')} title="Players see it too">Shared</button>
          <button role="radio" aria-checked={t.visibility === 'gm'} className={`mode${t.visibility === 'gm' ? ' sel' : ''}`} onClick={() => t.setVisibility('gm')} title="Only you see it (drawn dashed)">GM Only</button>
        </div>
      )}
      <div className="tool-row">
        <button className="btn sm" disabled={!t.selAnn} onClick={t.removeSelected} title="Delete the selected drawing (Delete key)">Delete</button>
        {isGm ? (
          <>
            <button className="btn sm" disabled={!t.annotations.some((a) => a.by !== 'gm')} onClick={() => t.act({ type: 'annotate', op: { op: 'clear', scope: 'players' } })}>Clear Player Marks</button>
            <button className="btn sm mag" disabled={!t.annotations.length} onClick={() => { if (window.confirm('Remove every drawing on this map?')) t.act({ type: 'annotate', op: { op: 'clear', scope: 'all' } }); }}>Clear All</button>
          </>
        ) : (
          <button className="btn sm" disabled={!mineCount} onClick={() => t.act({ type: 'annotate', op: { op: 'clear', scope: 'mine' } })}>Clear My Marks</button>
        )}
      </div>
      {isGm ? (
        <div className="tool-row">
          <label className="lbl"><input type="checkbox" checked={rules.playersMayDraw} onChange={(e) => t.act({ type: 'annotate', op: { op: 'setRules', rules: { ...rules, playersMayDraw: e.target.checked } } })} /> Players May Draw</label>
          <select aria-label="Player Marks Last" value={rules.playerTtl} disabled={!rules.playersMayDraw} onChange={(e) => t.act({ type: 'annotate', op: { op: 'setRules', rules: { ...rules, playerTtl: Number(e.target.value) } } })}>
            {TTL.map((s) => <option key={s} value={s}>{ttlLabel(s)}</option>)}
          </select>
        </div>
      ) : <p className="hint">Your marks fade after {ttlLabel(rules.playerTtl).toLowerCase()}. Everyone sees them.</p>}
      {t.shape === 'select' && <p className="hint">{isGm ? 'Tap a drawing to select it; drag to move it.' : 'Tap one of your marks to select it; drag to move it.'}</p>}
    </div>
  );
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <span className="stepper" role="group" aria-label={label}>
      {label}
      <button className="btn sm" aria-label={`${label}: Fewer Squares`} disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
      <b aria-live="polite">{value}</b>
      <button className="btn sm" aria-label={`${label}: More Squares`} disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
    </span>
  );
}

function LightPanel({ t, map, nameOf }: { t: Tools; map: TacticalMap; nameOf: (id: string) => string }) {
  const ambient = map.ambient ?? 'bright';
  const lights = Object.values(map.lights ?? {});
  const sel = t.selLight ? map.lights?.[t.selLight] : undefined;
  const upsert = (l: LightSource) => t.act({ type: 'light', op: { op: 'upsert', light: l } });
  const describe = (l: LightSource) => l.label || (l.attachedTo ? `Carried by ${nameOf(l.attachedTo)}` : (() => { const at = lightPosition(map, l); return at ? `Light at ${at.x + 1}, ${at.y + 1}` : 'Light'; })());
  return (
    <div className="tool-panel" aria-label="Lighting Tools">
      <div className="ttl">Ambient Light</div>
      <div className="tool-row" role="radiogroup" aria-label="Ambient Light">
        {AMBIENT.map((a) => (
          <button key={a.id} role="radio" aria-checked={ambient === a.id} className={`mode${ambient === a.id ? ' sel' : ''}`} onClick={() => t.act({ type: 'light', op: { op: 'setAmbient', ambient: a.id } })}>{a.label}</button>
        ))}
      </div>
      <label className="lbl" title="House rule: ranged attacks into dim squares −2; into dark squares the attacker can’t see −4. Low Light and IR ignore both.">
        <input type="checkbox" checked={!!map.lightRules?.darknessPenalty} onChange={(e) => t.act({ type: 'light', op: { op: 'setRules', rules: { darknessPenalty: e.target.checked } } })} /> Darkness Penalty (House Rule)
      </label>
      <p className="hint">{ambient === 'bright' ? 'Lights matter once the ambient light is dim or dark.' : 'Tap a square to place a light; drag a light to move it.'}</p>
      {sel && (
        <div className="tool-panel" aria-label="Selected Light">
          <div className="ttl">Selected Light</div>
          <input type="text" aria-label="Light Label (GM Only)" placeholder="Label (GM only)" maxLength={40} defaultValue={sel.label ?? ''} key={sel.id}
            onBlur={(e) => { const v = e.target.value.trim(); if (v !== (sel.label ?? '')) { const { label: _l, ...rest } = sel; upsert(v ? { ...rest, label: v } : rest); } }} />
          <div className="tool-row">
            <Stepper label="Bright" value={sel.bright} min={0} max={30} onChange={(n) => upsert({ ...sel, bright: n, dim: n + sel.dim < 1 ? 1 : sel.dim })} />
            <Stepper label="Dim" value={sel.dim} min={0} max={30} onChange={(n) => upsert({ ...sel, dim: n, bright: n + sel.bright < 1 ? 1 : sel.bright })} />
          </div>
          <label className="lbl">Carried By{' '}
            <select value={sel.attachedTo ?? ''} onChange={(e) => {
              const id = e.target.value;
              const { attachedTo: _a, at: _at, ...rest } = sel;
              const here = lightPosition(map, sel) ?? { x: 0, y: 0 };
              upsert(id ? { ...rest, attachedTo: id } : { ...rest, at: here });
            }}>
              <option value="">Nobody (Fixed)</option>
              {Object.keys(map.tokens).map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}
            </select>
          </label>
          <Swatches value={sel.color ?? 'yellow'} onPick={(c) => upsert({ ...sel, color: c })} label="Light Color" />
          <div className="tool-row">
            <button className="btn sm" onClick={() => t.act({ type: 'light', op: { op: 'toggle', id: sel.id, on: !sel.on } })}>{sel.on ? 'Turn Off' : 'Turn On'}</button>
            <button className="btn sm mag" onClick={t.removeSelected}>Remove Light</button>
          </div>
        </div>
      )}
      {lights.length > 0 && (
        <div className="light-list" aria-label="Lights on This Map">
          {lights.map((l) => (
            <div key={l.id} className={`row-btn${t.selLight === l.id ? ' sel' : ''}`} role="button" tabIndex={0} onClick={() => t.setSelLight(l.id)} onKeyDown={(e) => { if (e.key === 'Enter') t.setSelLight(l.id); }}>
              <span><i className="dot" style={{ background: l.on ? NEON[l.color ?? 'yellow'] : 'transparent', border: `1px solid ${NEON[l.color ?? 'yellow']}` }} />{describe(l)}</span>
              <button className="btn sm" aria-pressed={l.on} onClick={(e) => { e.stopPropagation(); t.act({ type: 'light', op: { op: 'toggle', id: l.id, on: !l.on } }); }}>{l.on ? 'On' : 'Off'}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
