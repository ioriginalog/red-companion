/**
 * Session menu: Leave (confirmed), and for the GM the key, a backup file and
 * a session export. Opened from the top bar; rendered by App.
 */
import { useEffect, useRef, useState } from 'react';
import { client, type ClientState } from './net.js';

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SessionMenu({ s }: { s: ClientState }) {
  const isGm = s.role === 'gm';
  const creds = isGm ? client.currentGm() : null;
  const [showKey, setShowKey] = useState(false);
  const [confirm, setConfirm] = useState<'leave' | 'forget' | null>(null);
  const [copied, setCopied] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') client.closeSessionMenu(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Session" onClick={() => client.closeSessionMenu()}>
      <section className="card help session-menu" onClick={(e) => e.stopPropagation()}>
        <div className="ttl">Session</div>
        {isGm && creds && (
          <>
            <p className="dim u-mt-0">
              Your GM key is the only way to run this session. Keep a backup somewhere safe; anyone with it can take over as GM.
            </p>
            <div className="kv1">
              <span className="dim">Join Code</span> <b className="mono">{creds.joinCode}</b>
            </div>
            <div className="kv1 u-mt-6">
              <span className="dim">GM Key</span>{' '}
              <code className="u-break-all" aria-label={showKey ? 'GM Key' : 'GM Key, Hidden'}>{showKey ? creds.gmKey : '•'.repeat(16)}</code>
            </div>
            <div className="row u-wrap u-gap-8 u-mt-10">
              <button ref={first} className="btn" onClick={() => setShowKey(!showKey)} aria-pressed={showKey}>{showKey ? 'Hide GM Key' : 'Show GM Key'}</button>
              <button className="btn" onClick={() => { void navigator.clipboard?.writeText(creds.gmKey).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>{copied ? 'Copied' : 'Copy GM Key'}</button>
              <button className="btn" onClick={() => { const b = client.gmBackup(); if (b) download(`gm-backup-${creds.joinCode}-${stamp}.json`, new Blob([b], { type: 'application/json' })); }}>Download GM Backup</button>
              <button className="btn" onClick={() => { void client.exportSession().then((b) => { if (b) download(`session-${creds.joinCode}-${stamp}.json`, b); }); }}>Export Session</button>
            </div>
            <p className="dim u-fs-13">
              A GM backup resumes this session on another device (Import on the home screen). An export is the whole log, without keys; importing it starts a new session.
            </p>
          </>
        )}

        {confirm === null && (
          <div className="row u-gap-8 u-mt-12 u-wrap">
            <button ref={isGm ? undefined : first} className="btn" onClick={() => setConfirm('leave')}>Leave Session</button>
            {isGm && <button className="btn danger" onClick={() => setConfirm('forget')}>Forget on This Device</button>}
            <div className="spacer" />
            <button className="btn ghost" onClick={() => client.closeSessionMenu()}>Close</button>
          </div>
        )}
        {confirm === 'leave' && (
          <div className="warn u-mt-12" role="alertdialog" aria-label="Confirm Leaving">
            {isGm
              ? 'Leave this session? Players stay connected and can’t act until you return. Your GM key stays saved on this device.'
              : 'Leave this session? You can rejoin as yourself with the same join code on this device.'}
            <div className="row u-gap-8 u-mt-8">
              <button className="btn yellow" autoFocus onClick={() => client.leave()}>Leave</button>
              <button className="btn ghost" onClick={() => setConfirm(null)}>Cancel</button>
            </div>
          </div>
        )}
        {confirm === 'forget' && (
          <div className="warn u-mt-12" role="alertdialog" aria-label="Confirm Forgetting">
            Remove this session’s GM key from this device? Without a backup, you won’t be able to run it again. The session itself isn’t deleted.
            <div className="row u-gap-8 u-mt-8">
              <button className="btn danger" autoFocus onClick={() => client.leave({ forget: true })}>Forget and Leave</button>
              <button className="btn ghost" onClick={() => setConfirm(null)}>Cancel</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
