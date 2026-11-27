/**
 * GM Players card (Scene tab): who's at the table, what they play, and
 * Rename, Merge and Remove. Also the player-side Reclaim Seat prompt.
 */
import { useState } from 'react';
import type { TableCtx } from './ctx.js';
import { mergeTargets, removeWarning, renameProblem, rosterRows, type PlayerAdmin } from './roster.js';

export function RosterCard({ c, admin }: { c: TableCtx; admin: PlayerAdmin | null }) {
  const rows = rosterRows(c.s.players, c.view.actors);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [merging, setMerging] = useState<string | null>(null);
  if (!rows.length) return null;
  const off = !admin;
  const offTitle = 'Player management needs the updated relay.';
  const problem = editing ? renameProblem(editing.name, editing.id, c.s.players) : null;
  return (
    <section className="card roster-card" aria-label="Players">
      <div className="ttl">Players</div>
      <ul className="players">
        {rows.map((r) => (
          <li key={r.playerId} className={`player-row${r.idle ? ' idle' : ''}`}>
            <div className="player-head">
              <span className={`dot ${r.online ? 'on' : 'off'}`} aria-hidden />
              <span className="h player-name">{r.name}</span>
              <span className="dim small">{r.online ? 'Online' : r.idle ? 'Offline · No Characters' : 'Offline'}</span>
            </div>
            <div className="dim small player-chars">{r.characters.length ? `Plays ${r.characters.join(', ')}` : 'Plays nobody yet.'}</div>
            {editing?.id === r.playerId ? (
              <form className="row u-wrap player-edit" onSubmit={(e) => { e.preventDefault(); if (!problem && admin) { admin.renamePlayer(r.playerId, editing.name.trim()); setEditing(null); } }}>
                <input aria-label={`New Name for ${r.name}`} value={editing.name} maxLength={40} autoFocus onChange={(e) => setEditing({ id: r.playerId, name: e.target.value })} />
                <button className="btn sm yellow" disabled={!!problem || off}>Save</button>
                <button type="button" className="btn sm ghost" onClick={() => setEditing(null)}>Cancel</button>
                {problem && editing.name.trim() !== '' && <span className="warn-txt small player-why" role="alert">{problem}</span>}
              </form>
            ) : merging === r.playerId ? (
              <div className="row u-wrap player-edit">
                <select aria-label={`Merge ${r.name} Into`} defaultValue="" onChange={(e) => {
                  const into = e.target.value;
                  const target = rows.find((x) => x.playerId === into);
                  if (!into || !target || !admin) return;
                  if (confirm(`Merge ${r.name} into ${target.name}? ${r.name}’s characters move to ${target.name}, and ${r.name}’s seat is removed.`)) { admin.mergePlayers(r.playerId, into); setMerging(null); }
                }}>
                  <option value="" disabled>Merge Into…</option>
                  {mergeTargets(rows, r.playerId).map((t) => <option key={t.playerId} value={t.playerId}>{t.name}{t.online ? '' : ' (offline)'}</option>)}
                </select>
                <button className="btn sm ghost" onClick={() => setMerging(null)}>Cancel</button>
              </div>
            ) : (
              <div className="row u-wrap player-actions">
                <button className="btn sm" disabled={off} title={off ? offTitle : `Rename ${r.name}.`} onClick={() => setEditing({ id: r.playerId, name: r.name })}>Rename</button>
                <button className="btn sm" disabled={off || rows.length < 2} title={off ? offTitle : 'Fold a duplicate seat into this player’s real one.'} onClick={() => setMerging(r.playerId)}>Merge</button>
                <button className="btn sm danger" disabled={off} title={off ? offTitle : `Remove ${r.name} from the session.`}
                  onClick={() => { if (admin && confirm(removeWarning(r))) admin.removePlayer(r.playerId); }}>Remove</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="dim small u-mt-8">
        {off ? 'Rename, Merge and Remove arrive with the relay update.' : 'Someone rejoined under a new name? Merge the new seat into the old one. Offline seats with no characters don’t count toward the player limit.'}
      </p>
    </section>
  );
}

/**
 * Player side: joining under a name that matches an offline seat. Wire to the
 * relay's reclaim prompt (net.ts).
 */
export function ReclaimSeatPrompt({ name, characters, onReclaim, onNewSeat }: { name: string; characters: string[]; onReclaim: () => void; onNewSeat: () => void }) {
  return (
    <div className="card prompt" role="alertdialog" aria-label="Reclaim Your Seat">
      <div className="ttl">Welcome Back?</div>
      <p>{name} already has a seat at this table{characters.length ? `, playing ${characters.join(', ')}` : ''}. Is that you?</p>
      <div className="row">
        <button className="btn yellow" onClick={onReclaim}>Reclaim My Seat</button>
        <button className="btn" onClick={onNewSeat}>Join as Someone New</button>
      </div>
      <p className="dim small">The GM sees which seat you take.</p>
    </div>
  );
}
