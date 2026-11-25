import { useRef } from 'react';
import type { TacticalMap, ViewState } from '@cprc/session';
import type { Box } from '../viewport.js';

const DOT = { party: '#22e3ff', ally: '#3dff8a', neutral: '#b46bff', hostile: '#ff3b4e' } as const;

/**
 * Overview of the whole map with the current view as a rectangle. Click or drag
 * to move the camera. Shows only what this viewer already has (projected tokens,
 * the same fog path), so it reveals nothing new.
 */
export function MiniMap({ map, view, box, fogPath, fogFill, onCenter }: {
  map: TacticalMap; view: ViewState; box: Box; fogPath: string; fogFill: string; onCenter: (x: number, y: number) => void;
}) {
  const S = map.cellPx;
  const W = map.width * S, H = map.height * S;
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef(false);
  const go = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    onCenter(((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H);
  };
  return (
    <svg
      ref={ref} className="minimap" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Map overview. Click to move the view."
      onPointerDown={(e) => { drag.current = true; (e.target as Element).setPointerCapture?.(e.pointerId); go(e); }}
      onPointerMove={(e) => { if (drag.current) go(e); }}
      onPointerUp={() => { drag.current = false; }}
    >
      {map.background ? <image href={map.background} width={W} height={H} preserveAspectRatio="none" /> : <rect width={W} height={H} fill="#0b1230" />}
      {fogPath && <path d={fogPath} fill={fogFill} />}
      {Object.entries(map.tokens).map(([id, t]) => {
        const a = view.actors[id];
        if (!a) return null;
        return <circle key={id} cx={t.x * S + S / 2} cy={t.y * S + S / 2} r={S * 0.55} fill={a.public.conditions.dead ? '#556' : DOT[a.public.allegiance]} stroke="#000" strokeWidth={S * 0.12} />;
      })}
      <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="rgba(255,212,0,0.08)" stroke="#ffd400" strokeWidth={Math.max(W, H) / 120} />
    </svg>
  );
}
