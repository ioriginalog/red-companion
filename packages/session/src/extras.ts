/**
 * Round 3 X: Grab/Grapple/Choke/Throw/Escape, Martial Arts Special Moves,
 * Facedowns and the table tools for the remaining Role Abilities.
 *
 * One intent, `{ type: 'extra', op }`. `executeExtra` validates the payload
 * (types, whole numbers, bounds), authorizes it, and runs it. The authority
 * also calls three hooks:
 *   - `extrasGate`: refuses moves/attacks a grapple forbids.
 *   - `extrasAdjust`: adds Grapple and lost-Facedown penalties to attacks and checks.
 *   - `trackExtras`: records this Round's attacks (Special Move triggers) and
 *     drops grapples that can no longer hold.
 */
import {
  ablate, applyDamage, applySystems, beats, callBackup, charismaticImpact, chokeDamage, CHOKE_KNOCKOUT_ROUNDS,
  FACEDOWN_PENALTY, favorTier, fieldExpertiseMinutes, formLevel, getMove, GRAPPLE_PENALTY, gridDistance, haggleCheck, HANDS,
  hpLoss, inflictInjury, loyaltyCheck, makerCheck, MARTIAL_RECOVERY_DV, maxTeam, moveRequirementProblem, newMemberLoyalty,
  opposedBrawl, operatorPerks, PRICE_CATEGORIES, PRICE_LABEL, publishStory, resolveFacedown, resolveMeleeAttack, roleProblem,
  rollDamage, rumorCheck, specialMoveCheck, TEAM_KIND_LABEL, TEAM_KINDS, TECH_SKILLS, throwDamage,
  type CheckResult, type CombatEvent, type Combatant, type Dice, type Modifier,
} from '@cprc/rules-core';
import { checkOtherAction, controls, currentActorId, getActor, SessionError, usageFor } from './helpers.js';
import { factionOf } from './tactical.js';
import type { Actor, Encounter, ExtraOp, ExtrasState, Grapple, Intent, RoundHit, SessionState, StatePatch, Viewer } from './types.js';

type Result = { events: CombatEvent[]; patch: StatePatch };

export const emptyExtras = (): ExtrasState => ({ grapples: [], facedowns: [], hits: [], movesUsed: [] });
const extrasOf = (s: SessionState): ExtrasState => s.extras ?? emptyExtras();

// ----- Validation helpers -------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (n: unknown, lo: number, hi: number): n is number => Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi;
function need(ok: unknown, message: string): asserts ok {
  if (!ok) throw new SessionError('INVALID', message);
}
function id(v: unknown, what: string): string {
  need(typeof v === 'string' && v.length > 0 && v.length <= 64, `${what} is missing.`);
  return v as string;
}
function text(v: unknown, what: string, max: number): string {
  need(typeof v === 'string' && v.trim().length > 0 && v.length <= max, `${what} must be 1–${max} characters.`);
  return (v as string).trim();
}
function oneOf<T extends string>(v: unknown, what: string, options: readonly T[]): T {
  need(typeof v === 'string' && (options as readonly string[]).includes(v), `${what} must be one of: ${options.join(', ')}.`);
  return v as T;
}
const gmOnly = (by: Viewer) => {
  if (by.role !== 'gm') throw new SessionError('FORBIDDEN', 'Only the GM can do that.');
};

function own(state: SessionState, by: Viewer, actorId: string): Actor {
  const a = getActor(state, actorId);
  if (!controls(by, a)) throw new SessionError('FORBIDDEN', `You don’t control ${a.combatant.name}.`);
  return a;
}
/** Control, Turn order and Death Save, as for any Action. */
function acting(state: SessionState, by: Viewer, actorId: string): Actor {
  const a = own(state, by, actorId);
  if (by.role === 'gm') return a;
  if (state.encounter.active && currentActorId(state) !== actorId) throw new SessionError('NOT_YOUR_TURN', `It isn’t ${a.combatant.name}’s Turn.`);
  if (state.encounter.deathSaveRequiredFor === actorId) throw new SessionError('DEATH_SAVE_FIRST', `${a.combatant.name} must roll a Death Save first.`);
  return a;
}
function upright(a: Actor, what = 'act') {
  const c = a.combatant.conditions;
  if (c.dead || c.unconscious) throw new SessionError('INVALID', `${a.combatant.name} can’t ${what}.`);
}
function adjacent(state: SessionState, a: string, b: string): boolean {
  const ta = state.map?.tokens[a];
  const tb = state.map?.tokens[b];
  return !ta || !tb || gridDistance(ta, tb) <= 1;
}
function needAdjacent(state: SessionState, a: Actor, b: Actor) {
  if (!adjacent(state, a.id, b.id)) throw new SessionError('OUT_OF_REACH', `${b.combatant.name} isn’t in an adjacent square.`);
}

// ----- Knowledge and visibility ---------------------------------------------------------------

/** Characters players know about (same rule as the projection's). */
export function partyKnows(state: SessionState): Set<string> {
  const out = new Set<string>();
  const order = new Set(state.encounter.active ? state.encounter.order : []);
  for (const a of Object.values(state.actors)) {
    if (factionOf(a) === 'friendly') out.add(a.id);
    else if (state.map ? state.map.spotted.includes(a.id) : order.has(a.id)) out.add(a.id);
  }
  return out;
}
/** Public only when every named character is known to the party (the text names them). */
function vis(state: SessionState, ...ids: (string | undefined)[]): 'public' | 'gm' {
  const known = partyKnows(state);
  return ids.every((i) => !i || known.has(i)) ? 'public' : 'gm';
}
const rollsOf = (...cs: [string, CheckResult][]) => cs.map(([label, c]) => ({ label, total: c.total, natural: c.roll.natural }));
const name = (a: Actor) => a.combatant.name;
const withC = (a: Actor, c: Combatant): Actor => ({ ...a, combatant: c });

// ----- Penalties shared with attacks and checks ------------------------------------------------

export function grappleOf(x: ExtrasState, actorId: string): Grapple | undefined {
  return x.grapples.find((g) => g.holderId === actorId || g.heldId === actorId);
}

/** −2 while grappling or held; −2 against the winner of a Facedown you chose to fight on. */
export function extrasPenalties(state: SessionState, actorId: string, opponentId?: string): Modifier[] {
  const x = state.extras;
  if (!x) return [];
  const mods: Modifier[] = [];
  if (grappleOf(x, actorId)) mods.push({ label: 'Grappling', value: GRAPPLE_PENALTY });
  if (opponentId && x.facedowns.some((f) => f.status === 'fighting' && f.loserId === actorId && f.winnerId === opponentId)) {
    mods.push({ label: 'Lost Facedown', value: FACEDOWN_PENALTY });
  }
  return mods;
}

/** Authority hook: the intent that actually runs, with Grapple and Facedown penalties added. */
export function extrasAdjust(state: SessionState, intent: Intent): Intent {
  if (!state.extras) return intent;
  switch (intent.type) {
    case 'rangedAttack':
    case 'meleeAttack': {
      const mods = extrasPenalties(state, intent.attackerId, intent.defenderId);
      return mods.length ? { ...intent, situational: [...(intent.situational ?? []), ...mods] } : intent;
    }
    case 'rollCheck': {
      const mods = intent.actorId ? extrasPenalties(state, intent.actorId) : [];
      return mods.length ? { ...intent, modifiers: [...(intent.modifiers ?? []), ...mods] } : intent;
    }
    default:
      return intent;
  }
}

/** Authority hook: what a grapple forbids. */
export function extrasGate(state: SessionState, intent: Intent): void {
  const x = state.extras;
  if (!x || !x.grapples.length) return;
  const twoHanded = (actorId: string, weaponId: string) => {
    const w = state.actors[actorId]?.weapons.find((v) => v.id === weaponId);
    return !!w && HANDS[w.type] === 2;
  };
  switch (intent.type) {
    case 'moveToken': {
      const g = x.grapples.find((v) => v.heldId === intent.actorId);
      if (g) throw new SessionError('INVALID', `${state.actors[intent.actorId]?.combatant.name ?? 'They'} is held and can’t move. Escape first.`);
      return;
    }
    case 'rangedAttack': {
      const g = grappleOf(x, intent.attackerId);
      if (!g) return;
      if (g.heldId === intent.attackerId && g.ironGrip) throw new SessionError('INVALID', 'An Iron Grip stops ranged attacks.');
      if (twoHanded(intent.attackerId, intent.weaponId)) throw new SessionError('INVALID', 'Two-handed weapons can’t be used while grappling.');
      return;
    }
    case 'meleeAttack':
      if (grappleOf(x, intent.attackerId) && intent.with.kind === 'weapon' && twoHanded(intent.attackerId, intent.with.weaponId)) {
        throw new SessionError('INVALID', 'Two-handed weapons can’t be used while grappling.');
      }
      return;
    case 'areaAttack':
    case 'suppressiveFire':
      if (grappleOf(x, intent.attackerId) && twoHanded(intent.attackerId, intent.weaponId)) {
        throw new SessionError('INVALID', 'Two-handed weapons can’t be used while grappling.');
      }
      return;
    default:
      return;
  }
}

/** Authority hook: after an accepted intent, record attacks and drop grapples that broke. */
export function trackExtras(before: SessionState, intent: Intent, result: Result): Result {
  const x = before.extras;
  const attacks = result.events.filter((e) => e.type === 'attackResolved');
  if (!x && !attacks.length) return result;
  const base = result.patch.extras ?? x ?? emptyExtras();
  const enc = result.patch.encounter ?? before.encounter;
  const actors: Record<string, Actor | null> = { ...before.actors, ...(result.patch.actors ?? {}) };

  const withKind = (): RoundHit['with'] => {
    if (intent.type === 'meleeAttack') return intent.with.kind;
    if (intent.type === 'extra') return 'martialArts';
    return 'ranged';
  };
  const round = before.encounter.round;
  const turnIndex = before.encounter.turnIndex;
  const hits = [
    ...base.hits.filter((h) => h.round === enc.round),
    ...(enc.round === round
      ? attacks.map((e) => (e.type === 'attackResolved' ? { round, turnIndex, attackerId: e.attackerId, defenderId: e.defenderId, with: withKind(), hit: e.hit } : null)).filter((h): h is RoundHit => !!h)
      : []),
  ];
  const movesUsed = base.movesUsed.filter((u) => u.round === enc.round && u.turnIndex === enc.turnIndex);
  const fine = (actorId: string) => {
    const a = actors[actorId];
    return !!a && !a.combatant.conditions.dead && !a.combatant.conditions.unconscious;
  };
  const map = 'map' in result.patch ? result.patch.map : before.map;
  const grapples = base.grapples.filter((g) => {
    if (!fine(g.holderId) || !actors[g.heldId] || actors[g.heldId]!.combatant.conditions.dead) return false;
    // Interpretation: if either token ends up out of reach (holder moved off, GM moved a token), the hold breaks.
    const a = map?.tokens[g.holderId];
    const b = map?.tokens[g.heldId];
    return !a || !b || gridDistance(a, b) <= 1;
  });
  const facedowns = base.facedowns.filter((f) => actors[f.winnerId] && actors[f.loserId]);
  const next: ExtrasState = { grapples, facedowns, hits, movesUsed };
  if (JSON.stringify(next) === JSON.stringify(x ?? emptyExtras())) return result;
  return { events: result.events, patch: { ...result.patch, extras: next } };
}

// ----- Projection ---------------------------------------------------------------------------

/** Players: only grapples and Facedowns between known characters; no attack history. */
export function projectExtras(state: SessionState, viewer: Viewer): ExtrasState | undefined {
  const x = state.extras;
  if (!x) return undefined;
  if (viewer.role === 'gm') return x;
  const known = partyKnows(state);
  return {
    grapples: x.grapples.filter((g) => known.has(g.holderId) && known.has(g.heldId)),
    facedowns: x.facedowns.filter((f) => known.has(f.winnerId) && known.has(f.loserId)),
    hits: [],
    movesUsed: [],
  };
}

// ----- Execution ----------------------------------------------------------------------------

const KINDS = [
  'grab', 'escape', 'release', 'choke', 'throw', 'getUp', 'specialMove', 'facedown', 'facedownChoice', 'endFacedown', 'setReputation',
  'impact', 'backup', 'haggle', 'publish', 'rumor', 'maker', 'juryRig', 'recruit', 'loyalty', 'setRoleExtras',
] as const;

export function executeExtra(state: SessionState, rawOp: unknown, by: Viewer, dice: Dice, newId: () => string): Result {
  need(isObj(rawOp), 'Missing extra action.');
  const op = rawOp as ExtraOp & Obj;
  const kind = oneOf(op.kind, 'Extra action', KINDS);
  const x = extrasOf(state);
  const out = (events: CombatEvent[], patch: StatePatch, nx?: ExtrasState): Result => ({ events, patch: nx ? { ...patch, extras: nx } : patch });
  const ev = (combatantId: string, move: string, textLine: string, extra: Partial<Extract<CombatEvent, { type: 'extraResolved' }>> = {}, ...ids: string[]): CombatEvent => ({
    type: 'extraResolved', visibility: vis(state, combatantId, ...ids), combatantId, move, text: textLine, ...extra,
  });
  const actionPatch = (enc: Encounter | undefined): StatePatch => (enc ? { encounter: enc } : {});

  switch (kind) {
    // ----- Grab and the grapple -----
    case 'grab': {
      const a = acting(state, by, id(op.actorId, 'Character'));
      const t = getActor(state, id(op.targetId, 'Target'));
      const choice = oneOf(op.choice, 'Grab choice', ['grapple', 'takeItem'] as const);
      need(a.id !== t.id, 'You can’t grab yourself.');
      upright(a);
      need(!t.combatant.conditions.dead, `${name(t)} is dead.`);
      needAdjacent(state, a, t);
      need(!grappleOf(x, a.id), `${name(a)} is already in a grapple.`);
      if (choice === 'grapple') need(!x.grapples.some((g) => g.heldId === t.id), `${name(t)} is already held.`);
      if (op.weaponId !== undefined) id(op.weaponId, 'Item');
      const enc = checkOtherAction(state, by, a);
      const auto = t.combatant.conditions.unconscious;
      const c = auto ? null : opposedBrawl(a.combatant, t.combatant, dice, extrasPenalties(state, a.id, t.id), extrasPenalties(state, t.id));
      const win = auto || c!.attackerWins;
      const rolls = c ? rollsOf([name(a), c.attack], [name(t), c.defense]) : [];
      if (!win) return out([ev(a.id, 'grab', `${name(a)} tries to grab ${name(t)} and fails.`, { targetId: t.id, success: false, rolls }, t.id)], actionPatch(enc));
      if (choice === 'grapple') {
        const nx = { ...x, grapples: [...x.grapples, { holderId: a.id, heldId: t.id, chokes: 0, lastChokeRound: null, ironGrip: false }] };
        return out([ev(a.id, 'grab', `${name(a)} grabs ${name(t)} and holds on. Both take −2 to all Actions.`, { targetId: t.id, success: true, rolls }, t.id)], actionPatch(enc), nx);
      }
      return takeItem(state, a, t, op.weaponId as string | undefined, by, rolls, enc);
    }
    case 'escape': {
      const a = acting(state, by, id(op.actorId, 'Character'));
      const g = x.grapples.find((v) => v.heldId === id(op.heldId, 'Held character'));
      need(g, 'That character isn’t held.');
      upright(a);
      const holder = getActor(state, g.holderId);
      if (a.id !== g.heldId) needAdjacent(state, a, holder);
      const enc = checkOtherAction(state, by, a);
      const grip: Modifier[] = g.ironGrip && a.id === g.heldId ? [{ label: 'Iron Grip', value: -2 }] : [];
      const c = opposedBrawl(a.combatant, holder.combatant, dice, [...extrasPenalties(state, a.id), ...grip], extrasPenalties(state, holder.id));
      const rolls = rollsOf([name(a), c.attack], [name(holder), c.defense]);
      const held = getActor(state, g.heldId);
      if (!c.attackerWins) return out([ev(a.id, 'escape', `${name(a)} can’t break ${name(holder)}’s hold on ${name(held)}.`, { targetId: holder.id, success: false, rolls }, holder.id, held.id)], actionPatch(enc));
      const nx = { ...x, grapples: x.grapples.filter((v) => v !== g) };
      return out([ev(a.id, 'escape', `${name(held)} breaks free of ${name(holder)}.`, { targetId: holder.id, success: true, rolls }, holder.id, held.id)], actionPatch(enc), nx);
    }
    case 'release': {
      const a = own(state, by, id(op.actorId, 'Character'));
      const g = x.grapples.find((v) => v.holderId === a.id);
      need(g, `${name(a)} isn’t holding anyone.`);
      const held = getActor(state, g.heldId);
      return out([ev(a.id, 'release', `${name(a)} lets go of ${name(held)}.`, { targetId: held.id }, held.id)], {}, { ...x, grapples: x.grapples.filter((v) => v !== g) });
    }
    case 'choke':
    case 'throw': {
      const a = acting(state, by, id(op.actorId, 'Character'));
      upright(a);
      const g = x.grapples.find((v) => v.holderId === a.id);
      need(g, `${name(a)} must be holding someone first.`);
      const t = getActor(state, g.heldId);
      const enc = checkOtherAction(state, by, a);
      if (kind === 'throw') {
        const loss = hpLoss(t.combatant, throwDamage(a.combatant), dice);
        const target = { ...loss.target, conditions: { ...loss.target.conditions, prone: true } };
        const nx = { ...x, grapples: x.grapples.filter((v) => v !== g) };
        return out(
          [ev(a.id, 'throw', `${name(a)} throws ${name(t)} for ${loss.lost} damage; they land Prone.`, { targetId: t.id, success: true }, t.id), ...loss.events],
          { ...actionPatch(enc), actors: { [t.id]: withC(t, target) } }, nx,
        );
      }
      const round = state.encounter.active ? state.encounter.round : null;
      const chokes = round !== null && g.lastChokeRound !== null && g.lastChokeRound === round - 1 ? g.chokes + 1 : round !== null && g.lastChokeRound === round ? g.chokes : 1;
      const loss = hpLoss(t.combatant, chokeDamage(a.combatant), dice, { floorAtOne: true });
      let target = loss.target;
      const out3 = chokes >= CHOKE_KNOCKOUT_ROUNDS;
      if (out3 && !target.conditions.unconscious) target = { ...target, conditions: { ...target.conditions, unconscious: true } };
      const line = target.conditions.unconscious
        ? `${name(a)} chokes ${name(t)} unconscious.`
        : `${name(a)} chokes ${name(t)} for ${loss.lost} damage (${chokes} of ${CHOKE_KNOCKOUT_ROUNDS} Rounds).`;
      const nx = { ...x, grapples: x.grapples.map((v) => (v === g ? { ...v, chokes, lastChokeRound: round } : v)) };
      return out([ev(a.id, 'choke', line, { targetId: t.id, success: true }, t.id), ...loss.events], { ...actionPatch(enc), actors: { [t.id]: withC(t, target) } }, nx);
    }
    case 'getUp': {
      const a = acting(state, by, id(op.actorId, 'Character'));
      upright(a, 'get up');
      need(a.combatant.conditions.prone, `${name(a)} isn’t Prone.`);
      const stand = withC(a, { ...a.combatant, conditions: { ...a.combatant.conditions, prone: false } });
      if (op.form !== undefined) {
        const form = text(op.form, 'Form', 40);
        need(formLevel(a.combatant, form) >= 1, `${name(a)} has no levels in ${form}.`);
        const c = specialMoveCheck(a.combatant, form, dice, extrasPenalties(state, a.id));
        if (beats(c.total, MARTIAL_RECOVERY_DV)) {
          return out([ev(a.id, 'recovery', `${name(a)} springs up (${form} Recovery) without spending an Action.`, { success: true, rolls: rollsOf([name(a), c]) })], { actors: { [a.id]: stand } });
        }
        const u = usageFor(state, a.id);
        if (u?.actionUsed && by.role !== 'gm') {
          return out([ev(a.id, 'recovery', `${name(a)} fails the Recovery and has no Action left to stand.`, { success: false, rolls: rollsOf([name(a), c]) })], {});
        }
        const enc = checkOtherAction(state, by, a);
        return out([ev(a.id, 'recovery', `${name(a)} misses the Recovery and spends the Action getting up.`, { success: false, rolls: rollsOf([name(a), c]) })], { ...actionPatch(enc), actors: { [a.id]: stand } });
      }
      const enc = checkOtherAction(state, by, a);
      return out([ev(a.id, 'getUp', `${name(a)} gets up.`)], { ...actionPatch(enc), actors: { [a.id]: stand } });
    }

    // ----- Martial Arts -----
    case 'specialMove':
      return specialMove(state, op, by, dice, x, ev, out);

    // ----- Facedowns -----
    case 'facedown': {
      const a = own(state, by, id(op.actorId, 'Character'));
      const t = getActor(state, id(op.targetId, 'Opponent'));
      need(a.id !== t.id, 'You can’t face yourself down.');
      upright(a);
      upright(t, 'stand up to anyone');
      const r = resolveFacedown(a.combatant, t.combatant, dice);
      const rolls = rollsOf([name(a), r.a], [name(t), r.b]);
      const others = x.facedowns.filter((f) => !((f.winnerId === a.id && f.loserId === t.id) || (f.winnerId === t.id && f.loserId === a.id)));
      if (!r.winner) return out([ev(a.id, 'facedown', `${name(a)} and ${name(t)} stare each other down. Nobody blinks.`, { targetId: t.id, rolls }, t.id)], {}, { ...x, facedowns: others });
      const [w, l] = r.winner === 'a' ? [a, t] : [t, a];
      const f = { id: newId(), winnerId: w.id, loserId: l.id, status: 'choosing' as const };
      return out(
        [ev(a.id, 'facedown', `${name(w)} wins the Facedown. ${name(l)} must back down or fight on at −2 against ${name(w)}.`, { targetId: t.id, success: r.winner === 'a', rolls }, t.id)],
        {}, { ...x, facedowns: [...others, f] },
      );
    }
    case 'facedownChoice': {
      const f = x.facedowns.find((v) => v.id === id(op.facedownId, 'Facedown'));
      need(f, 'No such Facedown.');
      const choice = oneOf(op.choice, 'Choice', ['backDown', 'fight'] as const);
      const l = own(state, by, f.loserId);
      const w = getActor(state, f.winnerId);
      if (choice === 'backDown') {
        return out([ev(l.id, 'facedown', `${name(l)} backs down from ${name(w)}.`, { targetId: w.id }, w.id)], {}, { ...x, facedowns: x.facedowns.filter((v) => v !== f) });
      }
      return out([ev(l.id, 'facedown', `${name(l)} won’t back down: −2 to all Actions against ${name(w)}.`, { targetId: w.id }, w.id)], {},
        { ...x, facedowns: x.facedowns.map((v) => (v === f ? { ...v, status: 'fighting' as const } : v)) });
    }
    case 'endFacedown': {
      const f = x.facedowns.find((v) => v.id === id(op.facedownId, 'Facedown'));
      need(f, 'No such Facedown.');
      const w = getActor(state, f.winnerId);
      if (by.role !== 'gm' && !controls(by, w)) throw new SessionError('FORBIDDEN', 'Only the GM or the winner can end a Facedown.');
      return out([ev(w.id, 'facedown', `The Facedown between ${name(w)} and ${name(getActor(state, f.loserId))} is over.`, {}, f.loserId)], {}, { ...x, facedowns: x.facedowns.filter((v) => v !== f) });
    }
    case 'setReputation': {
      gmOnly(by);
      const a = getActor(state, id(op.actorId, 'Character'));
      need(isInt(op.value, 0, 10), 'Reputation must be 0–10.');
      return out([], { actors: { [a.id]: withC(a, { ...a.combatant, reputation: op.value as number }) } });
    }

    // ----- Role Abilities -----
    case 'impact': {
      const a = own(state, by, id(op.actorId, 'Character'));
      need(a.combatant.role?.id === 'rockerboy', `${name(a)} isn’t a Rockerboy.`);
      const audience = oneOf(op.audience, 'Audience', ['single', 'small', 'huge'] as const);
      const r = charismaticImpact(a.combatant, audience, dice);
      if ('problem' in r) throw new SessionError('INVALID', r.problem!);
      const who = { single: 'one person', small: 'a small group', huge: 'a huge crowd' }[audience];
      const line = r.success
        ? `${name(a)} wins over ${who} (Charismatic Impact ${r.check.total} vs DV ${r.dv}). Fans will do ${favorTier(a.combatant.role!.rank, audience)}.`
        : `${name(a)} doesn’t reach ${who} (${r.check.total} vs DV ${r.dv}). Those fans can’t be asked again for a week.`;
      return out([ev(a.id, 'impact', line, { success: r.success, rolls: rollsOf([name(a), r.check]) })], {});
    }
    case 'backup': {
      const a = acting(state, by, id(op.actorId, 'Character'));
      need(a.combatant.role?.id === 'lawman', `${name(a)} isn’t a Lawman.`);
      upright(a);
      const enc = checkOtherAction(state, by, a);
      const r = callBackup(a.combatant, dice);
      const line = r.dispatched
        ? `${name(a)} calls it in (${r.roll} ≤ Backup ${r.rank}): ${r.groups === 2 ? 'two groups of ' : ''}${r.who.toLowerCase()}, arriving in ${r.rounds} Round${r.rounds === 1 ? '' : 's'}.`
        : `${name(a)} calls for backup, but nobody’s free (${r.roll} vs Backup ${r.rank}). Try again next Turn.`;
      return out([ev(a.id, 'backup', line, { success: r.dispatched, rolls: [{ label: 'Backup', total: r.roll, natural: r.roll }] })], actionPatch(enc));
    }
    case 'haggle': {
      const a = own(state, by, id(op.actorId, 'Character'));
      need(a.combatant.role?.id === 'fixer', `${name(a)} isn’t a Fixer.`);
      if (op.sellerTotal !== undefined) {
        gmOnly(by);
        need(isInt(op.sellerTotal, -20, 60), 'Seller total must be a whole number.');
      }
      const c = haggleCheck(a.combatant, dice);
      const perks = operatorPerks(a.combatant.role!.rank);
      const line = op.sellerTotal === undefined
        ? `${name(a)} haggles: ${c.total}. The GM compares it with the seller’s roll.`
        : beats(c.total, op.sellerTotal as number) ? `${name(a)} out-haggles the seller (${c.total} vs ${op.sellerTotal}).` : `The seller holds firm (${c.total} vs ${op.sellerTotal}).`;
      return out([ev(a.id, 'haggle', `${line} Operator perks: ${perks.join('; ') || 'none yet'}.`, { rolls: rollsOf([name(a), c]) })], {});
    }
    case 'publish':
    case 'rumor': {
      const a = own(state, by, id(op.actorId, 'Character'));
      need(a.combatant.role?.id === 'media', `${name(a)} isn’t a Media.`);
      need(isInt(op.dv, 1, 40), 'DV must be 1–40.');
      if (kind === 'rumor') {
        const r = rumorCheck(a.combatant, op.dv as number, dice);
        return out([ev(a.id, 'rumor', r.success ? `${name(a)} turns up a solid lead (${r.check.total} vs DV ${r.dv}).` : `${name(a)} hears nothing useful (${r.check.total} vs DV ${r.dv}).`, { success: r.success, rolls: rollsOf([name(a), r.check]) })], {});
      }
      need(isInt(op.evidence, 0, 3), 'Evidence must be 0–3.');
      const r = publishStory(a.combatant, op.dv as number, op.evidence as number, dice);
      const line = !r.success
        ? `${name(a)}’s story doesn’t land (${r.check.total} vs DV ${r.dv}).`
        : `${name(a)} publishes to a ${r.audience.toLowerCase()} audience (${r.check.total} vs DV ${r.dv}); ${r.believed ? 'most people believe it' : 'most people shrug it off'} (believability ${r.believabilityRoll}).`;
      return out([ev(a.id, 'publish', line, { success: r.success, rolls: rollsOf([name(a), r.check]) })], {});
    }
    case 'maker': {
      const a = own(state, by, id(op.actorId, 'Character'));
      need(a.combatant.role?.id === 'tech', `${name(a)} isn’t a Tech.`);
      const specialty = oneOf(op.specialty, 'Specialty', ['upgrade', 'fabrication', 'invention'] as const);
      const skill = oneOf(op.skill, 'Skill', TECH_SKILLS);
      const price = oneOf(op.price, 'Price category', PRICE_CATEGORIES);
      const item = text(op.item, 'Item', 80);
      const r = makerCheck(a.combatant, specialty, skill, price, dice);
      if ('problem' in r) throw new SessionError('INVALID', r.problem!);
      const verb = { upgrade: 'upgrade', fabrication: 'build', invention: 'invent' }[specialty];
      const line = r.success
        ? `${name(a)} manages to ${verb} ${item} (${r.check.total} vs DV ${r.dv}, ${PRICE_LABEL[r.price!]}); it takes ${r.time}.`
        : `${name(a)} can’t ${verb} ${item} yet (${r.check.total} vs DV ${r.dv}). The materials survive; try again.`;
      return out([ev(a.id, 'maker', line, { success: r.success, rolls: rollsOf([name(a), r.check!]) })], {});
    }
    case 'juryRig': {
      const a = own(state, by, id(op.actorId, 'Character'));
      need(a.combatant.role?.id === 'tech', `${name(a)} isn’t a Tech.`);
      const minutes = fieldExpertiseMinutes(a.combatant);
      need(minutes > 0, `${name(a)} has no Field Expertise.`);
      const item = text(op.item, 'Item', 80);
      return out([ev(a.id, 'juryRig', `${name(a)} jury-rigs ${item}: it works perfectly for ${minutes} minutes, then fails until fully repaired.`)], {});
    }
    case 'recruit': {
      gmOnly(by);
      const a = getActor(state, id(op.actorId, 'Character'));
      const role = a.combatant.role;
      need(role?.id === 'exec', `${name(a)} isn’t an Exec.`);
      const team = role.team ?? [];
      need(team.length < maxTeam(role.rank), `Teamwork ${role.rank} allows ${maxTeam(role.rank)} team member(s).`);
      const memberKind = oneOf(op.memberKind, 'Member kind', TEAM_KINDS);
      const member = { name: text(op.name, 'Name', 60), kind: memberKind, loyalty: newMemberLoyalty(dice) };
      const next = applySystems({ ...a.combatant, role: { ...role, team: [...team, member] } });
      return out([ev(a.id, 'recruit', `${member.name} (${TEAM_KIND_LABEL[memberKind]}) joins ${name(a)}’s team at Loyalty ${member.loyalty}.`)], { actors: { [a.id]: withC(a, next) } });
    }
    case 'loyalty': {
      gmOnly(by);
      const a = getActor(state, id(op.actorId, 'Character'));
      const team = a.combatant.role?.id === 'exec' ? a.combatant.role.team ?? [] : [];
      need(isInt(op.member, 0, team.length - 1), 'No such team member.');
      if (op.order !== undefined) text(op.order, 'Order', 200);
      const m = team[op.member as number]!;
      const r = loyaltyCheck(m, dice);
      const line = r.holds
        ? `${m.name} follows the order (${r.roll} under Loyalty ${m.loyalty}).`
        : `${m.name} balks (${r.roll} vs Loyalty ${m.loyalty}): they may refuse, botch it or betray ${name(a)}.`;
      return out([{ ...ev(a.id, 'loyalty', line, { success: r.holds }), audience: ['gm'], visibility: 'gm' }], {});
    }
    case 'setRoleExtras': {
      gmOnly(by);
      const a = getActor(state, id(op.actorId, 'Character'));
      const role = a.combatant.role;
      need(role, `${name(a)} has no Role.`);
      need(op.maker !== undefined || op.team !== undefined || op.moto !== undefined, 'Nothing to change.');
      const nextRole = {
        ...role,
        ...(op.maker !== undefined ? { maker: op.maker as never } : {}),
        ...(op.team !== undefined ? { team: op.team as never } : {}),
        ...(op.moto !== undefined ? { moto: op.moto as never } : {}),
      };
      const p = roleProblem(nextRole);
      if (p) throw new SessionError('INVALID', p);
      return out([], { actors: { [a.id]: withC(a, applySystems({ ...a.combatant, role: nextRole })) } });
    }
  }
}

function takeItem(state: SessionState, a: Actor, t: Actor, weaponId: string | undefined, by: Viewer, rolls: { label: string; total: number; natural?: number }[], enc: Encounter | undefined): Result {
  const known = partyKnows(state);
  const event = (line: string): CombatEvent => ({ type: 'extraResolved', visibility: known.has(a.id) && known.has(t.id) ? 'public' : 'gm', combatantId: a.id, targetId: t.id, move: 'takeItem', text: line, success: true, rolls });
  const patch: StatePatch = enc ? { encounter: enc } : {};
  const w = weaponId ? t.weapons.find((v) => v.id === weaponId) : undefined;
  if (!w) {
    // Players can't see NPC gear: the GM decides what changes hands.
    return { events: [event(`${name(a)} wrests something from ${name(t)}’s grip. The GM decides what.`)], patch };
  }
  let newIdForWeapon = w.id;
  for (let i = 2; a.weapons.some((v) => v.id === newIdForWeapon); i++) newIdForWeapon = `${w.id}-${i}`;
  return {
    events: [event(`${name(a)} takes ${w.name} from ${name(t)}.`)],
    patch: {
      ...patch,
      actors: {
        [a.id]: { ...a, weapons: [...a.weapons, { ...w, id: newIdForWeapon }] },
        [t.id]: { ...t, weapons: t.weapons.filter((v) => v.id !== w.id) },
      },
    },
  };
}

type Ev = (combatantId: string, move: string, textLine: string, extra?: Partial<Extract<CombatEvent, { type: 'extraResolved' }>>, ...ids: string[]) => CombatEvent;
type Out = (events: CombatEvent[], patch: StatePatch, nx?: ExtrasState) => Result;

function specialMove(state: SessionState, op: Obj, by: Viewer, dice: Dice, x: ExtrasState, ev: Ev, out: Out): Result {
  const a = acting(state, by, id(op.actorId, 'Character'));
  upright(a);
  const move = getMove(id(op.moveId, 'Move'));
  need(move, 'Unknown Special Move.');
  const problem = moveRequirementProblem(a.combatant, move);
  if (problem) throw new SessionError('INVALID', problem);
  if (op.force !== undefined) {
    need(typeof op.force === 'boolean', 'Force must be yes or no.');
    if (op.force) gmOnly(by);
  }
  if (op.gmDv !== undefined) {
    gmOnly(by);
    need(isInt(op.gmDv, 1, 40), 'DV must be 1–40.');
  }
  need(op.aimHead === undefined || typeof op.aimHead === 'boolean', 'Aim must be yes or no.');
  const force = op.force === true;
  const enc0 = state.encounter;
  const round = enc0.round;
  const target = op.targetId !== undefined ? getActor(state, id(op.targetId, 'Target')) : undefined;
  const thisTurn = (h: RoundHit) => h.round === round && h.turnIndex === enc0.turnIndex && h.attackerId === a.id;

  // Trigger check (the GM can force a move the history can't show).
  if (move.trigger && !force) {
    const hitsOn = (tid: string, kinds: RoundHit['with'][]) => kinds.every((k) => x.hits.some((h) => thisTurn(h) && h.hit && h.defenderId === tid && h.with === k));
    const holdOf = x.grapples.find((g) => g.heldId === a.id);
    const ok = (() => {
      switch (move.trigger) {
        case 'brawlAndMartialHitSameTarget': return !!target && hitsOn(target.id, ['brawling', 'martialArts']);
        case 'meleeWeaponAndMartialHitSameTarget': return !!target && hitsOn(target.id, ['weapon', 'martialArts']);
        case 'holdingTarget': return x.grapples.some((g) => g.holderId === a.id);
        case 'twoMartialHitsOnHolder':
          return !!holdOf && x.hits.filter((h) => thisTurn(h) && h.hit && h.defenderId === holdOf.holderId && h.with === 'martialArts').length >= 2;
        case 'dodgedAllMeleeThisRound': {
          if (!target) return false;
          const vs = x.hits.filter((h) => h.round === round && h.attackerId === target.id && h.defenderId === a.id && h.with !== 'ranged');
          return vs.length > 0 && vs.every((h) => !h.hit);
        }
        default: return false;
      }
    })();
    if (!ok) throw new SessionError('INVALID', `${move.name} isn’t available: ${move.summary}`);
  }
  if (move.kind === 'triggered' && x.movesUsed.some((u) => u.actorId === a.id && u.moveId === move.id && u.round === round && u.turnIndex === enc0.turnIndex)) {
    throw new SessionError('INVALID', `${move.name} is once per Turn.`);
  }
  const used: ExtrasState = move.kind === 'triggered' ? { ...x, movesUsed: [...x.movesUsed, { round, turnIndex: enc0.turnIndex, actorId: a.id, moveId: move.id }] } : x;
  const pen = extrasPenalties(state, a.id, target?.id);

  // ----- Strikes that replace both attacks -----
  if (move.kind === 'attack') {
    need(target, 'Pick a target.');
    need(target.id !== a.id, 'Pick someone else.');
    needAdjacent(state, a, target);
    if (move.minMoved) {
      const u = usageFor(state, a.id);
      if (u && u.moveUsed < move.minMoved && !force) throw new SessionError('INVALID', `${move.name} needs at least ${move.minMoved * 2} m/yds of movement first this Turn.`);
    }
    const u = usageFor(state, a.id);
    if (u?.actionUsed && by.role !== 'gm') throw new SessionError('ACTION_USED', `${move.name} replaces both attacks; ${name(a)} has already used their Action.`);
    const enc = checkOtherAction(state, by, a);
    const aimTarget = op.aimHead === true && move.effect.kind === 'strikeInjury' ? 'head' as const : undefined;
    const res = resolveMeleeAttack({
      attacker: a.combatant, defender: target.combatant, with: { kind: 'martialArts', form: move.form }, aimTarget, situational: pen,
      ...(op.gmDv !== undefined ? { gmDvIfDefenderCannotEvade: op.gmDv as number } : {}),
    }, dice);
    const events: CombatEvent[] = [...res.events];
    const patch: StatePatch = enc ? { encounter: enc } : {};
    if (!res.hit || !res.damage) {
      events.push(ev(a.id, move.id, `${name(a)}’s ${move.name} misses ${name(target)}.`, { targetId: target.id, success: false }, target.id));
      return out(events, patch, used);
    }
    const roll = rollDamage(res.damage, dice);
    events.push({ type: 'damageRolled', visibility: 'public', dice: roll.dice, multiplier: roll.multiplier, total: roll.total, critTriggered: roll.critTriggered });
    const dmg = applyDamage(target.combatant, res.damage, roll, dice);
    events.push(...dmg.events);
    let t = dmg.target;
    if (move.effect.kind === 'strikeInjury') {
      const inj = inflictInjury(t, aimTarget ? move.effect.headInjury : move.effect.injury, dice);
      t = inj.target;
      events.push(...inj.events);
    } else if (move.effect.kind === 'flyingKick') {
      t = { ...t, conditions: { ...t.conditions, prone: true } };
    }
    events.push(ev(a.id, move.id, `${name(a)} lands a ${move.name} on ${name(target)}.${move.effect.kind === 'flyingKick' ? ' They go down Prone.' : ''}`, { targetId: target.id, success: true }, target.id));
    return out(events, { ...patch, actors: { [target.id]: withC(target, t) } }, used);
  }

  // ----- Checked moves -----
  const enc = move.kind === 'action' ? checkOtherAction(state, by, a) : undefined;
  const actionPatch: StatePatch = enc ? { encounter: enc } : {};
  const c = specialMoveCheck(a.combatant, move.form, dice, pen);
  const dv = move.dv ?? 15;
  const ok = beats(c.total, dv);
  const rolls = rollsOf([name(a), c]);
  if (!ok) return out([ev(a.id, move.id, `${name(a)} attempts ${move.name} and fails (${c.total} vs DV ${dv}).`, { success: false, rolls, ...(target ? { targetId: target.id } : {}) }, target?.id ?? '')], actionPatch, used);

  switch (move.effect.kind) {
    case 'prompt':
      return out([ev(a.id, move.id, `${name(a)} pulls off ${move.name} (${c.total} vs DV ${dv}). GM: ${move.summary}`, { success: true, rolls, ...(target ? { targetId: target.id } : {}) }, target?.id ?? '')], actionPatch, used);
    case 'ironGrip': {
      const g = x.grapples.find((v) => v.holderId === a.id)!;
      const held = getActor(state, g.heldId);
      return out([ev(a.id, move.id, `${name(a)} locks ${name(held)} in an Iron Grip: escapes at −2, no ranged attacks.`, { targetId: held.id, success: true, rolls }, held.id)], actionPatch,
        { ...used, grapples: used.grapples.map((v) => (v.holderId === a.id ? { ...v, ironGrip: true } : v)) });
    }
    case 'takeItem': {
      need(target, 'Pick the target.');
      const r = takeItem(state, a, target, op.weaponId as string | undefined, by, rolls, undefined);
      return out(r.events, { ...actionPatch, ...r.patch }, used);
    }
    case 'ablate': {
      need(target, 'Pick the target.');
      const ab = ablate(target.combatant.armor, 'body', move.effect.amount);
      const events: CombatEvent[] = [ev(a.id, move.id, `${name(a)}’s ${move.name} cracks ${name(target)}’s armor (−${move.effect.amount} SP).`, { targetId: target.id, success: true, rolls }, target.id)];
      if (ab.changes.length) events.push({ type: 'armorAblated', visibility: vis(state, target.id), targetId: target.id, location: 'body', pieces: ab.changes });
      return out(events, { ...actionPatch, actors: { [target.id]: withC(target, { ...target.combatant, armor: ab.armor }) } }, used);
    }
    case 'throwAttacker': {
      need(target, 'Pick who to throw.');
      needAdjacent(state, a, target);
      const loss = hpLoss(target.combatant, throwDamage(a.combatant), dice);
      const t = { ...loss.target, conditions: { ...loss.target.conditions, prone: true } };
      return out([ev(a.id, move.id, `${name(a)} counter-throws ${name(target)} for ${loss.lost} damage; they land Prone.`, { targetId: target.id, success: true, rolls }, target.id), ...loss.events],
        { ...actionPatch, actors: { [target.id]: withC(target, t) } }, used);
    }
    case 'escapeAndInjure': {
      const g = x.grapples.find((v) => v.heldId === a.id);
      need(g, `${name(a)} isn’t held.`);
      const holder = getActor(state, g.holderId);
      const inj = inflictInjury(holder.combatant, move.effect.injury, dice);
      return out([ev(a.id, move.id, `${name(a)} breaks ${name(holder)}’s hold with an ${move.name}.`, { targetId: holder.id, success: true, rolls }, holder.id), ...inj.events],
        { ...actionPatch, actors: { [holder.id]: withC(holder, inj.target) } }, { ...used, grapples: used.grapples.filter((v) => v !== g) });
    }
    default:
      return out([], actionPatch, used);
  }
}
