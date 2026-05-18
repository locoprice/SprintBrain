import { useEffect, useState } from 'react';

const MIN_DESKTOP_WIDTH = 1024;

function getInitialIsDesktop(): boolean {
  return window.matchMedia(`(min-width: ${MIN_DESKTOP_WIDTH}px)`).matches;
}

// Returns true when the viewport is wide enough to render the dashboard.
// Reads matchMedia synchronously on first render to avoid a flash of the
// wrong branch before the effect fires.
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(getInitialIsDesktop);

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${MIN_DESKTOP_WIDTH}px)`);
    const update = () => setIsDesktop(mql.matches);
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  return isDesktop;
}
