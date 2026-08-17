import type { defaultNS, TranslationResource } from '@/i18n/resources';

// Teaches TypeScript the key catalogue, so `t('nav.snippets')` is checked at
// compile time and a typo or a renamed key fails `npm run typecheck` instead of
// rendering the raw key string to a user. English is the reference locale — the
// others are kept in step by `src/__tests__/i18n.test.ts`.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    resources: TranslationResource;
    returnNull: false;
  }
}
