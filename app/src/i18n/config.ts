import type { InitOptions } from 'i18next';
import type { DetectorOptions } from 'i18next-browser-languagedetector';
import { FALLBACK_LANGUAGE, SUPPORTED_LANGUAGES } from '@/i18n/languages';
import { defaultNS, resources } from '@/i18n/resources';

/** localStorage key holding the chosen locale. Mirrors `sprintbrain-theme`. */
export const LANGUAGE_STORAGE_KEY = 'sprintbrain-language';

/**
 * Everything about the i18next instance that does not touch the browser. Kept
 * apart from `index.ts` so the same options an app boots with can be asserted in
 * a Node test — the plugins (detector, React binding) are the only browser part.
 */
export const baseOptions: InitOptions = {
  resources,
  defaultNS,
  fallbackLng: FALLBACK_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES,
  // Treat `en-GB` and `en-US` as `en` — the dashboard ships no regional variants.
  load: 'languageOnly',
  // React escapes interpolated values already; escaping twice mangles
  // apostrophes and ampersands in translated copy.
  interpolation: { escapeValue: false },
};

/**
 * An explicit choice outranks the browser's guess, and only that choice is
 * written back, so arriving with a different browser locale never overwrites
 * what the user picked.
 */
export const detectionOptions: DetectorOptions = {
  order: ['localStorage', 'navigator'],
  caches: ['localStorage'],
  lookupLocalStorage: LANGUAGE_STORAGE_KEY,
  // Detection reports the browser's full tag (`it-IT`), and whatever it reports
  // is what gets cached. Narrowing here keeps the stored preference to the codes
  // the switcher can actually show as selected.
  convertDetectedLanguage: (language) => language.split('-')[0] ?? language,
};
