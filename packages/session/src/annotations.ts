/**
 * Map drawings: the GM's persistent notes on the map (lines, shapes, text),
 * GM-only or shared, and short-lived marks players may draw when the GM
 * allows it. Validated here; the authority only delegates.
 */
import { SessionError } from './helpers.js';
import type { AnnotateOp, Annotation, DrawRules, SessionState, StatePatch, TacticalMap, Viewer } from './types.js';

export const MAX_ANNOTATIONS = 200;
export const MAX_PLAYER_MARKS = 10;
export const MAX_PATH_POINTS = 200;
export const DEFAULT_DRAW_RULES: DrawRules = { playersMayDraw: false, playerTtl: 60 };

const bad = (m: string): never => { throw new SessionError('INVALID', m); };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const COLORS = new Set(['cyan', 'yellow', 'magenta', 'green', 'red', 'white']);
const KINDS = new Set(['path', 'line', 'rect', 'circle', 'text']);
const POINTS: Record<string, [number, number]> = { path: [2, MAX_PATH_POINTS], line: [2, 2], rect: [2, 2], circle: [2, 2], text: [1, 1] };

/** True when the annotation is still showing at `nowIso` (GM marks never expire). */
export const isLive = (a: Annotation, nowIso: string) => !a.expiresAt || a.expiresAt > nowIso;

export function validateAnnotationBody(v: unknown, map: { width: number; height: number }, withMeta: boolean): Annotation {
  if (!isObj(v)) return bad('A drawing must be an object.');
  const allowed = new Set(['id', 'kind', 'points', 'color', 'text', 'visibility', ...(withMeta ? ['by', 'expiresAt'] : [])]);
  for (const k of Object.keys(v)) if (!allowed.has(k)) bad(`Unknown drawing field: ${k.slice(0, 20)}.`);
  if (typeof v.id !== 'string' || !ID.test(v.id)) bad('A drawing needs a short id.');
  if (typeof v.kind !== 'string' || !KINDS.has(v.kind)) bad('Unknown drawing kind.');
  if (typeof v.color !== 'string' || !COLORS.has(v.color)) bad('Unknown drawing color.');
  if (v.visibility !== 'gm' && v.visibility !== 'all') bad('A drawing is GM-only or shared.');
  const pts = v.points;
  if (!Array.isArray(pts) || pts.length % 2 !== 0) bad('Drawing points come in x, y pairs.');
  const [lo, hi] = POINTS[v.kind as string]!;
  const n = (pts as unknown[]).length / 2;
  if (n < lo || n > hi) bad(`A ${v.kind} needs ${lo === hi ? lo : `${lo}–${hi}`} points.`);
  for (let i = 0; i < (pts as unknown[]).length; i++) {
    const p = (pts as unknown[])[i];
    const max = i % 2 === 0 ? map.width : map.height;
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > max) bad('Drawing points must be on the map.');
  }
  if (v.kind === 'text') {
    if (typeof v.text !== 'string' || !v.text.trim() || v.text.length > 80) bad('A label needs 1–80 characters.');
  } else if (v.text !== undefined) bad('Only labels carry text.');
  if (withMeta) {
    if (typeof v.by !== 'string' || v.by.length > 64) bad('Drawing author is invalid.');
    if (v.expiresAt !== undefined && (typeof v.expiresAt !== 'string' || v.expiresAt.length > 40)) bad('Drawing expiry is invalid.');
  }
  // Round to 1/100 square: keeps the log small and deterministic.
  return { ...(v as unknown as Annotation), points: (pts as number[]).map((p) => Math.round(p * 100) / 100) };
}

export function validateDrawRules(v: unknown): DrawRules {
  if (!isObj(v)) return bad('Drawing rules must be an object.');
  for (const k of Object.keys(v)) if (k !== 'playersMayDraw' && k !== 'playerTtl') bad('Unknown drawing rule.');
  if (typeof v.playersMayDraw !== 'boolean') bad('Players may draw: yes or no.');
  if (!Number.isInteger(v.playerTtl) || (v.playerTtl as number) < 10 || (v.playerTtl as number) > 600) bad('Player marks last 10–600 seconds.');
  return { playersMayDraw: v.playersMayDraw as boolean, playerTtl: v.playerTtl as number };
}

/** Drawing fields on a whole map (setMap, library). */
export function validateMapAnnotations(m: Record<string, unknown>, w: number, h: number): void {
  if (m.annotations !== undefined) {
    if (!isObj(m.annotations)) bad('Drawings must be keyed by id.');
    const entries = Object.entries(m.annotations as Record<string, unknown>);
    if (entries.length > MAX_ANNOTATIONS) bad(`Up to ${MAX_ANNOTATIONS} drawings per map.`);
    for (const [k, a] of entries) { const ann = validateAnnotationBody(a, { width: w, height: h }, true); if (ann.id !== k) bad('Drawing ids must match their keys.'); }
  }
  if (m.drawRules !== undefined) validateDrawRules(m.drawRules);
}

export function parseAnnotateOp(v: unknown, map: TacticalMap): AnnotateOp {
  if (!isObj(v) || typeof v.op !== 'string') return bad('Unknown drawing action.');
  switch (v.op) {
    case 'add': return { op: 'add', annotation: validateAnnotationBody(v.annotation, map, false) };
    case 'move': {
      if (typeof v.id !== 'string' || !ID.test(v.id)) bad('Which drawing?');
      const ok = (d: unknown) => typeof d === 'number' && Number.isFinite(d) && Math.abs(d) <= 200;
      if (!ok(v.dx) || !ok(v.dy)) bad('Move by a number of squares.');
      return { op: 'move', id: v.id as string, dx: v.dx as number, dy: v.dy as number };
    }
    case 'remove':
      if (typeof v.id !== 'string' || !ID.test(v.id)) bad('Which drawing?');
      return { op: 'remove', id: v.id as string };
    case 'clear':
      if (v.scope !== 'all' && v.scope !== 'mine' && v.scope !== 'players') bad('Clear all, mine or players’ marks.');
      return { op: 'clear', scope: v.scope as 'all' | 'mine' | 'players' };
    case 'setRules': return { op: 'setRules', rules: validateDrawRules(v.rules) };
    default: return bad('Unknown drawing action.');
  }
}

const authorOf = (by: Viewer) => (by.role === 'gm' ? 'gm' : by.playerId);

export function executeAnnotate(state: SessionState, rawOp: unknown, by: Viewer, nowIso: string): { events: []; patch: StatePatch } {
  const map = state.map;
  if (!map) throw new SessionError('INVALID', 'No map is loaded.');
  const op = parseAnnotateOp(rawOp, map);
  const me = authorOf(by);
  const rules = map.drawRules ?? DEFAULT_DRAW_RULES;
  // Expired marks are dropped whenever drawings change.
  const live = Object.fromEntries(Object.entries(map.annotations ?? {}).filter(([, a]) => isLive(a, nowIso)));
  const isGm = by.role === 'gm';
  const mayTouch = (a: Annotation) => isGm || a.by === me;
  let annotations: Record<string, Annotation> = live;
  let drawRules = map.drawRules;
  switch (op.op) {
    case 'add': {
      if (!isGm && !rules.playersMayDraw) throw new SessionError('FORBIDDEN', 'The GM hasn’t allowed drawing.');
      if (live[op.annotation.id] || map.annotations?.[op.annotation.id]) throw new SessionError('INVALID', 'That drawing id is taken.');
      if (Object.keys(live).length >= MAX_ANNOTATIONS) throw new SessionError('INVALID', `Up to ${MAX_ANNOTATIONS} drawings per map.`);
      if (!isGm && Object.values(live).filter((a) => a.by === me).length >= MAX_PLAYER_MARKS) {
        throw new SessionError('INVALID', `Up to ${MAX_PLAYER_MARKS} marks at once; wait for one to fade.`);
      }
      const a: Annotation = isGm
        ? { ...op.annotation, by: 'gm' }
        : { ...op.annotation, visibility: 'all', by: me, expiresAt: new Date(Date.parse(nowIso) + rules.playerTtl * 1000).toISOString() };
      annotations = { ...live, [a.id]: a };
      break;
    }
    case 'move': {
      const a = live[op.id];
      if (!a) throw new SessionError('NOT_FOUND', 'No such drawing.');
      if (!mayTouch(a)) throw new SessionError('FORBIDDEN', 'That isn’t your drawing.');
      const points = a.points.map((p, i) => {
        const max = i % 2 === 0 ? map.width : map.height;
        return Math.round(Math.min(max, Math.max(0, p + (i % 2 === 0 ? op.dx : op.dy))) * 100) / 100;
      });
      annotations = { ...live, [a.id]: { ...a, points } };
      break;
    }
    case 'remove': {
      const a = live[op.id];
      if (!a) throw new SessionError('NOT_FOUND', 'No such drawing.');
      if (!mayTouch(a)) throw new SessionError('FORBIDDEN', 'That isn’t your drawing.');
      const { [op.id]: _gone, ...rest } = live;
      annotations = rest;
      break;
    }
    case 'clear': {
      if (!isGm && op.scope !== 'mine') throw new SessionError('FORBIDDEN', 'Players can clear only their own marks.');
      annotations = Object.fromEntries(Object.entries(live).filter(([, a]) =>
        op.scope === 'all' ? false : op.scope === 'mine' ? a.by !== me : a.by === 'gm'));
      break;
    }
    case 'setRules':
      if (!isGm) throw new SessionError('FORBIDDEN', 'Only the GM sets drawing rules.');
      drawRules = op.rules;
      if (!op.rules.playersMayDraw) annotations = Object.fromEntries(Object.entries(live).filter(([, a]) => a.by === 'gm'));
      break;
  }
  return { events: [], patch: { map: { ...map, annotations, ...(drawRules ? { drawRules } : {}) } } };
}

/** Player copy: no GM-only drawings. */
export function playerAnnotations(map: TacticalMap): Record<string, Annotation> | undefined {
  if (!map.annotations) return undefined;
  return Object.fromEntries(Object.entries(map.annotations).filter(([, a]) => a.visibility === 'all'));
}
