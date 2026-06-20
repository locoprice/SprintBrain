import type { SnippetLanguage, SnippetRow } from '@/types/database';

/**
 * Trailing language code on a trigger or title. Mirrors the Chrome extension's
 * `LANG_SUFFIX_RE` (`extension/content/content.js`) so the dashboard collapses
 * the exact same variants the extension's language picker does:
 *   - `::quoteEN` + `::quoteES`  → share the base `::quote`
 *   - `::air` + `::airEN`        → share the base `::air`
 *   - `::budgetstay` (no suffix) → groups with its same-trigger siblings
 */
const LANG_SUFFIX_RE = /(?:EN|ES|IT|FR|MULTI)$/i;

/** Canonical language order for variant pills and active-variant fallback. */
const LANG_ORDER: SnippetLanguage[] = ['EN', 'ES', 'IT', 'FR', 'MULTI'];

/** Strip a trailing language code from a trigger to get its grouping base. */
export function baseTrigger(trigger: string): string {
  return trigger.replace(LANG_SUFFIX_RE, '');
}

/**
 * Strip a trailing language code (and any leading space) from a snippet title —
 * e.g. "Valenx (firma) EN" → "Valenx (firma)". Only applied to grouped rows;
 * single-language rows keep their raw name so legitimate titles that happen to
 * end in a language code (e.g. "GREEN") are never clipped.
 */
export function baseSnippetName(name: string): string {
  return name.replace(/\s*(?:EN|ES|IT|FR|MULTI)$/i, '').trim() || name;
}

export interface SnippetGroup {
  /** Stable grouping key — lowercased base trigger (falls back to the row id). */
  key: string;
  /** First row in input order — drives group ordering and the displayed name. */
  master: SnippetRow;
  /** Every row in the group, in input order. Drives selection and counts. */
  variants: SnippetRow[];
  /** First row seen per language. Drives the switcher and active-variant lookup. */
  byLang: Map<SnippetLanguage, SnippetRow>;
  /** Distinct languages present, in canonical order. */
  languages: SnippetLanguage[];
}

/**
 * Collapse translated variants of the same snippet into one group, keyed by the
 * trigger with its trailing language code stripped. Input order is preserved so
 * an upstream sort still drives group ordering. Rows that share a base trigger
 * but the same language keep the first occurrence in `byLang`; the duplicate
 * stays in `variants` so bulk selection still reaches it.
 */
export function groupSnippetsByLanguage(rows: SnippetRow[]): SnippetGroup[] {
  const groups: SnippetGroup[] = [];
  const index = new Map<string, SnippetGroup>();

  for (const row of rows) {
    const trigger = row.triggers[0] ?? '';
    const key = baseTrigger(trigger).toLowerCase() || row.id;
    let group = index.get(key);
    if (group === undefined) {
      group = { key, master: row, variants: [], byLang: new Map(), languages: [] };
      index.set(key, group);
      groups.push(group);
    }
    group.variants.push(row);
    if (!group.byLang.has(row.language)) {
      group.byLang.set(row.language, row);
    }
  }

  for (const group of groups) {
    const present = LANG_ORDER.filter((l) => group.byLang.has(l));
    // Defensive: surface any language not in the canonical list (shouldn't happen).
    for (const v of group.variants) {
      if (!present.includes(v.language)) present.push(v.language);
    }
    group.languages = present;
  }

  return groups;
}

/**
 * Resolve which variant a grouped row should display. Honors the user's
 * explicit language switch, then falls back to English, then the master row.
 */
export function resolveActiveVariant(
  group: SnippetGroup,
  activeId: string | undefined,
): SnippetRow {
  if (activeId !== undefined) {
    const picked = group.variants.find((v) => v.id === activeId);
    if (picked !== undefined) return picked;
  }
  return group.byLang.get('EN') ?? group.master;
}
