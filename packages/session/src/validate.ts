/**
 * Intent validation: the first thing the authority does with any intent.
 *
 * Intents arrive as untrusted JSON (players over the relay, and the GM's own
 * client). Every field the engine reads is checked for type and bounds here,
 * so a bad payload is rejected before it can reach the rules engine or the
 * permanent log. Players may never send GM-only fields (situational
 * modifiers, DV rulings, line-of-sight overrides).
 *
 * Unknown intent types pass through untouched: modules that own them
 * (Netrunning, systems) validate their own payloads.
 */
import {
  AMMO_TYPES, ammoProblem, cyberwareProblem, drugsStateProblem, qualityProblem, roleProblem, shieldProblem, smartWeaponProblem, vehicleProblem, WEAPON_QUALITIES, WEAPON_TYPES,
  type AmmoTypeId, type CyberwareItem, type RoleState, type Weapon,
} from '@cprc/rules-core';
import { SessionError } from './helpers.js';
import { validateMapLighting } from './vision.js';
import { validateMapAnnotations } from './annotations.js';
import type { SessionState, Viewer } from './types.js';

type Obj = Record<string, unknown>;

const bad = (msg: string): never => { throw new SessionError('INVALID', msg); };
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function obj(v: unknown, what: string): Obj {
  return isObj(v) ? v : bad(`${what} must be an object.`);
}
function str(v: unknown, what: string, max: number, opts: { optional?: boolean; min?: number } = {}): string | undefined {
  if (v === undefined && opts.optional) return undefined;
  if (typeof v !== 'string' || v.length < (opts.min ?? 1) || v.length > max) bad(`${what} must be text of ${opts.min ?? 1}–${max} characters.`);
  return v as string;
}
function int(v: unknown, what: string, lo: number, hi: number, optional = false): number | undefined {
  if (v === undefined && optional) return undefined;
  if (!Number.isInteger(v) || (v as number) < lo || (v as number) > hi) bad(`${what} must be a whole number from ${lo} to ${hi}.`);
  return v as number;
}
function num(v: unknown, what: string, lo: number, hi: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) bad(`${what} must be a number from ${lo} to ${hi}.`);
  return v as number;
}
function bool(v: unknown, what: string, optional = true) {
  if (v === undefined && optional) return;
  if (typeof v !== 'boolean') bad(`${what} must be true or false.`);
}
function oneOf<T extends string>(v: unknown, what: string, options: readonly T[], optional = false): T | undefined {
  if (v === undefined && optional) return undefined;
  if (typeof v !== 'string' || !(options as readonly string[]).includes(v)) bad(`${what} must be one of: ${options.join(', ')}.`);
  return v as T;
}
function arr(v: unknown, what: string, max: number, optional = false): unknown[] | undefined {
  if (v === undefined && optional) return undefined;
  if (!Array.isArray(v) || v.length > max) bad(`${what} must be a list of at most ${max} items.`);
  return v as unknown[];
}
function cell(v: unknown, what: string) {
  const c = obj(v, what);
  int(c.x, `${what}.x`, 0, 999);
  int(c.y, `${what}.y`, 0, 999);
}
function actorId(state: SessionState, v: unknown, what: string) {
  const id = str(v, what, 64)!;
  if (!state.actors[id]) throw new SessionError('NOT_FOUND', `No actor ${id}.`);
}
const ID_RE = /^[A-Za-z0-9_:.-]{1,64}$/;
function idStr(v: unknown, what: string) {
  if (typeof v !== 'string' || !ID_RE.test(v)) bad(`${what} must be 1–64 letters, digits, or _ : . -`);
}

/** Modifiers: only the GM sends them on attacks; whole numbers within ±20. */
export function validateModifiers(v: unknown, what: string, limit = 20) {
  const mods = arr(v, what, 10, true);
  if (!mods) return;
  for (const m of mods) {
    const o = obj(m, `${what} entry`);
    str(o.label, `${what} label`, 60);
    int(o.value, `${what} value`, -limit, limit);
  }
}

const STAT_KEYS = ['INT', 'REF', 'DEX', 'TECH', 'COOL', 'WILL', 'LUCK', 'MOVE', 'BODY', 'EMP'] as const;
const WEAPON_TYPE_KEYS = Object.keys(WEAPON_TYPES);
/** Uploaded assets (/u/...), bundled art (/assets/...), or an inline image. No `..`, no other paths or schemes. */
const ASSET_URL = /^(\/(u|assets)\/[A-Za-z0-9_-][A-Za-z0-9_./-]{0,279}|data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+)$/;
const MAX_INLINE_IMAGE = 6_000_000;

function imageUrl(v: unknown, what: string) {
  if (v === undefined) return;
  if (typeof v !== 'string' || v.length > MAX_INLINE_IMAGE || !ASSET_URL.test(v) || v.includes('..')) bad(`${what} must be an uploaded image path or an inline image.`);
}

const AMMO_IDS = AMMO_TYPES.map((a) => a.id);
/** Without an inline portrait, one actor's JSON stays well under this. */
const MAX_ACTOR_JSON = 200_000;

function problem(p: string | null, what: string) {
  if (p) bad(`${what}: ${p}`);
}

function validateWeapon(w: unknown) {
  const o = obj(w, 'Weapon');
  str(o.id, 'Weapon id', 64); str(o.name, 'Weapon name', 60);
  oneOf(o.type, 'Weapon type', WEAPON_TYPE_KEYS);
  if (o.ammo !== undefined) {
    const am = obj(o.ammo, 'Ammo');
    const cap = int(am.capacity, 'Magazine', 0, 999)!;
    int(am.loaded, 'Loaded ammo', 0, cap);
  }
  int(o.damageDiceOverride, 'Damage dice', 1, 20, true);
  if (o.rofOverride !== undefined && o.rofOverride !== 1 && o.rofOverride !== 2) bad('ROF must be 1 or 2.');
  const ammoType = oneOf(o.ammoType, 'Ammo type', AMMO_IDS, true) as AmmoTypeId | undefined;
  bool(o.smartgunLink, 'Smartgun Link');
  oneOf(o.quality, 'Quality', WEAPON_QUALITIES, true);
  oneOf(o.smart, 'Smart Weapon', ['built', 'rebuild'] as const, true);
  oneOf(o.tech2070s, '2070s class', ['power', 'tech'] as const, true);
  const weapon = o as unknown as Weapon;
  problem(smartWeaponProblem(weapon), weapon.name);
  if (ammoType && ammoType !== 'basic') problem(ammoProblem(weapon, ammoType), weapon.name);
  problem(qualityProblem(weapon), weapon.name);
}

/**
 * Derived modifiers (recomputed by the engine, but stored on the actor):
 * nested objects of small numbers and booleans only, so future modifier
 * kinds pass while junk (strings, huge values, deep nesting) doesn't.
 */
function validateMods(v: unknown, what = 'Modifiers', depth = 0) {
  if (depth > 2) bad(`${what} are nested too deeply.`);
  const m = obj(v, what);
  if (Object.keys(m).length > 80) bad(`${what} has too many entries.`);
  for (const [k, x] of Object.entries(m)) {
    str(k, `${what} key`, 60);
    if (typeof x === 'boolean') continue;
    if (isObj(x)) validateMods(x, `${what} ${k}`, depth + 1);
    else num(x, `${what} ${k}`, -50, 50);
  }
}

function validateCombatantExtras(c: Obj) {
  if (c.role !== undefined) problem(roleProblem(obj(c.role, 'Role') as unknown as RoleState), 'Role');
  if (c.humanity !== undefined) {
    const h = obj(c.humanity, 'Humanity');
    const max = int(h.max, 'Max Humanity', 0, 200)!;
    int(h.current, 'Humanity', -200, max);
    int(h.base, 'Starting Humanity', 0, 200, true);
  }
  for (const g of arr(c.gear, 'Gear', 100, true) ?? []) {
    const o = obj(g, 'Gear item');
    str(o.name, 'Gear name', 80); int(o.qty, 'Quantity', 0, 9999);
    str(o.notes, 'Gear notes', 500, { optional: true, min: 0 });
  }
  for (const cw of arr(c.cyberware, 'Cyberware', 40, true) ?? []) problem(cyberwareProblem(obj(cw, 'Cyberware') as unknown as CyberwareItem), 'Cyberware');
  if (c.mods !== undefined) validateMods(c.mods);
  if (c.perRound !== undefined) {
    const pr = obj(c.perRound, 'Per-Round abilities');
    int(pr.round, 'Round', 0, 100_000); bool(pr.deflected, 'deflected'); bool(pr.spotWeakness, 'spotWeakness');
  }
  int(c.onFire, 'On Fire', 0, 50, true);
  int(c.reputation, 'Reputation', 0, 10, true);
  // Critical Injury Turn flags and activated speedware state.
  if (c.turnFlags !== undefined) {
    const f = obj(c.turnFlags, 'Turn flags');
    bool(f.loseAction, 'Lost Action flag'); bool(f.noMove, 'Lost Move flag');
  }
  if (c.speedware !== undefined) {
    const sw = obj(c.speedware, 'Speedware');
    bool(sw.active, 'Speedware on', false); int(sw.roundsLeft, 'Speedware Rounds left', 0, 100); bool(sw.spent, 'Speedware spent', false);
  }
  // Shields, drugs, vehicles.
  if (c.shield !== undefined) problem(shieldProblem(c.shield), 'Shield');
  if (c.drugs !== undefined) problem(drugsStateProblem(c.drugs), 'Drugs');
  if (c.vehicle !== undefined) problem(vehicleProblem(c.vehicle), 'Vehicle');
  if (c.flags !== undefined) for (const [k, x] of Object.entries(obj(c.flags, 'Flags'))) bool(x, `Flag ${k}`, false);
}

export function validateActor(v: unknown) {
  const a = obj(v, 'Actor');
  idStr(a.id, 'Actor id');
  str(a.controller, 'Controller', 64);
  oneOf(a.allegiance, 'Allegiance', ['party', 'ally', 'neutral', 'hostile'] as const, true);
  imageUrl(a.portrait, 'Portrait');
  str(a.notes, 'Notes', 8000, { optional: true, min: 0 });
  str(a.gmNotes, 'GM notes', 8000, { optional: true, min: 0 });
  const { portrait: _p, ...rest } = a;
  if (JSON.stringify(rest).length > MAX_ACTOR_JSON) bad('That character sheet is too large.');
  const c = obj(a.combatant, 'Combatant');
  if (c.id !== a.id) bad('actor.id must equal combatant.id.');
  str(c.name, 'Name', 60);
  oneOf(c.side, 'Side', ['pc', 'npc'] as const);
  const stats = obj(c.stats, 'STATs');
  for (const k of STAT_KEYS) int(stats[k], k, 0, 20);
  const skills = obj(c.skills, 'Skills');
  const entries = Object.entries(skills);
  if (entries.length > 120) bad('Too many skills.');
  for (const [k, lvl] of entries) { str(k, 'Skill name', 60); int(lvl, `Skill ${k}`, 0, 20); }
  const hp = obj(c.hp, 'HP');
  const max = int(hp.max, 'Max HP', 1, 999)!;
  int(hp.current, 'Current HP', -999, max);
  for (const p of arr(c.armor, 'Armor', 12)!) {
    const o = obj(p, 'Armor piece');
    str(o.id, 'Armor id', 64); str(o.name, 'Armor name', 60);
    oneOf(o.location, 'Armor location', ['head', 'body'] as const);
    const mx = int(o.maxSP, 'Max SP', 0, 99)!;
    int(o.currentSP, 'Current SP', 0, mx);
    int(o.penalty, 'Armor penalty', -10, 0);
  }
  for (const i of arr(c.criticalInjuries, 'Critical Injuries', 40)!) {
    const o = obj(i, 'Critical Injury');
    str(o.injuryId, 'Injury id', 64); oneOf(o.table, 'Injury table', ['head', 'body'] as const); bool(o.quickFixed, 'quickFixed', false);
  }
  int(obj(c.deathSave, 'Death Save').accumulatedPenalty, 'Death Save penalty', 0, 99);
  const cond = obj(c.conditions, 'Conditions');
  for (const k of ['prone', 'unconscious', 'dead', 'stabilized']) bool(cond[k], k, false);
  validateCombatantExtras(c);
  for (const w of arr(a.weapons, 'Weapons', 24)!) validateWeapon(w);
}

export function validateMap(v: unknown) {
  const m = obj(v, 'Map');
  idStr(m.id, 'Map id');
  str(m.name, 'Map name', 80);
  const w = int(m.width, 'Map width', 1, 200)!;
  const h = int(m.height, 'Map height', 1, 200)!;
  if (w * h > 10_000) bad('Maps are limited to 10,000 squares.');
  if (typeof m.cells !== 'string' || m.cells.length !== w * h || !/^[.#c~]*$/.test(m.cells)) bad('Map cells must be width × height terrain codes.');
  int(m.cellPx, 'Square size', 8, 1024);
  int(m.sightRange, 'Sight range', 1, 999);
  imageUrl(m.background, 'Background');
  const tokens = obj(m.tokens, 'Tokens');
  if (Object.keys(tokens).length > 500) bad('Too many tokens.');
  for (const [k, c] of Object.entries(tokens)) { str(k, 'Token id', 64); cell(c, 'Token'); }
  const watches = obj(m.watches, 'Watches');
  for (const [k, wv] of Object.entries(watches)) {
    str(k, 'Watch id', 64);
    const o = obj(wv, 'Watch');
    num(o.facing, 'Facing', 0, 360); int(o.arc, 'Arc', 30, 180); int(o.range, 'Range', 1, 999);
  }
  for (const s of arr(m.spotted, 'Spotted', 500)!) str(s, 'Spotted id', 64);
  if (m.lighting !== undefined) validateLighting(m.lighting);
  validateMapLighting(m, w, h);
  validateMapAnnotations(m, w, h);
  // Exploration bitmap.
  if (m.explored !== undefined && (typeof m.explored !== 'string' || m.explored.length !== w * h || !/^[01]*$/.test(m.explored))) {
    bad('Explored squares must be a width × height string of 0 and 1.');
  }
}

function validateLighting(v: unknown) {
  const l = obj(v, 'Lighting');
  bool(l.revealAll, 'revealAll');
  for (const k of arr(l.revealed, 'Revealed squares', 10_000, true) ?? []) {
    if (typeof k !== 'string' || !/^\d{1,3},\d{1,3}$/.test(k)) bad('Revealed squares must be "x,y".');
  }
}

/** Fields only the GM may send, on any intent. */
const GM_FIELDS = ['situational', 'gmDv', 'gmDvIfDefenderCannotEvade', 'ignoreLineOfSight'] as const;

/**
 * Throws SessionError for any malformed intent. Intent types not listed
 * here are passed through to their own handlers.
 */
export function validateIntent(state: SessionState, raw: unknown, by: Viewer): void {
  const i = obj(raw, 'Intent');
  if (typeof i.type !== 'string' || i.type.length > 40) bad('Intent needs a type.');
  if (JSON.stringify(i).length > 8_000_000) bad('That intent is too large.');
  if (by.role !== 'gm') {
    for (const f of GM_FIELDS) if (i[f] !== undefined) throw new SessionError('FORBIDDEN', 'Only the GM can set modifiers or rulings on an attack.');
  }
  const pendingId = () => str(i.pendingId, 'pendingId', 64);
  switch (i.type) {
    case 'addActor':
    case 'replaceActor':
      validateActor(i.actor);
      return;
    case 'removeActor':
    case 'deathSave':
    case 'clearWatch':
      actorId(state, i.actorId, 'actorId');
      return;
    case 'assignController':
      actorId(state, i.actorId, 'actorId');
      str(i.controller, 'Controller', 64);
      return;
    case 'startEncounter': {
      const ps = arr(i.participants, 'Participants', 100)!;
      if (ps.length === 0) bad('Add at least one participant.');
      for (const p of ps) {
        const o = obj(p, 'Participant');
        actorId(state, o.actorId, 'Participant');
        int(o.bonus, 'Initiative bonus', -20, 20, true);
      }
      return;
    }
    case 'endEncounter':
    case 'cancelPending':
    case 'endTurn':
      return;
    case 'rangedAttack':
      actorId(state, i.attackerId, 'attackerId');
      actorId(state, i.defenderId, 'defenderId');
      str(i.weaponId, 'weaponId', 64);
      num(i.distance, 'Distance', 0, 5000);
      oneOf(i.mode, 'Mode', ['single', 'autofire'] as const, true);
      oneOf(i.aimTarget, 'Aim', ['head', 'heldItem', 'leg'] as const, true);
      validateModifiers(i.situational, 'Modifiers');
      bool(i.defenderDodges, 'defenderDodges');
      bool(i.ignoreLineOfSight, 'ignoreLineOfSight');
      return;
    case 'meleeAttack': {
      actorId(state, i.attackerId, 'attackerId');
      actorId(state, i.defenderId, 'defenderId');
      const w = obj(i.with, 'with');
      const kind = oneOf(w.kind, 'Attack kind', ['weapon', 'brawling', 'martialArts'] as const);
      if (kind === 'weapon') str(w.weaponId, 'weaponId', 64);
      if (kind === 'martialArts') str(w.form, 'Martial Arts form', 40);
      oneOf(i.aimTarget, 'Aim', ['head', 'heldItem', 'leg'] as const, true);
      validateModifiers(i.situational, 'Modifiers');
      int(i.gmDv, 'DV', 0, 60, true);
      return;
    }
    case 'respondDodge':
      pendingId(); bool(i.dodge, 'dodge', false);
      return;
    case 'rollDamage':
    case 'declineWatch':
      pendingId();
      return;
    case 'stabilize':
      actorId(state, i.medicId, 'medicId');
      actorId(state, i.targetId, 'targetId');
      oneOf(i.skill, 'Skill', ['First Aid', 'Paramedic'] as const);
      validateModifiers(i.situational, 'Modifiers');
      return;
    case 'reload':
      actorId(state, i.actorId, 'actorId');
      str(i.weaponId, 'weaponId', 64);
      return;
    case 'setMap':
      if (i.map !== null) validateMap(i.map);
      return;
    case 'placeToken':
      actorId(state, i.actorId, 'actorId');
      if (i.at !== null) cell(i.at, 'Square');
      return;
    case 'moveToken':
      actorId(state, i.actorId, 'actorId');
      cell(i.to, 'Square');
      bool(i.run, 'run');
      return;
    case 'setWatch':
      actorId(state, i.actorId, 'actorId');
      num(i.facing, 'Facing', -720, 720);
      int(i.arc, 'Arc', 30, 180, true);
      return;
    case 'rollCheck':
      str(i.label, 'Label', 80);
      if (i.actorId !== undefined) actorId(state, i.actorId, 'actorId');
      oneOf(i.stat, 'STAT', STAT_KEYS, true);
      str(i.skill, 'Skill', 60, { optional: true });
      int(i.base, 'Base', -20, 60, true);
      // Free checks are public and show their breakdown; players get a tighter bound.
      validateModifiers(i.modifiers, 'Modifiers', by.role === 'gm' ? 20 : 10);
      int(i.dv, 'DV', 0, 60, true);
      bool(i.private, 'private');
      return;
    case 'rollDice': {
      str(i.label, 'Label', 80);
      const d = obj(i.dice, 'Dice');
      int(d.count, 'Dice count', 1, 20);
      if (d.sides !== 6 && d.sides !== 10) bad('RED rolls d6 or d10.');
      int(d.bonus, 'Bonus', -50, 50);
      bool(i.private, 'private');
      return;
    }
    case 'chat':
      str(i.text, 'Message', 500);
      for (const t of arr(i.to, 'Recipients', 12, true) ?? []) str(t, 'Recipient', 64);
      if (i.asActorId !== undefined) actorId(state, i.asActorId, 'asActorId');
      return;
    case 'adjustHp':
      actorId(state, i.actorId, 'actorId');
      int(i.delta, 'HP change', -999, 999);
      str(i.reason, 'Reason', 80, { optional: true, min: 0 });
      return;
    case 'setCondition':
      actorId(state, i.actorId, 'actorId');
      oneOf(i.condition, 'Condition', ['prone', 'unconscious', 'dead', 'stabilized'] as const);
      bool(i.value, 'value', false);
      return;
    case 'saveToLibrary': {
      const kind = oneOf(i.kind, 'Kind', ['map', 'actor'] as const);
      if (kind === 'map') validateMap(i.item); else validateActor(i.item);
      return;
    }
    case 'removeFromLibrary':
      oneOf(i.kind, 'Kind', ['map', 'actor'] as const);
      str(i.id, 'id', 64);
      return;
    case 'switchScene':
      str(i.mapId, 'mapId', 64);
      return;
    case 'spawnFromLibrary':
      str(i.templateId, 'templateId', 64);
      idStr(i.newId, 'newId');
      str(i.name, 'Name', 60, { optional: true });
      if (i.at !== undefined) cell(i.at, 'Square');
      return;
    case 'setLighting':
      validateLighting(i.lighting);
      return;
    case 'areaAttack':
      actorId(state, i.attackerId, 'attackerId');
      str(i.weaponId, 'weaponId', 64);
      oneOf(i.kind, 'Area kind', ['shotgunShell', 'launcher', 'thrownGrenade'] as const);
      cell(i.at, 'Square');
      return;
    case 'suppressiveFire':
      actorId(state, i.attackerId, 'attackerId');
      str(i.weaponId, 'weaponId', 64);
      return;
    default:
      // Owned by another module (Netrunning, systems): validated by its handler.
      return;
  }
}
