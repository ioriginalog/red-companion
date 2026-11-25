/**
 * Per-viewer redaction. The relay runs this before sending anything to a
 * player, so NPC stats/HP never leave the server for player connections.
 *
 * Players see in full: actors they control, and (by default) all PCs.
 * Everything else: name, side, Wound State, conditions, injury names.
 */
import { getInjury, woundState, type CheckResult, type CombatEvent } from '@cprc/rules-core';
import { projectPendingForPlayer } from './systems.js'; // Track K
import { allegianceOf, factionOf, projectMap } from './tactical.js';
import { visibleHandouts } from './handouts.js'; // Track U
import { projectExtras } from './extras.js'; // Round 3 X
// --- Track N ---
import { projectNet } from './netrun.js';
// --- end Track N ---
import type { Actor, Encounter, LogEntry, Pending, ProjectedActor, ProjectedEntry, ProjectedPending, SessionState, TacticalMap, Viewer, ViewState } from './types.js';

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

// ----- Player knowledge (fog of war) ----------------------------------------------
//
// Players only ever receive actors they know about: the party and allies
// always; hostile and neutral NPCs once the party has spotted them on the map
// (or, with no map, while they are in an active encounter). Unknown actors
// are omitted entirely, including from the Turn order, so players can't count
// unseen hostiles or tell where they sit. When an unknown actor is acting,
// the order shows a single opaque `hidden` slot (and `hiddenActing: true`);
// any event or pending step that mentions an unknown actor uses `hidden` too.

export const HIDDEN = 'hidden';

/** Actor ids players may know about in this state. */
export function playerKnown(state: SessionState): Set<string> {
  const out = new Set<string>();
  const order = new Set(state.encounter.active ? state.encounter.order : []);
  for (const a of Object.values(state.actors)) {
    if (factionOf(a) === 'friendly') out.add(a.id);
    else if (state.map ? state.map.spotted.includes(a.id) : order.has(a.id)) out.add(a.id);
  }
  return out;
}

interface Knowledge { known: Set<string>; aliasOf: (id: string) => string }

function knowledge(state: SessionState): Knowledge {
  const known = playerKnown(state);
  return { known, aliasOf: (id) => (known.has(id) ? id : HIDDEN) };
}

function placeholder(id: string): ProjectedActor {
  return {
    id, controller: 'gm', placeholder: true,
    public: {
      name: 'Unknown Contact', side: 'npc', allegiance: 'neutral', woundState: 'unhurt',
      conditions: { prone: false, unconscious: false, dead: false, stabilized: false }, injuries: [],
    },
  };
}

/** True when an actor the players don't know about holds the current Turn. */
function hiddenActing(enc: Encounter, kn: Knowledge): boolean {
  const cur = enc.active ? enc.order[enc.turnIndex] : undefined;
  return !!cur && !kn.known.has(cur);
}

/**
 * The Turn order as players see it: known actors only, with one `hidden`
 * slot standing in for the current Turn when an unknown actor holds it.
 * Consecutive unknown Turns look identical, so the slot reveals no count.
 */
function projectEncounter(enc: Encounter, kn: Knowledge): Encounter {
  const hidden = hiddenActing(enc, kn);
  const order: string[] = [];
  let turnIndex = 0;
  enc.order.forEach((id, i) => {
    const current = enc.active && i === enc.turnIndex;
    if (current && hidden) { turnIndex = order.length; order.push(HIDDEN); return; }
    if (!kn.known.has(id)) return;
    if (current) turnIndex = order.length;
    order.push(id);
  });
  const { usage, hiddenActing: _h, ...rest } = enc;
  return {
    ...rest,
    order,
    turnIndex,
    deathSaveRequiredFor: enc.deathSaveRequiredFor && kn.known.has(enc.deathSaveRequiredFor) ? enc.deathSaveRequiredFor : null,
    ...(usage && kn.known.has(usage.actorId) ? { usage } : {}),
    ...(hidden ? { hiddenActing: true } : {}),
  };
}

function projectPending(p: Pending | null, viewer: Viewer, state: SessionState, kn: Knowledge, opts?: ProjectionOptions): ProjectedPending | null {
  if (!p || viewer.role === 'gm') return p;
  const full = (id: string) => { const a = state.actors[id]; return !!a && canSeeFull(a, viewer, opts); };
  switch (p.kind) {
    case 'awaitingDodge': {
      const a = p.attack;
      return {
        kind: p.kind, id: p.id, defenderId: kn.aliasOf(p.defenderId),
        attack: {
          type: 'rangedAttack', attackerId: kn.aliasOf(a.attackerId), defenderId: kn.aliasOf(a.defenderId),
          weaponId: full(a.attackerId) ? a.weaponId : 'unknown', distance: a.distance,
          ...(a.mode ? { mode: a.mode } : {}), ...(a.aimTarget ? { aimTarget: a.aimTarget } : {}),
        },
      };
    }
    case 'awaitingDamage':
      return {
        kind: p.kind, id: p.id, attackerId: kn.aliasOf(p.attackerId), targetId: kn.aliasOf(p.targetId),
        ...(full(p.attackerId) ? { spec: p.spec } : {}),
      };
    case 'awaitingWatch':
      return { kind: p.kind, id: p.id, watcherId: kn.aliasOf(p.watcherId), targetId: kn.aliasOf(p.targetId) };
    // --- Track K ---
    case 'awaitingAreaDodge': {
      const f = projectPendingForPlayer(p, state) as typeof p;
      return {
        ...f, attackerId: kn.aliasOf(p.attackerId),
        targets: f.targets.map((t) => ({ id: kn.aliasOf(t.id) })),
        decisions: Object.fromEntries(Object.entries(f.decisions).map(([k, v]) => [kn.aliasOf(k), v])),
      };
    }
    // --- end Track K ---
  }
}

/** Every actor a player may see (known actors, plus the `hidden` stand-in while an unknown actor acts). */
function playerActors(state: SessionState, viewer: Viewer, kn: Knowledge, opts?: ProjectionOptions): Record<string, ProjectedActor> {
  const out: Record<string, ProjectedActor> = {};
  for (const a of Object.values(state.actors)) if (kn.known.has(a.id)) out[a.id] = projectActor(a, viewer, opts, state.map);
  if (hiddenActing(state.encounter, kn)) out[HIDDEN] = placeholder(HIDDEN);
  return out;
}

export function projectState(state: SessionState, viewer: Viewer, opts?: ProjectionOptions): ViewState {
  if (viewer.role === 'gm') {
    return {
      sessionId: state.sessionId, seq: state.seq,
      actors: Object.fromEntries(Object.values(state.actors).map((a) => [a.id, projectActor(a, viewer, opts, state.map)])),
      encounter: state.encounter, pending: state.pending, map: state.map, library: state.library,
      handouts: state.handouts ?? {}, // Track U
      // --- Track N ---
      ...(state.netrun ? { netrun: projectNet(state, viewer) } : {}),
      // --- end Track N ---
      ...(state.extras ? { extras: state.extras } : {}), // Round 3 X
    };
  }
  const kn = knowledge(state);
  return {
    sessionId: state.sessionId,
    seq: state.seq,
    actors: playerActors(state, viewer, kn, opts),
    encounter: projectEncounter(state.encounter, kn),
    pending: projectPending(state.pending, viewer, state, kn, opts),
    map: viewMap(state, viewer),
    handouts: visibleHandouts(state.handouts ?? {}, viewer), // Track U
    // --- Track N ---
    ...(state.netrun ? { netrun: projectNet(state, viewer) } : {}),
    // --- end Track N ---
    ...(state.extras ? { extras: projectExtras(state, viewer) } : {}), // Round 3 X
  };
}

function viewMap(state: SessionState, viewer: Viewer): TacticalMap | null {
  if (!state.map) return null;
  return viewer.role === 'gm' ? state.map : projectMap(state.map, state.actors);
}

function eventSubject(e: CombatEvent): string | undefined {
  return 'targetId' in e ? e.targetId : 'combatantId' in e ? e.combatantId : undefined;
}

const ID_KEYS = new Set(['attackerId', 'defenderId', 'targetId', 'combatantId', 'medicId', 'watcherId', 'asCombatantId']);

/** Rewrite every actor id in an event that the player doesn't know. */
function aliasIds<T>(v: T, f: (id: string) => string, key?: string): T {
  if (typeof v === 'string') return (key && ID_KEYS.has(key) ? f(v) : v) as T;
  if (Array.isArray(v)) return v.map((x) => aliasIds(x, f, key === 'targetIds' ? 'targetId' : undefined)) as T;
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, aliasIds(x, f, k)])) as T;
  }
  return v;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Project one entry. `after` = state after the entry; `before` = state
 * before it (the relay always passes it, so players get exact actor diffs:
 * newly spotted NPCs appear, forgotten ones are removed, unknown ids never
 * leak). Without `before`, entries that touch the map or the encounter
 * re-send every actor the player knows.
 */
export function projectEntry(entry: LogEntry, viewer: Viewer, after: SessionState, opts?: ProjectionOptions, before?: SessionState): ProjectedEntry {
  const base = { seq: entry.seq, id: entry.id, at: entry.at, by: entry.by, intentType: entry.intent.type };
  if (viewer.role === 'gm') {
    const patch: ProjectedEntry['patch'] = {};
    if (entry.patch.actors) {
      patch.actors = Object.fromEntries(Object.entries(entry.patch.actors).map(([id, a]) => [id, a ? projectActor(a, viewer, opts, after.map) : null]));
    }
    if ('map' in entry.patch) patch.map = after.map;
    if (entry.patch.encounter) patch.encounter = entry.patch.encounter;
    if ('pending' in entry.patch) patch.pending = entry.patch.pending ?? null;
    if (entry.patch.library) patch.library = entry.patch.library;
    if (entry.patch.handouts) patch.handouts = entry.patch.handouts; // Track U
    // --- Track N ---
    if (entry.patch.netrun) patch.netrun = projectNet(after, viewer);
    // --- end Track N ---
    if (entry.patch.extras) patch.extras = entry.patch.extras; // Round 3 X
    return { ...base, events: entry.events, patch };
  }

  const actorsAfter = after.actors;
  const kn = knowledge(after);
  const visible = (id: string | undefined) => {
    const a = id ? actorsAfter[id] : undefined;
    return a ? canSeeFull(a, viewer, opts) : false;
  };
  const me = viewer.playerId;
  let events = entry.events
    .filter((e) => !e.audience || e.audience.includes(me))
    .filter((e) => e.visibility === 'public' || visible(eventSubject(e)))
    // NPC ammo counts are stats.
    .filter((e) => e.type !== 'ammoSpent' || visible(e.combatantId))
    .map((e) => redactEvent(e, visible));
  // Don't reveal hidden tokens: drop their checks, trim them from area results.
  if (after.map && events.some((e) => e.type === 'areaResolved' || e.type === 'checkRolled')) {
    const map = after.map;
    const seen = projectMap(map, actorsAfter).tokens;
    const hidden = (id: string) => !!map.tokens[id] && !seen[id];
    events = events
      .filter((e) => !(e.type === 'checkRolled' && e.combatantId && hidden(e.combatantId)))
      .map((e) => (e.type === 'areaResolved' ? { ...e, targetIds: e.targetIds.filter((id) => !hidden(id)) } : e));
  }
  events = events.map((e) => aliasIds(e, kn.aliasOf));

  const patch: ProjectedEntry['patch'] = {};
  const nowActors = playerActors(after, viewer, kn, opts);
  if (before) {
    const prevActors = playerActors(before, viewer, knowledge(before), opts);
    const diff: Record<string, ProjectedActor | null> = {};
    for (const [id, a] of Object.entries(nowActors)) if (!same(prevActors[id], a)) diff[id] = a;
    for (const id of Object.keys(prevActors)) if (!nowActors[id]) diff[id] = null;
    if (Object.keys(diff).length) patch.actors = diff;
    const encNow = projectEncounter(after.encounter, kn);
    if (entry.patch.encounter || !same(projectEncounter(before.encounter, knowledge(before)), encNow)) patch.encounter = encNow;
  } else {
    const touchesKnowledge = 'map' in entry.patch || !!entry.patch.encounter;
    const ids = touchesKnowledge ? Object.keys(nowActors) : Object.keys(entry.patch.actors ?? {});
    const diff: Record<string, ProjectedActor | null> = {};
    for (const id of ids) {
      if (nowActors[id]) diff[id] = nowActors[id]!;
      else if (entry.patch.actors?.[id] === null && !touchesKnowledge) diff[id] = null;
    }
    if (Object.keys(diff).length) patch.actors = diff;
    if (touchesKnowledge) patch.encounter = projectEncounter(after.encounter, kn);
  }
  if ('map' in entry.patch || (entry.patch.actors && after.map)) patch.map = viewMap(after, viewer);
  if ('pending' in entry.patch) patch.pending = projectPending(entry.patch.pending ?? null, viewer, after, kn, opts);
  if (entry.patch.handouts) patch.handouts = visibleHandouts(entry.patch.handouts, viewer); // Track U
  // --- Track N --- (Turn changes move NET Actions left; controller changes move ownership.)
  if (after.netrun && (entry.patch.netrun || entry.patch.actors || entry.patch.encounter)) patch.netrun = projectNet(after, viewer);
  // --- end Track N ---
  if (after.extras && (entry.patch.extras || entry.patch.actors || 'map' in entry.patch)) patch.extras = projectExtras(after, viewer); // Round 3 X
  return { ...base, events, patch };
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
  return { sessionId, seq: 0, actors: {}, encounter: { active: false, round: 0, order: [], turnIndex: 0, deathSaveRequiredFor: null }, pending: null, map: null, handouts: {} /* Track U */ };
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
    ...(entry.patch.handouts ? { handouts: entry.patch.handouts } : {}), // Track U
    // --- Track N ---
    ...(entry.patch.netrun ? { netrun: entry.patch.netrun } : {}),
    ...(entry.patch.extras ? { extras: entry.patch.extras } : {}), // Round 3 X
    // --- end Track N ---
  };
}
