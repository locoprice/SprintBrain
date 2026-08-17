import { beforeAll, describe, expect, it } from 'vitest';
import i18next, { type i18n as I18n } from 'i18next';
import { baseOptions } from '@/i18n/config';
import { resources } from '@/i18n/resources';
import {
  FALLBACK_LANGUAGE,
  LANGUAGE_LABELS,
  LANGUAGE_SHORT_LABELS,
  SUPPORTED_LANGUAGES,
  isSupportedLanguage,
  resolveLanguage,
} from '@/i18n/languages';

// The translation catalogue is hand-edited JSON, so nothing at compile time
// notices when a key is added to English and forgotten in Spanish — the app
// silently falls back and one locale quietly drifts English. These tests are
// that missing check.

type JsonValue = string | { [key: string]: JsonValue };

/** Flatten a nested catalogue to dotted paths: `{ nav: { team: 'Team' } }` → `nav.team`. */
function flatten(value: JsonValue, prefix = ''): Record<string, string> {
  if (typeof value === 'string') return { [prefix]: value };
  return Object.entries(value).reduce<Record<string, string>>((acc, [key, child]) => {
    return Object.assign(acc, flatten(child, prefix ? `${prefix}.${key}` : key));
  }, {});
}

/** Interpolation placeholders used by a string, e.g. `{{count}}` → `count`. */
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*(\w+)[^}]*\}\}/g)].map((match) => match[1] ?? '').sort();
}

const reference = flatten(resources[FALLBACK_LANGUAGE].common);
const referenceKeys = Object.keys(reference).sort();

describe('locale roster', () => {
  it('ships a resource bundle for every supported language', () => {
    expect(Object.keys(resources).sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
  });

  it('labels every supported language', () => {
    for (const language of SUPPORTED_LANGUAGES) {
      expect(LANGUAGE_LABELS[language]).toBeTruthy();
      expect(LANGUAGE_SHORT_LABELS[language]).toBeTruthy();
    }
  });

  it('accepts supported codes and rejects everything else', () => {
    expect(isSupportedLanguage('es')).toBe(true);
    expect(isSupportedLanguage('de')).toBe(false);
  });

  it('narrows regional tags and falls back on unknown ones', () => {
    expect(resolveLanguage('it-CH')).toBe('it');
    expect(resolveLanguage('de-DE')).toBe(FALLBACK_LANGUAGE);
    expect(resolveLanguage(undefined)).toBe(FALLBACK_LANGUAGE);
  });
});

describe.each(SUPPORTED_LANGUAGES)('locale "%s"', (language) => {
  const catalogue = flatten(resources[language].common);

  it('carries exactly the keys English carries', () => {
    expect(Object.keys(catalogue).sort()).toEqual(referenceKeys);
  });

  it('has no blank values', () => {
    for (const [key, value] of Object.entries(catalogue)) {
      expect(value.trim(), `"${key}" is empty`).not.toBe('');
    }
  });

  it('keeps the same interpolation placeholders as English', () => {
    for (const [key, value] of Object.entries(catalogue)) {
      expect(placeholders(value), `"${key}" placeholders diverge`).toEqual(
        placeholders(reference[key] ?? ''),
      );
    }
  });
});

// The catalogue can be perfect and the app still render raw keys if the instance
// is wired wrong. These assertions run the real `baseOptions` — the browser
// plugins are the only thing they leave out.
describe('i18next instance', () => {
  let i18n: I18n;

  beforeAll(async () => {
    i18n = i18next.createInstance();
    await i18n.init(baseOptions);
  });

  it('resolves keys in every supported language', async () => {
    const expected: Record<string, string> = { en: 'Team', es: 'Equipo', it: 'Team' };
    for (const language of SUPPORTED_LANGUAGES) {
      await i18n.changeLanguage(language);
      expect(i18n.t('nav.team')).toBe(expected[language]);
    }
  });

  it('interpolates values', async () => {
    await i18n.changeLanguage('es');
    expect(i18n.t('language.switchTo', { language: 'Italiano' })).toBe('Cambiar a Italiano');
  });

  it('selects the right plural form', async () => {
    await i18n.changeLanguage('it');
    expect(i18n.t('nav.itemCount', { count: 1 })).toBe('1 elemento');
    expect(i18n.t('nav.itemCount', { count: 4 })).toBe('4 elementi');
  });

  it('falls back to English for an unshipped locale', async () => {
    await i18n.changeLanguage('de');
    expect(i18n.t('nav.team')).toBe('Team');
    expect(i18n.t('account.settings')).toBe('Settings');
  });

  it('narrows a regional tag to its base locale', async () => {
    await i18n.changeLanguage('es-MX');
    expect(i18n.resolvedLanguage).toBe('es');
    expect(i18n.t('account.settings')).toBe('Ajustes');
  });
});
