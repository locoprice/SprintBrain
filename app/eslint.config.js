// ESLint v9 flat config for the SprintBrain dashboard.
// Minimal TS-aware setup to unblock the `npm run lint` commit gate.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  console: 'readonly',
  navigator: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  fetch: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  crypto: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  HTMLElement: 'readonly',
  HTMLInputElement: 'readonly',
  HTMLDivElement: 'readonly',
  HTMLButtonElement: 'readonly',
  HTMLSelectElement: 'readonly',
  HTMLFormElement: 'readonly',
  HTMLTextAreaElement: 'readonly',
  Event: 'readonly',
  MouseEvent: 'readonly',
  KeyboardEvent: 'readonly',
  React: 'readonly',
  process: 'readonly',
};

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.netlify/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js}'],
    languageOptions: { globals: browserGlobals },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // supabase-js returns a failed query's error as a plain object, and the
    // screens read `.message` only from a real Error. Throwing the object as it
    // came is how a rejected save ended up as a bare "Save failed".
    files: ['src/lib/api/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ThrowStatement > :matches(Identifier, MemberExpression, LogicalExpression)',
          message: 'Throw errors through toApiError(error) so a screen can read them (lib/api/apiError.ts).',
        },
      ],
    },
  },
);
