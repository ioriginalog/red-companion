import { useEffect, useState } from 'react';

/** Live `matchMedia` result. */
export function useMedia(query: string): boolean {
  const get = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches;
  const [match, setMatch] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return;
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

const NARROW = '(max-width: 1000px)';
const PHONE = '(max-width: 600px)';
const SHORT_LANDSCAPE = '(max-height: 520px) and (orientation: landscape)';

export interface Layout {
  /** Phones and short landscape phones: compact dock, target chips, follow camera. */
  compact: boolean;
  /** Panel is a bottom sheet (phones and portrait tablets). */
  sheet: boolean;
  /** Landscape phone: panel is a narrow right column. */
  shortLandscape: boolean;
}

/** Layout mode. Keep in sync with the media queries in styles.css. */
export function useLayout(): Layout {
  const narrow = useMedia(NARROW);
  const phone = useMedia(PHONE);
  const shortL = useMedia(SHORT_LANDSCAPE) && narrow;
  return { compact: phone || shortL, sheet: narrow && !shortL, shortLandscape: shortL };
}

export function usePrefersReducedMotion(): boolean {
  return useMedia('(prefers-reduced-motion: reduce)');
}
