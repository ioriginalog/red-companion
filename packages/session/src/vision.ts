/**
 * Lighting and vision on the tactical map. Pure; shared by the authority,
 * the relay's projection and the clients.
 *
 * RED Core gives only light guidance on darkness (the GM decides what can be
 * seen), so everything here beyond "you can't target what you can't see" is
 * an Interpretation or a house rule; see docs/rules-verification.md.
 *
 * - Ambient light is bright, dim or dark. Bright (the default) changes nothing.
 * - A light lights `bright` squares bright and `dim` more squares dim, within
 *   its line of sight (walls and cover block light). Attached lights follow
 *   their token.
 * - A token sees a square when it has line of sight and range to it and the
 *   square isn't dark, or the square is adjacent, or the token has Low Light
 *   or IR cyberoptics (dark counts as dim for them).
 */
import {
  gridDistance, hasLineOfSight, visibleCells,
  type Cell, type Combatant, type Modifier,
} from '@cprc/rules-core';
import { SessionError } from './helpers.js';
import type {
  Actor, AmbientLight, LightOp, LightRules, LightSource, SessionState, StatePatch, TacticalMap, Viewer,
} from './types.js';

export type LightLevel = 'bright' | 'dim' | 'dark';
export type Sense = 'normal' | 'lowlight' | 'ir';
export interface Seer { at: Cell; sense: Sense }

const RANK: Record<LightLevel, number> = { dark: 0, dim: 1, bright: 2 };
export const MAX_LIGHTS = 64;
export const MAX_LIGHT_RADIUS = 30;

/** Lighting matters only when the ambient isn't bright. */
export const lightingActive = (map: TacticalMap) => !!map.ambient && map.ambient !== 'bright';

/** Where a light is now: its token's square if attached (null if that token isn't on the map). */
export function lightPosition(map: TacticalMap, l: LightSource): Cell | null {
  if (l.attachedTo) return map.tokens[l.attachedTo] ?? null;
  return l.at ?? null;
}

const cache = new WeakMap<TacticalMap, Map<string, LightLevel> | null>();

/**
 * Light level of every square that isn't the ambient level, or null when the
 * map is lit bright everywhere. Memoized per map object (maps are immutable).
 */
export function lightLevels(map: TacticalMap): Map<string, LightLevel> | null {
  if (cache.has(map)) return cache.get(map)!;
  let out: Map<string, LightLevel> | null = null;
  if (lightingActive(map)) {
    out = new Map();
    const ambient = map.ambient!;
    for (const l of Object.values(map.lights ?? {})) {
      if (!l.on) continue;
      const at = lightPosition(map, l);
      if (!at) continue;
      const reach = Math.min(MAX_LIGHT_RADIUS, l.bright + l.dim);
      for (const k of visibleCells(map, at, reach)) {
        const [x, y] = k.split(',').map(Number);
        const d = gridDistance(at, { x: x!, y: y! });
        const lvl: LightLevel = d <= l.bright ? 'bright' : 'dim';
        const prev = out.get(k) ?? ambient;
        if (RANK[lvl] > RANK[prev]) out.set(k, lvl);
      }
    }
  }
  cache.set(map, out);
  return out;
}

export function levelAt(map: TacticalMap, k: string, levels = lightLevels(map)): LightLevel {
  if (!levels) return 'bright';
  return levels.get(k) ?? map.ambient ?? 'bright';
}

/** Low Light or IR from cyberware (IR wins). */
export function senseOf(c: Combatant | undefined): Sense {
  let s: Sense = 'normal';
  for (const item of c?.cyberware ?? []) {
    for (const e of item.effects ?? []) {
      if (e.kind === 'vision') { if (e.sense === 'ir') return 'ir'; s = 'lowlight'; }
    }
  }
  return s;
}

/** Squares one seer can see. */
export function seerVision(map: TacticalMap, seer: Seer, levels = lightLevels(map)): Set<string> {
  const geo = visibleCells(map, seer.at, map.sightRange);
  if (!levels || seer.sense !== 'normal') return geo;
  const out = new Set<string>();
  for (const k of geo) {
    if (levelAt(map, k, levels) !== 'dark') { out.add(k); continue; }
    const [x, y] = k.split(',').map(Number);
    if (gridDistance(seer.at, { x: x!, y: y! }) <= 1) out.add(k);
  }
  return out;
}

/** Can `seer` make out the square `c` right now (geometry and light)? */
export function canSeeSquare(map: TacticalMap, seer: Seer, c: Cell): boolean {
  if (!hasLineOfSight(map, seer.at, c) || gridDistance(seer.at, c) > map.sightRange) return false;
  if (seer.sense !== 'normal' || gridDistance(seer.at, c) <= 1) return true;
  return levelAt(map, `${c.x},${c.y}`) !== 'dark';
}

/**
 * House rule (GM toggle `lightRules.darknessPenalty`, off by default): a ranged
 * attack into a dim square is −2, into a dark square the attacker can't see −4.
 * Low Light and IR remove both. Used by the authority and the attack preview.
 */
export function lightingModifiers(map: TacticalMap | null, attacker: { at?: Cell; sense: Sense }, target?: Cell): Modifier[] {
  if (!map || !map.lightRules?.darknessPenalty || !lightingActive(map) || !target || !attacker.at) return [];
  if (attacker.sense !== 'normal') return [];
  const lvl = levelAt(map, `${target.x},${target.y}`);
  if (lvl === 'dim') return [{ label: 'Dim Light', value: -2 }];
  if (lvl === 'dark' && gridDistance(attacker.at, target) > 1) return [{ label: 'Darkness', value: -4 }];
  return [];
}

/** One character per square for player projections ('0' unseen, 'B'/'D'/'K' seen at that light). */
export function encodeSeen(map: TacticalMap, vision: Set<string>): string {
  const levels = lightLevels(map);
  let s = '';
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const k = `${x},${y}`;
      if (!vision.has(k)) { s += '0'; continue; }
      const lvl = levelAt(map, k, levels);
      s += lvl === 'bright' ? 'B' : lvl === 'dim' ? 'D' : 'K';
    }
  }
  return s;
}

export function decodeSeen(map: TacticalMap): { vision: Set<string>; levels: Map<string, LightLevel> } | null {
  const s = map.seen;
  if (!s || s.length !== map.width * map.height) return null;
  const vision = new Set<string>();
  const levels = new Map<string, LightLevel>();
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '0') continue;
    const k = `${i % map.width},${Math.floor(i / map.width)}`;
    vision.add(k);
    levels.set(k, ch === 'B' ? 'bright' : ch === 'D' ? 'dim' : 'dark');
  }
  return { vision, levels };
}

/** The party's seers (conscious friendly tokens) with their senses. */
export function partySeers(map: TacticalMap, actors: Record<string, Actor>, isFriendly: (a: Actor) => boolean): Seer[] {
  const out: Seer[] = [];
  for (const [id, at] of Object.entries(map.tokens)) {
    const a = actors[id];
    if (!a || !isFriendly(a) || a.combatant.conditions.dead || a.combatant.conditions.unconscious) continue;
    out.push({ at, sense: senseOf(a.combatant) });
  }
  return out;
}

/** Lights a player may receive: on squares the party sees, never carried by a token they can't see. */
export function visibleLights(map: TacticalMap, vision: Set<string>, visibleTokenIds: Set<string>): Record<string, LightSource> | undefined {
  if (!map.lights) return undefined;
  const out: Record<string, LightSource> = {};
  for (const [id, l] of Object.entries(map.lights)) {
    if (l.attachedTo && !visibleTokenIds.has(l.attachedTo)) continue;
    const at = lightPosition(map, l);
    if (!at || !vision.has(`${at.x},${at.y}`)) continue;
    out[id] = l;
  }
  return out;
}

// ----- Validation ------------------------------------------------------------------

const bad = (m: string): never => { throw new SessionError('INVALID', m); };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const COLORS = new Set(['cyan', 'yellow', 'magenta', 'green', 'red', 'white']);

export function validateAmbient(v: unknown): AmbientLight {
  if (v !== 'bright' && v !== 'dim' && v !== 'dark') bad('Ambient light must be bright, dim or dark.');
  return v as AmbientLight;
}

export function validateLight(v: unknown, map: { width: number; height: number }): LightSource {
  if (!isObj(v)) return bad('A light must be an object.');
  const allowed = new Set(['id', 'label', 'at', 'attachedTo', 'bright', 'dim', 'on', 'color']);
  for (const k of Object.keys(v)) if (!allowed.has(k)) bad(`Unknown light field: ${k.slice(0, 20)}.`);
  if (typeof v.id !== 'string' || !ID.test(v.id)) bad('A light needs a short id.');
  if (v.label !== undefined && (typeof v.label !== 'string' || v.label.length > 40)) bad('Light labels are up to 40 characters.');
  if (!isInt(v.bright, 0, MAX_LIGHT_RADIUS) || !isInt(v.dim, 0, MAX_LIGHT_RADIUS)) bad(`Light radii are whole squares from 0 to ${MAX_LIGHT_RADIUS}.`);
  if ((v.bright as number) + (v.dim as number) < 1) bad('A light must reach at least 1 square.');
  if (typeof v.on !== 'boolean') bad('A light is on or off.');
  if (v.color !== undefined && !COLORS.has(v.color as string)) bad('Unknown light color.');
  const hasAt = v.at !== undefined;
  const hasTok = v.attachedTo !== undefined;
  if (hasAt === hasTok) bad('A light is either fixed on a square or carried by a token.');
  if (hasAt) {
    const c = v.at;
    if (!isObj(c) || !isInt(c.x, 0, map.width - 1) || !isInt(c.y, 0, map.height - 1) || Object.keys(c).length !== 2) bad('A light’s square must be on the map.');
  }
  if (hasTok && (typeof v.attachedTo !== 'string' || !ID.test(v.attachedTo))) bad('A carried light needs a token id.');
  return v as unknown as LightSource;
}

export function validateLightRules(v: unknown): LightRules {
  if (!isObj(v)) return bad('Lighting rules must be an object.');
  for (const k of Object.keys(v)) if (k !== 'darknessPenalty') bad('Unknown lighting rule.');
  if (v.darknessPenalty !== undefined && typeof v.darknessPenalty !== 'boolean') bad('Darkness penalty is on or off.');
  return v as LightRules;
}

/** Lighting fields on a whole map (setMap, library). */
export function validateMapLighting(m: Record<string, unknown>, w: number, h: number): void {
  if (m.ambient !== undefined) validateAmbient(m.ambient);
  if (m.lights !== undefined) {
    if (!isObj(m.lights)) bad('Lights must be keyed by id.');
    const entries = Object.entries(m.lights as Record<string, unknown>);
    if (entries.length > MAX_LIGHTS) bad(`Up to ${MAX_LIGHTS} lights per map.`);
    for (const [k, l] of entries) { const light = validateLight(l, { width: w, height: h }); if (light.id !== k) bad('Light ids must match their keys.'); }
  }
  if (m.lightRules !== undefined) validateLightRules(m.lightRules);
  if (m.seen !== undefined) bad('`seen` is computed by the relay and can’t be set.');
}

export function parseLightOp(v: unknown, map: TacticalMap): LightOp {
  if (!isObj(v) || typeof v.op !== 'string') return bad('Unknown lighting action.');
  switch (v.op) {
    case 'setAmbient': return { op: 'setAmbient', ambient: validateAmbient(v.ambient) };
    case 'upsert': return { op: 'upsert', light: validateLight(v.light, map) };
    case 'remove':
      if (typeof v.id !== 'string' || !ID.test(v.id)) bad('Which light?');
      return { op: 'remove', id: v.id as string };
    case 'toggle':
      if (typeof v.id !== 'string' || !ID.test(v.id) || typeof v.on !== 'boolean') bad('Which light, on or off?');
      return { op: 'toggle', id: v.id as string, on: v.on as boolean };
    case 'setRules': return { op: 'setRules', rules: validateLightRules(v.rules) };
    default: return bad('Unknown lighting action.');
  }
}

// ----- Authority -------------------------------------------------------------------

export function executeLight(state: SessionState, rawOp: unknown, by: Viewer, withSpotted: (m: TacticalMap) => TacticalMap): { events: []; patch: StatePatch } {
  if (by.role !== 'gm') throw new SessionError('FORBIDDEN', 'Only the GM sets the lighting.');
  const map = state.map;
  if (!map) throw new SessionError('INVALID', 'No map is loaded.');
  const op = parseLightOp(rawOp, map);
  let next: TacticalMap;
  switch (op.op) {
    case 'setAmbient': next = { ...map, ambient: op.ambient }; break;
    case 'upsert': {
      const lights = map.lights ?? {};
      if (!lights[op.light.id] && Object.keys(lights).length >= MAX_LIGHTS) throw new SessionError('INVALID', `Up to ${MAX_LIGHTS} lights per map.`);
      if (op.light.attachedTo && !state.actors[op.light.attachedTo]) throw new SessionError('NOT_FOUND', 'That token isn’t in the session.');
      next = { ...map, lights: { ...lights, [op.light.id]: op.light } };
      break;
    }
    case 'remove': {
      if (!map.lights?.[op.id]) throw new SessionError('NOT_FOUND', 'No such light.');
      const { [op.id]: _gone, ...lights } = map.lights;
      next = { ...map, lights };
      break;
    }
    case 'toggle': {
      const l = map.lights?.[op.id];
      if (!l) throw new SessionError('NOT_FOUND', 'No such light.');
      next = { ...map, lights: { ...map.lights, [op.id]: { ...l, on: op.on } } };
      break;
    }
    case 'setRules': next = { ...map, lightRules: op.rules }; break;
  }
  return { events: [], patch: { map: withSpotted(next) } };
}
