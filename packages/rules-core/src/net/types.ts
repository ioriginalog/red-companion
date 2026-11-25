/**
 * Netrunning data model. Rule sources and their status are recorded in
 * docs/rules-verification.md ("Netrunning"). Names of game terms (Backdoor,
 * Black ICE, Programs) are RED's; every summary and every stat shipped in
 * data.ts is original to this tool and GM-editable.
 */

export type NetDifficulty = 'basic' | 'standard' | 'uncommon' | 'advanced';

export type InterfaceAbility = 'backdoor' | 'cloak' | 'control' | 'eyeDee' | 'pathfinder' | 'scanner' | 'slide' | 'virus' | 'zap';

export interface NetDice { count: number; sides: 6 }

/** Black ICE, GM-entered. PER resists Slide, SPD drives the encounter Speed Check, ATK/DEF are combat bonuses, REZ is its HP. */
export interface IceStats {
  name: string;
  /** antiPersonnel: damages the runner's brain (HP). antiProgram: damages, then destroys, Programs. */
  kind: 'antiPersonnel' | 'antiProgram';
  per: number;
  spd: number;
  atk: number;
  def: number;
  rez: number;
  damage: NetDice;
  /** Short original summary of any extra effect; shown to the GM as a ruling prompt when it lands. */
  effect?: string;
}

export interface DemonStats { name: string; rez: number; interface: number; netActions: number }

export type NetFloorKind = 'password' | 'file' | 'controlNode' | 'blackIce' | 'demon' | 'empty';

export interface NetFloor {
  id: string;
  kind: NetFloorKind;
  /** Optional GM label ("Lobby", "Camera Grid"). */
  label?: string;
  /** Password, File and Control Node DV. */
  dv?: number;
  /** File contents or what a Control Node runs. Revealed to the runner on Eye-Dee / Control success. */
  note?: string;
  ice?: IceStats[];
  demon?: DemonStats;
}

/** A tree of floors: the root is Floor 1; a node with several children is a branch. */
export interface NetArchitecture {
  id: string;
  name: string;
  difficulty: NetDifficulty;
  rootId: string;
  floors: Record<string, NetFloor>;
  children: Record<string, string[]>;
  /** Squares on a map where a runner can Jack In. */
  access: { mapId: string; cells: { x: number; y: number }[] }[];
  /** DV to plant a Virus on a lowest floor (GM-set). */
  virusDv: number;
}

export type ProgramClass = 'booster' | 'defender' | 'attacker';

export interface Program {
  id: string;
  name: string;
  class: ProgramClass;
  /** Attackers: 'ice' (anti-program) or 'netrunner' (anti-personnel). */
  target?: 'ice' | 'netrunner';
  atk: number;
  def: number;
  rez: number;
  maxRez: number;
  status: 'ready' | 'active' | 'derezzed' | 'destroyed';
  /** Booster: bonus to an Interface Ability (or 'speed' for the Speed Check). */
  boost?: { ability: InterfaceAbility | 'speed'; amount: number };
  /** Defender: brain damage reduction while active. */
  brainReduce?: number;
  /** Defender: negates the first brain damage of the run, then deactivates. */
  shield?: boolean;
  /** Attacker damage against Black ICE / Demons. */
  damage?: NetDice;
  summary?: string;
  /** Turn key of last attacker use (once per Round). */
  usedTurn?: string;
}

/** A netrunner's kit: Interface rank (the Netrunner Role Ability) and a cyberdeck. */
export interface NetRig {
  interface: number;
  deckName: string;
  slots: number;
  programs: Program[];
}

/** One runner's live run. ICE state lives here, so a safe Jack Out resets the architecture for them. */
export interface NetRun {
  archId: string;
  floorId: string;
  revealed: string[];
  passed: string[];
  identified: string[];
  controlled: string[];
  /** Current REZ of each ICE on a floor (index-aligned with floor.ice). */
  ice: Record<string, number[]>;
  demonRez: Record<string, number>;
  /** Floors whose ICE has met this runner (they bite on an unsafe Jack Out). */
  encountered: string[];
  cloakDv: number | null;
  virusDv: number | null;
  shieldSpent: boolean;
  /** Turn key of the last Slide (once per Turn). */
  slidTurn: string | null;
}
