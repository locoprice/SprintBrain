import { useEffect, useState } from 'react';

const MIN_DESKTOP_WIDTH = 1024;

// Tracks a min-width media query. Reads matchMedia synchronously on first
// render to avoid a flash of the wrong branch before the effect fires.
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const [matches, setMatches] = useState<boolean>(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    // Re-read on subscribe: the width can have changed between the initial
    // render and this effect, and the listener only fires on later crossings.
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);

  return matches;
}

// Returns true when the viewport is wide enough to render the dashboard.
export function useIsDesktop(): boolean {
  return useMinWidth(MIN_DESKTOP_WIDTH);
}
