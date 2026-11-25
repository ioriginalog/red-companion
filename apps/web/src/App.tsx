import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { client } from './net.js';
import { Table } from './Table.js';
import { GmShell } from './editors/GmShell.js';

export function App() {
  const s = useSyncExternalStore(client.subscribe, client.getState);
  // A reload drops a player back into their last session (Leave forgets it).
  useEffect(() => { client.autoResume(new URLSearchParams(location.search).get('join')); }, []);
  if (s.role === 'gm' && s.view) return <GmShell s={s} table={<Table s={s} />} />;
  if (s.role && s.view) return <Table s={s} />;
  return <Home busy={s.status === 'connecting'} toast={s.toast?.text ?? null} />;
}

function Home({ busy, toast }: { busy: boolean; toast: string | null }) {
  const saved = client.savedGm();
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
          {saved && <button className="btn yellow" disabled={busy} onClick={() => client.resumeGm(saved)}>Resume Session {saved.joinCode}</button>}
          <button className="btn" disabled={busy} onClick={() => void client.createSession()}>Create a New Session</button>
          <button className="btn ghost" disabled={busy} onClick={() => importRef.current?.click()} title="Restore a session export as a new session">Import Session</button>
          <input
            ref={importRef} type="file" accept="application/json,.json" hidden aria-label="Session export file"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void client.importSession(f); }}
          />
        </div>
        {toast && <div className="warn" style={{ marginTop: 14 }}>{toast}</div>}

        <p className="fine">
          Unofficial content provided under the Homebrew Content Policy of R. Talsorian Games and is not approved or endorsed by RTG.
          This content references materials that are the property of R. Talsorian Games and its licensees. Free and non-commercial.
        </p>
      </div>
    </div>
  );
}
