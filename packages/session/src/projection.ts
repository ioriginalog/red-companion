/**
 * Per-viewer redaction. The relay runs this before sending anything to a
 * player, so NPC stats/HP never leave the server for player connections.
 *
 * Players see in full: actors they control, and (by default) all PCs.
 * Everything else: name, side, Wound State, conditions, injury names.
 */
import { getInjury, woundState, type CheckResult, type CombatEvent, type Weapon } from '@cprc/rules-core';
import { projectPendingForPlayer } from './systems.js';
import { allegianceOf, factionOf, partyVision, projectMap } from './tactical.js';
import { visibleHandouts } from './handouts.js';
import { projectExtras } from './extras.js';
import { projectNet } from './netrun.js';
import type { Actor, Encounter, LogEntry, Pending, ProjectedActor, ProjectedEntry, ProjectedPending, RedactedCheck, SessionState, TacticalMap, Viewer, ViewState } from './types.js';

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
      ...(c.vehicle ? { vehicle: true as const } : {}),
    },
  };
  if (!canSeeFull(actor, viewer, opts)) return base;
  return {
    ...base, combatant: c, weapons: actor.weapons,
    ...(actor.notes ? { notes: actor.notes } : {}),
    // GM notes never leave the GM's view.
    ...(viewer.role === 'gm' && actor.gmNotes ? { gmNotes: actor.gmNotes } : {}),
  };
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
  // Initiative totals name every combatant; players don't get them.
  const { usage, hiddenActing: _h, initiative: _totals, ...rest } = enc;
  return {
    ...rest,
    order,
    turnIndex,
    deathSaveRequiredFor: enc.deathSaveRequiredFor && kn.known.has(enc.deathSaveRequiredFor) ? enc.deathSaveRequiredFor : null,
    ...(usage && kn.known.has(usage.actorId) ? { usage } : {}),
    ...(hidden ? { hiddenActing: true } : {}),
  };
}

function weaponTypeOf(state: SessionState, actorId: string, weaponId: string): { weaponType?: Weapon['type'] } {
  const w = state.actors[actorId]?.weapons.find((x) => x.id === weaponId);
  return w ? { weaponType: w.type } : {};
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
          // The type of a known attacker's weapon (the defender can see it), for the real range DV.
          ...(kn.known.has(a.attackerId) ? weaponTypeOf(state, a.attackerId, a.weaponId) : {}),
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
    case 'awaitingAreaDodge': {
      const f = projectPendingForPlayer(p, state) as typeof p;
      const sees = full(p.attackerId);
      // Built field by field (never spread), so a new field stays GM-only until it's listed here.
      return {
        kind: p.kind, id: p.id, attackerId: kn.aliasOf(p.attackerId), areaKind: p.areaKind, at: p.at, source: p.source,
        // An attacker whose sheet the player can't see shows only the total to beat (no STAT, skill or die).
        attack: sees ? p.attack : totalOnly(p.attack),
        // (NPC damage dice are stats)
        damageDice: sees ? p.damageDice : 0,
        // Unknown targets are dropped, not aliased: a list of `hidden` entries would be a count.
        targets: f.targets.filter((t) => kn.known.has(t.id)).map((t) => ({ id: t.id })),
        decisions: Object.fromEntries(Object.entries(f.decisions).filter(([k]) => kn.known.has(k))),
      };
    }
    case 'awaitingScatter': {
      const sees = full(p.attackerId);
      return {
        kind: p.kind, id: p.id, attackerId: kn.aliasOf(p.attackerId), areaKind: p.areaKind, at: p.at,
        attack: sees ? p.attack : totalOnly(p.attack),
        damageDice: sees ? p.damageDice : 0,
      };
    }
  }
}

/** What a player may know of a check whose roller's sheet they can't see: the total. */
export function totalOnly(c: CheckResult): RedactedCheck {
  return { total: c.total, redacted: true };
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
      handouts: state.handouts ?? {},
      ...(state.netrun ? { netrun: projectNet(state, viewer) } : {}),
      ...(state.extras ? { extras: state.extras } : {}),
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
    handouts: visibleHandouts(state.handouts ?? {}, viewer),
    ...(state.netrun ? { netrun: projectNet(state, viewer) } : {}),
    ...(state.extras ? { extras: projectExtras(state, viewer) } : {}),
  };
}

function viewMap(state: SessionState, viewer: Viewer): TacticalMap | null {
  if (!state.map) return null;
  return viewer.role === 'gm' ? state.map : maskUnexplored(projectMap(state.map, state.actors), state.actors, state.map);
}

/** Terrain code players get for squares the party has never seen. */
export const UNEXPLORED = '?';

/**
 * Players' terrain: squares the party has never explored (and can't see now)
 * read `UNEXPLORED`, and their cover records are dropped, so the layout of
 * unexplored areas never leaves the relay. Every wall that bounds what the
 * party sees is itself seen, so the client's line of sight is unchanged.
 */
function maskUnexplored(view: TacticalMap, actors: SessionState['actors'], full: TacticalMap): TacticalMap {
  const n = full.width * full.height;
  if (full.lighting?.revealAll || full.cells.length !== n) return view;
  const explored = full.explored && full.explored.length === n ? full.explored : null;
  const vision = partyVision(full, actors);
  const known = (i: number) => explored?.[i] === '1' || vision.has(`${i % full.width},${Math.floor(i / full.width)}`);
  let cells = '';
  let masked = false;
  for (let i = 0; i < n; i++) {
    if (known(i)) cells += full.cells[i];
    else { cells += UNEXPLORED; masked = true; }
  }
  if (!masked) return view;
  const out: TacticalMap = { ...view, cells };
  if (view.cover) {
    const cover = Object.fromEntries(Object.entries(view.cover).filter(([k]) => {
      const [x, y] = k.split(',').map(Number);
      return known(y! * full.width + x!);
    }));
    if (Object.keys(cover).length) out.cover = cover; else delete out.cover;
  }
  return out;
}

function eventSubject(e: CombatEvent): string | undefined {
  return 'targetId' in e ? e.targetId : 'combatantId' in e ? e.combatantId : undefined;
}

// ----- Player event scrubbing -----------------------------------------------------
//
// Not a hand-kept list of event shapes: every event is walked. Values under
// actor-id keys are aliased; id lists drop unknown ids; list entries that
// only concern unknown actors are dropped (so nothing reveals a count);
// any other string equal to an unknown actor's id becomes `hidden`; and
// unknown actors' names are replaced in free text.

/** Keys whose string value is always an actor id. */
const ACTOR_ID_KEYS = new Set([
  'attackerId', 'defenderId', 'targetId', 'combatantId', 'medicId', 'watcherId', 'asCombatantId',
  'byId', 'after', 'actorId', 'holderId', 'heldId', 'winnerId', 'loserId', 'runnerId', 'ownerId', 'sourceId',
]);
/** Keys whose value is a list of actor ids. */
const ACTOR_LIST_KEYS = new Set(['targetIds', 'actorIds', 'combatantIds']);
/** Keys that hold other kinds of ids or player ids: never treated as actor ids. */
const NON_ACTOR_KEYS = new Set(['id', 'by', 'weaponId', 'itemId', 'injuryId', 'mapId', 'pendingId', 'audience', 'type', 'visibility']);

interface Scrub {
  known: Set<string>;
  /** Ids of actors the player doesn't know (in the state before or after the entry). */
  unknownIds: Set<string>;
  /** Their names, longest first, for free-text replacement. */
  unknownNames: RegExp | null;
}

function scrubContext(after: SessionState, kn: Knowledge, before?: SessionState): Scrub {
  const unknownIds = new Set<string>();
  const names = new Set<string>();
  const knownNames = new Set<string>();
  for (const st of before ? [after, before] : [after]) {
    for (const a of Object.values(st.actors)) {
      if (kn.known.has(a.id)) { knownNames.add(a.combatant.name); continue; }
      unknownIds.add(a.id);
      names.add(a.combatant.name);
    }
  }
  // A name shared with a known actor can't be scrubbed without breaking that actor's lines.
  const list = [...names].filter((n) => n.trim().length >= 3 && !knownNames.has(n)).sort((x, y) => y.length - x.length);
  const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { known: kn.known, unknownIds, unknownNames: list.length ? new RegExp(`\\b(?:${list.map(esc).join('|')})\\b`, 'g') : null };
}

/** Every actor id an event mentions (for "does it concern anyone the player knows?"). */
function mentionedActors(v: unknown, out: string[] = [], key?: string): string[] {
  if (typeof v === 'string') { if (key && ACTOR_ID_KEYS.has(key)) out.push(v); return out; }
  if (Array.isArray(v)) {
    for (const x of v) {
      if (typeof x === 'string') { if (key && ACTOR_LIST_KEYS.has(key)) out.push(x); }
      else mentionedActors(x, out);
    }
    return out;
  }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) mentionedActors(x, out, k);
  return out;
}

function scrubValue(v: unknown, sc: Scrub, key?: string): unknown {
  if (typeof v === 'string') {
    if (key && NON_ACTOR_KEYS.has(key)) return v;
    if ((key && ACTOR_ID_KEYS.has(key)) || sc.unknownIds.has(v)) return sc.known.has(v) ? v : HIDDEN;
    return sc.unknownNames ? v.replace(sc.unknownNames, 'Unknown Contact') : v;
  }
  if (Array.isArray(v)) {
    if (key && ACTOR_LIST_KEYS.has(key)) return v.filter((x) => typeof x !== 'string' || sc.known.has(x));
    if (key && NON_ACTOR_KEYS.has(key)) return v;
    return v
      .filter((x) => {
        // An entry about unknown actors only (initiative entries, suppression results) is dropped.
        if (!x || typeof x !== 'object') return true;
        const ids = mentionedActors(x);
        return ids.length === 0 || ids.some((id) => sc.known.has(id));
      })
      .map((x) => scrubValue(x, sc));
  }
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, scrubValue(x, sc, k)]));
  }
  return v;
}

/** Drop events that only concern actors the player doesn't know about (they would reveal that someone is there). */
function concernsKnown(e: CombatEvent, sc: Scrub): boolean {
  // The GM may speak as an unseen voice; the speaker becomes `hidden`.
  if (e.type === 'chatMessage') return true;
  const ids = mentionedActors(e);
  return ids.length === 0 || ids.some((id) => sc.known.has(id));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Project one entry. `after` = state after the entry; `before` = state
 * before it (the relay always passes it, so players get exact diffs: newly
 * spotted NPCs appear, forgotten ones are removed, unknown ids never leak,
 * and a field is sent only when the player's view of it changed). Without
 * `before`, entries that touch the map or the encounter re-send every
 * actor the player knows.
 *
 * Players: an entry whose content is hidden (no visible events, or some
 * events withheld) carries no `by` or `intentType`. When nothing at all is
 * visible, `playerSees` is false and the relay sends nothing, so unseen
 * Turns, private rolls and other players' whispers can't even be counted.
 */
export function projectEntry(entry: LogEntry, viewer: Viewer, after: SessionState, opts?: ProjectionOptions, before?: SessionState): ProjectedEntry {
  const base = { seq: entry.seq, id: entry.id, at: entry.at };
  if (viewer.role === 'gm') {
    const patch: ProjectedEntry['patch'] = {};
    if (entry.patch.actors) {
      patch.actors = Object.fromEntries(Object.entries(entry.patch.actors).map(([id, a]) => [id, a ? projectActor(a, viewer, opts, after.map) : null]));
    }
    if ('map' in entry.patch) patch.map = after.map;
    if (entry.patch.encounter) patch.encounter = entry.patch.encounter;
    if ('pending' in entry.patch) patch.pending = entry.patch.pending ?? null;
    if (entry.patch.library) patch.library = entry.patch.library;
    if (entry.patch.handouts) patch.handouts = entry.patch.handouts;
    if (entry.patch.netrun) patch.netrun = projectNet(after, viewer);
    if (entry.patch.extras) patch.extras = entry.patch.extras;
    return { ...base, by: entry.by, intentType: entry.intent.type, events: entry.events, patch };
  }

  const actorsAfter = after.actors;
  const kn = knowledge(after);
  const visible = (id: string | undefined) => {
    const a = id ? actorsAfter[id] : undefined;
    return a ? canSeeFull(a, viewer, opts) : false;
  };
  const me = viewer.playerId;
  const sc = scrubContext(after, kn, before);
  let events = entry.events
    .filter((e) => !e.audience || e.audience.includes(me))
    .filter((e) => e.visibility === 'public' || visible(eventSubject(e)))
    .filter((e) => !sheetOnly(e, visible))
    .filter((e) => concernsKnown(e, sc))
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
  events = events.map((e) => scrubValue(e, sc) as CombatEvent);
  const withheld = events.length < entry.events.length;

  const patch: ProjectedEntry['patch'] = {};
  const nowActors = playerActors(after, viewer, kn, opts);
  if (before) {
    const knBefore = knowledge(before);
    const prevActors = playerActors(before, viewer, knBefore, opts);
    const diff: Record<string, ProjectedActor | null> = {};
    for (const [id, a] of Object.entries(nowActors)) if (!same(prevActors[id], a)) diff[id] = a;
    for (const id of Object.keys(prevActors)) if (!nowActors[id]) diff[id] = null;
    if (Object.keys(diff).length) patch.actors = diff;
    const encNow = projectEncounter(after.encounter, kn);
    if (!same(projectEncounter(before.encounter, knBefore), encNow)) patch.encounter = encNow;
    if ('map' in entry.patch || entry.patch.actors) {
      const m = viewMap(after, viewer);
      if (!same(viewMap(before, viewer), m)) patch.map = m;
    }
    if ('pending' in entry.patch) {
      const p = projectPending(entry.patch.pending ?? null, viewer, after, kn, opts);
      if (!same(projectPending(before.pending, viewer, before, knBefore, opts), p)) patch.pending = p;
    }
    if (entry.patch.handouts) {
      const h = visibleHandouts(entry.patch.handouts, viewer);
      if (!same(visibleHandouts(before.handouts ?? {}, viewer), h)) patch.handouts = h;
    }
    // (Turn changes move NET Actions left; controller changes move ownership.)
    if (after.netrun && (entry.patch.netrun || entry.patch.actors || entry.patch.encounter)) {
      const n = projectNet(after, viewer);
      if (!before.netrun || !same(projectNet(before, viewer), n)) patch.netrun = n;
    }
    if (after.extras && (entry.patch.extras || entry.patch.actors || 'map' in entry.patch)) {
      const x = projectExtras(after, viewer);
      if (!before.extras || !same(projectExtras(before, viewer), x)) patch.extras = x;
    }
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
    if ('map' in entry.patch || (entry.patch.actors && after.map)) patch.map = viewMap(after, viewer);
    if ('pending' in entry.patch) patch.pending = projectPending(entry.patch.pending ?? null, viewer, after, kn, opts);
    if (entry.patch.handouts) patch.handouts = visibleHandouts(entry.patch.handouts, viewer);
    if (after.netrun && (entry.patch.netrun || entry.patch.actors || entry.patch.encounter)) patch.netrun = projectNet(after, viewer);
    if (after.extras && (entry.patch.extras || entry.patch.actors || 'map' in entry.patch)) patch.extras = projectExtras(after, viewer);
  }
  // Who did what is shown only when everything they did is visible (or it was the player's own entry).
  const open = entry.by === `player:${me}` || (events.length > 0 && !withheld);
  return { ...base, ...(open ? { by: entry.by, intentType: entry.intent.type } : {}), events, patch };
}

/** Whether a projected entry shows the player anything; the relay sends players nothing for entries that don't. */
export function playerSees(p: ProjectedEntry): boolean {
  return p.events.length > 0 || Object.keys(p.patch).length > 0;
}

/** Keep results a table would announce; drop numbers that reveal hidden stats or HP. */
function redactCheck(c: CheckResult): CheckResult {
  return { base: 0, baseBreakdown: [], modifiers: [], roll: { natural: 0, kind: 'normal', value: 0 }, total: c.total, redacted: true };
}

/** NET Actions where one side of the contest is Black ICE or a Demon: which field holds its check. */
const NET_OPPONENT_SIDE: Record<string, 'check' | 'vs'> = {
  iceAttack: 'check', demonZap: 'check', speedCheck: 'vs', slide: 'vs', zap: 'vs', program: 'vs',
};

/** Remove keys and mark the event redacted. Narration must not print numbers from a redacted event. */
function omit<E extends CombatEvent>(e: E, keys: readonly string[]): E {
  const out: Record<string, unknown> = { ...e, redacted: true };
  for (const k of keys) delete out[k];
  return out as E;
}

/**
 * Events that only make sense on a character sheet (Humanity, cyberware,
 * therapy, Combat Awareness, ammo counts, GM HP edits). Players get them
 * only for actors whose sheet they can see.
 */
function sheetOnly(e: CombatEvent, visible: (id: string | undefined) => boolean): boolean {
  switch (e.type) {
    case 'ammoSpent':
    case 'ammoLoaded':
    case 'humanityChanged':
    case 'cyberwareInstalled':
    case 'cyberwareRemoved':
    case 'therapyResolved':
    case 'awarenessSet':
    case 'deathSavePenaltyChanged':
      return !visible(eventSubject(e));
    case 'hpAdjusted':
      return !visible(e.targetId);
    default:
      return false;
  }
}

/** HP, SP and stat numbers are removed for anyone whose sheet the viewer can't see. */
export function redactEvent(e: CombatEvent, visible: (id: string | undefined) => boolean): CombatEvent {
  switch (e.type) {
    case 'attackResolved':
      return {
        ...e,
        attack: visible(e.attackerId) ? e.attack : redactCheck(e.attack),
        defense: e.defense && !visible(e.defenderId) ? redactCheck(e.defense) : e.defense,
      };
    case 'damageApplied':
      return visible(e.targetId) ? e : omit(e, ['spBefore', 'spCounted', 'through', 'hpBefore', 'hpAfter']);
    case 'criticalInjury':
      return visible(e.targetId) ? e : omit(e, ['hpAfter']);
    case 'armorAblated':
      return visible(e.targetId) ? e : { ...e, pieces: [], redacted: true };
    case 'deathSaveRolled':
      return visible(e.targetId) ? e : omit(e, ['penalty', 'total', 'body']);
    case 'stabilized':
      return visible(e.targetId) ? e : omit(e, ['hpAfter']);
    case 'burning':
      return visible(e.targetId) ? e : omit(e, ['hpAfter']);
    case 'rested':
      return visible(e.targetId) ? e : omit(e, ['healed', 'hpAfter']);
    case 'damageDeflected':
      return visible(e.targetId) ? e : omit(e, ['amount']);
    case 'spotWeakness':
      return visible(e.combatantId) ? e : omit(e, ['bonus']);
    case 'checkRolled':
      return !e.combatantId || visible(e.combatantId) ? e : { ...e, check: redactCheck(e.check) };
    case 'stabilizationAttempted':
      return visible(e.medicId) ? e : { ...e, check: redactCheck(e.check) };
    case 'injuryTreated':
      return visible(e.medicId) ? e : { ...e, check: redactCheck(e.check) };
    case 'initiativeRolled':
      return { ...e, entries: e.entries.map((x) => (visible(x.combatantId) ? x : { ...x, base: 0, roll: 0, total: 0, tiebreaks: [] })) };
    case 'suppressiveFireResolved':
      return {
        ...e,
        attack: visible(e.attackerId) ? e.attack : redactCheck(e.attack),
        results: e.results.map((r) => (visible(r.targetId) ? r : { ...r, resist: redactCheck(r.resist) })),
      };
    case 'smartAmmoRetry':
      return {
        ...e,
        ...(visible(e.attackerId) ? {} : { roll: { natural: 0, kind: 'normal' as const, value: 0 }, redacted: true }),
        ...(e.defense && !visible(e.defenderId) ? { defense: redactCheck(e.defense) } : {}),
      };
    case 'netAction': {
      if (!visible(e.combatantId)) return omit({ ...e, ...(e.check ? { check: redactCheck(e.check) } : {}), ...(e.vs ? { vs: redactCheck(e.vs) } : {}) }, ['dice', 'amount']);
      // Black ICE and Demon stats are GM-only: their side of a contest shows its total.
      const side = NET_OPPONENT_SIDE[e.action];
      if (side === 'check' && e.check) return { ...e, check: redactCheck(e.check) };
      if (side === 'vs' && e.vs) return { ...e, vs: redactCheck(e.vs) };
      return e;
    }
    case 'gearAction':
      return visible(e.combatantId) ? e : omit({ ...e, ...(e.check ? { check: redactCheck(e.check) } : {}) }, ['amount', 'hpLeft', 'dv']);
    case 'extraResolved':
      return visible(e.combatantId) || !e.rolls ? e : { ...e, rolls: e.rolls.map(({ label, total }) => ({ label, total })) };
    default:
      return e;
  }
}

export function emptyView(sessionId: string): ViewState {
  return { sessionId, seq: 0, actors: {}, encounter: { active: false, round: 0, order: [], turnIndex: 0, deathSaveRequiredFor: null }, pending: null, map: null, handouts: {} /* */ };
}

/** Client-side reducer for projected entries. */
export function applyProjectedEntry(view: ViewState, entry: ProjectedEntry): ViewState {
  // Players never receive entries they can't see, so seqs may skip; anything already applied is ignored.
  if (entry.seq <= view.seq) return view;
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
    ...(entry.patch.handouts ? { handouts: entry.patch.handouts } : {}),
    ...(entry.patch.netrun ? { netrun: entry.patch.netrun } : {}),
    ...(entry.patch.extras ? { extras: entry.patch.extras } : {}),
  };
}
