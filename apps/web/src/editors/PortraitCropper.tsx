import { useEffect, useRef, useState } from 'react';
import { preparePortrait, storeImage, type SquareCrop } from '../assets.js';

/**
 * Square crop for portraits. Drag the box to move it; the slider sets its
 * size. Output is 256 × 256 WebP, stored through the Assets API.
 */
export function PortraitCropper({ img, onDone, onCancel }: { img: HTMLImageElement; onDone: (url: string, where: string) => void; onCancel: () => void }) {
  const nw = img.naturalWidth, nh = img.naturalHeight;
  const maxSize = Math.min(nw, nh);
  const [crop, setCrop] = useState<SquareCrop>({ cx: nw / 2, cy: Math.min(nh / 2, maxSize / 2 + nh * 0.05), size: maxSize });
  const [busy, setBusy] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const out = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);

  const clampCrop = (c: SquareCrop): SquareCrop => {
    const size = Math.max(32, Math.min(maxSize, c.size));
    const h = size / 2;
    return { size, cx: Math.min(nw - h, Math.max(h, c.cx)), cy: Math.min(nh - h, Math.max(h, c.cy)) };
  };

  useEffect(() => {
    const ctx = out.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 96, 96);
    ctx.drawImage(img, crop.cx - crop.size / 2, crop.cy - crop.size / 2, crop.size, crop.size, 0, 0, 96, 96);
  }, [crop, img]);

  const scale = () => (stage.current ? stage.current.clientWidth / nw : 1);

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Crop Portrait" onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}>
      <div className="modal">
        <div className="h" style={{ fontSize: 22 }}><span className="slash" />Crop Portrait</div>
        <div
          ref={stage}
          className="crop-stage"
          onPointerDown={(e) => { (e.currentTarget as Element).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, cx: crop.cx, cy: crop.cy }; }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const k = scale();
            setCrop((c) => clampCrop({ ...c, cx: d.cx + (e.clientX - d.x) / k, cy: d.cy + (e.clientY - d.y) / k }));
          }}
          onPointerUp={() => { drag.current = null; }}
        >
          <img src={img.src} alt="" />
          <StageBox crop={crop} nw={nw} nh={nh} />
        </div>
        <div className="row" style={{ alignItems: 'center' }}>
          <canvas ref={out} width={96} height={96} className="crop-out" aria-label="Portrait preview" />
          <label className="fld" style={{ flex: 1 }}><span>Crop Size</span>
            <input type="range" min={32} max={maxSize} value={crop.size} onChange={(e) => setCrop((c) => clampCrop({ ...c, size: Number(e.target.value) }))} />
          </label>
        </div>
        <div className="note">Drag the yellow square to frame the face. Arrow keys nudge it.</div>
        <div className="btnrow" onKeyDown={(e) => {
          const step = e.shiftKey ? 20 : 4;
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          if (dx || dy) { e.preventDefault(); setCrop((c) => clampCrop({ ...c, cx: c.cx + dx, cy: c.cy + dy })); }
        }}>
          <button className="btn yellow" disabled={busy} autoFocus onClick={async () => {
            setBusy(true);
            try {
              const stored = await storeImage(await preparePortrait(img, crop));
              onDone(stored.url, stored.where);
            } finally { setBusy(false); }
          }}>{busy ? 'Saving…' : 'Use Portrait'}</button>
          <button className="btn" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function StageBox({ crop, nw, nh }: { crop: SquareCrop; nw: number; nh: number }) {
  return (
    <div className="crop-box" style={{
      left: `${((crop.cx - crop.size / 2) / nw) * 100}%`, top: `${((crop.cy - crop.size / 2) / nh) * 100}%`,
      width: `${(crop.size / nw) * 100}%`, height: `${(crop.size / nh) * 100}%`,
    }} />
  );
}
