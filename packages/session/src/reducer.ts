import type { LogEntry, SessionState } from './types.js';

export function emptySession(sessionId: string): SessionState {
  return {
    sessionId,
    seq: 0,
    actors: {},
    encounter: { active: false, round: 0, order: [], turnIndex: 0, deathSaveRequiredFor: null },
    pending: null,
    map: null,
    library: { maps: {}, actors: {} },
    handouts: {}, // Track U
  };
}

export class LogGapError extends Error {}

/** Apply one entry. Entries must arrive in order with no gaps. Pure. */
export function applyEntry(state: SessionState, entry: LogEntry): SessionState {
  if (entry.seq !== state.seq + 1) throw new LogGapError(`Expected seq ${state.seq + 1}, got ${entry.seq}`);
  const actors = { ...state.actors };
  for (const [id, a] of Object.entries(entry.patch.actors ?? {})) {
    if (a === null) delete actors[id];
    else actors[id] = a;
  }
  return {
    ...state,
    seq: entry.seq,
    actors,
    encounter: entry.patch.encounter ?? state.encounter,
    pending: 'pending' in entry.patch ? (entry.patch.pending ?? null) : state.pending,
    map: 'map' in entry.patch ? (entry.patch.map ?? null) : state.map,
    library: entry.patch.library ?? state.library,
    handouts: entry.patch.handouts ?? state.handouts ?? {}, // Track U
  };
}

/** Rebuild state from a log. Undo = replay(log.slice(0, n)). */
export function replay(sessionId: string, log: LogEntry[]): SessionState {
  return log.reduce(applyEntry, emptySession(sessionId));
}
