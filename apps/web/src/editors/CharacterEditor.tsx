import { Fragment, useEffect, useMemo, useState } from 'react';
import { ARMOR_TYPES, CORE_FORMS, creationHumanity, formSkill, ROLES, WEAPON_TYPES, type RoleId, type StatKey, type WeaponType } from '@cprc/rules-core';
import type { Actor, Allegiance, Intent, ProjectedActor, ViewState } from '@cprc/session';
import { client, type ClientState } from '../net.js';
import { downloadText, loadImage, pickFile } from '../assets.js';
import { SKILL_GROUPS, STAT_KEYS } from '../data/skills.js';
import { STARTER_TEMPLATES } from '../data/templates.js';
import {
  actorFromDraft, derived, draftFromActor, emptyDraft, exportActors, importActors, newWeaponDraft, numberedNames, SKILL_MAX, STAT_MAX, STAT_MIN,
  uniqueId, validateDraft, type ActorDraft, type ActorWithNotes, type ArmorChoice,
} from './actorModel.js';
import { freeSquares } from './mapModel.js';
import { queuePlacement } from '../table/placement.js';
import { isFriendly, partyVision } from '../tactics.js';
import { PortraitCropper } from './PortraitCropper.js';
import { AmmoSelect, CyberwareField, GearField, RoleField } from './SystemsFields.js';
import './editors.css';
import { num } from '../table/format.js';

type Placement = 'off' | 'click' | 'near';

/**
 * Free squares near the party. Hostile or neutral arrivals avoid squares the
 * party can see, so "Near the Party" never reveals them by itself.
 */
function nearPartySquares(view: ViewState, n: number, allegiance: string): { x: number; y: number }[] {
  const map = view.map!;
  const near = Object.entries(map.tokens).find(([tid]) => isFriendly(view.actors[tid]))?.[1];
  const hostile = allegiance === 'hostile' || allegiance === 'neutral';
  if (!hostile) return freeSquares(map, n, near);
  const hidden = freeSquares(map, n, near, partyVision(view));
  return hidden.length === n ? hidden : [...hidden, ...freeSquares(map, n - hidden.length, near)].slice(0, n);
}

const ROLE_NAME = Object.fromEntries(ROLES.map((r) => [r.id, r.name])) as Record<RoleId, string>;

type Sel = { kind: 'session' | 'library'; id: string } | { kind: 'starter'; key: string } | { kind: 'new' };

const ALLEGIANCES: { v: Allegiance; label: string }[] = [
  { v: 'party', label: 'Party (PC)' }, { v: 'ally', label: 'Ally' }, { v: 'neutral', label: 'Neutral' }, { v: 'hostile', label: 'Hostile' },
];
const ALLEGIANCE_TAG: Record<Allegiance, string> = { party: 'Party', ally: 'Ally', neutral: 'Neutral', hostile: 'Hostile' };
const RANGED = (Object.keys(WEAPON_TYPES) as WeaponType[]).filter((t) => !WEAPON_TYPES[t].melee && t !== 'grenade');
const THROWN: WeaponType[] = ['grenade'];
const isFirearm = (t: WeaponType) => !WEAPON_TYPES[t].melee && !['grenade', 'grenadeLauncher', 'rocketLauncher'].includes(t);
const MELEE = (Object.keys(WEAPON_TYPES) as WeaponType[]).filter((t) => WEAPON_TYPES[t].melee);

export function CharacterEditor({ s }: { s: ClientState }) {
  const view = s.view!;
  const sessionActors = Object.values(view.actors);
  const library = view.library?.actors ?? {};
  const allIds = useMemo(() => [...Object.keys(view.actors), ...Object.keys(library)], [view.actors, library]);

  const [sel, setSel] = useState<Sel>({ kind: 'new' });
  const [draft, setDraft] = useState<ActorDraft>(() => ({ ...emptyDraft(), name: '' }));
  const [baseline, setBaseline] = useState('');
  const [reset, setReset] = useState(false);
  // Where new characters go. Off Map by default, so reinforcements stay a surprise.
  const [place, setPlace] = useState<Placement>('off');
  const [copies, setCopies] = useState(3);
  const [cropImg, setCropImg] = useState<HTMLImageElement | null>(null);
  const [skillFilter, setSkillFilter] = useState('');
  const [onlyTrained, setOnlyTrained] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  const load = (d: ActorDraft, next: Sel) => { setDraft(d); setBaseline(JSON.stringify(d)); setSel(next); setReset(false); setMsg(null); };
  const dirty = JSON.stringify(draft) !== baseline;

  const sessionActor = (id: string): ActorWithNotes | null => client.gmActor(id);

  // If the selected session actor disappears (removed elsewhere), fall back to a new draft.
  useEffect(() => {
    if (sel.kind === 'session' && !view.actors[sel.id]) setSel({ kind: 'new' });
    if (sel.kind === 'library' && !library[sel.id]) setSel({ kind: 'new' });
  }, [view.actors, library, sel]);

  const d = derived(draft.stats);
  const problems = validateDraft(draft);
  const set = (patch: Partial<ActorDraft>) => setDraft((x) => ({ ...x, ...patch }));
  const act = (i: Intent) => client.act(i);

  // ----- Actions -----
  function addToSession() {
    if (problems.length) return setMsg({ tone: 'warn', text: problems[0]! });
    const id = uniqueId(draft.name, allIds);
    const actor = actorFromDraft({ ...draft, id });
    if (!act({ type: 'addActor', actor })) return;
    let placed = false;
    if (place === 'near' && view.map) {
      const at = nearPartySquares(view, 1, draft.allegiance)[0];
      if (at) placed = act({ type: 'placeToken', actorId: id, at });
    }
    if (place === 'click' && view.map) queuePlacement([id]);
    load(draftFromActor(actor), { kind: 'session', id });
    setMsg({ tone: 'ok', text: `Added ${actor.combatant.name} to the session${placed ? ' and placed them near the party' : place === 'click' ? '. Tap a square on the Table to place them' : ', off the map'}.` });
  }

  function saveSession() {
    if (sel.kind !== 'session') return;
    if (problems.length) return setMsg({ tone: 'warn', text: problems[0]! });
    const prev = sessionActor(sel.id);
    if (!prev) return;
    const actor = actorFromDraft({ ...draft, id: sel.id }, { previous: prev, resetState: reset });
    if (act({ type: 'replaceActor', actor })) {
      load(draftFromActor(actor), sel);
      setMsg({ tone: 'ok', text: reset ? 'Saved. Health, armor and magazines are back to full.' : 'Saved. Current HP, injuries, armor wear and ammo were kept.' });
    }
  }

  function saveTemplate(asNew: boolean) {
    if (problems.length) return setMsg({ tone: 'warn', text: problems[0]! });
    const id = !asNew && sel.kind === 'library' ? sel.id : uniqueId(`${draft.name}-template`, allIds);
    const actor = actorFromDraft({ ...draft, id, controller: 'gm' }, { resetState: true });
    if (act({ type: 'saveToLibrary', kind: 'actor', item: actor })) {
      load(draftFromActor(actor), { kind: 'library', id });
      setMsg({ tone: 'ok', text: `Saved ${actor.combatant.name} as a template.` });
    }
  }

  function spawnCopies() {
    if (sel.kind !== 'library') return;
    const n = Math.max(1, Math.min(20, copies));
    const names = numberedNames(draft.name, n, sessionActors.map((a) => a.public.name));
    const squares = view.map && place === 'near' ? nearPartySquares(view, n, draft.allegiance) : [];
    const toPlace: string[] = [];
    const taken = [...allIds];
    let done = 0;
    for (let i = 0; i < n; i++) {
      const newId = uniqueId(names[i]!, taken);
      taken.push(newId);
      const at = squares[i];
      if (!act({ type: 'spawnFromLibrary', templateId: sel.id, newId, name: names[i]!, ...(at ? { at } : {}) })) break;
      if (place === 'click') toPlace.push(newId);
      done++;
    }
    if (toPlace.length && view.map) queuePlacement(toPlace);
    if (done) setMsg({ tone: 'ok', text: `Spawned ${done} ${done > 1 ? 'copies' : 'copy'} of ${draft.name}${place === 'click' ? '. Tap squares on the Table to place them' : place === 'off' ? ', off the map' : ''}.` });
  }

  function removeCurrent() {
    if (sel.kind === 'session') {
      if (!window.confirm(`Remove ${draft.name} from the session? Their token leaves the map. Undo on the Table brings them back.`)) return;
      if (act({ type: 'removeActor', actorId: sel.id })) { load({ ...emptyDraft() }, { kind: 'new' }); setMsg({ tone: 'ok', text: 'Removed from the session.' }); }
    } else if (sel.kind === 'library') {
      if (!window.confirm(`Delete the ${draft.name} template?`)) return;
      if (act({ type: 'removeFromLibrary', kind: 'actor', id: sel.id })) { load({ ...emptyDraft() }, { kind: 'new' }); setMsg({ tone: 'ok', text: 'Template deleted.' }); }
    }
  }

  async function importJson() {
    const f = await pickFile('application/json,.json');
    if (!f) return;
    try {
      const actors = importActors(await f.text());
      const taken = [...allIds];
      let saved = 0;
      for (const a of actors) {
        const id = uniqueId(a.combatant.name, taken);
        taken.push(id);
        const item = actorFromDraft({ ...draftFromActor(a), id, controller: 'gm' }, { resetState: true });
        if (act({ type: 'saveToLibrary', kind: 'actor', item })) saved++;
      }
      if (actors.length === 1 && !saved) load({ ...draftFromActor(actors[0]!), id: '' }, { kind: 'new' });
      setMsg({ tone: saved ? 'ok' : 'warn', text: saved ? `Imported ${saved} character${saved > 1 ? 's' : ''} into the library.` : 'Loaded the file as a new draft; the library isn’t available yet.' });
    } catch (e) { setMsg({ tone: 'warn', text: (e as Error).message }); }
  }

  function exportAll() {
    const list = [...sessionActors.map((p) => sessionActor(p.id)).filter((a): a is Actor => !!a), ...Object.values(library)];
    downloadText('characters.json', exportActors(list));
  }

  async function choosePortrait() {
    const f = await pickFile('image/png,image/jpeg,image/webp');
    if (!f) return;
    try { setCropImg(await loadImage(f)); } catch (e) { setMsg({ tone: 'warn', text: (e as Error).message }); }
  }

  const visibleGroups = SKILL_GROUPS.map((g) => ({
    ...g,
    skills: g.skills.filter((k) => (!onlyTrained || (draft.skills[k.name] ?? 0) > 0) && (!skillFilter || k.name.toLowerCase().includes(skillFilter.toLowerCase()))),
  })).filter((g) => g.skills.length);

  const initBonus = (draft.role?.id === 'solo' ? draft.role.awareness?.initiativeReaction ?? 0 : 0)
    + draft.cyberware.flatMap((i) => i.effects).reduce((t, e) => t + (e.kind === 'initiative' ? e.value : 0), 0);
  const title = sel.kind === 'session' ? 'Session Character' : sel.kind === 'library' ? 'Library Template' : sel.kind === 'starter' ? 'Starter Template' : 'New Character';

  return (
    <div className="ed">
      <aside className="ed-col ed-list" aria-label="Characters">
        <div className="btnrow">
          <button className="btn yellow" onClick={() => load({ ...emptyDraft() }, { kind: 'new' })}>New Character</button>
          <button className="btn" onClick={() => void importJson()}>Import JSON</button>
          <button className="btn" onClick={exportAll}>Export All</button>
        </div>
        <ListSection title="In This Session" empty="Nobody yet. Add characters from the form.">
          {sessionActors.map((a) => (
            <ActorItem key={a.id} a={a} sel={sel.kind === 'session' && sel.id === a.id}
              onClick={() => { const full = sessionActor(a.id); if (full) load(draftFromActor(full), { kind: 'session', id: a.id }); }} />
          ))}
        </ListSection>
        <ListSection title="Library" empty="Saved templates appear here.">
          {Object.values(library).map((a) => (
            <ActorItem key={a.id} a={{ id: a.id, controller: a.controller, public: { name: a.combatant.name, allegiance: a.allegiance ?? 'hostile', portrait: a.portrait, conditions: a.combatant.conditions } }}
              sel={sel.kind === 'library' && sel.id === a.id} onClick={() => load(draftFromActor(a), { kind: 'library', id: a.id })} />
          ))}
        </ListSection>
        <ListSection title="Starter Templates" empty="">
          {STARTER_TEMPLATES.map((t) => (
            <button key={t.key} className={`li${sel.kind === 'starter' && sel.key === t.key ? ' sel' : ''}`} onClick={() => load({ ...t.draft, id: '' }, { kind: 'starter', key: t.key })}>
              <span style={{ minWidth: 0 }}><span className="nm" style={{ display: 'block' }}>{t.label}</span><span className="meta">{t.blurb}</span></span>
            </button>
          ))}
        </ListSection>
      </aside>

      <main className="ed-col ed-main">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <h1 className="ed-h">{draft.name.trim() || 'Unnamed'}</h1>
          <span className="note">{title}{dirty ? ' · Unsaved changes' : ''}</span>
        </div>

        <section className="card">
          <div className="ttl">Identity</div>
          <div className="row" style={{ alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ display: 'grid', gap: 6, justifyItems: 'center' }}>
              <div className="pf big" data-al={draft.allegiance}>
                {draft.portrait ? <img src={draft.portrait} alt="" /> : <div className="ini">{draft.name.slice(0, 1) || '?'}</div>}
              </div>
              <button className="btn sm" onClick={() => void choosePortrait()}>{draft.portrait ? 'Change Portrait' : 'Add Portrait'}</button>
              {draft.portrait && <button className="btn sm ghost" onClick={() => set({ portrait: null })}>Remove</button>}
            </div>
            <div style={{ flex: 1, display: 'grid', gap: 10, minWidth: 240 }}>
              <label className="fld"><span>Name</span><input value={draft.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} placeholder="Character name" /></label>
              <div className="grid2">
                <label className="fld"><span>Allegiance</span>
                  <select value={draft.allegiance} onChange={(e) => set({ allegiance: e.target.value as Allegiance })}>
                    {ALLEGIANCES.map((a) => <option key={a.v} value={a.v}>{a.label}</option>)}
                  </select>
                </label>
                <label className="fld"><span>Played by</span>
                  <select value={draft.allegiance === 'party' ? draft.controller : 'gm'} disabled={draft.allegiance !== 'party'} onChange={(e) => set({ controller: e.target.value })}>
                    <option value="gm">GM</option>
                    {s.players.map((p) => <option key={p.playerId} value={p.playerId}>{p.name}</option>)}
                  </select>
                </label>
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="ttl">STATs</div>
          <div className="stats">
            {STAT_KEYS.map((k) => (
              <div className="stat" key={k}>
                <label htmlFor={`stat-${k}`}>{k}</label>
                <input id={`stat-${k}`} type="number" min={STAT_MIN} max={STAT_MAX} value={draft.stats[k]}
                  onChange={(e) => set({ stats: { ...draft.stats, [k]: Math.max(STAT_MIN, Math.min(STAT_MAX, Number(e.target.value) || STAT_MIN)) } })} />
              </div>
            ))}
          </div>
          <div className="derived" style={{ marginTop: 10 }}>
            <div><div className="k">Hit Points</div><div className="v mono">{d.maxHp}</div></div>
            <div><div className="k">Seriously Wounded</div><div className="v mono" style={{ fontSize: 16 }}>Below {d.seriouslyBelow}</div></div>
            <div><div className="k">Death Save</div><div className="v mono" style={{ fontSize: 16 }}>Roll Under {d.deathSaveUnder}</div></div>
            <div><div className="k">Move</div><div className="v mono" style={{ fontSize: 16 }}>{draft.stats.MOVE} Sq · {d.moveMeters} m</div></div>
          </div>
          <div className="note" style={{ marginTop: 6 }}>HP = 10 + 5 × (BODY + WILL) ÷ 2, rounded up. Typical STATs run 2 to 8.</div>
        </section>

        <RoleField value={draft.role} onChange={(role) => set({ role })} />

        <section className="card">
          <div className="ttl">Skills</div>
          <div className="row" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
            <input placeholder="Filter skills" aria-label="Filter Skills" value={skillFilter} onChange={(e) => setSkillFilter(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
            <label className="lbl" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={onlyTrained} onChange={(e) => setOnlyTrained(e.target.checked)} />Trained Only</label>
          </div>
          {(draft.skills['Martial Arts'] ?? 0) > 0 && (
            <div className="warn" role="alert" style={{ marginBottom: 8 }}>
              Martial Arts is learned per Form. This character has an untyped Martial Arts {draft.skills['Martial Arts']}, which can’t be used for strikes or Special Moves.{' '}
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>Move It to
                <select aria-label="Martial Arts Form for the Untyped Skill" defaultValue="" onChange={(e) => {
                  if (!e.target.value) return;
                  const { 'Martial Arts': lv = 0, ...rest } = draft.skills;
                  set({ skills: { ...rest, [formSkill(e.target.value)]: Math.max(lv, rest[formSkill(e.target.value)] ?? 0) } });
                }}>
                  <option value="">Choose a Form</option>
                  {CORE_FORMS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
            </div>
          )}
          {visibleGroups.map((g) => {
            const trained = g.skills.filter((k) => (draft.skills[k.name] ?? 0) > 0).length;
            return (
              <details className="skg" key={g.category} open={!!skillFilter || onlyTrained || g.category === 'Fighting' || g.category === 'Ranged Weapon'}>
                <summary><span>{g.category}</span><span className="dim">{trained ? `${trained} Trained` : ''}</span></summary>
                <div className="skills">
                  {g.skills.map((k) => {
                    const lv = draft.skills[k.name] ?? 0;
                    return (
                      <label key={k.name} className={`skill${lv > 0 ? ' on' : ''}`}>
                        <span>{k.name} <span className="dim" style={{ fontSize: 11 }}>{k.stat}</span></span>
                        <input type="number" min={0} max={SKILL_MAX} value={lv} aria-label={`${k.name} Level`}
                          onChange={(e) => set({ skills: { ...draft.skills, [k.name]: Math.max(0, Math.min(SKILL_MAX, Number(e.target.value) || 0)) } })} />
                        <span className="base" title={`${k.stat} + ${k.name}`}>{draft.stats[k.stat as StatKey] + lv}</span>
                      </label>
                    );
                  })}
                </div>
              </details>
            );
          })}
        </section>

        <section className="card">
          <div className="ttl">Weapons</div>
          {draft.weapons.length === 0 && <div className="ed-empty">No weapons. Brawling is always available.</div>}
          {draft.weapons.map((w, i) => {
            const p = WEAPON_TYPES[w.type];
            const upd = (patch: Partial<typeof w>) => set({ weapons: draft.weapons.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
            return (
              <Fragment key={w.id}>
              <div className="wrow">
                <label className="fld"><span>Name</span><input value={w.name} maxLength={40} onChange={(e) => upd({ name: e.target.value })} /></label>
                <label className="fld"><span>Type</span>
                  <select value={w.type} onChange={(e) => { const t = e.target.value as WeaponType; const fresh = newWeaponDraft(t, []); upd({ type: t, capacity: fresh.capacity }); }}>
                    <optgroup label="Ranged">{RANGED.map((t) => <option key={t} value={t}>{WEAPON_TYPES[t].displayName}</option>)}</optgroup>
                    <optgroup label="Thrown">{THROWN.map((t) => <option key={t} value={t}>{WEAPON_TYPES[t].displayName}</option>)}</optgroup>
                    <optgroup label="Melee">{MELEE.map((t) => <option key={t} value={t}>{WEAPON_TYPES[t].displayName}</option>)}</optgroup>
                  </select>
                </label>
                <label className="fld"><span>{w.type === 'grenade' ? 'Count' : 'Magazine'}</span>
                  <input type="number" min={1} max={200} disabled={p.melee} value={p.melee ? '' : w.capacity ?? ''} placeholder={p.melee ? '—' : ''}
                    onChange={(e) => upd({ capacity: e.target.value === '' ? null : Number(e.target.value) })} />
                </label>
                <label className="fld"><span>ROF</span>
                  <select value={w.rofOverride ?? ''} onChange={(e) => upd({ rofOverride: e.target.value ? (Number(e.target.value) as 1 | 2) : null })}>
                    <option value="">Default ({p.rof})</option><option value="1">1</option><option value="2">2</option>
                  </select>
                </label>
                <AmmoSelect type={w.type} value={w.ammoType} onChange={(ammoType) => upd({ ammoType })} era2070s={!!view.netrun?.quickhacks2070s} />
                <label className="fld"><span>Damage</span>
                  <input type="number" min={1} max={10} value={w.damageDiceOverride ?? ''} placeholder={`${p.damageDice}d6`}
                    onChange={(e) => upd({ damageDiceOverride: e.target.value ? Number(e.target.value) : null })} aria-label={`${w.name} Damage Dice Override (d6)`} />
                </label>
                <button className="iconbtn" aria-label={`Remove ${w.name}`} onClick={() => set({ weapons: draft.weapons.filter((_, j) => j !== i) })}>✕</button>
              </div>
              {isFirearm(w.type) && (
                <div className="wopts" aria-label={`${w.name} Attachments`}>
                  <label title="+1 to ranged attacks when wired in through a Neural Link with Interface Plugs or a Subdermal Grip.">
                    <input type="checkbox" checked={!!w.smartgunLink} onChange={(e) => upd({ smartgunLink: e.target.checked || undefined })} /> Smartgun Link
                  </label>
                  <label title="2070s option: Smart Weapons get +1 to hit and can load Improved Smart ammo.">Smart Weapon
                    <select value={w.smart ?? ''} onChange={(e) => upd({ smart: (e.target.value || undefined) as 'built' | 'rebuild' | undefined })}>
                      <option value="">No</option><option value="built">Built Smart</option><option value="rebuild">Smart Rebuild (2 Slots)</option>
                    </select>
                  </label>
                  <label title="2070s weapon class. Power and Tech weapons can’t take a Smart Rebuild.">2070s Class
                    <select value={w.tech2070s ?? ''} onChange={(e) => upd({ tech2070s: (e.target.value || undefined) as 'power' | 'tech' | undefined })}>
                      <option value="">None</option><option value="power">Power</option><option value="tech">Tech</option>
                    </select>
                  </label>
                </div>
              )}
              </Fragment>
            );
          })}
          <div className="row" style={{ marginTop: 8 }}>
            <select aria-label="Weapon Type to Add" id="add-weapon" defaultValue="heavyPistol">
              <optgroup label="Ranged">{RANGED.map((t) => <option key={t} value={t}>{WEAPON_TYPES[t].displayName}</option>)}</optgroup>
              <optgroup label="Thrown">{THROWN.map((t) => <option key={t} value={t}>{WEAPON_TYPES[t].displayName}</option>)}</optgroup>
              <optgroup label="Melee">{MELEE.map((t) => <option key={t} value={t}>{WEAPON_TYPES[t].displayName}</option>)}</optgroup>
            </select>
            <button className="btn" onClick={() => {
              const t = (document.getElementById('add-weapon') as HTMLSelectElement).value as WeaponType;
              set({ weapons: [...draft.weapons, newWeaponDraft(t, draft.weapons)] });
            }}>Add Weapon</button>
          </div>
          <div className="note" style={{ marginTop: 6 }}>Damage overrides are for exotic or homebrew gear; leave blank to use the weapon type.</div>
        </section>

        <section className="card">
          <div className="ttl">Armor</div>
          <div className="grid2">
            {(['head', 'body'] as const).map((loc) => (
              <ArmorField key={loc} label={loc === 'head' ? 'Head' : 'Body'} value={draft.armor[loc]} onChange={(v) => set({ armor: { ...draft.armor, [loc]: v } })} />
            ))}
          </div>
          <div className="note" style={{ marginTop: 6 }}>The worst armor penalty applies to REF, DEX and MOVE.</div>
        </section>

        <CyberwareField value={draft.cyberware} emp={draft.stats.EMP} onChange={(cyberware) => set({ cyberware })} />

        <GearField value={draft.gear} onChange={(gear) => set({ gear })} />

        <section className="card">
          <div className="ttl">Notes (Visible to Players)</div>
          <textarea aria-label="Notes (Visible to Players)" value={draft.notes} maxLength={2000} onChange={(e) => set({ notes: e.target.value })} placeholder="Background, look, gear the party knows about…" style={{ width: '100%' }} />
          <div className="ttl" style={{ marginTop: 10 }}>GM Notes</div>
          <textarea aria-label="GM Notes" value={draft.gmNotes} maxLength={4000} onChange={(e) => set({ gmNotes: e.target.value })} placeholder="Secrets, tactics, loot, motives. Never sent to players." style={{ width: '100%' }} />
        </section>
      </main>

      <aside className="ed-col ed-side" aria-label="Save Character">
        {msg && <div className={msg.tone === 'ok' ? 'ok' : 'warn'} role="status">{msg.text}</div>}
        <section className="card">
          <div className="ttl">{title}</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {sel.kind === 'session' && (
              <>
                <button className="cta" style={{ fontSize: 18, padding: 10 }} disabled={!dirty && !reset} onClick={saveSession}>Save Changes</button>
                <label className="lbl" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={reset} onChange={(e) => setReset(e.target.checked)} />Reset Health, Armor and Ammo</label>
                <button className="btn full" onClick={() => saveTemplate(true)}>Save as Template</button>
                <button className="btn full mag" onClick={removeCurrent}>Remove from Session</button>
              </>
            )}
            {sel.kind === 'library' && (
              <>
                <button className="cta" style={{ fontSize: 18, padding: 10 }} onClick={addToSession}>Add to Session</button>
                <div className="row">
                  <input type="number" min={1} max={20} value={copies} aria-label="Number of Copies" onChange={(e) => setCopies(Number(e.target.value) || 1)} style={{ width: 70 }} />
                  <button className="btn" style={{ flex: 1 }} onClick={spawnCopies}>Spawn Copies</button>
                </div>
                <button className="btn full" disabled={!dirty} onClick={() => saveTemplate(false)}>Save Template</button>
                <button className="btn full mag" onClick={removeCurrent}>Delete Template</button>
              </>
            )}
            {(sel.kind === 'starter' || sel.kind === 'new') && (
              <>
                <button className="cta" style={{ fontSize: 18, padding: 10 }} onClick={addToSession}>Add to Session</button>
                <button className="btn full" onClick={() => saveTemplate(true)}>Save as Template</button>
              </>
            )}
            {sel.kind !== 'session' && view.map && (
              <label className="fld"><span>Placement</span>
                <select value={place} onChange={(e) => setPlace(e.target.value as Placement)} aria-label="Placement on the Map">
                  <option value="off">Off Map</option>
                  <option value="click">Place by Clicking</option>
                  <option value="near">Near the Party</option>
                </select>
              </label>
            )}
            <button className="btn full ghost" onClick={() => downloadText(`${uniqueId(draft.name || 'character', [])}.json`, exportActors([actorFromDraft({ ...draft, id: draft.id || uniqueId(draft.name, []) })]))}>Export JSON</button>
          </div>
        </section>
        <section className="card">
          <div className="ttl">At a Glance</div>
          <div className="breakdown">
            <span>Hit Points</span><span className="mono">{d.maxHp}</span>
            <span>Armor (Head / Body)</span><span className="mono">{armorSp(draft.armor.head)} / {armorSp(draft.armor.body)}</span>
            <span>Evasion Base</span><span className="mono">{draft.stats.DEX + (draft.skills.Evasion ?? 0)}</span>
            <span>Can Dodge Bullets</span><span>{draft.stats.REF >= 8 ? 'Yes (REF 8+)' : 'No'}</span>
            <span>Initiative</span><span className="mono">REF {draft.stats.REF}{initBonus ? ` + ${initBonus}` : ''} + 1d10</span>
            <span>Humanity</span><span className="mono">{creationHumanity(draft.stats.EMP, draft.cyberware).current} / {creationHumanity(draft.stats.EMP, draft.cyberware).max}</span>
            {draft.role && <><span>Role</span><span>{ROLE_NAME[draft.role.id]} {draft.role.rank}</span></>}
          </div>
        </section>
      </aside>

      {cropImg && (
        <PortraitCropper img={cropImg} onCancel={() => setCropImg(null)} onDone={(url, where) => {
          set({ portrait: url });
          setCropImg(null);
          if (where === 'local') setMsg({ tone: 'warn', text: 'The portrait is stored only on this device. Players won’t see it until the relay can store images.' });
        }} />
      )}
    </div>
  );
}

function armorSp(c: ArmorChoice): number {
  if (c.kind === 'none') return 0;
  if (c.kind === 'custom') return c.sp;
  return ARMOR_TYPES.find((a) => a.id === c.typeId)?.sp ?? 0;
}

function ArmorField({ label, value, onChange }: { label: string; value: ArmorChoice; onChange: (v: ArmorChoice) => void }) {
  const sel = value.kind === 'type' ? value.typeId : value.kind;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <label className="fld"><span>{label}</span>
        <select value={sel} onChange={(e) => {
          const v = e.target.value;
          onChange(v === 'none' ? { kind: 'none' } : v === 'custom' ? { kind: 'custom', name: 'Custom Armor', sp: 7, penalty: 0 } : { kind: 'type', typeId: v });
        }}>
          <option value="none">None</option>
          {ARMOR_TYPES.map((a) => <option key={a.id} value={a.id}>{a.displayName} (SP {a.sp}{a.penalty ? `, ${num(a.penalty)}` : ''})</option>)}
          <option value="custom">Custom…</option>
        </select>
      </label>
      {value.kind === 'custom' && (
        <div className="grid3">
          <label className="fld"><span>Name</span><input value={value.name} maxLength={30} onChange={(e) => onChange({ ...value, name: e.target.value })} /></label>
          <label className="fld"><span>SP</span><input type="number" min={0} max={30} value={value.sp} onChange={(e) => onChange({ ...value, sp: Number(e.target.value) || 0 })} /></label>
          <label className="fld"><span>Penalty</span><input type="number" min={-6} max={0} value={value.penalty} onChange={(e) => onChange({ ...value, penalty: Math.min(0, Number(e.target.value) || 0) })} /></label>
        </div>
      )}
    </div>
  );
}

function ListSection({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div>
      <div className="ed-sub">{title}</div>
      <div style={{ display: 'grid', gap: 6 }}>{children.length ? children : empty ? <div className="ed-empty">{empty}</div> : null}</div>
    </div>
  );
}

type ItemActor = Pick<ProjectedActor, 'id' | 'controller'> & { public: Pick<ProjectedActor['public'], 'name' | 'allegiance' | 'portrait' | 'conditions'> };

function ActorItem({ a, sel, onClick }: { a: ItemActor; sel: boolean; onClick: () => void }) {
  return (
    <button className={`li${sel ? ' sel' : ''}`} onClick={onClick} aria-current={sel ? 'true' : undefined}>
      <div className="pf" data-al={a.public.allegiance}>
        {a.public.portrait ? <img src={a.public.portrait} alt="" /> : <div className="ini">{a.public.name.slice(0, 1)}</div>}
      </div>
      <span style={{ minWidth: 0 }}>
        <span className="nm" style={{ display: 'block' }}>{a.public.name}</span>
        <span className="meta"><span className={`tag al-${a.public.allegiance}`}>{ALLEGIANCE_TAG[a.public.allegiance]}</span>{a.public.conditions.dead ? ' · Dead' : ''}</span>
      </span>
    </button>
  );
}
