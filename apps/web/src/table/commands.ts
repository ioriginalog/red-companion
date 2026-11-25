/**
 * Chat input parser. Pure, so it is unit-tested.
 *
 *   /r 2d6+3 [label]          roll dice (also /roll)
 *   /check REF+Handgun [vs 15] [: label]   skill check for the selected character
 *   /gm /r … · /gm /check …   private roll (GM eyes only)
 *   /gm message               whisper to the GM
 *   /w Name message           whisper to a player or a character's player
 *   anything else             chat
 */
import type { Modifier } from '@cprc/rules-core';
import type { DiceExpr, Intent, StatKeyName } from '@cprc/session';

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
    const rest = whisper[1]!;
    // Longest name first, so "Doc Ruiz" wins over "Doc".
    const sorted = [...ctx.recipients].sort((a, b) => b.name.length - a.name.length);
    const hit = sorted.find((r) => rest.toLowerCase().startsWith(`${r.name.toLowerCase()} `));
    if (!hit) return { kind: 'error', message: 'Whisper to whom? Use /w Name message.' };
    const text = rest.slice(hit.name.length).trim();
    if (!text) return { kind: 'error', message: 'Add a message after the name.' };
    return { kind: 'intent', intent: { type: 'chat', text, to: [hit.id] } };
  }

  if (input.startsWith('/')) return { kind: 'error', message: `Unknown command ${input.split(/\s/)[0]}. Type /help.` };
  if (input.length > 500) return { kind: 'error', message: 'Keep messages under 500 characters.' };
  return { kind: 'intent', intent: { type: 'chat', text: input, ...(ctx.asActorId ? { asActorId: ctx.asActorId } : {}) } };
}

function parseCheck(spec: string, ctx: CommandContext, priv: boolean): Parsed {
  let s = spec.trim();
  let label: string | undefined;
  const colon = s.indexOf(':');
  if (colon >= 0) { label = s.slice(colon + 1).trim() || undefined; s = s.slice(0, colon).trim(); }
  let dv: number | undefined;
  const vs = /\s+vs\.?\s+(\d+)\s*$/i.exec(s);
  if (vs) { dv = Number(vs[1]); s = s.slice(0, vs.index).trim(); }

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
      skill = ctx.skills.find((k) => k.toLowerCase() === term.toLowerCase()) ?? titleCase(term.toLowerCase());
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
