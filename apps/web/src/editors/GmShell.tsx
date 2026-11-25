import { useEffect, useRef, useState, type ReactNode } from 'react';
import { client, type ClientState } from '../net.js';
import { NetArchitectureEditor } from '../netrun/index.js';
import { MapEditor } from './MapEditor.js';
import { CharacterEditor } from './CharacterEditor.js';
import './editors.css';

const TABS = [
  { id: 'table', label: 'Table' },
  { id: 'maps', label: 'Maps' },
  { id: 'characters', label: 'Characters' },
  { id: 'net', label: 'NET Prep' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/**
 * GM shell: the Table plus prep tabs. The Table stays mounted while hidden so
 * its selection and targeting state survive a trip to the editors.
 */
export function GmShell({ s, table }: { s: ClientState; table: ReactNode }) {
  const [tab, setTab] = useState<TabId>(() => (sessionStorage.getItem('nsc.tab') as TabId | null) ?? 'table');
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => { try { sessionStorage.setItem('nsc.tab', tab); } catch { /* private mode */ } }, [tab]);

  // Alt+1–4 switch tabs from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const i = ['1', '2', '3', '4'].indexOf(e.key);
      if (i >= 0) { e.preventDefault(); setTab(TABS[i]!.id); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const n = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1;
    if (n < 0) return;
    e.preventDefault();
    setTab(TABS[n]!.id);
    refs.current[n]?.focus();
  };

  return (
    <div className="shell">
      <div className="shell-tabs" role="tablist" aria-label="GM workspace">
        <span className="shell-brand" aria-hidden="true">///</span>
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => { refs.current[i] = el; }}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`pane-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className="shell-tab"
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onTabKey(e, i)}
            title={`${t.label} (Alt+${i + 1})`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="shell-pane" role="tabpanel" id="pane-table" aria-labelledby="tab-table" hidden={tab !== 'table'}>{table}</div>
      {tab === 'maps' && <div className="shell-pane" role="tabpanel" id="pane-maps" aria-labelledby="tab-maps"><MapEditor s={s} /></div>}
      {tab === 'characters' && <div className="shell-pane" role="tabpanel" id="pane-characters" aria-labelledby="tab-characters"><CharacterEditor s={s} /></div>}
      {tab === 'net' && s.view && <div className="shell-pane" role="tabpanel" id="pane-net" aria-labelledby="tab-net"><NetArchitectureEditor view={s.view} act={(i) => client.act(i)} /></div>}
    </div>
  );
}
