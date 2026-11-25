/** Netrunning session types (Track N). Engine types live in @cprc/rules-core (net/). */
import type { Cell, InterfaceAbility, NetArchitecture, NetFloorKind, NetRig, NetRun, Program } from '@cprc/rules-core';

/** Everything netrunning, GM-authoritative. Players get a NetView instead. */
export interface NetState {
  /** Edgerunners Mission Kit 2070s options (Quickhacks). Off by default. */
  quickhacks2070s: boolean;
  architectures: Record<string, NetArchitecture>;
  rigs: Record<string, NetRig>;
  runs: Record<string, NetRun>;
  /** Architectures whose access points the party knows (Scanner or GM reveal). */
  found: string[];
  /** NET Actions spent per runner in a Turn (turn key = "round:turnIndex"). */
  turns?: Record<string, { turn: string; used: number }>;
}

export type NetAbilityName = Exclude<InterfaceAbility, 'scanner'>;

/** One intent type (`{ type: 'net', op }`) carries every netrunning operation. */
export type NetOp =
  // GM prep and control
  | { op: 'saveArchitecture'; architecture: NetArchitecture }
  | { op: 'deleteArchitecture'; archId: string }
  | { op: 'setRig'; actorId: string; rig: NetRig | null }
  | { op: 'setOptions'; quickhacks2070s: boolean }
  /** GM: tell (or untell) the party where an architecture's access points are. */
  | { op: 'revealAccess'; archId: string; found: boolean }
  /** GM: a Black ICE (or Demon floor) on the runner's floor attacks the runner. */
  | { op: 'iceAttack'; actorId: string; index: number }
  /** GM: rip the runner out (unsafe): every live ICE they met bites. */
  | { op: 'forceJackOut'; actorId: string }
  // Runner
  | { op: 'jackIn'; actorId: string; archId: string }
  | { op: 'jackOut'; actorId: string }
  | { op: 'move'; actorId: string; toFloorId: string }
  /** Round 3 P: step down into the `branch`-th way down from here (revealed or not). No Pathfinder needed. */
  | { op: 'descend'; actorId: string; branch: number }
  | { op: 'ability'; actorId: string; ability: NetAbilityName; index?: number; toFloorId?: string }
  | { op: 'program'; actorId: string; programId: string; index: number }
  | { op: 'activate'; actorId: string; programId: string; active: boolean }
  /** Scanner: a Meat Action that finds access points nearby. */
  | { op: 'scan'; actorId: string }
  /** 2070s option: Jack In to a visible target's neuroport within 50 m/yds. */
  | { op: 'quickhack'; actorId: string; targetId: string };

export interface NetFloorView {
  id: string;
  kind: NetFloorKind;
  label?: string;
  depth: number;
  children: string[];
  /** Shown once the runner has dealt with the floor (Backdoor, Eye-Dee, Control). */
  dv?: number;
  note?: string;
  passed: boolean;
  identified: boolean;
  controlled: boolean;
  ice?: { name: string; kind: 'antiPersonnel' | 'antiProgram'; rez: number; maxRez: number }[];
  demon?: { name: string; rez: number; maxRez: number };
  /** Round 3 P: on the runner's own floor, how many ways lead down (revealed or not). */
  exitsDown?: number;
}

export interface NetRunView {
  actorId: string;
  archId: string;
  archName: string;
  floorId: string;
  floors: Record<string, NetFloorView>;
  rootId: string;
  actionsLeft: number | null;
  engaged: boolean;
  cloakDv: number | null;
  virusPlaced: boolean;
  canSlide: boolean;
}

/** What one viewer sees of netrunning: their own runners only (the GM sees all). */
export interface NetView {
  quickhacks2070s: boolean;
  rigs: Record<string, NetRig>;
  runs: Record<string, NetRunView>;
  /** Architectures the party has found (name and access points only). */
  jackable: { id: string; name: string; access: { mapId: string; cells: Cell[] }[] }[];
  /** GM only. */
  full?: NetState;
}

export type { Program };
