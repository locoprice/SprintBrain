import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  LANGUAGE_LABELS,
  LANGUAGE_SHORT_LABELS,
  SUPPORTED_LANGUAGES,
  resolveLanguage,
  type SupportedLanguage,
} from '@/i18n/languages';

/**
 * Segmented locale control. Deliberately the same shape as `ThemeToggle` — the
 * two sit side by side in the top bar and read as one preferences cluster.
 *
 * No store: i18next already holds the active locale and persists it, so mirroring
 * it into Zustand would create a second source of truth that can drift.
 */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const active = resolveLanguage(i18n.resolvedLanguage);

  function onSelect(language: SupportedLanguage) {
    if (language === active) return;
    void i18n.changeLanguage(language);
  }

  return (
    <div
      role="group"
      aria-label={t('language.groupLabel')}
      className="flex items-center rounded-[10px] border border-line bg-bg-alt p-0.5"
    >
      {SUPPORTED_LANGUAGES.map((language) => (
        <button
          key={language}
          type="button"
          lang={language}
          aria-label={t('language.switchTo', { language: LANGUAGE_LABELS[language] })}
          aria-pressed={language === active}
          onClick={() => onSelect(language)}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-[8px] text-[10px] font-semibold transition-colors duration-150',
            language === active
              ? 'bg-card text-ink shadow-sm'
              : 'text-ink-subtle hover:text-ink-muted',
          )}
        >
          {LANGUAGE_SHORT_LABELS[language]}
        </button>
      ))}
    </div>
  );
}
