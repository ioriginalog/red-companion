import { useEffect, useRef, useState } from 'react';

/**
 * "Your Turn" banner: slides over the map for a moment when one of your
 * characters starts its Turn (for the GM: an NPC the GM runs). Decorative; the
 * Table's live region already announces the Turn to screen readers.
 */
export function TurnBanner({ turnKey, title, sub }: { turnKey: string | null; title: string | null; sub?: string }) {
  const [shown, setShown] = useState<{ key: string; title: string; sub?: string } | null>(null);
  const last = useRef<string | null>(turnKey);
  useEffect(() => {
    if (turnKey && turnKey !== last.current && title) {
      setShown({ key: turnKey, title, sub });
      const t = window.setTimeout(() => setShown(null), 1900);
      last.current = turnKey;
      return () => window.clearTimeout(t);
    }
    // Turn moved on (or the encounter ended): never leave an old banner up.
    // (The previous run's cleanup already cancelled its hide timer.)
    last.current = turnKey;
    setShown(null);
    return undefined;
  }, [turnKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!shown) return null;
  return (
    <div className="turn-banner" aria-hidden key={shown.key}>
      <div className="tb-title h">{shown.title}</div>
      {shown.sub && <div className="tb-sub h">{shown.sub}</div>}
    </div>
  );
}
