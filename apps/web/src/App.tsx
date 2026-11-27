import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { client } from './net.js';
import { Table } from './Table.js';
import { GmShell } from './editors/GmShell.js';
import { SessionMenu } from './SessionMenu.js';
import { DISCLAIMER } from './legal.js';

// End-to-end tests drive the client through this hook; it's only set when a
// test has opted in on this device (localStorage nsc.e2e = 1).
try { if (typeof window !== 'undefined' && localStorage.getItem('nsc.e2e') === '1') (window as unknown as { __nsc: typeof client }).__nsc = client; } catch { /* storage blocked */ }

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
          <input className="code-input" aria-label="Join Code" placeholder="Join code" value={code} maxLength={8} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <input aria-label="Your Name" placeholder="Your name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          <button className="cta" disabled={!code.trim() || busy}>Join</button>
        </form>

        <h2>Run a Session</h2>
        <div className="stack">
          {saved.length > 0 && (
            <ul className="saved-sessions u-list-plain u-grid u-gap-6" aria-label="Your Sessions on This Device">
              {saved.map((g, i) => (
                <li key={g.sessionId} className="row u-gap-6">
                  <button className={`btn${i === 0 ? ' yellow' : ''} u-grow`} disabled={busy} onClick={() => void client.resumeGm(g)}>
                    Resume Session {g.joinCode}
                  </button>
                  {forgetting === g.sessionId ? (
                    <>
                      <button className="btn danger" onClick={() => { client.forgetGm(g.sessionId); setForgetting(null); }} aria-label={`Confirm Forgetting Session ${g.joinCode}`}>Forget</button>
                      <button className="btn ghost" onClick={() => setForgetting(null)}>Keep</button>
                    </>
                  ) : (
                    <button className="btn ghost" onClick={() => setForgetting(g.sessionId)} aria-label={`Forget Session ${g.joinCode} on This Device`} title="Remove this GM key from this device.">Forget</button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {forgetting && <div className="dim u-fs-13" role="status">Forgetting removes the GM key from this device. Without a GM backup you can’t run that session again.</div>}
          <button className="btn" disabled={busy} onClick={() => void client.createSession()}>Create a New Session</button>
          <button className="btn ghost" disabled={busy} onClick={() => importRef.current?.click()} title="Open a GM backup, or restore a session export as a new session.">Import Session or GM Backup</button>
          <input
            ref={importRef} type="file" accept="application/json,.json" hidden aria-label="Session Export or GM Backup File"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void client.importSession(f); }}
          />
        </div>
        {lockLeft > 0
          ? <div className="warn u-mt-14" role="status" aria-live="polite">Too many failed attempts from this network. Retrying in {lockLeft} {lockLeft === 1 ? 'second' : 'seconds'}.</div>
          : toast && <div className="warn u-mt-14">{toast}</div>}

        <p className="fine">{DISCLAIMER}</p>
        <p className="fine">Free and non-commercial.</p>
      </div>
    </div>
  );
}
