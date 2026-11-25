/**
 * Per-viewer redaction. The relay runs this before sending anything to a
 * player, so NPC stats/HP never leave the server for player connections.
 *
 * Players see in full: actors they control, and (by default) all PCs.
 * Everything else: name, side, Wound State, conditions, injury names.
 */
import { getInjury, woundState, type CheckResult, type CombatEvent } from '@cprc/rules-core';
import type { Actor, LogEntry, ProjectedActor, ProjectedEntry, SessionState, Viewer, ViewState } from './types.js';

export interface ProjectionOptions {
  /** Players can see other PCs' sheets. Default true. */
  revealPcs?: boolean;
}

export function canSeeFull(actor: Actor, viewer: Viewer, opts: ProjectionOptions = {}): boolean {
  if (viewer.role === 'gm') return true;
  if (actor.controller === viewer.playerId) return true;
  return (opts.revealPcs ?? true) && actor.combatant.side === 'pc';
}

export function projectActor(actor: Actor, viewer: Viewer, opts?: ProjectionOptions): ProjectedActor {
  const c = actor.combatant;
  const base: ProjectedActor = {
    id: actor.id,
    controller: actor.controller,
    public: {
      name: c.name,
      side: c.side,
      woundState: woundState(c.hp),
      conditions: c.conditions,
      injuries: c.criticalInjuries.map((i) => getInjury(i.injuryId).name),
    },
  };
  return canSeeFull(actor, viewer, opts) ? { ...base, combatant: c, weapons: actor.weapons } : base;
}

export function projectState(state: SessionState, viewer: Viewer, opts?: ProjectionOptions): ViewState {
  return {
    sessionId: state.sessionId,
    seq: state.seq,
    actors: Object.fromEntries(Object.values(state.actors).map((a) => [a.id, projectActor(a, viewer, opts)])),
    encounter: state.encounter,
    pending: state.pending,
  };
}

function eventSubject(e: CombatEvent): string | undefined {
  return 'targetId' in e ? e.targetId : 'combatantId' in e ? e.combatantId : undefined;
}

/**
 * Project one entry. `actorsAfter` = actors after applying the entry (used to
 * decide who the viewer may see; removed actors fall back to the patch-less view).
 */
export function projectEntry(entry: LogEntry, viewer: Viewer, actorsAfter: Record<string, Actor>, opts?: ProjectionOptions): ProjectedEntry {
  const visible = (id: string | undefined) => {
    if (viewer.role === 'gm') return true;
    const a = id ? actorsAfter[id] : undefined;
    return a ? canSeeFull(a, viewer, opts) : false;
  };
  const events = entry.events
    .filter((e) => e.visibility === 'public' || visible(eventSubject(e)))
    .map((e) => (viewer.role === 'gm' ? e : redactEvent(e, visible)));
  const patch: ProjectedEntry['patch'] = {};
  if (entry.patch.actors) {
    patch.actors = Object.fromEntries(Object.entries(entry.patch.actors).map(([id, a]) => [id, a ? projectActor(a, viewer, opts) : null]));
  }
  if (entry.patch.encounter) patch.encounter = entry.patch.encounter;
  if ('pending' in entry.patch) patch.pending = entry.patch.pending ?? null;
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
  return { sessionId, seq: 0, actors: {}, encounter: { active: false, round: 0, order: [], turnIndex: 0, deathSaveRequiredFor: null }, pending: null };
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
  };
}
