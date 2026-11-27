/**
 * Chat input parser. Pure, so it is unit-tested.
 *
 *   /r 2d6+3 [label]          roll dice (also /roll)
 *   /check REF+Handgun [vs|dv|against 15] [: label]   skill check for the selected character
 *   /gm /r … · /gm /check …   private roll (GM eyes only)
 *   /gm message               whisper to the GM
 *   /w Name message           whisper to a player (player or character name; a unique prefix works)
 *   anything else             chat
 */
import { joinNames } from './format.js';
export { joinNames };
import type { Modifier } from '@cprc/rules-core';
import type { DiceExpr, Intent, StatKeyName } from '@cprc/session';
import { ALL_SKILLS } from '../data/skills.js';

/** Every RED Core skill name (game terms), for matching and suggestions. */
const KNOWN_SKILLS = ALL_SKILLS.map((k) => k.name);

export const STATS: StatKeyName[] = ['INT', 'REF', 'DEX', 'TECH', 'COOL', 'WILL', 'LUCK', 'MOVE', 'BODY', 'EMP'];

export interface Recipient { name: string; id: string }
export interface CommandContext {
  /** Character the check is rolled for (the viewer's selected or acting character). */
  actorId: string | null;
  /** Skill names the character has, for case-insensitive matching. */
  skills: string[];
  recipients: Recipient[];
  /** Speak as this character in plain chat. */
  asActorId?: string;
  /** Characters this viewer may roll for by name (the GM: everyone with a sheet). */
  rollable?: { id: string; name: string; skills: string[] }[];
}

export type Parsed =
  | { kind: 'intent'; intent: Intent }
  | { kind: 'error'; message: string }
  | { kind: 'help' }
  | { kind: 'empty' };

export function parseDice(s: string): DiceExpr | null {
  const m = /^\s*(\d*)d(6|10)\s*(?:([+-])\s*(\d+))?\s*$/i.exec(s);
  if (!m) return null;
  const count = m[1] ? Number(m[1]) : 1;
  if (count < 1 || count > 20) return null;
  const bonus = m[4] ? Number(m[4]) * (m[3] === '-' ? -1 : 1) : 0;
  if (Math.abs(bonus) > 50) return null;
  return { count, sides: Number(m[2]) as 6 | 10, bonus };
}

const titleCase = (s: string) => s.replace(/\b([a-z])/g, (c) => c.toUpperCase());

export function parseCommand(raw: string, ctx: CommandContext): Parsed {
  let input = raw.trim();
  if (!input) return { kind: 'empty' };
  let priv = false;
  if (/^\/gm\s+\//i.test(input)) { priv = true; input = input.replace(/^\/gm\s+/i, ''); }
  else if (/^\/gm\s+\S/i.test(input)) {
    return { kind: 'intent', intent: { type: 'chat', text: input.replace(/^\/gm\s+/i, ''), to: ['gm'] } };
  }

  if (/^\/(\?|help)\s*$/i.test(input)) return { kind: 'help' };

  const roll = /^\/(?:r|roll)\s+(\S+)\s*(.*)$/i.exec(input);
  if (roll) {
    const dice = parseDice(roll[1]!);
    if (!dice) return { kind: 'error', message: 'Use dice like 2d6+3 or 1d10 (up to 20 dice; d6 or d10).' };
    const label = roll[2]!.trim() || roll[1]!;
    return { kind: 'intent', intent: { type: 'rollDice', label, dice, ...(priv ? { private: true } : {}) } };
  }

  const check = /^\/check\s+(.+)$/i.exec(input);
  if (check) return parseCheck(check[1]!, ctx, priv);

  const whisper = /^\/w\s+(.+)$/i.exec(input);
  if (whisper) {
    const r = matchRecipient(whisper[1]!, ctx.recipients);
    if ('error' in r) return { kind: 'error', message: r.error };
    if (!r.text) return { kind: 'error', message: 'Add a message after the name.' };
    return { kind: 'intent', intent: { type: 'chat', text: r.text, to: [r.id] } };
  }

  if (input.startsWith('/')) return { kind: 'error', message: `Unknown command ${input.split(/\s/)[0]}. Type /help.` };
  if (input.length > 500) return { kind: 'error', message: 'Keep messages under 500 characters.' };
  return { kind: 'intent', intent: { type: 'chat', text: input, ...(ctx.asActorId ? { asActorId: ctx.asActorId } : {}) } };
}

/**
 * Match the start of `rest` to a recipient: a full name (longest first, case-insensitive),
 * else a unique prefix of one name or word. Several names may share one id (a player and
 * their characters); that still counts as unique.
 */
export function matchRecipient(rest: string, recipients: Recipient[]): { id: string; name: string; text: string } | { error: string } {
  const lower = rest.toLowerCase();
  const sorted = [...recipients].sort((a, b) => b.name.length - a.name.length);
  const full = sorted.find((r) => lower === r.name.toLowerCase() || lower.startsWith(`${r.name.toLowerCase()} `));
  if (full) return { id: full.id, name: full.name, text: rest.slice(full.name.length).trim() };
  const word = rest.split(/\s+/)[0] ?? '';
  if (!word) return { error: 'Whisper to whom? Use /w Name message.' };
  const w = word.toLowerCase();
  const hits = recipients.filter((r) => r.name.toLowerCase().startsWith(w) || r.name.toLowerCase().split(/\s+/).some((part) => part.startsWith(w)));
  const ids = [...new Set(hits.map((h) => h.id))];
  if (ids.length === 1) return { id: ids[0]!, name: hits[0]!.name, text: rest.slice(word.length).trim() };
  if (ids.length > 1) return { error: `Which one: ${[...new Set(hits.map((h) => h.name))].slice(0, 5).join(', ')}?` };
  return { error: `No one called “${word}” is here. Use /w Name message.` };
}

/** Edit distance, for "Did you mean …?" suggestions. */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length]![b.length]!;
}

/** Resolve a typed skill to its RED name, or suggest the closest ones. */
export function resolveSkill(term: string, own: string[]): { skill: string } | { error: string } {
  const t = term.trim().toLowerCase();
  const pool = [...new Set([...own, ...KNOWN_SKILLS])];
  const exact = pool.find((k) => k.toLowerCase() === t);
  if (exact) return { skill: exact };
  // Specializations like "Language (Streetslang)" or "Local Expert (Watson)".
  const base = /^(.+?)\s*\((.+)\)$/.exec(term.trim());
  if (base && pool.some((k) => k.toLowerCase() === base[1]!.toLowerCase())) return { skill: titleCase(term.trim()) };
  const prefix = pool.filter((k) => k.toLowerCase().startsWith(t));
  if (prefix.length === 1) return { skill: prefix[0]! };
  const ranked = (prefix.length ? prefix : pool)
    .map((k) => ({ k, d: prefix.length ? 0 : distance(t, k.toLowerCase()) }))
    .sort((a, b) => a.d - b.d || a.k.localeCompare(b.k))
    .filter((x) => prefix.length || x.d <= Math.max(2, Math.floor(t.length / 3)))
    .slice(0, 3)
    .map((x) => x.k);
  return { error: ranked.length ? `Unknown skill “${term.trim()}”. Did you mean ${ranked.join(' or ')}?` : `Unknown skill “${term.trim()}”. Type /help for the format.` };
}

/**
 * "/check Enforcer COOL vs 15": a leading character name (exact, or a unique
 * prefix) picks who rolls. Returns the rest of the spec and that character.
 */
export function splitRoller(spec: string, rollable: NonNullable<CommandContext['rollable']>): { rest: string; actor: { id: string; skills: string[] } } | { error: string } | null {
  const words = spec.trim().split(/\s+/);
  for (let n = words.length - 1; n >= 1; n--) {
    const cand = words.slice(0, n).join(' ').toLowerCase();
    if (STATS.includes(words[0]!.toUpperCase() as StatKeyName)) return null;
    const exact = rollable.filter((a) => a.name.toLowerCase() === cand);
    const pre = exact.length ? exact : rollable.filter((a) => a.name.toLowerCase().startsWith(cand));
    if (pre.length === 1) return { rest: words.slice(n).join(' '), actor: pre[0]! };
    if (pre.length > 1 && n === 1) return { error: `“${words[0]}” matches ${joinNames(pre.map((a) => a.name))}. Type more of the name.` };
  }
  return null;
}


function parseCheck(spec: string, ctx: CommandContext, priv: boolean): Parsed {
  if (ctx.rollable?.length) {
    const who = splitRoller(spec, ctx.rollable);
    if (who && 'error' in who) return { kind: 'error', message: who.error };
    if (who) return parseCheck(who.rest, { ...ctx, actorId: who.actor.id, skills: who.actor.skills, rollable: undefined }, priv);
  }
  let s = spec.trim();
  let label: string | undefined;
  const colon = s.indexOf(':');
  if (colon >= 0) { label = s.slice(colon + 1).trim() || undefined; s = s.slice(0, colon).trim(); }
  let dv: number | undefined;
  // "vs 15", "vs. 15", "vs DV 15", "dv 15", "DV15", "against 15".
  const vs = /\s+(?:(?:vs\.?|against)(?:\s*dv)?|dv)\s*(\d+)\s*$/i.exec(s);
  if (vs) { dv = Number(vs[1]); s = s.slice(0, vs.index).trim(); }
  if (dv !== undefined && (dv < 1 || dv > 60)) return { kind: 'error', message: 'DV must be between 1 and 60.' };

  let stat: StatKeyName | undefined;
  let skill: string | undefined;
  const mods: Modifier[] = [];
  let base = 0;
  const parts = s.split(/\s*([+-])\s*/).filter((p) => p !== '');
  let sign = 1;
  for (const p of parts) {
    if (p === '+') { sign = 1; continue; }
    if (p === '-') { sign = -1; continue; }
    const term = p.trim();
    if (/^\d+$/.test(term)) {
      mods.push({ label: sign > 0 ? 'Bonus' : 'Penalty', value: sign * Number(term) });
    } else if (STATS.includes(term.toUpperCase() as StatKeyName) && sign > 0) {
      if (stat) return { kind: 'error', message: 'Use one STAT per check.' };
      stat = term.toUpperCase() as StatKeyName;
    } else if (sign > 0) {
      if (skill) return { kind: 'error', message: 'Use one skill per check.' };
      const r = resolveSkill(term, ctx.skills);
      if ('error' in r) return { kind: 'error', message: r.error };
      skill = r.skill;
    } else {
      return { kind: 'error', message: `Can’t subtract “${term}”.` };
    }
    sign = 1;
  }
  if ((stat || skill) && !ctx.actorId) return { kind: 'error', message: 'Select one of your characters to roll a check.' };
  if (!stat && !skill) {
    // Raw base: the numbers are the base.
    base = mods.reduce((t, m) => t + m.value, 0);
    mods.length = 0;
  }
  const text = label ?? ([stat, skill].filter(Boolean).join(' + ') || `Check ${base}`);
  const intent: Intent = {
    type: 'rollCheck', label: text,
    ...(ctx.actorId && (stat || skill) ? { actorId: ctx.actorId } : {}),
    ...(stat ? { stat } : {}), ...(skill ? { skill } : {}),
    ...(!stat && !skill ? { base } : {}),
    ...(mods.length ? { modifiers: mods } : {}),
    ...(dv !== undefined ? { dv } : {}),
    ...(priv ? { private: true } : {}),
  };
  return { kind: 'intent', intent };
}
