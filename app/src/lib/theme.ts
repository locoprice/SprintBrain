export type ThemePreference = 'light' | 'dark' | 'auto';

const STORAGE_KEY = 'sprintbrain-theme';

export function getStoredTheme(): ThemePreference {
  return (localStorage.getItem(STORAGE_KEY) as ThemePreference) ?? 'auto';
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
