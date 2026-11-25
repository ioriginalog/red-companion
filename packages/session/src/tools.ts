/**
 * Table tools: free checks and dice, chat, GM edits, the prep library and
 * scenes. Runs inside the authority (GM device) like every other intent.
 *
 * Privacy: a private roll or a whisper carries `audience`, which the
 * projection enforces (the GM always sees everything).
 */
import {
  beats, cellKey, effectiveStat, inBounds, isPassable, makeCheck, skillLevel, standingModifiers, woundState,
  type CheckResult, type CombatEvent, type Dice, type Modifier, type StatKey,
} from '@cprc/rules-core';
import { controls, getActor, requireMap, SessionError, visibilityFor } from './helpers.js';
import { withSpotted } from './tactical.js';
import type { Actor, Intent, IntentType, Library, SessionState, StatePatch, TacticalMap, Viewer } from './types.js';

export type ToolResult = { events: CombatEvent[]; patch: StatePatch };

/** GM-only tool intents. */
export const TOOL_GM_ONLY: ReadonlySet<IntentType> = new Set([
  'adjustHp', 'setCondition', 'saveToLibrary', 'removeFromLibrary', 'switchScene', 'spawnFromLibrary', 'setLighting',
]);
/** Tools that never interfere with a pending dodge/damage/watch step. */
export const TOOL_WHILE_PENDING: ReadonlySet<IntentType> = new Set([
  'rollCheck', 'rollDice', 'chat', 'adjustHp', 'setCondition', 'saveToLibrary', 'removeFromLibrary', 'setLighting',
]);

const STATS: ReadonlySet<string> = new Set(['INT', 'REF', 'DEX', 'TECH', 'COOL', 'WILL', 'LUCK', 'MOVE', 'BODY', 'EMP']);
const MAX_ID = 64;
const who = (by: Viewer) => (by.role === 'gm' ? 'gm' : by.playerId);
const isInt = (n: unknown, lo: number, hi: number): n is number => Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi;

function privacy(by: Viewer, priv: boolean | undefined): { audience?: string[] } {
  if (!priv) return {};
  return { audience: by.role === 'gm' ? ['gm'] : [by.playerId, 'gm'] };
}

function validModifiers(mods: Modifier[] | undefined): Modifier[] {
  if (mods === undefined) return [];
  if (!Array.isArray(mods) || mods.length > 10) throw new SessionError('INVALID', 'Too many modifiers.');
  for (const m of mods) {
    if (typeof m?.label !== 'string' || m.label.length > 60 || !isInt(m.value, -50, 50)) throw new SessionError('INVALID', 'Each modifier needs a label and a whole number from −50 to 50.');
  }
  return mods;
}

function validMap(m: TacticalMap) {
  if (typeof m?.id !== 'string' || !m.id || m.id.length > MAX_ID) throw new SessionError('INVALID', 'The map needs an id.');
  if (!Number.isInteger(m.width) || !Number.isInteger(m.height) || m.width < 1 || m.height < 1 || m.width * m.height !== m.cells?.length || m.width * m.height > 10_000) {
    throw new SessionError('INVALID', 'Map cells must be width × height (at most 10,000 squares).');
  }
}

function validActor(a: Actor) {
  if (typeof a?.id !== 'string' || !a.id || a.id.length > MAX_ID) throw new SessionError('INVALID', 'The character needs an id.');
  if (a.combatant?.id !== a.id) throw new SessionError('INVALID', 'actor.id must equal combatant.id.');
}

export function executeTool(state: SessionState, intent: Intent, by: Viewer, dice: Dice): ToolResult {
  switch (intent.type) {
    case 'rollCheck': {
      const label = intent.label?.trim();
      if (!label || label.length > 80) throw new SessionError('INVALID', 'Give the check a label (80 characters or fewer).');
      const actor = intent.actorId ? getActor(state, intent.actorId) : undefined;
      if (actor && !controls(by, actor)) throw new SessionError('FORBIDDEN', `You don’t control ${actor.combatant.name}.`);
      if (intent.stat !== undefined && !STATS.has(intent.stat)) throw new SessionError('INVALID', `Unknown STAT ${intent.stat}.`);
      if (intent.skill !== undefined && (typeof intent.skill !== 'string' || intent.skill.length > 40)) throw new SessionError('INVALID', 'Unknown skill.');
      if (intent.base !== undefined && !isInt(intent.base, -20, 60)) throw new SessionError('INVALID', 'Base must be a whole number from −20 to 60.');
      if (intent.dv !== undefined && !isInt(intent.dv, 0, 60)) throw new SessionError('INVALID', 'DV must be a whole number from 0 to 60.');
      const modifiers = validModifiers(intent.modifiers);
      const breakdown: Modifier[] = [];
      let standing: Modifier[] = [];
      if (intent.base !== undefined) breakdown.push({ label: 'Base', value: intent.base });
      if (actor) {
        if (intent.stat) breakdown.push({ label: intent.stat, value: effectiveStat(actor.combatant, intent.stat as StatKey) });
        if (intent.skill) breakdown.push({ label: intent.skill, value: skillLevel(actor.combatant, intent.skill) });
        if (intent.stat || intent.skill) standing = standingModifiers(actor.combatant, 'other');
      } else if (intent.stat || intent.skill) {
        throw new SessionError('INVALID', 'A STAT or skill check needs a character.');
      }
      if (!breakdown.length) throw new SessionError('INVALID', 'Pick a STAT, a skill or a base value.');
      const check: CheckResult = makeCheck(breakdown, [...standing, ...modifiers], dice);
      const ev: CombatEvent = {
        type: 'checkRolled', visibility: 'public', ...privacy(by, intent.private), by: who(by), label, check,
        ...(actor ? { combatantId: actor.id } : {}),
        ...(intent.dv !== undefined ? { dv: intent.dv, success: beats(check.total, intent.dv) } : {}),
      };
      return { events: [ev], patch: {} };
    }

    case 'rollDice': {
      const label = intent.label?.trim();
      if (!label || label.length > 80) throw new SessionError('INVALID', 'Give the roll a label (80 characters or fewer).');
      const d = intent.dice;
      if (!d || !isInt(d.count, 1, 20) || (d.sides !== 6 && d.sides !== 10) || !isInt(d.bonus, -50, 50)) {
        throw new SessionError('INVALID', 'Roll 1–20 d6 or d10 with a bonus from −50 to 50.');
      }
      const faces = Array.from({ length: d.count }, () => (d.sides === 6 ? dice.d6() : dice.d10()));
      const total = faces.reduce((s, n) => s + n, d.bonus);
      return {
        events: [{ type: 'diceRolled', visibility: 'public', ...privacy(by, intent.private), by: who(by), label, dice: faces, sides: d.sides, bonus: d.bonus, total }],
        patch: {},
      };
    }

    case 'chat': {
      const text = typeof intent.text === 'string' ? intent.text.trim() : '';
      if (!text || text.length > 500) throw new SessionError('INVALID', 'Messages are 1–500 characters.');
      if (intent.asActorId) {
        const a = getActor(state, intent.asActorId);
        if (!controls(by, a)) throw new SessionError('FORBIDDEN', `You can’t speak as ${a.combatant.name}.`);
      }
      let audience: string[] | undefined;
      if (intent.to !== undefined) {
        if (!Array.isArray(intent.to) || intent.to.length === 0 || intent.to.length > 12 || intent.to.some((t) => typeof t !== 'string' || !t || t.length > MAX_ID)) {
          throw new SessionError('INVALID', 'Whisper to 1–12 recipients.');
        }
        audience = [...new Set([...intent.to, who(by)])];
      }
      return {
        events: [{ type: 'chatMessage', visibility: 'public', ...(audience ? { audience } : {}), by: who(by), text, ...(intent.asActorId ? { asCombatantId: intent.asActorId } : {}) }],
        patch: {},
      };
    }

    case 'adjustHp': {
      const a = getActor(state, intent.actorId);
      if (!isInt(intent.delta, -1000, 1000) || intent.delta === 0) throw new SessionError('INVALID', 'Change HP by a whole number from −1,000 to 1,000.');
      const reason = intent.reason?.trim().slice(0, 80) || undefined;
      const c = a.combatant;
      // @interpretation HP has no floor (only Death Saves kill) and no auto-death; healing caps at max HP.
      const current = Math.min(c.hp.max, c.hp.current + intent.delta);
      const next = { ...a, combatant: { ...c, hp: { ...c.hp, current } } };
      const events: CombatEvent[] = [{ type: 'hpAdjusted', visibility: visibilityFor(a), targetId: a.id, delta: current - c.hp.current, hpAfter: current, ...(reason ? { reason } : {}) }];
      const from = woundState(c.hp);
      const to = woundState(next.combatant.hp);
      if (from !== to) events.push({ type: 'woundStateChanged', visibility: 'public', targetId: a.id, from, to });
      return { events, patch: { actors: { [a.id]: next } } };
    }

    case 'setCondition': {
      const a = getActor(state, intent.actorId);
      const keys = ['prone', 'unconscious', 'dead', 'stabilized'] as const;
      if (!keys.includes(intent.condition) || typeof intent.value !== 'boolean') throw new SessionError('INVALID', 'Unknown condition.');
      const conditions = { ...a.combatant.conditions, [intent.condition]: intent.value };
      return {
        events: [{ type: 'conditionSet', visibility: 'public', targetId: a.id, condition: intent.condition, value: intent.value }],
        patch: { actors: { [a.id]: { ...a, combatant: { ...a.combatant, conditions } } } },
      };
    }

    case 'saveToLibrary': {
      const lib = state.library;
      if (intent.kind === 'map') {
        const m = intent.item as TacticalMap;
        validMap(m);
        return { events: [], patch: { library: { ...lib, maps: { ...lib.maps, [m.id]: m } } } };
      }
      if (intent.kind === 'actor') {
        const a = intent.item as Actor;
        validActor(a);
        return { events: [], patch: { library: { ...lib, actors: { ...lib.actors, [a.id]: a } } } };
      }
      throw new SessionError('INVALID', 'Save a map or a character.');
    }

    case 'removeFromLibrary': {
      const lib = state.library;
      const bucket = intent.kind === 'map' ? lib.maps : intent.kind === 'actor' ? lib.actors : null;
      if (!bucket) throw new SessionError('INVALID', 'Remove a map or a character.');
      if (!bucket[intent.id]) throw new SessionError('NOT_FOUND', 'That isn’t in the library.');
      const { [intent.id]: _gone, ...rest } = bucket as Record<string, unknown>;
      const next: Library = intent.kind === 'map' ? { ...lib, maps: rest as Library['maps'] } : { ...lib, actors: rest as Library['actors'] };
      return { events: [], patch: { library: next } };
    }

    case 'switchScene': {
      // @ruling Allowed mid-encounter (the GM's call); the encounter and Turn order carry over.
      const target = state.library.maps[intent.mapId];
      if (!target) throw new SessionError('NOT_FOUND', 'That map isn’t in the library.');
      if (state.map?.id === intent.mapId) throw new SessionError('INVALID', 'That map is already in play.');
      let library = state.library;
      // Park the current map (watches are Turn-bound, so they don't survive the switch).
      if (state.map) library = { ...library, maps: { ...library.maps, [state.map.id]: { ...state.map, watches: {} } } };
      const tokens = Object.fromEntries(Object.entries(target.tokens).filter(([id]) => state.actors[id]));
      const map = withSpotted({ ...target, tokens, watches: {} }, state.actors);
      return { events: [{ type: 'sceneChanged', visibility: 'public', mapId: map.id, name: map.name }], patch: { map, library } };
    }

    case 'spawnFromLibrary': {
      const t = state.library.actors[intent.templateId];
      if (!t) throw new SessionError('NOT_FOUND', 'That character isn’t in the library.');
      const id = intent.newId;
      if (typeof id !== 'string' || !id || id.length > MAX_ID) throw new SessionError('INVALID', 'The new character needs an id.');
      if (state.actors[id]) throw new SessionError('INVALID', `Actor ${id} already exists.`);
      const copy = JSON.parse(JSON.stringify(t)) as Actor;
      const c = copy.combatant;
      const name = intent.name?.trim() || c.name;
      if (name.length > 60) throw new SessionError('INVALID', 'Names are 60 characters or fewer.');
      const actor: Actor = {
        ...copy, id, controller: 'gm',
        weapons: copy.weapons.map((w) => (w.ammo ? { ...w, ammo: { ...w.ammo, loaded: w.ammo.capacity } } : w)),
        combatant: {
          ...c, id, name, hp: { ...c.hp, current: c.hp.max },
          armor: c.armor.map((p) => ({ ...p, currentSP: p.maxSP })),
          criticalInjuries: [], deathSave: { accumulatedPenalty: 0 },
          conditions: { prone: false, unconscious: false, dead: false, stabilized: false },
        },
      };
      const patch: StatePatch = { actors: { [id]: actor } };
      if (intent.at) {
        const map = requireMap(state);
        const at = intent.at;
        if (!inBounds(map, at) || !isPassable(map, at)) throw new SessionError('INVALID', 'That square is blocked.');
        if (Object.values(map.tokens).some((c2) => cellKey(c2) === cellKey(at))) throw new SessionError('INVALID', 'That square is occupied.');
        patch.map = withSpotted({ ...map, tokens: { ...map.tokens, [id]: at } }, { ...state.actors, [id]: actor });
      }
      return { events: [], patch };
    }

    case 'setLighting': {
      const map = requireMap(state);
      const l = intent.lighting;
      if (!l || typeof l !== 'object') throw new SessionError('INVALID', 'Lighting needs settings.');
      const revealed = l.revealed ?? [];
      if (!Array.isArray(revealed) || revealed.length > map.width * map.height || revealed.some((k) => typeof k !== 'string' || !/^\d{1,4},\d{1,4}$/.test(k))) {
        throw new SessionError('INVALID', 'Revealed squares must be "x,y" keys.');
      }
      const lighting = { revealAll: !!l.revealAll, revealed: [...new Set(revealed)] };
      return { events: [], patch: { map: withSpotted({ ...map, lighting }, state.actors) } };
    }

    default:
      throw new SessionError('INVALID', `${intent.type} isn’t supported yet.`);
  }
}

