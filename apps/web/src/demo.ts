/**
 * Demo encounter for the painted warehouse map. All characters are original
 * to this tool (no published NPCs or stat blocks). Stats are illustrative
 * mooks built on RED's STAT + skill scale.
 */
import { maxHP, type ArmorPiece, type Stats, type Weapon } from '@cprc/rules-core';
import type { Actor, Allegiance, Intent, TacticalMap } from '@cprc/session';

/** 24 × 16 squares of 64 px over warehouse-yard.webp. '#' wall, 'c' cover. */
export const WAREHOUSE_ROWS = [
  '########################',
  '########################',
  '####.................###',
  '####..cc..#.##..ccc.####',
  '####.c....#.##c...c#####',
  '####....c.#.##c....#####',
  '####................####',
  '####c................###',
  '####..c..............###',
  '###c................####',
  '###.c...........c...####',
  '###....c......c...c.####',
  '####....c......c....####',
  '####...............#####',
  '########################',
  '########################',
];

const BASE: Stats = { INT: 5, REF: 6, DEX: 6, TECH: 5, COOL: 6, WILL: 5, LUCK: 5, MOVE: 6, BODY: 6, EMP: 5 };
const jack = (sp = 11): ArmorPiece[] => [
  { id: 'body', name: 'Light Armorjack', location: 'body', maxSP: sp, currentSP: sp, penalty: 0 },
  { id: 'head', name: 'Light Armorjack Helmet', location: 'head', maxSP: sp, currentSP: sp, penalty: 0 },
];
const gun = (id: string, name: string, type: Weapon['type'], capacity?: number): Weapon =>
  capacity ? { id, name, type, ammo: { loaded: capacity, capacity } } : { id, name, type };

function mk(
  id: string, name: string, allegiance: Allegiance, stats: Partial<Stats>, skills: Record<string, number>,
  weapons: Weapon[], portrait?: string,
): Actor {
  const s = { ...BASE, ...stats };
  const max = maxHP(s.BODY, s.WILL);
  return {
    id, controller: 'gm', allegiance, weapons,
    ...(portrait ? { portrait: `/assets/portraits/${portrait}.webp` } : {}),
    combatant: {
      id, name, side: allegiance === 'party' ? 'pc' : 'npc', stats: s, skills, hp: { max, current: max }, armor: jack(),
      criticalInjuries: [], deathSave: { accumulatedPenalty: 0 },
      conditions: { prone: false, unconscious: false, dead: false, stabilized: false },
    },
  };
}

export function demoActors(): Actor[] {
  return [
    mk('vex', 'Vex', 'party', { REF: 8, DEX: 7, BODY: 7, WILL: 6, COOL: 7 },
      { Handgun: 6, 'Shoulder Arms': 6, Autofire: 4, Evasion: 6, Brawling: 4, 'Melee Weapon': 4 },
      [gun('ar', 'Assault Rifle', 'assaultRifle', 25), gun('pistol', 'Heavy Pistol', 'heavyPistol', 8)], 'vex'),
    mk('doc', 'Doc Ruiz', 'party', { REF: 6, BODY: 5, WILL: 7, TECH: 7, MOVE: 5 },
      { Handgun: 5, Paramedic: 6, 'First Aid': 6, Evasion: 4 },
      [gun('pistol', 'Heavy Pistol', 'heavyPistol', 8)], 'doc-ruiz'),
    mk('kestrel', 'Kestrel', 'party', { REF: 7, DEX: 7, BODY: 5, WILL: 6, MOVE: 7, INT: 8 },
      { Handgun: 6, Autofire: 3, Evasion: 6 },
      [gun('smg', 'SMG', 'smg', 30)], 'kestrel'),
    mk('rook', 'Rook', 'ally', { BODY: 8, WILL: 6, MOVE: 5 },
      { 'Shoulder Arms': 6, Evasion: 4, Brawling: 6 },
      [gun('shotgun', 'Shotgun', 'shotgun', 4)]),
    mk('lt', 'Lieutenant', 'hostile', { REF: 7, BODY: 6, WILL: 6 },
      { 'Shoulder Arms': 6, Autofire: 5, Evasion: 5 },
      [gun('ar', 'Assault Rifle', 'assaultRifle', 25)], 'lieutenant'),
    mk('ganger-a', 'Street Ganger', 'hostile', { REF: 5, DEX: 5, BODY: 5, WILL: 4, MOVE: 5 },
      { Handgun: 4, Evasion: 2 },
      [gun('pistol', 'Heavy Pistol', 'heavyPistol', 8)], 'ganger'),
    mk('ganger-b', 'Street Ganger B', 'hostile', { REF: 5, DEX: 5, BODY: 5, WILL: 4, MOVE: 5 },
      { Handgun: 4, Evasion: 2 },
      [gun('pistol', 'Heavy Pistol', 'heavyPistol', 8)], 'ganger'),
    mk('enforcer', 'Enforcer', 'hostile', { REF: 6, DEX: 7, BODY: 8, WILL: 5 },
      { 'Melee Weapon': 6, Brawling: 5, Evasion: 4, Handgun: 3 },
      [gun('blade', 'Heavy Blade', 'heavyMelee'), gun('pistol', 'Medium Pistol', 'mediumPistol', 12)], 'enforcer'),
    mk('drone', 'Security Drone', 'hostile', { REF: 6, BODY: 4, WILL: 4, MOVE: 8 },
      { Handgun: 5 },
      [gun('smg', 'Mounted SMG', 'smg', 30)]),
  ];
}

export function demoMap(): TacticalMap {
  return {
    id: 'warehouse-yard', name: 'Neon Warehouse Ambush', background: '/assets/warehouse-yard.webp', cellPx: 64,
    width: 24, height: 16, cells: WAREHOUSE_ROWS.join(''), sightRange: 30,
    tokens: {
      vex: { x: 6, y: 12 }, doc: { x: 5, y: 13 }, kestrel: { x: 4, y: 12 }, rook: { x: 7, y: 13 },
      lt: { x: 16, y: 5 }, 'ganger-a': { x: 11, y: 4 }, 'ganger-b': { x: 17, y: 8 }, enforcer: { x: 15, y: 7 }, drone: { x: 9, y: 7 },
    },
    watches: {}, spotted: [],
  };
}

/** Intents that set the demo up from an empty session. */
export function demoIntents(): Intent[] {
  return [...demoActors().map((actor): Intent => ({ type: 'addActor', actor })), { type: 'setMap', map: demoMap() }];
}
