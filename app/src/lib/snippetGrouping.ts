import type { SnippetLanguage, SnippetRow } from '@/types/database';

/**
 * Trailing language code on a trigger or title. Mirrors the canonical rule in
 * `extension/shared/snippet-stats.js`, which the popup, Sprintbrain.html, the
 * mobile companion and the content script all run, so every surface collapses
 * the same variants:
 *   - `::quoteEN` + `::quoteES`  → share the base `quote`
 *   - `::air` + `::airEN`        → share the base `air`
 *   - `::budgetstay` (no suffix) → groups with its same-trigger siblings
 */
const LANG_SUFFIX_RE = /(EN|ES|IT|FR|MULTI)$/i;

/** Canonical language order for variant pills and active-variant fallback. */
const LANG_ORDER: SnippetLanguage[] = ['EN', 'ES', 'IT', 'FR', 'MULTI'];

/** A stored trigger may or may not carry the trigger prefix baked in. */
function bareTrigger(trigger: string): string {
  return trigger.trim().replace(/^[^a-zA-Z0-9]+/, '');
}

/**
 * Grouping base of a row's trigger, lowercased. Drops the trigger prefix
 * (`::air` and `air` are the same trigger) and a trailing language code — but
 * only when that code is the row's OWN language.
 *
 * That guard is the whole point. Without it `wait` (a French snippet) sheds an
 * "IT" it never had, bases to `wa`, and merges with the unrelated `WA`. On live
 * data that put one person's snippet name and folder onto another person's
 * card.
 */
export function baseTrigger(row: SnippetRow): string {
  const trigger = bareTrigger(row.triggers[0] ?? '');
  if (trigger === '') return '';
  const match = trigger.match(LANG_SUFFIX_RE);
  if (match !== null) {
    const suffix = match[1] ?? '';
    const head = trigger.slice(0, trigger.length - suffix.length);
    if (head !== '' && suffix.toUpperCase() === row.language.toUpperCase()) {
      return head.toLowerCase();
    }
  }
  return trigger.toLowerCase();
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

/**
 * Grouping key for one row. An explicit `lang_group_id` wins; only rows without
 * one fall back to the base-trigger heuristic.
 *
 * Every key is namespaced by owner. Sharing a folder does not move ownership
 * (Phase B stamps `organization_id`, it does not reassign `user_id`), so two
 * teammates whose triggers happen to collide are two snippets, not one. Without
 * this, live data merged `WA` (owned by one admin) with `wait` (owned by
 * another) and the card rendered one person's name over the other's folder.
 *
 * Group ids are namespaced with `g:` because they are trigger-shaped in
 * practice (`altern`, `discount`, `quoteEN`) and would otherwise collide with a
 * base-trigger key spelled the same way. On live data a row with
 * `lang_group_id: 'budgetstay'` merged with two unrelated rows triggered
 * `budgetstay`, across three folders and two owners.
 *
 * Note this is deliberately NOT the extension's rule, which also joins gid and
 * base transitively so `::quoteEN` and `::quoteES` under two different group
 * ids become one snippet. Here they stay apart, so a second ES row is never
 * shadowed out of the language switcher. The two surfaces can therefore report
 * different library counts for the same account.
 */
export function snippetGroupKey(row: SnippetRow): string {
  const owner = `u:${row.user_id}`;
  const groupId = row.lang_group_id?.trim();
  if (groupId !== undefined && groupId !== '') return `${owner}|g:${groupId.toLowerCase()}`;
  const base = baseTrigger(row);
  return base !== '' ? `${owner}|b:${base}` : `${owner}|r:${row.id}`;
}

export interface SnippetGroup {
  /** Grouping key — see `snippetGroupKey`. Owner-namespaced. */
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
 * Every language a single row actually carries: the row's own language plus
 * each non-empty slot in its `bodies` map. A snippet written in the dashboard
 * is ONE row holding all its translations, so reading `language` alone reports
 * a four-language snippet as monolingual.
 */
function rowLanguages(row: SnippetRow): SnippetLanguage[] {
  const out: SnippetLanguage[] = [row.language];
  for (const lang of LANG_ORDER) {
    const text = row.bodies[lang];
    if (typeof text === 'string' && text.trim() !== '' && !out.includes(lang)) {
      out.push(lang);
    }
  }
  return out;
}

/**
 * Collapse translated variants of the same snippet into one group — see
 * `snippetGroupKey` for how a row's group is chosen. Input order is preserved
 * so an upstream sort still drives group ordering. Rows that land in the same
 * group with the same language keep the first occurrence in `byLang`; the
 * duplicate stays in `variants` so bulk selection still reaches it.
 *
 * Both multilingual models are folded together. Sibling rows (one row per
 * language, legacy `lang_group_id`) take precedence, then any language that
 * exists only inside a row's `bodies` map fills the gaps — that second pass is
 * what stops a single-row snippet from rendering as monolingual. The extension
 * and the mobile companion resolve variants the same way; see
 * `_findLangVariants` in extension/content/content.js.
 */
export function groupSnippetsByLanguage(rows: SnippetRow[]): SnippetGroup[] {
  const groups: SnippetGroup[] = [];
  const index = new Map<string, SnippetGroup>();

  for (const row of rows) {
    const key = snippetGroupKey(row);
    const existing = index.get(key);
    const group: SnippetGroup =
      existing ?? { key, master: row, variants: [], byLang: new Map(), languages: [] };
    if (existing === undefined) {
      index.set(key, group);
      groups.push(group);
    }
    group.variants.push(row);
    if (!group.byLang.has(row.language)) {
      group.byLang.set(row.language, row);
    }
  }

  for (const group of groups) {
    // Real rows already claimed their language above; fill what only `bodies`
    // carries, mapping it to the row that holds the text.
    for (const row of group.variants) {
      for (const lang of rowLanguages(row)) {
        if (!group.byLang.has(lang)) group.byLang.set(lang, row);
      }
    }
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
 * Resolve which language a grouped row should display. Honors the user's
 * explicit switch, then falls back to English, then the master row's language.
 *
 * Selection is keyed by LANGUAGE, not by row id: a single row can back several
 * languages through its `bodies` map, so an id cannot say which one is meant.
 */
export function resolveActiveLanguage(
  group: SnippetGroup,
  requested: SnippetLanguage | undefined,
): SnippetLanguage {
  if (requested !== undefined && group.byLang.has(requested)) return requested;
  if (group.byLang.has('EN')) return 'EN';
  return group.master.language;
}

/**
 * The row backing the group's active language — the edit / action target, and
 * the source of every row-level column (folder, updated, usage).
 */
export function resolveActiveVariant(
  group: SnippetGroup,
  activeLang: SnippetLanguage | undefined,
): SnippetRow {
  return group.byLang.get(resolveActiveLanguage(group, activeLang)) ?? group.master;
}
