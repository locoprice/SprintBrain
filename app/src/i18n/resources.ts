import enCommon from '@/i18n/locales/en/common.json';
import esCommon from '@/i18n/locales/es/common.json';
import itCommon from '@/i18n/locales/it/common.json';

// Translations are bundled, not fetched. Three locales of UI copy are a few KB
// each — a runtime `i18next-http-backend` fetch would trade that for a network
// round trip and a flash of untranslated text on first paint. Splitting them out
// only pays off once the catalogue is large enough to lazy-load per route.

/** The single namespace the dashboard ships. Add a file per namespace to split. */
export const defaultNS = 'common';

export const resources = {
  en: { common: enCommon },
  es: { common: esCommon },
  it: { common: itCommon },
} as const;

/** Shape every locale must satisfy — enforced at runtime by `i18n.test.ts`. */
export type TranslationResource = (typeof resources)['en'];
