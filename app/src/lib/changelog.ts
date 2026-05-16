// Types only. Changelog data is auto-generated from git history at build time.
// See the buildChangelog() function in vite.config.ts.

export interface ChangelogChange {
  type: string;
  text: string;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  label: string;
  changes?: ChangelogChange[];
}
