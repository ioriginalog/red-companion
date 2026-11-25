import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { effectiveStat, profileOf, type Weapon } from '@cprc/rules-core';
import type { Intent } from '@cprc/session';
import { client, type ClientState } from './net.js';
import { MapView, type MapMode } from './MapView.js';
import { aimOf, isFriendly, previewAttack, type AttackMode } from './tactics.js';
import { demoIntents } from './demo.js';
import type { TableCtx } from './table/ctx.js';
import { HelpOverlay, InitiativeStrip, Prompts, TopBar } from './table/panels.js';
import { CombatPanel, fireBlocked } from './table/CombatPanel.js';
import { SheetPanel } from './table/SheetPanel.js';
import { ChatPanel } from './table/ChatPanel.js';
import { Inspector, ScenePanel } from './table/GmPanels.js';
import { areaKindFor } from './table/area.js';
import { EFFECT_MS, effectsFor, type Effect } from './table/effects.js';
import { play } from './table/sound.js';

type Tab = 'combat' | 'sheet' | 'chat' | 'scene';

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
  const [partyFog, setPartyFog] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>('combat');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [effects, setEffects] = useState<Effect[]>([]);
  const [unread, setUnread] = useState(0);
  const [gmCursor, setGmCursor] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const mine = useCallback((id: string | null | undefined) => !!id && (isGm || view.actors[id]?.controller === me), [isGm, view.actors, me]);
  const name = useCallback((id: string) => view.actors[id]?.public.name ?? 'Someone', [view.actors]);
  const c: TableCtx = { s, view, isGm, me, mine, name, who: (by) => client.nameOf(by), act: (i: Intent) => client.act(i) };

  // Acting: the current actor in an encounter; otherwise whoever you selected (or your only character).
  const ownIds = Object.values(view.actors).filter((a) => !isGm && a.controller === me).map((a) => a.id);
  const actingId = currentId ?? (selected && mine(selected) ? selected : ownIds.length === 1 ? ownIds[0]! : null);
  const canAct = mine(actingId);
  const acting = actingId ? view.actors[actingId] : undefined;
  const weapons: Weapon[] = acting?.weapons ?? [];
  const weapon = weapons.find((w) => w.id === weaponId) ?? weapons[0];
  const usage = enc.usage?.actorId === actingId ? enc.usage : null;
  const areaKind = areaKindFor(weapon);

  useEffect(() => { setMapMode((m) => (m === 'ruler' || m === 'reveal' ? m : 'move')); setMode('single'); }, [actingId]);
  useEffect(() => { if (targetId && !view.map?.tokens[targetId]) setTargetId(null); }, [view.map, targetId]);
  useEffect(() => { if (mapMode === 'area' && !areaKind) setMapMode('move'); }, [areaKind, mapMode]);

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
  const lastSeq = useRef<number>(s.feed.at(-1)?.seq ?? 0);
  useEffect(() => {
    const fresh = s.feed.filter((f) => f.seq > lastSeq.current);
    if (!fresh.length) return;
    lastSeq.current = fresh.at(-1)!.seq;
    const tokens = view.map?.tokens ?? {};
    const all = effectsFor(fresh.flatMap((f) => f.events), tokens);
    const now = Date.now();
    if (all.effects.length) setEffects((prev) => [...prev.filter((e) => now - e.t < EFFECT_MS), ...all.effects]);
    [...new Set(all.cues)].slice(0, 3).forEach((cue, i) => window.setTimeout(() => play(cue), i * 90));
    const talk = fresh.flatMap((f) => f.events).filter((e) => e.type === 'chatMessage' || e.type === 'checkRolled' || e.type === 'diceRolled').length;
    if (talk && tab !== 'chat') setUnread((u) => u + talk);
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
    if (currentId && currentId !== prevCurrent.current && !isGm && mine(currentId)) play('turn');
    prevCurrent.current = currentId;
  }, [currentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- Keyboard shortcuts -----
  const canEndTurn = enc.active && (isGm || mine(currentId)) && !view.pending;
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
        case 'Escape': setMapMode('move'); setHelp(false); setFocusId(null); setHighlight([]); break;
        case '?': setHelp((h) => !h); break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // rebinding keeps `fire` fresh

  const openTab = (t: Tab) => { setTab(t); setSheetOpen(true); if (t === 'chat') setUnread(0); };

  const pickToken = (id: string) => {
    const a = view.actors[id];
    if (!a) return;
    if (isGm) setFocusId(id);
    if (isFriendly(a) && id !== actingId && (mine(id) || !enc.active)) { setSelected(id); return; }
    if (id !== actingId) setTargetId(id);
  };

  const tabs: [Tab, string][] = [['combat', 'Combat'], ['sheet', 'Sheet'], ['chat', 'Chat'], ...(isGm ? [['scene', 'Scene'] as [Tab, string]] : [])];

  return (
    <div className={`table${sheetOpen ? ' sheet-open' : ''}`} ref={rootRef}>
      <TopBar c={c} onHelp={() => setHelp(true)} />
      <InitiativeStrip c={c} onPick={(id, friendly) => (friendly ? (setSelected(id), isGm && setFocusId(id)) : setTargetId(id))} />

      <main className="mapwrap">
        {view.map ? (
          <MapView
            view={view} isGm={isGm} actingId={actingId} canAct={canAct} targetId={targetId} attack={attack} chances={chances}
            mode={mapMode} areaKind={areaKind} partyFog={partyFog} focusId={isGm ? focusId : null} highlight={highlight}
            shareCursor={!isGm || gmCursor}
            signals={s.signals} effects={effects} nameOf={(f) => client.nameOf(f)}
            canDrag={(id) => isGm || (mine(id) && (!enc.active || currentId === id))}
            onToken={pickToken}
            onTokenContext={(id) => { if (isGm) { setFocusId(id); openTab('combat'); } else pickToken(id); }}
            onCell={(cell, { run }) => {
              if (mapMode === 'place' && isGm && (focusId ?? selected)) { c.act({ type: 'placeToken', actorId: (focusId ?? selected)!, at: cell }); return; }
              if (!actingId || !canAct) return;
              c.act({ type: 'moveToken', actorId: actingId, to: cell, ...(run ? { run: true } : {}) });
            }}
            onDrop={(id, cell, { run }) => {
              if (isGm && !(enc.active && currentId === id)) { c.act({ type: 'placeToken', actorId: id, at: cell }); return; }
              c.act({ type: 'moveToken', actorId: id, to: cell, ...(run && !isGm ? { run: true } : {}) });
            }}
            onWatchFacing={(deg) => { if (actingId) { c.act({ type: 'setWatch', actorId: actingId, facing: deg, arc: 90 }); setMapMode('move'); } }}
            onArea={(at) => {
              if (!actingId || !weapon || !areaKind) return;
              if (c.act({ type: 'areaAttack', attackerId: actingId, weaponId: weapon.id, kind: areaKind === 'blast' ? 'launcher' : 'shotgunShell', at })) setMapMode('move');
            }}
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
        {view.map && (
          <div className="legend">
            <span><i style={{ background: 'rgba(34,227,255,0.5)' }} />Move</span>
            <span><i style={{ background: 'rgba(255,212,0,0.5)' }} />Run (Uses Action)</span>
            <span><i style={{ background: '#ff2bd6' }} />Watch</span>
            <span><i style={{ background: 'rgba(2,4,14,0.9)', border: '1px solid #445' }} />Unseen</span>
          </div>
        )}
        {mapMode !== 'move' && <div className="mode-banner h">{
          mapMode === 'ruler' ? 'Ruler: drag to measure. Everyone sees it.'
            : mapMode === 'watch' ? 'Watch: tap where to face (90° cone).'
              : mapMode === 'area' ? (areaKind === 'blast' ? 'Blast: tap the aim square.' : 'Shell: tap the direction to fire.')
                : mapMode === 'place' ? 'Place: tap a square for the selected token.'
                  : 'Reveal: drag over squares.'
        } <button className="link" onClick={() => setMapMode('move')}>Cancel (Esc)</button></div>}
      </main>

      <footer className="actions">
        {canAct && enc.active && (
          <div className="econ">
            <span>Move <b className="mono">{usage?.moveUsed ?? 0}/{acting?.combatant ? effectiveStat(acting.combatant, 'MOVE') : '?'}</b></span>
            <span className={usage?.actionUsed ? 'used' : ''}>Action</span>
          </div>
        )}
        <button className={`btn${mapMode === 'move' ? ' on' : ''}`} onClick={() => setMapMode('move')} title="Move (M)">Move</button>
        <button className={`btn${mapMode === 'watch' ? ' on' : ''}`} disabled={!canAct || !view.map || !!usage?.actionUsed} onClick={() => setMapMode(mapMode === 'watch' ? 'move' : 'watch')} title="House rule: spend your Action to watch a 90° cone until your next Turn. (W)">Watch</button>
        <button className={`btn${mapMode === 'ruler' ? ' on' : ''}`} disabled={!view.map} onClick={() => setMapMode(mapMode === 'ruler' ? 'move' : 'ruler')} title="Ruler (R)">Ruler</button>
        <button className="btn hide-sm" disabled={!canAct || !weapon?.ammo || weapon.ammo.loaded === weapon.ammo.capacity} onClick={() => actingId && weapon && c.act({ type: 'reload', actorId: actingId, weaponId: weapon.id })}>Reload</button>
        <button className="btn hide-sm" disabled={!canAct || !targetId} onClick={() => actingId && targetId && c.act({ type: 'meleeAttack', attackerId: actingId, defenderId: targetId, with: { kind: 'brawling' } })}>Brawl</button>
        {isGm && <button className={`btn hide-sm${mapMode === 'place' ? ' on' : ''}`} disabled={!view.map} onClick={() => setMapMode(mapMode === 'place' ? 'move' : 'place')} title="Select a token, then tap a square to put it there.">Place</button>}
        {isGm && <button className={`btn hide-sm${partyFog ? ' on' : ''}`} disabled={!view.map} onClick={() => setPartyFog(!partyFog)}>Party View</button>}
        {isGm && <button className="btn" onClick={() => client.undo()}>Undo</button>}
        <div className="spacer" />
        {isGm && !enc.active && view.map && (
          <button className="btn yellow" onClick={() => c.act({ type: 'startEncounter', participants: Object.keys(view.map!.tokens).map((actorId) => ({ actorId })) })}>Start Encounter</button>
        )}
        {isGm && enc.active && <button className="btn hide-sm" onClick={() => c.act({ type: 'endEncounter' })}>End Encounter</button>}
        {enc.active && (isGm || mine(currentId)) && <button className="btn danger" disabled={!canEndTurn} onClick={() => c.act({ type: 'endTurn' })} title="End Turn (E)">End Turn</button>}
      </footer>

      <aside className="side" aria-label="Panels">
        <div className="tabs" role="tablist">
          {tabs.map(([t, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`tab${tab === t ? ' sel' : ''}`} onClick={() => (tab === t && sheetOpen ? setSheetOpen(false) : openTab(t))}>
              {label}{t === 'chat' && unread > 0 && <span className="badge">{unread > 9 ? '9+' : unread}</span>}
            </button>
          ))}
          <button className="tab grip" aria-label={sheetOpen ? 'Collapse Panel' : 'Expand Panel'} onClick={() => setSheetOpen(!sheetOpen)}>{sheetOpen ? '▾' : '▴'}</button>
        </div>
        <div className="side-body">
          <Prompts c={c} />
          {tab === 'combat' && (
            <>
              {isGm && focusId && view.actors[focusId] && <Inspector c={c} id={focusId} onClose={() => setFocusId(null)} onTarget={setTargetId} />}
              <CombatPanel
                c={c} actingId={actingId} currentId={currentId} canAct={canAct} weapon={weapon} setWeaponId={setWeaponId} mode={mode} setMode={setMode}
                targetId={targetId} setTargetId={setTargetId} attack={attack} usage={usage} mapMode={mapMode} setMapMode={setMapMode}
                setHighlight={setHighlight} onFire={fire}
              />
            </>
          )}
          {tab === 'sheet' && <SheetPanel c={c} preferId={isGm ? (focusId ?? actingId) : actingId} />}
          {tab === 'chat' && <ChatPanel c={c} rollerId={isGm ? (focusId ?? actingId) : (actingId ?? ownIds[0] ?? null)} onUnreadReset={() => setUnread(0)} />}
          {tab === 'scene' && isGm && <ScenePanel c={c} mapMode={mapMode} setMapMode={setMapMode} shareCursor={gmCursor} setShareCursor={(v) => { setGmCursor(v); if (!v) client.signal({ kind: 'cursor', at: null }); }} onFocus={(id) => { setFocusId(id); setTab('combat'); }} />}
        </div>
      </aside>

      {help && <HelpOverlay onClose={() => setHelp(false)} />}
      {s.toast && Date.now() - s.toast.at < 5000 && <div className="toast" role="alert">{s.toast.text}</div>}
    </div>
  );
}
