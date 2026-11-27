/** Area-attack dodge decisions: mount with the other pending prompts (Combat panel). */
import type { Intent, ProjectedPending, ViewState } from '@cprc/session';
import { joinNames } from '../table/format.js';

interface Props {
  view: ViewState;
  isGm: boolean;
  mine: (id: string) => boolean;
  name: (id: string) => string;
  act: (i: Intent) => boolean;
}

export function AreaDodgePrompt({ view, isGm, mine, name, act }: Props) {
  const p = view.pending as ProjectedPending | null;
  if (!p || p.kind !== 'awaitingAreaDodge') return null;
  const open = Object.entries(p.decisions).filter(([, d]) => d === null).map(([id]) => id);
  const yours = open.filter((id) => mine(id));
  const label = p.areaKind === 'shotgunShell' ? 'Shotgun Shell' : 'Blast';
  if (!yours.length && !isGm) return null;
  return (
    <div className="card prompt" role="alertdialog" aria-label="Dodge the Area Attack">
      <div className="ttl">{label} Incoming</div>
      <p className="u-m-0 u-mb-8">
        {name(p.attackerId)} rolled {p.attack.total}. Dodging is DEX + Evasion + 1d10; beat {p.attack.total} to get clear. Damage is rolled once everyone decides.
      </p>
      {yours.map((id) => (
        <div className="row u-mb-6 u-wrap" key={id}>
          <b className="u-minw-110">{name(id)}</b>
          <button className="btn yellow" onClick={() => act({ type: 'respondAreaDodge', pendingId: p.id, actorId: id, dodge: true })}>Dodge</button>
          <button className="btn" onClick={() => act({ type: 'respondAreaDodge', pendingId: p.id, actorId: id, dodge: false })}>Take It</button>
        </div>
      ))}
      {isGm && (
        <div className="row u-wrap">
          <span className="dim u-grow">{open.length ? `Waiting on ${joinNames(open.map(name))}.` : 'Resolving…'}</span>
          <button className="btn" disabled={!open.length} onClick={() => act({ type: 'resolveAreaDodges', pendingId: p.id })}>Everyone Left Dodges</button>
        </div>
      )}
    </div>
  );
}
