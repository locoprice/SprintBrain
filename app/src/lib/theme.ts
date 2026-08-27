export type ThemePreference = 'light' | 'dark' | 'auto';

const STORAGE_KEY = 'sprintbrain-theme';

export function getStoredTheme(): ThemePreference {
  // Runs at module load, from the uiStore initializer. Storage is not always
  // reachable there: a browser with site data blocked throws on access, and the
  // vitest 'node' environment has no localStorage at all, which took down every
  // suite that transitively imports the store. 'auto' is the same default a
  // first-time visitor gets, so falling back costs nothing.
  try {
    return (localStorage.getItem(STORAGE_KEY) as ThemePreference) ?? 'auto';
  } catch {
    return 'auto';
  }
}

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Apply a theme preference to the document root and persist it to localStorage. */
export function applyTheme(pref: ThemePreference): void {
  const resolved = pref === 'auto' ? getSystemTheme() : pref;
  document.documentElement.setAttribute('data-theme', resolved);
  localStorage.setItem(STORAGE_KEY, pref);
}

/**
 * Subscribe to OS-level color scheme changes.
 * Only relevant when the active preference is 'auto'.
 * Returns an unsubscribe function.
 */
export function watchSystemTheme(onChange: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
