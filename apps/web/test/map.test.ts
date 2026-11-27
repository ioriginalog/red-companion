import { describe, expect, it } from 'vitest';
import { maxHP, scriptedDice, type Combatant, type Stats } from '@cprc/rules-core';
import {
  applyEntry, emptySession, handleIntent, partyVision, projectState,
  type Actor, type Intent, type SessionState, type TacticalMap, type ViewState, type Viewer,
} from '@cprc/session';
import { pendingArea } from '../src/map/pendingArea.js';
import { clientVision } from '../src/map/vision.js';
import { distanceTo, hitAnnotation, thin } from '../src/map/geometry.js';

const ROWS = ['..........',
              '..........',
              '....c.....',
              '..........',
              '..........'];
const MAP: TacticalMap = { id: 'm', name: 'Yard', width: 10, height: 5, cells: ROWS.join(''), cellPx: 64, sightRange: 30, tokens: { solo: { x: 1, y: 2 } }, watches: {}, spotted: [] };
const view = (pending: unknown, tokens: Record<string, { x: number; y: number }> = MAP.tokens): ViewState =>
  ({ sessionId: 's', seq: 1, actors: {}, encounter: { active: false, round: 0, order: [], turnIndex: 0, deathSaveRequiredFor: null }, pending, map: { ...MAP, tokens } } as unknown as ViewState);
const check = { total: 15 };

describe('Incoming area overlay', () => {
  it('shows the 5 × 5 blast at the landing square; cover protects the squares behind it', () => {
    const a = pendingArea(view({ kind: 'awaitingAreaDodge', id: 'p', attackerId: 'hidden', areaKind: 'launcher', at: { x: 5, y: 2 }, attack: check, damageDice: 0, source: 'explosive', targets: [], decisions: {} }))!;
    expect(a.kind).toBe('blast');
    expect(a.cells.length).toBe(25);
    expect(a.hit.has('5,2')).toBe(true);
    expect(a.hit.has('3,2')).toBe(false); // behind the crate at 4,2
    expect(a.label).toBe('Blast Incoming');
  });
  it('shows where a missed explosive may land while the GM places it', () => {
    const a = pendingArea(view({ kind: 'awaitingScatter', id: 'p', attackerId: 'hidden', areaKind: 'thrownGrenade', at: { x: 0, y: 0 }, attack: check, damageDice: 0 }))!;
    expect(a.kind).toBe('scatter');
    expect(a.cells.length).toBe(9); // clipped at the map corner
  });
  it('draws a shotgun cone only from a shooter the viewer can see', () => {
    const p = { kind: 'awaitingAreaDodge', id: 'p', attackerId: 'boss', areaKind: 'shotgunShell', at: { x: 3, y: 2 }, attack: check, damageDice: 0, source: 'shotgunShell', targets: [], decisions: {} };
    const seen = pendingArea(view(p, { ...MAP.tokens, boss: { x: 0, y: 2 } }))!;
    expect(seen.kind).toBe('shell');
    expect(seen.hit.has('1,2')).toBe(true);
    const hidden = pendingArea(view({ ...p, attackerId: 'hidden' }))!;
    expect(hidden.kind).toBe('aim');
    expect(hidden.cells).toEqual([{ x: 3, y: 2 }]);
  });
  it('is absent otherwise', () => {
    expect(pendingArea(view(null))).toBeNull();
    expect(pendingArea(view({ kind: 'awaitingWatch', id: 'p', watcherId: 'a', targetId: 'b' }))).toBeNull();
  });
});

const BASE: Stats = { INT: 6, REF: 6, DEX: 6, TECH: 6, COOL: 6, WILL: 6, LUCK: 6, MOVE: 6, BODY: 6, EMP: 6 };
function actor(id: string, side: 'pc' | 'npc', controller: string): Actor {
  const max = maxHP(6, 6);
  const combatant = {
    id, name: id, side, stats: BASE, skills: {}, hp: { max, current: max }, armor: [], criticalInjuries: [], deathSave: { accumulatedPenalty: 0 },
    conditions: { prone: false, unconscious: false, dead: false, stabilized: false },
  } as Combatant;
  return { id, controller, weapons: [], combatant };
}

describe('Client fog uses the relay’s vision', () => {
  it('matches the server for the GM and for players, with lights and darkness', () => {
    let state: SessionState = emptySession('s');
    const GM: Viewer = { role: 'gm' };
    let n = 0;
    const send = (i: Intent) => { const r = handleIntent(state, i, GM, { dice: scriptedDice({}), now: () => '2077-01-01T00:00:00Z', newId: () => `i${++n}` }); expect(r.ok).toBe(true); if (r.ok) state = applyEntry(state, r.entry); };
    send({ type: 'addActor', actor: actor('solo', 'pc', 'p1') });
    send({ type: 'addActor', actor: actor('ganger', 'npc', 'gm') });
    send({ type: 'setMap', map: { ...MAP, tokens: { solo: { x: 1, y: 2 }, ganger: { x: 8, y: 4 } } } });
    send({ type: 'light', op: { op: 'setAmbient', ambient: 'dark' } });
    send({ type: 'light', op: { op: 'upsert', light: { id: 'lamp', at: { x: 6, y: 0 }, bright: 2, dim: 1, on: true } } });
    send({ type: 'light', op: { op: 'upsert', light: { id: 'torch', attachedTo: 'ganger', bright: 1, dim: 0, on: true } } });
    const server = [...partyVision(state.map!, state.actors)].sort();
    const gm = clientVision(projectState(state, GM));
    const player = clientVision(projectState(state, { role: 'player', playerId: 'p1' }));
    expect([...gm.vision].sort()).toEqual(server);
    expect([...player.vision].sort()).toEqual(server);
    expect(player.levels!.get('6,1')).toBe('bright');
    expect(gm.levels!.get('6,1')).toBe('bright');
  });
});

describe('Drawing geometry', () => {
  it('hit-tests strokes and keeps only the caller’s own', () => {
    const line = { id: 'a', kind: 'line', points: [0, 0, 4, 0], color: 'cyan', visibility: 'all', by: 'p1' } as const;
    const circle = { id: 'b', kind: 'circle', points: [5, 5, 6, 5], color: 'red', visibility: 'all', by: 'gm' } as const;
    expect(distanceTo(line, { x: 2, y: 0.2 })).toBeCloseTo(0.2);
    expect(distanceTo(circle, { x: 5, y: 6 })).toBeCloseTo(0);
    expect(hitAnnotation([line, circle], { x: 5, y: 6.1 }, 0.3, () => true)?.id).toBe('b');
    expect(hitAnnotation([line, circle], { x: 5, y: 6.1 }, 0.3, (a) => a.by === 'p1')).toBeNull();
  });
  it('thins long strokes to the cap', () => {
    const pts = Array.from({ length: 1000 }, (_, i) => ({ x: i / 100, y: 0 }));
    const t = thin(pts, 200);
    expect(t.length).toBe(200);
    expect(t[0]).toEqual(pts[0]);
    expect(t[199]).toEqual(pts[999]);
  });
});
