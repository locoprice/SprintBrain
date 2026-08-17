// The locale roster. Everything else in `src/i18n` derives from this file, so
// adding a language is: add the code here, add its `locales/<code>/` folder,
// register the folder in `resources.ts`. Nothing else changes.

/** Locale codes the dashboard ships translations for. */
export const SUPPORTED_LANGUAGES = ['en', 'es', 'it'] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** Used when detection finds nothing, and for any key missing from a locale. */
export const FALLBACK_LANGUAGE: SupportedLanguage = 'en';

/**
 * Endonyms — each language written the way its own speakers write it. Deliberately
 * *not* translation keys: a language switcher must stay readable to someone who
 * cannot read the currently active language, which is the whole reason they are
 * reaching for it.
 */
export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: 'English',
  es: 'Español',
  it: 'Italiano',
};

/** Short code shown on the switcher control. */
export const LANGUAGE_SHORT_LABELS: Record<SupportedLanguage, string> = {
  en: 'EN',
  es: 'ES',
  it: 'IT',
};

export function isSupportedLanguage(value: string): value is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Narrow an i18next language tag (`en`, `en-GB`, `es-419`) to a supported code.
 * Falls back to English rather than throwing — a stale localStorage value or an
 * unusual browser locale must never blank the UI.
 */
export function resolveLanguage(tag: string | undefined): SupportedLanguage {
  if (!tag) return FALLBACK_LANGUAGE;
  const base = tag.split('-')[0] ?? '';
  return isSupportedLanguage(base) ? base : FALLBACK_LANGUAGE;
}
