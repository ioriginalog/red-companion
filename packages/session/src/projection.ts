/**
 * Per-viewer redaction. The relay runs this before sending anything to a
 * player, so NPC stats/HP never leave the server for player connections.
 *
 * Players see in full: actors they control, and (by default) all PCs.
 * Everything else: name, side, Wound State, conditions, injury names.
 */
import { getInjury, woundState, type CheckResult, type CombatEvent } from '@cprc/rules-core';
import { allegianceOf, factionOf, projectMap } from './tactical.js';
// --- Track N ---
import { projectNet } from './netrun.js';
// --- end Track N ---
import type { Actor, LogEntry, ProjectedActor, ProjectedEntry, SessionState, TacticalMap, Viewer, ViewState } from './types.js';

export interface ProjectionOptions {
  /** Players can see other PCs' sheets. Default true. */
  revealPcs?: boolean;
}

export function canSeeFull(actor: Actor, viewer: Viewer, opts: ProjectionOptions = {}): boolean {
  if (viewer.role === 'gm') return true;
  if (actor.controller === viewer.playerId) return true;
  return (opts.revealPcs ?? true) && actor.combatant.side === 'pc';
}

/** Hostile and neutral NPCs the party hasn't seen yet stay anonymous to players. */
function isAnonymous(actor: Actor, viewer: Viewer, map: TacticalMap | null): boolean {
  if (viewer.role === 'gm' || !map || factionOf(actor) === 'friendly') return false;
  return !map.spotted.includes(actor.id);
}

export function projectActor(actor: Actor, viewer: Viewer, opts?: ProjectionOptions, map: TacticalMap | null = null): ProjectedActor {
  const c = actor.combatant;
  const anon = isAnonymous(actor, viewer, map);
  const base: ProjectedActor = {
    id: actor.id,
    controller: actor.controller,
    public: {
      name: anon ? 'Unknown Contact' : c.name,
      side: c.side,
      allegiance: allegianceOf(actor),
      ...(actor.portrait && !anon ? { portrait: actor.portrait } : {}),
      woundState: woundState(c.hp),
      conditions: c.conditions,
      injuries: c.criticalInjuries.map((i) => getInjury(i.injuryId).name),
    },
  };
  return canSeeFull(actor, viewer, opts) ? { ...base, combatant: c, weapons: actor.weapons, ...(actor.notes ? { notes: actor.notes } : {}) } : base;
}

export function projectState(state: SessionState, viewer: Viewer, opts?: ProjectionOptions): ViewState {
  return {
    sessionId: state.sessionId,
    seq: state.seq,
    actors: Object.fromEntries(Object.values(state.actors).map((a) => [a.id, projectActor(a, viewer, opts, state.map)])),
    encounter: state.encounter,
    pending: state.pending,
    map: viewMap(state, viewer),
    ...(viewer.role === 'gm' ? { library: state.library } : {}),
    // --- Track N ---
    ...(state.netrun ? { netrun: projectNet(state, viewer) } : {}),
    // --- end Track N ---
  };
}

function viewMap(state: SessionState, viewer: Viewer): TacticalMap | null {
  if (!state.map) return null;
  return viewer.role === 'gm' ? state.map : projectMap(state.map, state.actors);
}

function eventSubject(e: CombatEvent): string | undefined {
  return 'targetId' in e ? e.targetId : 'combatantId' in e ? e.combatantId : undefined;
}

/**
 * Project one entry. `after` = state after applying the entry (used to decide
 * what the viewer may see).
 *
 * Fog of war: any change to the map or to actors can change what the party
 * sees, so those entries carry the whole re-projected map, and a map change
 * re-sends every actor (a newly spotted NPC gets its name back).
 */
export function projectEntry(entry: LogEntry, viewer: Viewer, after: SessionState, opts?: ProjectionOptions): ProjectedEntry {
  const actorsAfter = after.actors;
  const visible = (id: string | undefined) => {
    if (viewer.role === 'gm') return true;
    const a = id ? actorsAfter[id] : undefined;
    return a ? canSeeFull(a, viewer, opts) : false;
  };
  const me = viewer.role === 'gm' ? 'gm' : viewer.playerId;
  const events = entry.events
    .filter((e) => viewer.role === 'gm' || !e.audience || e.audience.includes(me))
    .filter((e) => e.visibility === 'public' || visible(eventSubject(e)))
    .map((e) => (viewer.role === 'gm' ? e : redactEvent(e, visible)));
  // Don't reveal hidden tokens: drop their checks, trim them from area results.
  if (viewer.role !== 'gm' && after.map && events.some((e) => e.type === 'areaResolved' || e.type === 'checkRolled')) {
    const map = after.map;
    const seen = projectMap(map, actorsAfter).tokens;
    const hidden = (id: string) => !!map.tokens[id] && !seen[id];
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]!;
      if (e.type === 'areaResolved') events[i] = { ...e, targetIds: e.targetIds.filter((id) => !hidden(id)) };
      else if (e.type === 'checkRolled' && e.combatantId && hidden(e.combatantId)) events.splice(i, 1);
    }
  }
  const patch: ProjectedEntry['patch'] = {};
  if (entry.patch.actors) {
    patch.actors = Object.fromEntries(Object.entries(entry.patch.actors).map(([id, a]) => [id, a ? projectActor(a, viewer, opts, after.map) : null]));
  }
  if ('map' in entry.patch && viewer.role !== 'gm') {
    patch.actors = { ...patch.actors, ...Object.fromEntries(Object.values(actorsAfter).map((a) => [a.id, projectActor(a, viewer, opts, after.map)])) };
  }
  if ('map' in entry.patch || (entry.patch.actors && after.map)) patch.map = viewMap(after, viewer);
  if (entry.patch.encounter) patch.encounter = entry.patch.encounter;
  if ('pending' in entry.patch) patch.pending = entry.patch.pending ?? null;
  if (entry.patch.library && viewer.role === 'gm') patch.library = entry.patch.library;
  // --- Track N --- (Turn changes move NET Actions left; controller changes move ownership.)
  if (after.netrun && (entry.patch.netrun || entry.patch.actors || entry.patch.encounter)) patch.netrun = projectNet(after, viewer);
  // --- end Track N ---
  return { seq: entry.seq, id: entry.id, at: entry.at, by: entry.by, intentType: entry.intent.type, events, patch };
}

/** Keep results a table would announce; drop numbers that reveal hidden stats or HP. */
function redactCheck(c: CheckResult): CheckResult {
  return { base: 0, baseBreakdown: [], modifiers: [], roll: { natural: 0, kind: 'normal', value: 0 }, total: c.total, redacted: true };
}

export function redactEvent(e: CombatEvent, visible: (id: string | undefined) => boolean): CombatEvent {
  switch (e.type) {
    case 'attackResolved':
      return {
        ...e,
        attack: visible(e.attackerId) ? e.attack : redactCheck(e.attack),
        defense: e.defense && !visible(e.defenderId) ? redactCheck(e.defense) : e.defense,
      };
    case 'criticalInjury':
      return visible(e.targetId) ? e : { ...e, hpAfter: 0 };
    case 'armorAblated':
      return visible(e.targetId) ? e : { ...e, pieces: [] };
    case 'deathSaveRolled':
      return visible(e.targetId) ? e : { ...e, penalty: 0, total: 0, body: 0 };
    case 'deathSavePenaltyChanged':
      return visible(e.targetId) ? e : { ...e, from: 0, to: 0 };
    case 'stabilized':
      return visible(e.targetId) ? e : { ...e, hpAfter: 0 };
    case 'checkRolled':
      return !e.combatantId || visible(e.combatantId) ? e : { ...e, check: redactCheck(e.check) };
    case 'stabilizationAttempted':
      return visible(e.medicId) ? e : { ...e, check: redactCheck(e.check) };
    case 'initiativeRolled':
      return { ...e, entries: e.entries.map((x) => (visible(x.combatantId) ? x : { ...x, base: 0, roll: 0, total: 0, tiebreaks: [] })) };
    case 'suppressiveFireResolved':
      return {
        ...e,
        attack: visible(e.attackerId) ? e.attack : redactCheck(e.attack),
        results: e.results.map((r) => (visible(r.targetId) ? r : { ...r, resist: redactCheck(r.resist) })),
      };
    default:
      return e;
  }
}

export function emptyView(sessionId: string): ViewState {
  return { sessionId, seq: 0, actors: {}, encounter: { active: false, round: 0, order: [], turnIndex: 0, deathSaveRequiredFor: null }, pending: null, map: null };
}

/** Client-side reducer for projected entries. */
export function applyProjectedEntry(view: ViewState, entry: ProjectedEntry): ViewState {
  if (entry.seq !== view.seq + 1) throw new Error(`Expected seq ${view.seq + 1}, got ${entry.seq}`);
  const actors = { ...view.actors };
  for (const [id, a] of Object.entries(entry.patch.actors ?? {})) {
    if (a === null) delete actors[id];
    else actors[id] = a;
  }
  return {
    ...view,
    seq: entry.seq,
    actors,
    encounter: entry.patch.encounter ?? view.encounter,
    pending: 'pending' in entry.patch ? (entry.patch.pending ?? null) : view.pending,
    map: 'map' in entry.patch ? (entry.patch.map ?? null) : view.map,
    ...(entry.patch.library ? { library: entry.patch.library } : {}),
    // --- Track N ---
    ...(entry.patch.netrun ? { netrun: entry.patch.netrun } : {}),
    // --- end Track N ---
  };
}
