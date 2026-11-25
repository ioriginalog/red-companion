/** Tiny WebAudio cues. No audio files. Muted state persists per device. */
let ctx: AudioContext | null = null;
const KEY = 'nsc.muted';
let muted = (() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })();

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem(KEY, m ? '1' : '0'); } catch { /* private mode */ }
}

function ac(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}

function tone(freq: number, dur: number, type: OscillatorType, gain = 0.08, slideTo?: number, delay = 0) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, gain = 0.12) {
  const a = ac();
  if (!a) return;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  const src = a.createBufferSource();
  const g = a.createGain();
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 2400;
  src.buffer = buf;
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

export type Cue = 'shot' | 'hit' | 'miss' | 'crit' | 'ping' | 'dice' | 'turn' | 'death' | 'chat';
export function play(cue: Cue) {
  switch (cue) {
    case 'shot': noise(0.18); break;
    case 'hit': tone(140, 0.18, 'square', 0.07, 60); break;
    case 'miss': tone(900, 0.12, 'sine', 0.04, 1400); break;
    case 'crit': tone(220, 0.15, 'sawtooth', 0.06); tone(330, 0.25, 'sawtooth', 0.06, undefined, 0.12); break;
    case 'ping': tone(1200, 0.25, 'sine', 0.05, 1800); break;
    case 'dice': noise(0.06, 0.06); tone(600, 0.05, 'triangle', 0.03, undefined, 0.07); break;
    case 'turn': tone(520, 0.1, 'triangle', 0.05); tone(780, 0.14, 'triangle', 0.05, undefined, 0.1); break;
    case 'death': tone(200, 0.6, 'sine', 0.08, 50); break;
    case 'chat': tone(880, 0.06, 'sine', 0.03); break;
  }
}
