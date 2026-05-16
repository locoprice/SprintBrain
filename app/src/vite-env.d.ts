/// <reference types="vite/client" />

// Build-time constants injected by the changelog Vite plugin (vite.config.ts).
declare const __APP_CHANGELOG__: import('./lib/changelog').ChangelogEntry[];
declare const __APP_VERSION__: string;
declare const __APP_RELEASE_DATE__: string;
