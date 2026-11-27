import { useEffect, useMemo, useRef, useState } from 'react';
import { isNearBottom, liveFeed } from './feed.js';
import type { CheckResult, CombatEvent } from '@cprc/rules-core';
import { narrate } from '../narrate.js';
import { COMMANDS } from './panels.js';
import { parseCommand, type Recipient } from './commands.js';
import type { TableCtx } from './ctx.js';
import { joinNames } from './format.js';

interface LocalLine { id: number; text: string; tone: 'error' | 'help' }

function Die({ v, sides, crit }: { v: number; sides: number; crit?: 'hi' | 'lo' }) {
  const k = crit ?? (sides === 10 && v === 10 ? 'hi' : sides === 10 && v === 1 ? 'lo' : sides === 6 && v === 6 ? 'hi' : undefined);
  return <span className={`die d${sides}${k ? ` ${k}` : ''}`}>{v}</span>;
}

function CheckDice({ check }: { check: CheckResult }) {
  if (check.redacted) return <span className="die hidden">?</span>;
  const r = check.roll;
  return (
    <>
      <Die v={r.natural} sides={10} />
      {r.critDie !== undefined && <><span className="op">{r.kind === 'critFailure' ? '−' : '+'}</span><Die v={r.critDie} sides={10} crit={r.kind === 'critFailure' ? 'lo' : 'hi'} /></>}
      {check.base !== 0 && <span className="op">+ {check.base}</span>}
      {check.modifiers.map((m, i) => <span key={i} className="op">{m.value >= 0 ? '+' : '−'} {Math.abs(m.value)}</span>)}
    </>
  );
}

export function ChatPanel({ c, rollerId, onUnreadReset }: { c: TableCtx; rollerId: string | null; onUnreadReset?: () => void }) {
  const { s, view, isGm } = c;
  const [text, setText] = useState('');
  const [local, setLocal] = useState<LocalLine[]>([]);
  const [hist, setHist] = useState<string[]>([]);
  const [hIdx, setHIdx] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const n = useRef(0);

  // Whisper targets: the GM, players by name (the directory reaches players too), and characters by name.
  const recipients: Recipient[] = useMemo(() => {
    const out: Recipient[] = isGm ? [] : [{ name: 'GM', id: 'gm' }];
    for (const p of s.players ?? []) if (p.playerId !== c.me && p.name) out.push({ name: p.name, id: p.playerId });
    for (const a of Object.values(view.actors)) {
      if (a.controller !== 'gm' && a.controller !== c.me && !out.some((r) => r.id === a.controller && r.name === a.public.name)) out.push({ name: a.public.name, id: a.controller });
    }
    return out;
  }, [isGm, s.players, view.actors, c.me]);

  const roller = rollerId ? view.actors[rollerId] : undefined;
  const items = useMemo(
    () => liveFeed(s.feed, view.seq).flatMap((f) => f.events.map((e, i) => ({ key: `${f.seq}-${i}`, seq: f.seq, e }))).slice(-200),
    [s.feed, view.seq],
  );

  // Stick to the newest message unless the reader has scrolled up (#17).
  const stuck = useRef(true);
  const [behind, setBehind] = useState(0);
  const lastCount = useRef(items.length + local.length);
  const jump = () => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    stuck.current = true;
    setBehind(0);
    onUnreadReset?.();
  };
  useEffect(() => {
    const added = items.length + local.length - lastCount.current;
    lastCount.current = items.length + local.length;
    if (stuck.current) jump();
    else if (added > 0) setBehind((b) => b + added);
  }, [items.length, local.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // Sending your own message always brings you to the bottom.
  useEffect(() => { if (local.length) jump(); }, [local.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    const rollable = Object.values(c.view.actors)
      .filter((a) => a.combatant && !a.placeholder && (c.isGm || a.controller === c.me))
      .map((a) => ({ id: a.id, name: a.public.name, skills: Object.keys(a.combatant!.skills) }));
    const r = parseCommand(text, { actorId: roller?.combatant ? roller.id : null, skills: Object.keys(roller?.combatant?.skills ?? {}), recipients, rollable });
    if (r.kind === 'empty') return;
    if (r.kind === 'help') { setLocal((l) => [...l, ...COMMANDS.map(([k, v]) => ({ id: ++n.current, text: `${k}: ${v}`, tone: 'help' as const }))]); setText(''); return; }
    if (r.kind === 'error') { setLocal((l) => [...l, { id: ++n.current, text: r.message, tone: 'error' }]); return; }
    if (c.act(r.intent)) { setHist((h) => [text, ...h].slice(0, 30)); setHIdx(-1); setText(''); }
  };

  const recipientName = (ids: string[]) => joinNames(ids.map((id) => (id === 'gm' ? 'GM' : id === c.me ? 'you' : c.who(id))));

  const render = (e: CombatEvent, key: string) => {
    const whisper = e.audience && e.audience.length ? <span className="tag whisper">{e.type === 'chatMessage' ? `To ${recipientName(e.audience.filter((x) => x !== (e as { by?: string }).by))}` : 'Private'}</span> : null;
    if (e.type === 'chatMessage') {
      const author = e.asCombatantId ? c.name(e.asCombatantId) : c.who(e.by);
      return <div key={key} className={`msg chat${e.by === c.me ? ' mine' : ''}`}><b>{author}</b>{whisper} <span>{e.text}</span></div>;
    }
    if (e.type === 'checkRolled') {
      const who = e.combatantId ? c.name(e.combatantId) : c.who(e.by);
      return (
        <div key={key} className="msg roll">
          <div className="roll-head"><b>{who}</b> · {e.label}{whisper}</div>
          <div className="roll-body"><CheckDice check={e.check} /><span className="eq">= {e.check.total}</span>
            {e.dv !== undefined && <span className={`tag ${e.success ? 'good-tag' : 'warn-tag'}`}>{e.success ? 'Success' : 'Failure'} vs {e.dv}</span>}
          </div>
        </div>
      );
    }
    if (e.type === 'diceRolled') {
      return (
        <div key={key} className="msg roll">
          <div className="roll-head"><b>{c.who(e.by)}</b> · {e.label}{whisper}</div>
          <div className="roll-body">{e.dice.map((d, i) => <Die key={i} v={d} sides={e.sides} />)}{e.bonus !== 0 && <span className="op">{e.bonus > 0 ? '+' : '−'} {Math.abs(e.bonus)}</span>}<span className="eq">= {e.total}</span></div>
        </div>
      );
    }
    const l = narrate(e, c.name, c.who);
    return l ? <div key={key} className={`msg ${l.tone}`}>{l.text}</div> : null;
  };

  return (
    <section className="card chatcard">
      <div className="ttl">Log and Chat</div>
      <div className="feed" ref={listRef} aria-live="polite" onScroll={(e) => {
        stuck.current = isNearBottom(e.currentTarget);
        if (stuck.current && behind) { setBehind(0); onUnreadReset?.(); }
      }}>
        {items.map(({ key, e }) => render(e, key))}
        {local.map((l) => <div key={`l${l.id}`} className={`msg ${l.tone}`}>{l.text}</div>)}
        {items.length === 0 && local.length === 0 && <span className="dim">Nothing yet. Type /help for commands.</span>}
      </div>
      {behind > 0 && <button className="btn yellow new-msgs" onClick={jump}>{behind} New {behind === 1 ? 'Message' : 'Messages'}</button>}
      <div className="quick-rolls">
        <button className="mode" onClick={() => c.act({ type: 'rollDice', label: '1d10', dice: { count: 1, sides: 10, bonus: 0 } })}>1d10</button>
        <button className="mode" onClick={() => c.act({ type: 'rollDice', label: '1d6', dice: { count: 1, sides: 6, bonus: 0 } })}>1d6</button>
        <button className="mode" onClick={() => c.act({ type: 'rollDice', label: '2d6', dice: { count: 2, sides: 6, bonus: 0 } })}>2d6</button>
        <button className="mode" onClick={() => c.act({ type: 'rollDice', label: '3d6', dice: { count: 3, sides: 6, bonus: 0 } })}>3d6</button>
        {isGm && <button className="mode" onClick={() => c.act({ type: 'rollDice', label: '1d10 (Private)', dice: { count: 1, sides: 10, bonus: 0 }, private: true })}>GM 1d10</button>}
      </div>
      <form className="chat-input pinned" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <input
          aria-label="Chat or Command" value={text} maxLength={520}
          placeholder={roller?.combatant ? `Chat, /r 2d6, /check REF+Handgun (${roller.public.name})` : 'Chat, /r 2d6, /w Name message'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' && hist.length) { e.preventDefault(); const i = Math.min(hist.length - 1, hIdx + 1); setHIdx(i); setText(hist[i]!); }
            if (e.key === 'ArrowDown' && hIdx >= 0) { e.preventDefault(); const i = hIdx - 1; setHIdx(i); setText(i >= 0 ? hist[i]! : ''); }
          }}
        />
        <button className="btn yellow" disabled={!text.trim()}>Send</button>
      </form>
    </section>
  );
}
