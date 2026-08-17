import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { FALLBACK_LANGUAGE, resolveLanguage } from '@/i18n/languages';
import { baseOptions, detectionOptions } from '@/i18n/config';

/**
 * Keep `<html lang>` in step with the active locale. Screen readers take their
 * pronunciation from this attribute, so a stale value is read aloud in the wrong
 * accent — and it is what the browser's own translate prompt keys off.
 */
function syncDocumentLanguage(language: string): void {
  document.documentElement.lang = resolveLanguage(language);
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({ ...baseOptions, detection: detectionOptions })
  .catch((error: unknown) => {
    console.error('[i18n] initialisation failed', error);
  });

i18n.on('languageChanged', syncDocumentLanguage);
syncDocumentLanguage(i18n.resolvedLanguage ?? FALLBACK_LANGUAGE);

export default i18n;
