/**
 * Critical Injury tables, encoded as mechanics + short summaries in our own words.
 *
 * IP NOTE: summaries are paraphrases, kept to one line, per the RTG app rule
 * ("summaries only"). Do not paste rulebook text here.
 *
 * Body table: verified against Easy Mode (which reprints the Core body table).
 * Head table: from a single community chart — treat as UNVERIFIED until a GM
 * with the book checks each row.
 */
import type { CritTable, SourceRef } from '../types.js';

export interface InjuryEffect {
  allActions?: number;
  rangedAttacks?: number;
  meleeAttacks?: number;
  /** Applied to MOVE with a floor of 1. */
  move?: number;
  /** Adds to Base Death Save Penalty. */
  deathSavePenalty?: number;
  cannotDodge?: boolean;
  /** Replaces the x2 multiplier for Aimed Shots to the head. */
  headshotMultiplier?: number;
  dropsHeldItem?: boolean;
  loseActionNextTurn?: boolean;
  /** Re-suffer the 5 bonus damage at end of any Turn moving > 4 m/yds on foot. */
  rebleedOnMove?: boolean;
  /** No Move Action next Turn after a Turn moving > 4 m/yds on foot (ear injuries). */
  noMoveAfterMove?: boolean;
  /** Effects the engine can't auto-apply; shown to the GM. */
  situational?: string[];
}

export interface SkillOption { skill: string; dv: number }

export interface CriticalInjuryDef {
  id: string;
  table: CritTable;
  roll: number; // 2–12
  name: string; // Headline-Style
  summary: string; // our words, one line
  effect: InjuryEffect;
  /** Any one option succeeds. null = no Quick Fix exists. */
  quickFix: SkillOption[] | null;
  /** 'quickFixIsPermanent' = a successful Quick Fix removes the effect for good. */
  treatment: SkillOption[] | 'quickFixIsPermanent';
  source: SourceRef;
}

const BODY_SRC: SourceRef = { book: 'CPR Easy Mode', verification: 'easy-mode' };
const HEAD_SRC: SourceRef = { book: 'CPR Core', verification: 'secondary', note: 'Single community source; verify each row.' };

export const BODY_CRITS: CriticalInjuryDef[] = [
  { id: 'dismemberedArm', table: 'body', roll: 2, name: 'Dismembered Arm', summary: 'Arm lost; drop what it held.', effect: { dropsHeldItem: true, deathSavePenalty: 1, situational: ['Arm is gone'] }, quickFix: null, treatment: [{ skill: 'Surgery', dv: 17 }], source: BODY_SRC },
  { id: 'dismemberedHand', table: 'body', roll: 3, name: 'Dismembered Hand', summary: 'Hand lost; drop what it held.', effect: { dropsHeldItem: true, deathSavePenalty: 1, situational: ['Hand is gone'] }, quickFix: null, treatment: [{ skill: 'Surgery', dv: 17 }], source: BODY_SRC },
  { id: 'collapsedLung', table: 'body', roll: 4, name: 'Collapsed Lung', summary: '−2 MOVE (min 1).', effect: { move: -2, deathSavePenalty: 1 }, quickFix: [{ skill: 'Paramedic', dv: 15 }], treatment: [{ skill: 'Surgery', dv: 15 }], source: BODY_SRC },
  { id: 'brokenRibs', table: 'body', roll: 5, name: 'Broken Ribs', summary: 'Moving over 4 m/yds on foot re-inflicts the bonus damage.', effect: { rebleedOnMove: true }, quickFix: [{ skill: 'Paramedic', dv: 13 }], treatment: [{ skill: 'Paramedic', dv: 15 }, { skill: 'Surgery', dv: 13 }], source: BODY_SRC },
  { id: 'brokenArm', table: 'body', roll: 6, name: 'Broken Arm', summary: 'Arm unusable; drop what it held.', effect: { dropsHeldItem: true, situational: ['Arm unusable'] }, quickFix: [{ skill: 'Paramedic', dv: 13 }], treatment: [{ skill: 'Paramedic', dv: 15 }, { skill: 'Surgery', dv: 13 }], source: BODY_SRC },
  { id: 'foreignObject', table: 'body', roll: 7, name: 'Foreign Object', summary: 'Moving over 4 m/yds on foot re-inflicts the bonus damage.', effect: { rebleedOnMove: true }, quickFix: [{ skill: 'First Aid', dv: 13 }, { skill: 'Paramedic', dv: 13 }], treatment: 'quickFixIsPermanent', source: BODY_SRC },
  { id: 'brokenLeg', table: 'body', roll: 8, name: 'Broken Leg', summary: '−4 MOVE (min 1).', effect: { move: -4 }, quickFix: [{ skill: 'Paramedic', dv: 13 }], treatment: [{ skill: 'Paramedic', dv: 15 }, { skill: 'Surgery', dv: 13 }], source: BODY_SRC },
  { id: 'tornMuscle', table: 'body', roll: 9, name: 'Torn Muscle', summary: '−2 to melee attacks.', effect: { meleeAttacks: -2 }, quickFix: [{ skill: 'First Aid', dv: 13 }, { skill: 'Paramedic', dv: 13 }], treatment: 'quickFixIsPermanent', source: BODY_SRC },
  { id: 'spinalInjury', table: 'body', roll: 10, name: 'Spinal Injury', summary: 'No Action next Turn (Move Action still allowed).', effect: { loseActionNextTurn: true, deathSavePenalty: 1 }, quickFix: [{ skill: 'Paramedic', dv: 15 }], treatment: [{ skill: 'Surgery', dv: 15 }], source: BODY_SRC },
  { id: 'crushedFingers', table: 'body', roll: 11, name: 'Crushed Fingers', summary: '−4 to Actions using that hand.', effect: { situational: ['−4 to Actions involving the injured hand'] }, quickFix: [{ skill: 'Paramedic', dv: 13 }], treatment: [{ skill: 'Surgery', dv: 15 }], source: BODY_SRC },
  { id: 'dismemberedLeg', table: 'body', roll: 12, name: 'Dismembered Leg', summary: 'Leg lost; −6 MOVE (min 1); can’t dodge.', effect: { move: -6, cannotDodge: true, deathSavePenalty: 1 }, quickFix: null, treatment: [{ skill: 'Surgery', dv: 17 }], source: BODY_SRC },
];

export const HEAD_CRITS: CriticalInjuryDef[] = [
  { id: 'lostEye', table: 'head', roll: 2, name: 'Lost Eye', summary: '−4 to ranged attacks and sight-based Perception.', effect: { rangedAttacks: -4, deathSavePenalty: 1, situational: ['−4 to Perception using sight'] }, quickFix: null, treatment: [{ skill: 'Surgery', dv: 17 }], source: HEAD_SRC },
  { id: 'brainInjury', table: 'head', roll: 3, name: 'Brain Injury', summary: '−2 to all Actions.', effect: { allActions: -2, deathSavePenalty: 1 }, quickFix: null, treatment: [{ skill: 'Surgery', dv: 17 }], source: HEAD_SRC },
  { id: 'damagedEye', table: 'head', roll: 4, name: 'Damaged Eye', summary: '−2 to ranged attacks and sight-based Perception.', effect: { rangedAttacks: -2, situational: ['−2 to Perception using sight'] }, quickFix: [{ skill: 'Paramedic', dv: 15 }], treatment: [{ skill: 'Surgery', dv: 13 }], source: HEAD_SRC },
  { id: 'concussion', table: 'head', roll: 5, name: 'Concussion', summary: '−2 to all Actions.', effect: { allActions: -2 }, quickFix: [{ skill: 'First Aid', dv: 13 }, { skill: 'Paramedic', dv: 13 }], treatment: 'quickFixIsPermanent', source: HEAD_SRC },
  { id: 'brokenJaw', table: 'head', roll: 6, name: 'Broken Jaw', summary: '−4 to Actions involving speech.', effect: { situational: ['−4 to Actions involving speech'] }, quickFix: [{ skill: 'Paramedic', dv: 13 }], treatment: [{ skill: 'Paramedic', dv: 13 }, { skill: 'Surgery', dv: 13 }], source: HEAD_SRC },
  { id: 'foreignObjectHead', table: 'head', roll: 7, name: 'Foreign Object', summary: 'Moving over 4 m/yds on foot re-inflicts the bonus damage.', effect: { rebleedOnMove: true }, quickFix: [{ skill: 'First Aid', dv: 13 }, { skill: 'Paramedic', dv: 13 }], treatment: 'quickFixIsPermanent', source: HEAD_SRC },
  { id: 'whiplash', table: 'head', roll: 8, name: 'Whiplash', summary: 'Raises Base Death Save Penalty.', effect: { deathSavePenalty: 1 }, quickFix: [{ skill: 'Paramedic', dv: 13 }], treatment: [{ skill: 'Paramedic', dv: 13 }, { skill: 'Surgery', dv: 13 }], source: HEAD_SRC },
  { id: 'crackedSkull', table: 'head', roll: 9, name: 'Cracked Skull', summary: 'Aimed headshots against you multiply through-damage by 3.', effect: { headshotMultiplier: 3, deathSavePenalty: 1 }, quickFix: [{ skill: 'Paramedic', dv: 15 }], treatment: [{ skill: 'Paramedic', dv: 15 }, { skill: 'Surgery', dv: 15 }], source: HEAD_SRC },
  { id: 'damagedEar', table: 'head', roll: 10, name: 'Damaged Ear', summary: 'After moving over 4 m/yds, no Move Action next Turn; −2 hearing Perception.', effect: { noMoveAfterMove: true, situational: ['−2 to Perception using hearing'] }, quickFix: [{ skill: 'Paramedic', dv: 13 }], treatment: [{ skill: 'Surgery', dv: 13 }], source: HEAD_SRC },
  { id: 'crushedWindpipe', table: 'head', roll: 11, name: 'Crushed Windpipe', summary: 'Can’t speak.', effect: { deathSavePenalty: 1, situational: ['Cannot speak'] }, quickFix: null, treatment: [{ skill: 'Surgery', dv: 15 }], source: HEAD_SRC },
  { id: 'lostEar', table: 'head', roll: 12, name: 'Lost Ear', summary: 'After moving over 4 m/yds, no Move Action next Turn; −4 hearing Perception.', effect: { deathSavePenalty: 1, noMoveAfterMove: true, situational: ['−4 to Perception using hearing'] }, quickFix: null, treatment: [{ skill: 'Surgery', dv: 17 }], source: HEAD_SRC },
];

export const CRIT_TABLES: Record<CritTable, CriticalInjuryDef[]> = { body: BODY_CRITS, head: HEAD_CRITS };

const BY_ID = new Map<string, CriticalInjuryDef>([...BODY_CRITS, ...HEAD_CRITS].map((d) => [d.id, d]));
export function getInjury(id: string): CriticalInjuryDef {
  const d = BY_ID.get(id);
  if (!d) throw new Error(`Unknown Critical Injury: ${id}`);
  return d;
}
