import { useEffect, useState } from 'react';

const MIN_DESKTOP_WIDTH = 1024;

// Returns true when the viewport is wide enough to render the dashboard.
// SSR-safe: defaults to true so the SPA shell renders immediately, then
// re-evaluates after the first effect.
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(true);

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${MIN_DESKTOP_WIDTH}px)`);
    const update = () => setIsDesktop(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  return isDesktop;
}
