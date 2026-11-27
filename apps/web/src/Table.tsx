import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { profileOf, type Cell, type Weapon } from '@cprc/rules-core';
import type { Intent } from '@cprc/session';
import { client, type ClientState } from './net.js';
import { MapView, type MapMode } from './MapView.js';
import { aimOf, isFriendly, nearestTarget, previewAttack, type AttackMode } from './tactics.js';
import { demoIntents } from './demo.js';
import type { TableCtx } from './table/ctx.js';
import { HelpOverlay, InitiativeStrip, Prompts, TopBar } from './table/panels.js';
import { coverAt, coverLabel } from './table/cover.js';
import { CombatPanel, fireBlocked } from './table/CombatPanel.js';
import { SheetPanel } from './table/SheetPanel.js';
import { AreaDodgePrompt } from './systems/AreaDodgePrompt.js';
import { CombatExtrasPanel, GearPanel, GmSystemsPanel, NetPanel, warmSplitChunks } from './table/lazy.js';
import { ChatPanel } from './table/ChatPanel.js';
import { Inspector, ScenePanel } from './table/GmPanels.js';
import { NotesPanel } from './table/NotesPanel.js';
import { narrate } from './narrate.js';
import { areaKindFor } from './table/area.js';
import { EFFECT_MS, effectsFor, type Effect } from './table/effects.js';
import { play } from './table/sound.js';
import { ActionBar } from './table/layout/ActionBar.js';
import { TargetChips, targetChips } from './table/layout/TargetChips.js';
import { TurnBanner } from './table/layout/TurnBanner.js';
import { useLayout } from './table/layout/useMedia.js';
import { AreaConfirm } from './table/AreaConfirm.js';
import { clearPlacement, prunePlacement, shiftPlacement, usePlacementQueue } from './table/placement.js';
import { requiredPrompt } from './table/required.js';
import { defaultTerrainStyle, rubbleFrom, type TerrainStyle } from './map/terrain.js';
import { noTargetHint } from './table/hints.js';

type Tab = 'combat' | 'sheet' | 'chat' | 'notes' | 'net' | 'scene';
/** Bottom sheet height on phones and portrait tablets. */
type Sheet = 'closed' | 'half' | 'full';

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

/** Entries arriving faster than this (log fetch, reconnect) are history, not live play. */
const BACKFILL_BATCH = 3;
const SETTLE_MS = 1500;

export function Table({ s }: { s: ClientState }) {
  const view = s.view!;
  const isGm = s.role === 'gm';
  const me = isGm ? 'gm' : (s.playerId ?? '');
  const enc = view.encounter;
  const currentId = enc.active ? enc.order[enc.turnIndex] ?? null : null;

  const [selected, setSelected] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [weaponId, setWeaponId] = useState<string | null>(null);
  const [mode, setMode] = useState<AttackMode>('single');
  const [mapMode, setMapMode] = useState<MapMode>('move');
  // One-shot map picks: a cover square to shoot, or where a missed explosive lands.
  const [coverPick, setCoverPick] = useState(false);
  const [scatterPick, setScatterPick] = useState(false);
  const [delayOpen, setDelayOpen] = useState<DOMRect | null>(null);
  const [partyFog, setPartyFog] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>('combat');
  const [sheet, setSheet] = useState<Sheet>('closed');
  const sheetOpen = sheet !== 'closed';
  const setSheetOpen = (v: boolean) => setSheet(v ? 'half' : 'closed');
  const [sideCollapsed, setSideCollapsed] = useState(() => store.get('nsc.sideCollapsed') === '1');
  const [showMini, setShowMini] = useState(() => store.get('nsc.minimap') === '1');
  const layout = useLayout();
  const [help, setHelp] = useState(false);
  const [effects, setEffects] = useState<Effect[]>([]);
  const [unread, setUnread] = useState(0);
  const [gmCursor, setGmCursor] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [notesUnread, setNotesUnread] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  // Terrain style: the GM's choice per map (Scene tab, Show Terrain); players get the map's default.
  const terrainKey = view.map ? `nsc.terrain.${view.map.id}` : '';
  const [terrainPick, setTerrainPick] = useState<Record<string, TerrainStyle>>({});
  const storedTerrain = terrainKey ? (terrainPick[terrainKey] ?? (store.get(terrainKey) as TerrainStyle | null)) : null;
  const terrainStyle: TerrainStyle | undefined = view.map
    ? (isGm && (storedTerrain === 'full' || storedTerrain === 'outline') ? storedTerrain : defaultTerrainStyle(view.map)) : undefined;
  const setTerrainStyle = (t: TerrainStyle) => { if (!terrainKey) return; store.set(terrainKey, t); setTerrainPick((m) => ({ ...m, [terrainKey]: t })); };
  const rubble = useMemo(() => (view.map ? rubbleFrom(s.feed.flatMap((f) => f.events), view.map) : undefined), [s.feed, view.map?.cells, view.map?.width]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { warmSplitChunks(); }, []);

  const mine = useCallback((id: string | null | undefined) => !!id && (isGm || view.actors[id]?.controller === me), [isGm, view.actors, me]);
  const name = useCallback((id: string) => view.actors[id]?.public.name ?? 'Unknown Contact', [view.actors]);
  const c: TableCtx = { s, view, isGm, me, mine, name, who: (by) => client.nameOf(by), act: (i: Intent) => client.act(i) };

  // Acting: the current actor in an encounter; otherwise whoever you selected (or your only character).
  const ownIds = Object.values(view.actors).filter((a) => !isGm && a.controller === me).map((a) => a.id);
  const actingId = currentId ?? (selected && mine(selected) ? selected : ownIds.length === 1 ? ownIds[0]! : null);
  const canAct = mine(actingId);
  const acting0 = actingId ? view.actors[actingId] : undefined;
  const acting = acting0 && !acting0.placeholder ? acting0 : undefined;
  const weapons: Weapon[] = acting?.weapons ?? [];
  const weapon = weapons.find((w) => w.id === weaponId) ?? weapons[0];
  const usage = enc.usage?.actorId === actingId ? enc.usage : null;
  const areaKind = areaKindFor(weapon);

  useEffect(() => { setMapMode((m) => (m === 'ruler' || m === 'reveal' ? m : 'move')); setMode('single'); }, [actingId]);
  useEffect(() => { if (targetId && !view.map?.tokens[targetId]) setTargetId(null); }, [view.map, targetId]);
  // A new actor keeps the target only if it's on the other side; nobody targets themselves.
  useEffect(() => {
    if (!targetId) return;
    const t = view.actors[targetId];
    if (targetId === actingId || !t || t.placeholder || (acting && isFriendly(t) === isFriendly(acting))) setTargetId(null);
  }, [actingId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (mapMode === 'area' && !areaKind) setMapMode('move'); }, [areaKind, mapMode]);
  const scatter = view.pending?.kind === 'awaitingScatter' ? view.pending : null;
  useEffect(() => { if (!scatter) setScatterPick(false); }, [scatter?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setCoverPick(false); setDelayOpen(null); }, [actingId, weapon?.id]);
  // GM "Place by Clicking" queue from the character editor (#12).
  const placing = usePlacementQueue();
  const placeNext = isGm && view.map ? placing[0] ?? null : null;
  useEffect(() => {
    prunePlacement((id) => !!view.actors[id] && !view.map?.tokens[id]);
  }, [view.actors, view.map?.tokens]);
  const effMode: MapMode = scatterPick ? 'area' : coverPick || placeNext ? 'place' : mapMode;
  // Encounter over: drop combat-only UI state (#14).
  useEffect(() => {
    if (enc.active) return;
    setTargetId(null); setMapMode('move'); setDelayOpen(null); setCoverPick(false); setScatterPick(false);
  }, [enc.active]); // eslint-disable-line react-hooks/exhaustive-deps
  // Area attacks aim first, then confirm (#13).
  const [areaAim, setAreaAim] = useState<Cell | null>(null);
  useEffect(() => { setAreaAim(null); }, [effMode, actingId, weapon?.id, scatter?.id]);
  const confirmArea = () => {
    if (!areaAim) return;
    if (scatterPick && scatter) { if (c.act({ type: 'placeScatter', pendingId: scatter.id, at: areaAim })) { setScatterPick(false); setAreaAim(null); } return; }
    if (!actingId || !weapon || !areaKind) return;
    if (c.act({ type: 'areaAttack', attackerId: actingId, weaponId: weapon.id, kind: areaKind === 'blast' ? 'launcher' : 'shotgunShell', at: areaAim })) { setMapMode('move'); setAreaAim(null); }
  };

  const attack = useMemo(
    () => (actingId && targetId && weapon && canAct ? previewAttack(view, actingId, targetId, weapon, mode) : null),
    [view, actingId, targetId, weapon, mode, canAct],
  );
  const chances = useMemo(() => {
    const out: Record<string, number | null> = {};
    if (!actingId || !weapon || !canAct || !view.map) return out;
    for (const id of Object.keys(view.map.tokens)) {
      const a = view.actors[id];
      if (!a || isFriendly(a) === isFriendly(acting) || a.public.conditions.dead) continue;
      const r = previewAttack(view, actingId, id, weapon, mode);
      if (r.ok && r.chance !== null) out[id] = r.chance;
    }
    return out;
  }, [view, actingId, weapon, mode, canAct, acting]);

  const fire = () => {
    if (!actingId || !targetId || !weapon) return;
    if (profileOf(weapon).melee) {
      c.act({ type: 'meleeAttack', attackerId: actingId, defenderId: targetId, with: { kind: 'weapon', weaponId: weapon.id }, ...(aimOf(mode) ? { aimTarget: aimOf(mode) } : {}) });
    } else {
      c.act({
        type: 'rangedAttack', attackerId: actingId, defenderId: targetId, weaponId: weapon.id, distance: attack?.distanceM ?? 1,
        ...(mode === 'autofire' ? { mode: 'autofire' as const } : {}), ...(aimOf(mode) ? { aimTarget: aimOf(mode) } : {}),
      });
    }
  };

  // ----- Effects and sound from new log entries -----
  // Only entries that arrive live animate. History (initial log load, reconnect
  // backfill) just advances the cursor: no floaters, no sounds, no unread counts.
  const lastSeq = useRef<number>(s.feed.at(-1)?.seq ?? 0);
  const liveAfter = useRef(Date.now() + SETTLE_MS);
  const prevStatus = useRef(s.status);
  useEffect(() => {
    if (s.status === 'online' && prevStatus.current !== 'online') liveAfter.current = Date.now() + SETTLE_MS;
    prevStatus.current = s.status;
  }, [s.status]);
  useEffect(() => {
    const last = s.feed.at(-1)?.seq ?? 0;
    if (last < lastSeq.current) { lastSeq.current = last; return; } // undo or log replaced
    const fresh = s.feed.filter((f) => f.seq > lastSeq.current);
    if (!fresh.length) return;
    lastSeq.current = fresh.at(-1)!.seq;
    if (fresh.length > BACKFILL_BATCH || Date.now() < liveAfter.current) return;
    const events = fresh.flatMap((f) => f.events);
    const tokens = view.map?.tokens ?? {};
    const all = effectsFor(events, tokens);
    const now = Date.now();
    if (all.effects.length) setEffects((prev) => [...prev.filter((e) => now - e.t < EFFECT_MS), ...all.effects]);
    [...new Set(all.cues)].slice(0, 3).forEach((cue, i) => window.setTimeout(() => play(cue), i * 90));
    const talk = events.filter((e) => e.type === 'chatMessage' || e.type === 'checkRolled' || e.type === 'diceRolled').length;
    if (talk && tab !== 'chat') setUnread((u) => u + talk);
    if (events.some((e) => e.type === 'handoutShared') && tab !== 'notes') setNotesUnread((u) => u + 1);
    // Screen readers: announce results (not chatter, which the chat log already reads).
    const lines = events.filter((e) => e.type !== 'chatMessage').map((e) => narrate(e, name, (b) => client.nameOf(b))?.text).filter(Boolean);
    if (lines.length) setAnnounce(lines.slice(-3).join(' '));
  }, [s.feed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!effects.length) return;
    const t = window.setTimeout(() => setEffects((prev) => prev.filter((e) => Date.now() - e.t < EFFECT_MS)), EFFECT_MS + 50);
    return () => window.clearTimeout(t);
  }, [effects]);
  const pingCount = useRef(s.signals.pings.length);
  useEffect(() => {
    const p = s.signals.pings;
    if (p.length > pingCount.current && p.at(-1)?.from !== 'me') play('ping');
    pingCount.current = p.length;
  }, [s.signals.pings]);
  const prevCurrent = useRef(currentId);
  useEffect(() => {
    if (currentId && currentId !== prevCurrent.current) {
      if (!isGm && mine(currentId)) play('turn');
      setAnnounce(mine(currentId) && !isGm ? `Your Turn: ${name(currentId)}.` : `${name(currentId)}’s Turn.`);
    }
    prevCurrent.current = currentId;
  }, [currentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- Keyboard shortcuts -----
  const owesDeathSave = !!currentId && enc.deathSaveRequiredFor === currentId;
  const canEndTurn = enc.active && (isGm || (mine(currentId) && !owesDeathSave)) && !view.pending;
  const keyState = { canAct, usage, attack, weapon, canEndTurn, mapMode };
  const keys = useRef(keyState);
  keys.current = keyState;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The GM shell keeps the Table mounted while another tab shows: ignore keys then.
      const root = rootRef.current;
      if (!root || root.closest('[hidden]') || root.offsetParent === null) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = keys.current;
      switch (e.key) {
        case 'm': case 'M': setMapMode('move'); break;
        case 'w': case 'W': if (k.canAct && !k.usage?.actionUsed) setMapMode(k.mapMode === 'watch' ? 'move' : 'watch'); break;
        case 'r': case 'R': setMapMode(k.mapMode === 'ruler' ? 'move' : 'ruler'); break;
        case 'f': case 'F': if (k.canAct && !fireBlocked({ attack: k.attack, usage: k.usage, weapon: k.weapon }, !!view.pending)) fire(); break;
        case 'e': case 'E': if (k.canEndTurn) client.act({ type: 'endTurn' }); break;
        case 'Escape': setScatterPick(false); setCoverPick(false); setDelayOpen(null); setMapMode('move'); setHelp(false); setFocusId(null); setHighlight([]); break;
        case '?': setHelp((h) => !h); break;
        case 'g': case 'G': (root.querySelector('.mapstage svg') as SVGSVGElement | null)?.focus(); break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // rebinding keeps `fire` fresh

  const openTab = (t: Tab) => { setTab(t); setSheetOpen(true); if (t === 'chat') setUnread(0); if (t === 'notes') setNotesUnread(0); };

  // A prompt this viewer must answer takes over the action bar, and the panel opens to it once.
  const required = useMemo(() => requiredPrompt(view, me), [view, me]);
  const lastRequired = useRef<string | null>(null);
  useEffect(() => {
    const key = required?.key ?? null;
    if (key && key !== lastRequired.current) {
      setTab('combat');
      if (layout.sheet || layout.compact) setSheet((sh) => (sh === 'closed' ? 'half' : sh));
      else setSideCollapsed(false);
    }
    lastRequired.current = key;
  }, [required?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickToken = (id: string) => {
    const a = view.actors[id];
    if (!a || a.placeholder) return;
    if (isGm) setFocusId(id);
    if (id === actingId) return;
    // Opposing the actor who's acting (a GM's NPC shooting a PC counts): target it.
    const opposing = acting ? isFriendly(a) !== isFriendly(acting) : !isFriendly(a);
    if (opposing && !a.public.conditions.dead) { setTargetId(id); return; }
    if (mine(id) && !enc.active) { setSelected(id); return; }
    setTargetId(id);
  };

  // NET: always for the GM; for players once one of their characters has a cyberdeck rig.
  const ownRunner = ownIds.find((id) => view.netrun?.rigs[id]) ?? null;
  const showNet = isGm || !!ownRunner;
  const netActorId = isGm ? (focusId ?? actingId ?? selected) : (actingId && view.netrun?.rigs[actingId] ? actingId : selected && view.netrun?.rigs[selected] ? selected : ownRunner);
  useEffect(() => { if (tab === 'net' && !showNet) setTab('combat'); }, [tab, showNet]);
  const tabs: [Tab, string][] = [['combat', 'Combat'], ['sheet', 'Sheet'], ['chat', 'Chat'], ['notes', 'Notes'], ...(showNet ? [['net', 'NET'] as [Tab, string]] : []), ...(isGm ? [['scene', 'Scene'] as [Tab, string]] : [])];
  const fireNow = canAct && !!targetId && !!weapon && !fireBlocked({ attack, usage, weapon }, !!view.pending);
  const chips = useMemo(() => (canAct ? targetChips(view, actingId, chances) : []), [view, actingId, chances, canAct]);
  const anyShot = useMemo(() => (canAct && actingId ? nearestTarget(view, actingId) !== null : false), [view, actingId, canAct]);
  const targetHint = noTargetHint({
    canAct, opponents: chips.length, anyShot, actingName: acting ? name(acting.id) : null,
    friendly: acting ? isFriendly(acting) : true, touch: layout.compact || layout.sheet,
  });
  // Turn banner: your own characters (for the GM, the NPCs the GM runs).
  const bannerTitle = currentId && view.actors[currentId] && !view.actors[currentId]!.placeholder && mine(currentId) && (!isGm || view.actors[currentId]!.controller === 'gm')
    ? (isGm ? `${name(currentId)}’s Turn` : 'Your Turn') : null;
  const turnKey = enc.active && currentId ? `${enc.round}:${enc.turnIndex}:${currentId}` : null;
  // Delay (house rule), shown in both the desktop bar and the phone dock.
  const delaySlot: React.ReactNode = (() => {
    // Delay (house rule): act later this Round, before moving or acting.
    if (!enc.active || !canAct || !currentId || actingId !== currentId || enc.delayAllowed === false) return null;
    const fresh = !usage || (usage.moveUsed === 0 && !usage.actionUsed);
    const later = enc.order.slice(enc.turnIndex + 1).filter((id) => view.actors[id] && !view.actors[id]!.placeholder);
    // Players' order omits unseen hostiles, so "last" is the server's call.
    return (
      <span className="menu-wrap">
        <button className={`btn${delayOpen ? ' on' : ''}`} disabled={!fresh || !!view.pending} aria-expanded={!!delayOpen} aria-haspopup="menu"
          onClick={(e) => setDelayOpen(delayOpen ? null : e.currentTarget.getBoundingClientRect())} title="House rule: take your Turn later this Round (before you move or act).">Delay</button>
        {delayOpen && (
          <span className="menu" role="menu" style={{ left: Math.max(8, Math.min(delayOpen.left, window.innerWidth - 230)), bottom: window.innerHeight - delayOpen.top + 6 }}>
            {later.map((id) => <button key={id} role="menuitem" onClick={() => { setDelayOpen(null); c.act({ type: 'delayTurn', after: id }); }}>After {c.name(id)}</button>)}
            <button role="menuitem" onClick={() => { setDelayOpen(null); c.act({ type: 'delayTurn' }); }}>To the End of the Round</button>
          </span>
        )}
      </span>
    );
  })();
  const sheetMode = layout.sheet;
  // Landscape phones are short on map: the target strip starts folded and folds again after a pick or a map touch.
  const [chipsFolded, setChipsFolded] = useState(layout.shortLandscape);
  useEffect(() => { setChipsFolded(layout.shortLandscape); }, [layout.shortLandscape]);
  const showChips = (layout.compact || layout.sheet) && canAct && mapMode === 'move' && !required && chips.length > 0;
  const toggleSide = () => { const v = !sideCollapsed; setSideCollapsed(v); store.set('nsc.sideCollapsed', v ? '1' : '0'); };

  return (
    <div className={`table sheet-${sheet}${sideCollapsed && !sheetMode && !layout.shortLandscape ? ' side-collapsed' : ''}${layout.compact ? ' compact' : ''}`} ref={rootRef}>
      <TopBar c={c} onHelp={() => setHelp(true)} />
      <InitiativeStrip c={c} onPick={(id, friendly) => (view.actors[id]?.placeholder ? undefined : friendly ? (setSelected(id), isGm && setFocusId(id)) : setTargetId(id))} />

      <main className="mapwrap" onPointerDownCapture={(e) => { if (layout.shortLandscape && !chipsFolded && (e.target as Element).closest?.('.mapstage')) setChipsFolded(true); }}>
        {view.map ? (
          <MapView
            view={view} isGm={isGm} actingId={actingId} canAct={canAct} targetId={targetId} attack={attack} chances={chances}
            compact={layout.compact || layout.sheet}
            bottomInset={showChips && !chipsFolded ? (layout.shortLandscape ? 52 : 62) : 0}
            followIds={[...(actingId && view.map.tokens[actingId] ? [actingId] : []), ...(targetId && targetId !== actingId ? [targetId] : [])]}
            followKey={`${turnKey ?? 'free'}|${actingId ?? ''}|${targetId ?? ''}|${sheet}`}
            showMini={showMini} onToggleMini={() => { const v = !showMini; setShowMini(v); store.set('nsc.minimap', v ? '1' : '0'); }}
            mode={effMode} areaKind={scatterPick ? 'blast' : areaKind} partyFog={partyFog} neutralTemplate={!!scatterPick}
            hoverInfo={(cell) => { const ci = view.map ? coverAt(view.map, cell) : null; return ci ? coverLabel(ci, isGm) : null; }} focusId={isGm ? focusId : null} highlight={highlight}
            shareCursor={!isGm || gmCursor} me={c.me} act={c.act} terrainStyle={terrainStyle} rubble={rubble}
            signals={s.signals} effects={effects} nameOf={(f) => client.nameOf(f)}
            canDrag={(id) => isGm || (mine(id) && (!enc.active || currentId === id))}
            onToken={pickToken}
            onTokenContext={(id) => { if (isGm) { setFocusId(id); openTab('combat'); } else pickToken(id); }}
            onCell={(cell, { run }) => {
              if (coverPick) {
                if (actingId && weapon && c.act({ type: 'attackCover', attackerId: actingId, weaponId: weapon.id, at: cell })) setCoverPick(false);
                return;
              }
              if (placeNext) { if (c.act({ type: 'placeToken', actorId: placeNext, at: cell })) shiftPlacement(); return; }
              if (mapMode === 'place' && isGm && (focusId ?? selected)) { c.act({ type: 'placeToken', actorId: (focusId ?? selected)!, at: cell }); return; }
              if (!actingId || !canAct) return;
              c.act({ type: 'moveToken', actorId: actingId, to: cell, ...(run ? { run: true } : {}) });
            }}
            onDrop={(id, cell, { run }) => {
              if (isGm && !(enc.active && currentId === id)) { c.act({ type: 'placeToken', actorId: id, at: cell }); return; }
              c.act({ type: 'moveToken', actorId: id, to: cell, ...(run && !isGm ? { run: true } : {}) });
            }}
            onWatchFacing={(deg) => { if (actingId) { c.act({ type: 'setWatch', actorId: actingId, facing: deg, arc: 90 }); setMapMode('move'); } }}
            onArea={(at) => setAreaAim(at)}
            areaLock={effMode === 'area' ? areaAim : null}
            onReveal={(cells, add) => {
              const l = view.map?.lighting ?? {};
              const set = new Set(l.revealed ?? []);
              for (const k of cells) { if (add) set.add(k); else set.delete(k); }
              c.act({ type: 'setLighting', lighting: { ...l, revealed: [...set] } });
            }}
            onSignal={(sig) => client.signal(sig)}
          />
        ) : (
          <div className="card empty-map">
            <div className="ttl">No Map Yet</div>
            {isGm ? (
              <>
                <p>Load the demo to try the tactical view: four of the crew against a gang crew in a neon-lit warehouse yard.</p>
                <button className="cta" onClick={() => client.actAll(demoIntents())}>Load Demo Encounter</button>
              </>
            ) : <p className="dim">The GM hasn’t loaded a map.</p>}
          </div>
        )}
        {showChips && <TargetChips chips={chips} targetId={targetId} collapsed={chipsFolded} onCollapse={setChipsFolded} onPick={(id) => { setTargetId(id); if (layout.shortLandscape) setChipsFolded(true); }} />}
        <TurnBanner turnKey={turnKey} title={bannerTitle} sub={bannerTitle && !isGm ? name(currentId!) : undefined} />
        {!sheetMode && !layout.shortLandscape && sideCollapsed && (
          <button className="btn side-open" onClick={toggleSide} aria-label="Show Panels" title="Show Panels">Panels ‹</button>
        )}
        {view.map && (
          <div className="legend">
            <span><i className="sw-move" />Move</span>
            <span><i className="sw-run" />Run (uses the Action)</span>
            <span><i className="sw-watch" />Watch</span>
            <span><i className="sw-unseen" />Unseen</span>
          </div>
        )}
        {effMode === 'area' && areaAim && view.map && (areaKind || scatterPick) && (
          <AreaConfirm view={view} actingId={scatterPick ? (scatter?.attackerId ?? null) : actingId} weapon={weapon} kind={scatterPick ? 'blast' : areaKind!}
            aim={areaAim} scatter={!!scatterPick} onConfirm={confirmArea} onCancel={() => setAreaAim(null)} />
        )}
        {(scatterPick || coverPick) && <div className="mode-banner h">{scatterPick ? 'Scatter: tap where the explosive lands.' : 'Shoot Cover: tap a cover square.'} <button className="link" onClick={() => { setScatterPick(false); setCoverPick(false); }}>Cancel (Esc)</button></div>}
        {placeNext && !scatterPick && !coverPick && (
          <div className="mode-banner h place-queue" role="status">
            Place {view.actors[placeNext]?.public.name ?? 'Them'}: Tap a Square{placing.length > 1 ? ` (${placing.length - 1} More After)` : ''}
            <button className="btn ghost" onClick={shiftPlacement}>Skip</button>
            <button className="btn ghost" onClick={clearPlacement}>Done</button>
          </div>
        )}
        {!placeNext && !scatterPick && !coverPick && mapMode !== 'move' && <div className="mode-banner h">{
          mapMode === 'ruler' ? 'Ruler: drag to measure. Everyone sees it.'
            : mapMode === 'watch' ? 'Watch: tap where to face (90° cone).'
              : mapMode === 'area' ? (areaKind === 'blast' ? 'Blast: tap the aim square.' : 'Shell: tap the direction to fire.')
                : mapMode === 'place' ? 'Place: tap a square for the selected token.'
                  : 'Reveal: drag over squares.'
        } <button className="link" onClick={() => setMapMode('move')}>Cancel (Esc)</button></div>}
      </main>

      <ActionBar
        c={c} compact={layout.compact} mapMode={mapMode} setMapMode={setMapMode} actingId={actingId} acting={acting} canAct={canAct}
        usage={usage} weapon={weapon} targetId={targetId} attack={attack} fireNow={fireNow} onFire={fire} canEndTurn={canEndTurn}
        partyFog={partyFog} setPartyFog={setPartyFog} extra={delaySlot}
        required={required} onOpenPanel={() => { openTab('combat'); setSideCollapsed(false); }}
      />

      <aside className="side" aria-label="Panels">
        <div className="tabs" role="tablist">
          {tabs.map(([t, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`tab${tab === t ? ' sel' : ''}`} onClick={() => (tab === t && sheetOpen ? setSheetOpen(false) : openTab(t))}>
              {label}{t === 'chat' && unread > 0 && <span className="badge">{unread > 9 ? '9+' : unread}</span>}
              {t === 'notes' && notesUnread > 0 && <span className="badge">{notesUnread}</span>}
            </button>
          ))}
          {sheetMode && sheetOpen && (
            <button className="tab grip" aria-label={sheet === 'full' ? 'Half-Height Panel' : 'Full-Height Panel'} title={sheet === 'full' ? 'Half Height' : 'Full Height'} onClick={() => setSheet(sheet === 'full' ? 'half' : 'full')}>{sheet === 'full' ? '⇩' : '⇧'}</button>
          )}
          {sheetMode
            ? <button className="tab grip" aria-label={sheetOpen ? 'Collapse Panel' : 'Expand Panel'} onClick={() => setSheetOpen(!sheetOpen)}>{sheetOpen ? '▾' : '▴'}</button>
            : !layout.shortLandscape && <button className="tab grip side-hide" aria-label="Hide Panels" title="Hide Panels" onClick={toggleSide}>›</button>}
        </div>
        <div className={`side-body tab-${tab}`}>
          <Prompts c={c} onPickScatter={setScatterPick} scatterPicking={scatterPick} />
          <AreaDodgePrompt view={view} isGm={isGm} mine={(id) => c.mine(id)} name={c.name} act={c.act} />
          {tab === 'combat' && (
            <>
              {isGm && focusId && view.actors[focusId] && <Inspector c={c} id={focusId} onClose={() => setFocusId(null)} onTarget={setTargetId} />}
              <CombatPanel
                c={c} actingId={actingId} currentId={currentId} canAct={canAct} weapon={weapon} setWeaponId={setWeaponId} mode={mode} setMode={setMode}
                targetId={targetId} setTargetId={setTargetId} attack={attack} usage={usage} mapMode={mapMode} setMapMode={setMapMode}
                setHighlight={setHighlight} onFire={fire} coverPick={coverPick} setCoverPick={setCoverPick}
                ownIds={ownIds} onSelectOwn={(id) => setSelected(id)} targetHint={targetHint}
              />
              <CombatExtrasPanel c={c} actingId={actingId} targetId={targetId} canAct={canAct} />
              <GearPanel c={c} actingId={actingId} targetId={targetId} canAct={canAct} />
            </>
          )}
          {tab === 'sheet' && <SheetPanel c={c} preferId={isGm ? (focusId ?? actingId) : actingId} />}
          {tab === 'notes' && <NotesPanel c={c} />}
          {tab === 'net' && showNet && <NetPanel view={view} actorId={netActorId} isGm={isGm} canAct={mine(netActorId)} act={(i) => client.act(i)} feed={s.feed} />}
          {tab === 'chat' && <ChatPanel c={c} rollerId={isGm ? (focusId ?? actingId) : (canAct ? actingId : ownIds[0] ?? null)} onUnreadReset={() => setUnread(0)} />}
          {tab === 'scene' && isGm && <ScenePanel c={c} mapMode={mapMode} setMapMode={setMapMode} terrainStyle={terrainStyle} setTerrainStyle={setTerrainStyle} shareCursor={gmCursor} setShareCursor={(v) => { setGmCursor(v); if (!v) client.signal({ kind: 'cursor', at: null }); }} onFocus={(id) => { setFocusId(id); setTab('combat'); }} />}
          {tab === 'scene' && isGm && <GmSystemsPanel c={c} />}
        </div>
      </aside>

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announce}</div>
      {help && <HelpOverlay onClose={() => setHelp(false)} />}
      {s.toast && Date.now() - s.toast.at < 5000 && <div className="toast" role="alert">{s.toast.text}</div>}
    </div>
  );
}
