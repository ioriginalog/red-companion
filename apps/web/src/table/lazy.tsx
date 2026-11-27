/**
 * Code-split screens: the GM editors, the NET UI and the optional rules panels
 * load on first use, so a player's first paint carries only the table.
 * Once the page is idle every chunk is fetched anyway, so the service worker
 * has them cached before the connection drops.
 */
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';

type Loader<P> = () => Promise<ComponentType<P>>;
const loaders: Loader<never>[] = [];

/** `quiet`: render nothing while loading (small panels), instead of a loading card (whole screens). */
function split<P extends object>(load: Loader<P>, quiet = false): ComponentType<P> {
  loaders.push(load as Loader<never>);
  const L = lazy(async () => ({ default: await load() }));
  return function Split(props: P) {
    return <Suspense fallback={quiet ? null : <Loading />}><L {...props} /></Suspense>;
  };
}

function Loading(): ReactNode {
  return <div className="card loading-card dim" role="status">Loading…</div>;
}

export const NetPanel = split(() => import('../netrun/NetPanel.js').then((m) => m.NetPanel));
export const NetArchitectureEditor = split(() => import('../netrun/NetArchitectureEditor.js').then((m) => m.NetArchitectureEditor));
export const MapEditor = split(() => import('../editors/MapEditor.js').then((m) => m.MapEditor));
export const CharacterEditor = split(() => import('../editors/CharacterEditor.js').then((m) => m.CharacterEditor));
export const GmSystemsPanel = split(() => import('../systems/GmSystemsPanel.js').then((m) => m.GmSystemsPanel), true);
export const SystemsSheet = split(() => import('../systems/SystemsSheet.js').then((m) => m.SystemsSheet), true);
export const CombatExtrasPanel = split(() => import('../extras/CombatExtrasPanel.js').then((m) => m.CombatExtrasPanel), true);
export const GearPanel = split(() => import('../gear/GearPanel.js').then((m) => m.GearPanel), true);
export const RoleAbilityPanel = split(() => import('../extras/RoleAbilityPanel.js').then((m) => m.RoleAbilityPanel), true);

let warmed = false;
/** Fetch every split chunk once the browser is idle (offline play needs them cached). */
export function warmSplitChunks() {
  if (warmed || typeof window === 'undefined') return;
  warmed = true;
  const go = () => { for (const l of loaders) void l().catch(() => undefined); };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(go, { timeout: 4000 }); else window.setTimeout(go, 2000);
}
