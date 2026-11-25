import type { Intent, ViewState } from '@cprc/session';
import type { ClientState } from '../net.js';

/** What every table panel needs to know about the viewer. */
export interface TableCtx {
  s: ClientState;
  view: ViewState;
  isGm: boolean;
  /** 'gm' or this player's id. */
  me: string;
  mine: (id: string | null | undefined) => boolean;
  name: (id: string) => string;
  who: (by: string) => string;
  act: (i: Intent) => boolean;
}

export const WOUND: Record<string, string> = { unhurt: 'Unhurt', lightly: 'Lightly Wounded', seriously: 'Seriously Wounded', mortally: 'Mortally Wounded' };
export const ALLEGIANCE: Record<string, string> = { party: 'Party', ally: 'Ally', neutral: 'Neutral', hostile: 'Hostile' };
