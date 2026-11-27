/** Copy for controls that depend on the situation. Pure; tested in test/table-copy.test.ts. */

/**
 * The Target card's hint when nothing is targeted. `friendly`: the acting
 * character is on the party's side (for the GM's hostiles, "enemies" are the
 * party and "the party can see" makes no sense).
 */
export function noTargetHint(o: { canAct: boolean; opponents: number; anyShot: boolean; actingName: string | null; friendly: boolean; touch: boolean }): string | undefined {
  if (!o.canAct) return undefined;
  const who = o.actingName ?? 'this character';
  if (o.friendly) {
    if (o.opponents === 0) return 'No enemies in sight. Move to find a line of sight.';
    if (!o.anyShot) return `The party can see enemies, but none is in ${who}’s line of sight. Move for a clear shot.`;
    return o.touch ? 'Tap an enemy on the map or in the target strip.' : 'Click an enemy on the map.';
  }
  if (o.opponents === 0) return `${who} has no opponents on the map.`;
  if (!o.anyShot) return `No opponent is in ${who}’s line of sight. Move for a clear shot.`;
  return o.touch ? 'Tap an opponent on the map or in the target strip.' : 'Click an opponent on the map.';
}

/** Grab button: when it can't be used, say why in place of the odds. */
export function grabButton(o: { hasTarget: boolean; near: boolean; actionSpent: boolean; odds: string | null }): { label: string; disabled: boolean; title: string } {
  if (!o.hasTarget) return { label: 'Grab', disabled: true, title: 'Pick a target.' };
  if (!o.near) return { label: 'Grab · Not Adjacent', disabled: true, title: 'Needs an adjacent target.' };
  if (o.actionSpent) return { label: 'Grab · Action Spent', disabled: true, title: 'Your Action is spent this Turn.' };
  return { label: o.odds ? `Grab · ${o.odds}` : 'Grab', disabled: false, title: 'Action: opposed DEX + Brawling.' };
}

/** Has `actorId` spent this Turn's Action? Only meaningful during an encounter on their Turn. */
export function actionSpent(enc: { active: boolean; usage?: { actorId: string; actionUsed: boolean } }, actorId: string): boolean {
  return enc.active && enc.usage?.actorId === actorId && enc.usage.actionUsed;
}

export interface LocalLine { id: number; text: string; tone: 'error' | 'help'; /** Newest log seq when it was written. */ after: number }

/**
 * Log items with this viewer's local lines (command errors, /help) in the order
 * they happened: a local line sits after the log lines that existed when it was
 * written and before anything newer.
 */
export function mergeLocal<T extends { seq: number }>(items: readonly T[], local: readonly LocalLine[]): ({ kind: 'item'; item: T } | { kind: 'local'; line: LocalLine })[] {
  const out: ({ kind: 'item'; item: T } | { kind: 'local'; line: LocalLine })[] = [];
  let i = 0;
  for (const item of items) {
    while (i < local.length && local[i]!.after < item.seq) out.push({ kind: 'local', line: local[i++]! });
    out.push({ kind: 'item', item });
  }
  while (i < local.length) out.push({ kind: 'local', line: local[i++]! });
  return out;
}
