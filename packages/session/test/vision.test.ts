import { describe, expect, it } from 'vitest';
import { maxHP, scriptedDice, visibleCells, type Combatant, type Stats } from '@cprc/rules-core';
import {
  applyEntry, emptySession, handleIntent, lightLevels, lightingModifiers, partyVision, projectEntry, projectMap, projectState,
  senseOf, validateIntent, visionFor, decodeSeen,
  type Actor, type Intent, type LogEntry, type SessionState, type TacticalMap, type Viewer,
} from '../src/index.js';

const BASE: Stats = { INT: 6, REF: 6, DEX: 6, TECH: 6, COOL: 6, WILL: 6, LUCK: 6, MOVE: 6, BODY: 6, EMP: 6 };
function actor(id: string, side: 'pc' | 'npc', controller: string, eyes?: 'lowlight' | 'ir'): Actor {
  const max = maxHP(6, 6);
  const combatant: Combatant = {
    id, name: id, side, stats: BASE, skills: { Handgun: 6 }, hp: { max, current: max },
    armor: [], criticalInjuries: [], deathSave: { accumulatedPenalty: 0 },
    conditions: { prone: false, unconscious: false, dead: false, stabilized: false },
    ...(eyes ? { cyberware: [{ id: 'eye', name: 'Cybereye', humanityLoss: 7, effects: [{ kind: 'vision', sense: eyes }], hlDice: '1d6/2', borgware: false, install: 'clinic' }] } : {}),
  } as Combatant;
  return { id, controller, weapons: [], combatant };
}

const GM: Viewer = { role: 'gm' };
const P1: Viewer = { role: 'player', playerId: 'p1' };
const P2: Viewer = { role: 'player', playerId: 'p2' };

//            0123456789AB
const ROWS = ['............',
              '......#.....',
              '......#.....',
              '......#.....',
              '............'];
const MAP: TacticalMap = {
  id: 'm', name: 'Dark Yard', width: 12, height: 5, cells: ROWS.join(''), cellPx: 64, sightRange: 30,
  tokens: { solo: { x: 1, y: 2 }, ganger: { x: 10, y: 2 } }, watches: {}, spotted: [],
};

function table(eyes?: 'lowlight' | 'ir') {
  let state: SessionState = emptySession('s1');
  const log: LogEntry[] = [];
  let n = 0;
  let clock = Date.parse('2077-01-01T00:00:00Z');
  const t = {
    get state() { return state; },
    log,
    tick(sec: number) { clock += sec * 1000; },
    send(intent: Intent, by: Viewer) {
      const r = handleIntent(state, intent, by, { dice: scriptedDice({}), now: () => new Date(clock).toISOString(), newId: () => `id${++n}` });
      if (r.ok) { state = applyEntry(state, r.entry); log.push(r.entry); }
      return r;
    },
  };
  t.send({ type: 'addActor', actor: actor('solo', 'pc', 'p1', eyes) }, GM);
  t.send({ type: 'addActor', actor: actor('ganger', 'npc', 'gm') }, GM);
  expect(t.send({ type: 'setMap', map: MAP }, GM).ok).toBe(true);
  return t;
}
const light = (op: unknown) => ({ type: 'light', op } as Intent);
const annotate = (op: unknown) => ({ type: 'annotate', op } as Intent);

describe('Lighting and vision', () => {
  it('bright ambient changes nothing', () => {
    const t = table();
    t.send(light({ op: 'setAmbient', ambient: 'bright' }), GM);
    const geo = visibleCells(t.state.map!, { x: 1, y: 2 }, 30);
    expect([...partyVision(t.state.map!, t.state.actors)].sort()).toEqual([...geo].sort());
    expect(projectMap(t.state.map!, t.state.actors).seen).toBeUndefined();
  });

  it('in the dark a token sees only adjacent and lit squares; Low Light and IR see the rest', () => {
    const t = table();
    t.send(light({ op: 'setAmbient', ambient: 'dark' }), GM);
    const v = partyVision(t.state.map!, t.state.actors);
    expect(v.has('2,2')).toBe(true); // adjacent
    expect(v.has('4,2')).toBe(false);
    expect(t.send(light({ op: 'upsert', light: { id: 'lamp', at: { x: 4, y: 0 }, bright: 1, dim: 1, on: true } }), GM).ok).toBe(true);
    const levels = lightLevels(t.state.map!)!;
    expect(levels.get('4,1')).toBe('bright');
    expect(levels.get('2,2')).toBe('dim');
    expect(levels.has('7,1')).toBe(false); // out of reach
    const v2 = partyVision(t.state.map!, t.state.actors);
    expect(v2.has('4,1') && v2.has('3,2')).toBe(true);
    expect(v2.has('9,4')).toBe(false);
    t.send(light({ op: 'toggle', id: 'lamp', on: false }), GM);
    expect(partyVision(t.state.map!, t.state.actors).has('4,1')).toBe(false);

    for (const eyes of ['lowlight', 'ir'] as const) {
      const t2 = table(eyes);
      t2.send(light({ op: 'setAmbient', ambient: 'dark' }), GM);
      expect(senseOf(t2.state.actors.solo!.combatant)).toBe(eyes);
      expect(partyVision(t2.state.map!, t2.state.actors).has('4,4')).toBe(true);
      expect(partyVision(t2.state.map!, t2.state.actors).has('3,0')).toBe(true);
      expect(partyVision(t2.state.map!, t2.state.actors).has('10,2')).toBe(false); // still behind the wall
    }
  });

  it('walls block light', () => {
    const t = table();
    t.send(light({ op: 'setAmbient', ambient: 'dark' }), GM);
    t.send(light({ op: 'upsert', light: { id: 'lamp', at: { x: 5, y: 2 }, bright: 3, dim: 0, on: true } }), GM);
    const levels = lightLevels(t.state.map!)!;
    expect(levels.get('4,2')).toBe('bright');
    expect(levels.has('7,2')).toBe(false); // behind the wall
  });

  it('party vision is the union of friendly tokens; dead allies don’t see', () => {
    const t = table();
    t.send({ type: 'addActor', actor: actor('medic', 'pc', 'p2') }, GM);
    t.send({ type: 'placeToken', actorId: 'medic', at: { x: 8, y: 4 } }, GM);
    t.send(light({ op: 'setAmbient', ambient: 'dark' }), GM);
    const v = partyVision(t.state.map!, t.state.actors);
    expect(v.has('2,2') && v.has('9,4')).toBe(true);
    t.send({ type: 'setCondition', actorId: 'medic', condition: 'dead', value: true }, GM);
    expect(partyVision(t.state.map!, t.state.actors).has('9,4')).toBe(false);
  });

  it('a light carried by an unseen token lights nothing for the party and is never sent', () => {
    const t = table();
    t.send(light({ op: 'setAmbient', ambient: 'dark' }), GM);
    // The ganger, around the wall, carries a big torch: its glow reaches squares the solo has LOS to.
    t.send({ type: 'placeToken', actorId: 'ganger', at: { x: 7, y: 1 } }, GM);
    t.send(light({ op: 'upsert', light: { id: 'torch', label: 'Ambush Torch', attachedTo: 'ganger', bright: 4, dim: 2, on: true } }), GM);
    // Its own square is lit, and in LOS? (1,2)->(7,1) crosses the wall column at y≈1: blocked.
    const geoSeesGanger = visibleCells(t.state.map!, { x: 1, y: 2 }, 30).has('7,1');
    expect(geoSeesGanger).toBe(false);
    const v = partyVision(t.state.map!, t.state.actors);
    expect(v.has('7,4')).toBe(false); // lit by the torch, in LOS, but the carrier is unseen
    const pm = projectMap(t.state.map!, t.state.actors);
    expect(pm.tokens.ganger).toBeUndefined();
    expect(pm.lights).toEqual({});
    const seen = decodeSeen(pm)!;
    expect(seen.vision.has('7,4')).toBe(false);
    const json = JSON.stringify(projectState(t.state, P1));
    expect(json).not.toContain('torch');
    expect(json).not.toContain('Ambush');
    expect(json).not.toContain('"7,1"');
  });

  it('a carrier in plain view keeps its light (without the GM label)', () => {
    const t = table();
    t.send(light({ op: 'setAmbient', ambient: 'dark' }), GM);
    t.send({ type: 'placeToken', actorId: 'ganger', at: { x: 4, y: 4 } }, GM);
    t.send(light({ op: 'upsert', light: { id: 'torch', label: 'Secret', attachedTo: 'ganger', bright: 1, dim: 1, on: true } }), GM);
    const pm = projectMap(t.state.map!, t.state.actors);
    expect(pm.tokens.ganger).toEqual({ x: 4, y: 4 });
    expect(pm.lights?.torch).toEqual({ id: 'torch', attachedTo: 'ganger', bright: 1, dim: 1, on: true });
    expect(pm.seen!.length).toBe(MAP.width * MAP.height);
  });

  it('fixed lights out of the party’s sight aren’t sent, though their glow on seen squares shows', () => {
    const t = table();
    t.send(light({ op: 'setAmbient', ambient: 'dim' }), GM);
    t.send(light({ op: 'upsert', light: { id: 'hidden-lamp', at: { x: 7, y: 2 }, bright: 1, dim: 0, on: true } }), GM);
    const pm = projectMap(t.state.map!, t.state.actors);
    expect(pm.lights?.['hidden-lamp']).toBeUndefined();
  });

  it('the darkness penalty is a GM toggle and Low Light ignores it', () => {
    const t = table();
    t.send(light({ op: 'setAmbient', ambient: 'dim' }), GM);
    const map = () => t.state.map!;
    expect(lightingModifiers(map(), { at: { x: 1, y: 2 }, sense: 'normal' }, { x: 4, y: 4 })).toEqual([]);
    t.send(light({ op: 'setRules', rules: { darknessPenalty: true } }), GM);
    expect(lightingModifiers(map(), { at: { x: 1, y: 2 }, sense: 'normal' }, { x: 4, y: 4 })).toEqual([{ label: 'Dim Light', value: -2 }]);
    expect(lightingModifiers(map(), { at: { x: 1, y: 2 }, sense: 'lowlight' }, { x: 4, y: 4 })).toEqual([]);
    t.send(light({ op: 'setAmbient', ambient: 'dark' }), GM);
    expect(lightingModifiers(map(), { at: { x: 1, y: 2 }, sense: 'normal' }, { x: 4, y: 4 })).toEqual([{ label: 'Darkness', value: -4 }]);
    // A player's copy reads the same level from the relay's `seen`.
    const pm = projectMap(map(), t.state.actors);
    expect(lightingModifiers(pm, { at: { x: 1, y: 2 }, sense: 'normal' }, { x: 2, y: 2 })).toEqual([]);
  });

  it('only the GM sets lighting, and hostile light payloads are refused', () => {
    const t = table();
    expect(t.send(light({ op: 'setAmbient', ambient: 'dark' }), P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    const ok = { id: 'l1', at: { x: 1, y: 1 }, bright: 1, dim: 1, on: true };
    const bad: unknown[] = [
      null, 'x', { op: 'setAmbient', ambient: 'pitch' }, { op: 'nuke' },
      { op: 'upsert', light: { ...ok, bright: 1e9 } },
      { op: 'upsert', light: { ...ok, dim: Number.NaN } },
      { op: 'upsert', light: { ...ok, bright: 0, dim: 0 } },
      { op: 'upsert', light: { ...ok, bright: 1.5 } },
      { op: 'upsert', light: { ...ok, at: { x: 99, y: 0 } } },
      { op: 'upsert', light: { ...ok, at: { x: 1, y: 1, z: 3 } } },
      { op: 'upsert', light: { ...ok, attachedTo: 'solo' } },
      { op: 'upsert', light: { id: 'l2', bright: 1, dim: 1, on: true } },
      { op: 'upsert', light: { ...ok, id: '<script>' } },
      { op: 'upsert', light: { ...ok, id: 'x'.repeat(65) } },
      { op: 'upsert', light: { ...ok, label: 'x'.repeat(41) } },
      { op: 'upsert', light: { ...ok, color: 'ultraviolet' } },
      { op: 'upsert', light: { ...ok, on: 'yes' } },
      { op: 'upsert', light: { ...ok, __proto__: { polluted: true }, extra: 1 } },
      { op: 'upsert', light: { id: 'l3', attachedTo: 'nobody', bright: 1, dim: 1, on: true } },
      { op: 'toggle', id: 'nope', on: true },
      { op: 'remove', id: 'nope' },
      { op: 'setRules', rules: { darknessPenalty: 'sure' } },
      { op: 'setRules', rules: { flashbang: true } },
    ];
    for (const op of bad) expect(t.send(light(op), GM).ok, JSON.stringify(op)).toBe(false);
    expect(t.state.map!.lights).toBeUndefined();
    for (let i = 0; i < 64; i++) expect(t.send(light({ op: 'upsert', light: { ...ok, id: `l${i}` } }), GM).ok).toBe(true);
    expect(t.send(light({ op: 'upsert', light: { ...ok, id: 'one-too-many' } }), GM).ok).toBe(false);
  });

  it('a whole map can’t smuggle in a `seen` string or too many lights', () => {
    const t = table();
    expect(t.send({ type: 'setMap', map: { ...MAP, seen: 'B'.repeat(60) } }, GM).ok).toBe(false);
    const lights = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`l${i}`, { id: `l${i}`, at: { x: 0, y: 0 }, bright: 1, dim: 0, on: true }]));
    expect(t.send({ type: 'setMap', map: { ...MAP, lights } }, GM).ok).toBe(false);
    expect(t.send({ type: 'setMap', map: { ...MAP, lights: { a: { id: 'b', at: { x: 0, y: 0 }, bright: 1, dim: 0, on: true } } } }, GM).ok).toBe(false);
    expect(t.send({ type: 'setMap', map: { ...MAP, ambient: 'void' } as unknown as TacticalMap }, GM).ok).toBe(false);
  });

  it('cyberware vision effects validate', () => {
    const t = table();
    const a = actor('owl', 'pc', 'p1', 'ir');
    expect(t.send({ type: 'addActor', actor: a }, GM).ok).toBe(true);
    const badEye = { ...a, id: 'owl2', combatant: { ...a.combatant, id: 'owl2', cyberware: [{ ...a.combatant.cyberware![0]!, effects: [{ kind: 'vision', sense: 'xray' }] }] } } as unknown as Actor;
    expect(t.send({ type: 'addActor', actor: badEye }, GM).ok).toBe(false);
  });

  it('visionFor still accepts bare squares', () => {
    const t = table();
    expect(visionFor(t.state.map!, [{ x: 1, y: 2 }]).has('3,3')).toBe(true);
  });
});

describe('Map drawings', () => {
  const line = (id: string, visibility: 'gm' | 'all' = 'all') => ({ op: 'add', annotation: { id, kind: 'line', points: [1, 1, 3.333, 2], color: 'cyan', visibility } });

  it('the GM draws GM-only and shared drawings; players only receive shared ones', () => {
    const t = table();
    expect(t.send(annotate(line('secret', 'gm')), GM).ok).toBe(true);
    expect(t.send(annotate(line('route')), GM).ok).toBe(true);
    expect(t.state.map!.annotations!.route!.points).toEqual([1, 1, 3.33, 2]);
    const pv = projectState(t.state, P1);
    expect(Object.keys(pv.map!.annotations!)).toEqual(['route']);
    expect(JSON.stringify(pv)).not.toContain('secret');
    // Live entries, too.
    const e = projectEntry(t.log[t.log.length - 2]!, P1, t.state);
    expect(JSON.stringify(e)).not.toContain('secret');
    expect(Object.keys(projectState(t.state, GM).map!.annotations!).sort()).toEqual(['route', 'secret']);
  });

  it('players draw only when allowed; their marks are shared, capped and expire', () => {
    const t = table();
    expect(t.send(annotate(line('p-1')), P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(t.send(annotate({ op: 'setRules', rules: { playersMayDraw: true, playerTtl: 30 } }), P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(t.send(annotate({ op: 'setRules', rules: { playersMayDraw: true, playerTtl: 30 } }), GM).ok).toBe(true);
    expect(t.send(annotate(line('p-1', 'gm')), P1).ok).toBe(true);
    const mark = t.state.map!.annotations!['p-1']!;
    expect(mark).toMatchObject({ visibility: 'all', by: 'p1', expiresAt: '2077-01-01T00:00:30.000Z' });
    for (let i = 2; i <= 10; i++) expect(t.send(annotate(line(`p-${i}`)), P1).ok).toBe(true);
    expect(t.send(annotate(line('p-11')), P1).ok).toBe(false);
    // Another player can't touch them; the GM can.
    expect(t.send(annotate({ op: 'remove', id: 'p-1' }), P2)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(t.send(annotate({ op: 'move', id: 'p-1', dx: 1, dy: 0 }), P2)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(t.send(annotate({ op: 'clear', scope: 'all' }), P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(t.send(annotate({ op: 'move', id: 'p-1', dx: 100, dy: -100 }), P1).ok).toBe(true);
    expect(t.state.map!.annotations!['p-1']!.points).toEqual([12, 0, 12, 0]); // clamped to the map
    // Time passes: expired marks are dropped on the next change.
    t.tick(31);
    expect(t.send(annotate(line('gm-1')), GM).ok).toBe(true);
    expect(Object.keys(t.state.map!.annotations!)).toEqual(['gm-1']);
    expect(t.send(annotate({ op: 'move', id: 'p-2', dx: 1, dy: 1 }), P1).ok).toBe(false);
    // Turning drawing off removes players' marks.
    expect(t.send(annotate({ op: 'setRules', rules: { playersMayDraw: true, playerTtl: 60 } }), GM).ok).toBe(true);
    t.send(annotate(line('p-12')), P1);
    t.send(annotate({ op: 'setRules', rules: { playersMayDraw: false, playerTtl: 60 } }), GM);
    expect(Object.keys(t.state.map!.annotations!)).toEqual(['gm-1']);
  });

  it('players can’t edit or delete GM drawings', () => {
    const t = table();
    t.send(annotate(line('route')), GM);
    t.send(annotate({ op: 'setRules', rules: { playersMayDraw: true, playerTtl: 60 } }), GM);
    expect(t.send(annotate({ op: 'remove', id: 'route' }), P1)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(t.send(annotate({ op: 'clear', scope: 'mine' }), P1).ok).toBe(true);
    expect(t.state.map!.annotations!.route).toBeDefined();
  });

  it('refuses hostile drawing payloads', () => {
    const t = table();
    const base = { id: 'a1', kind: 'line', points: [0, 0, 1, 1], color: 'cyan', visibility: 'all' };
    const bad: unknown[] = [
      null, [], { op: 'add' }, { op: 'paint' },
      { op: 'add', annotation: { ...base, kind: 'polygon' } },
      { op: 'add', annotation: { ...base, color: '#ff0000' } },
      { op: 'add', annotation: { ...base, visibility: 'p2' } },
      { op: 'add', annotation: { ...base, points: [0, 0, 1] } },
      { op: 'add', annotation: { ...base, points: [0, 0, 1, 1, 2, 2] } },
      { op: 'add', annotation: { ...base, points: [0, 0, 13, 1] } },
      { op: 'add', annotation: { ...base, points: [0, -1, 1, 1] } },
      { op: 'add', annotation: { ...base, points: [0, 0, Number.NaN, 1] } },
      { op: 'add', annotation: { ...base, points: [0, 0, '1', 1] } },
      { op: 'add', annotation: { ...base, kind: 'path', points: Array.from({ length: 402 }, () => 1) } },
      { op: 'add', annotation: { ...base, kind: 'text', points: [1, 1] } },
      { op: 'add', annotation: { ...base, kind: 'text', points: [1, 1], text: 'x'.repeat(81) } },
      { op: 'add', annotation: { ...base, kind: 'text', points: [1, 1], text: '   ' } },
      { op: 'add', annotation: { ...base, text: 'not a label' } },
      { op: 'add', annotation: { ...base, by: 'p1' } },
      { op: 'add', annotation: { ...base, expiresAt: '2999-01-01' } },
      { op: 'add', annotation: { ...base, id: '../../etc' } },
      { op: 'add', annotation: { ...base, onclick: 'alert(1)' } },
      { op: 'move', id: 'a1', dx: 1e9, dy: 0 },
      { op: 'move', id: 'a1', dx: Infinity, dy: 0 },
      { op: 'remove', id: 'missing' },
      { op: 'clear', scope: 'everything' },
      { op: 'setRules', rules: { playersMayDraw: true, playerTtl: 5 } },
      { op: 'setRules', rules: { playersMayDraw: true, playerTtl: 60.5 } },
      { op: 'setRules', rules: { playersMayDraw: 'yes', playerTtl: 60 } },
      { op: 'setRules', rules: { playersMayDraw: true, playerTtl: 60, gmOnly: false } },
    ];
    for (const op of bad) expect(t.send(annotate(op), GM).ok, JSON.stringify(op)).toBe(false);
    expect(t.state.map!.annotations).toBeUndefined();
    expect(t.send(annotate({ op: 'add', annotation: base }), GM).ok).toBe(true);
    expect(t.send(annotate({ op: 'add', annotation: base }), GM).ok).toBe(false); // id taken
    for (let i = 2; i <= 200; i++) t.send(annotate({ op: 'add', annotation: { ...base, id: `a${i}` } }), GM);
    expect(Object.keys(t.state.map!.annotations!).length).toBe(200);
    expect(t.send(annotate({ op: 'add', annotation: { ...base, id: 'a201' } }), GM).ok).toBe(false);
  });

  it('a whole map with bad drawings is refused', () => {
    const t = table();
    const ann = (id: string) => ({ id, kind: 'line', points: [0, 0, 1, 1], color: 'cyan', visibility: 'gm', by: 'gm' });
    expect(t.send({ type: 'setMap', map: { ...MAP, annotations: { a: ann('b') } } as unknown as TacticalMap }, GM).ok).toBe(false);
    const many = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`a${i}`, ann(`a${i}`)]));
    expect(t.send({ type: 'setMap', map: { ...MAP, annotations: many } as unknown as TacticalMap }, GM).ok).toBe(false);
    expect(t.send({ type: 'setMap', map: { ...MAP, annotations: { a: ann('a') } } as unknown as TacticalMap }, GM).ok).toBe(true);
    expect(projectState(t.state, P1).map!.annotations).toEqual({});
  });

  it('drawing and lighting work while an attack is pending', () => {
    const t = table();
    expect(() => validateIntent(t.state, annotate(line('x')), GM)).not.toThrow();
  });
});
