import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { client } from './net.js';
import { Table } from './Table.js';
import { GmShell } from './editors/GmShell.js';
import { SessionMenu } from './SessionMenu.js';

export function App() {
  const s = useSyncExternalStore(client.subscribe, client.getState);
  // A reload drops a player back into their last session (Leave forgets it).
  useEffect(() => { client.autoResume(new URLSearchParams(location.search).get('join')); }, []);
  const menu = s.sessionMenu && s.role ? <SessionMenu s={s} /> : null;
  if (s.role === 'gm' && s.view) return <><GmShell s={s} table={<Table s={s} />} />{menu}</>;
  if (s.role && s.view) return <><Table s={s} />{menu}</>;
  return <Home busy={s.status === 'connecting'} toast={s.toast?.text ?? null} lockedUntil={s.lockedUntil} />;
}

/** Seconds left on a hello lockout, ticking once a second. */
function useCountdown(until: number | null): number {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - Date.now()) / 1000)) : 0;
}

function Home({ busy, toast, lockedUntil }: { busy: boolean; toast: string | null; lockedUntil: number | null }) {
  const saved = client.savedGmSessions();
  const [forgetting, setForgetting] = useState<string | null>(null);
  const lockLeft = useCountdown(lockedUntil);
  const importRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('join') ?? '');
  const [name, setName] = useState('');
  return (
    <div className="home">
      <div className="home-card">
        <h1><span className="slash" />Night Shift <b>Companion</b></h1>
        <div className="dim">Tactical combat table for your crew.</div>

        <h2>Join a Session</h2>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); if (code.trim()) client.join(code, name); }}>
          <input aria-label="Join code" placeholder="Join code" value={code} maxLength={8} onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '0.2em', fontWeight: 700 }} />
          <input aria-label="Your name" placeholder="Your name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          <button className="cta" disabled={!code.trim() || busy}>Join</button>
        </form>

        <h2>Run a Session</h2>
        <div className="stack">
          {saved.length > 0 && (
            <ul className="saved-sessions" aria-label="Your sessions on this device" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
              {saved.map((g, i) => (
                <li key={g.sessionId} className="row" style={{ gap: 6 }}>
                  <button className={`btn${i === 0 ? ' yellow' : ''}`} style={{ flex: 1 }} disabled={busy} onClick={() => void client.resumeGm(g)}>
                    Resume Session {g.joinCode}
                  </button>
                  {forgetting === g.sessionId ? (
                    <>
                      <button className="btn danger" onClick={() => { client.forgetGm(g.sessionId); setForgetting(null); }} aria-label={`Confirm forgetting session ${g.joinCode}`}>Forget</button>
                      <button className="btn ghost" onClick={() => setForgetting(null)}>Keep</button>
                    </>
                  ) : (
                    <button className="btn ghost" onClick={() => setForgetting(g.sessionId)} aria-label={`Forget session ${g.joinCode} on this device`} title="Remove this GM key from this device">Forget</button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {forgetting && <div className="dim" role="status" style={{ fontSize: 13 }}>Forgetting removes the GM key from this device. Without a GM backup you can’t run that session again.</div>}
          <button className="btn" disabled={busy} onClick={() => void client.createSession()}>Create a New Session</button>
          <button className="btn ghost" disabled={busy} onClick={() => importRef.current?.click()} title="Open a GM backup, or restore a session export as a new session">Import Session or GM Backup</button>
          <input
            ref={importRef} type="file" accept="application/json,.json" hidden aria-label="Session export or GM backup file"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void client.importSession(f); }}
          />
        </div>
        {lockLeft > 0
          ? <div className="warn" role="status" aria-live="polite" style={{ marginTop: 14 }}>Too many failed attempts from this network. Retrying in {lockLeft} {lockLeft === 1 ? 'second' : 'seconds'}.</div>
          : toast && <div className="warn" style={{ marginTop: 14 }}>{toast}</div>}

        <p className="fine">
          Unofficial content provided under the Homebrew Content Policy of R. Talsorian Games and is not approved or endorsed by RTG.
          This content references materials that are the property of R. Talsorian Games and its licensees. Free and non-commercial.
        </p>
      </div>
    </div>
  );
}
