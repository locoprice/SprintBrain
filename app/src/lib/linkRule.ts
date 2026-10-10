/**
 * Fill from link: where on a pasted web page a field's value sits.
 *
 * A field token carries the rule as its last attribute:
 *   `{formtext: name=QTY; type=number; default=0; link=before:Boxes|Box}`
 *   `{formdate: name=DATE_1; format=long; link=after:Start date}`
 * Two ways to point at a value, both described in the author's own words, so
 * the product itself names no trade:
 *
 *   after:LABEL    the text right after the label LABEL
 *   before:WORD    every number written right before WORD, added up
 *
 * `|` separates other spellings of the same thing (a page writes "1 Box" but
 * "2 Boxes"). A rule with no `after:` / `before:` is a bare label and reads as
 * `after:`, which is what a label usually means.
 *
 * MIRRORED from `sbParseLinkRule` and `_linkValue` in
 * `extension/formula-engine.js`, which is what the fill form reads at expansion
 * time; this copy exists so the builders can write and read the rule without
 * importing extension source (app/CLAUDE.md §6). `src/__tests__/fillFromLink.test.ts`
 * pins the two against each other.
 */

export type LinkMode = 'after' | 'before';

export const LINK_MODES: readonly LinkMode[] = ['after', 'before'];

/**
 * What every builder but Number offers: the value after a label. A date, a
 * choice and a piece of text follow their label on a page ("Start date: 9
 * October", "Plan: Standard"). Adding up the numbers before a word makes a
 * count, and a count is a Number field (root CLAUDE.md, Industry-Neutral:
 * quantities are numeric fields, never text).
 */
export const LABEL_LINK_MODES: readonly LinkMode[] = ['after'];

export interface LinkRule {
  mode: LinkMode;
  /** The label or word(s), each one a spelling the page may use. Never empty. */
  words: string[];
}

function isLinkMode(value: string): value is LinkMode {
  return (LINK_MODES as readonly string[]).includes(value);
}

/**
 * A `link=` value as `{ mode, words }`, or null when it says nothing usable.
 *
 * `;` and `}` end the attribute and the token, `{` opens another, and a line
 * break would split the token across two lines of the body, so all four read
 * as a space, exactly as the engine reads them.
 */
export function parseLinkRule(raw: string | null | undefined): LinkRule | null {
  const v = String(raw ?? '')
    .replace(/[;{}\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\s+|\s+$/g, '');
  if (v === '') return null;
  let mode: LinkMode = 'after';
  let rest = v;
  const colon = v.indexOf(':');
  if (colon > -1) {
    const head = v.slice(0, colon).replace(/^\s+|\s+$/g, '').toLowerCase();
    if (isLinkMode(head)) {
      mode = head;
      rest = v.slice(colon + 1);
    }
  }
  const words: string[] = [];
  for (const part of rest.split('|')) {
    const word = part.replace(/^\s+|\s+$/g, '');
    if (word !== '' && !words.includes(word)) words.push(word);
  }
  return words.length ? { mode, words } : null;
}

/**
 * The rule in its one written spelling (`before:Boxes|Box`), or '' when there
 * is none. What every writer emits, so a token read and written back comes out
 * identical.
 */
export function linkValue(raw: string | null | undefined): string {
  const rule = parseLinkRule(raw);
  return rule ? `${rule.mode}:${rule.words.join('|')}` : '';
}

/** The `link=` a token's settings carry, in its written spelling, or ''. */
export function readLinkAttr(attrs: string): string {
  const match = /(?:^|;)\s*link\s*=\s*([^;]+)/i.exec(attrs);
  return match ? linkValue(match[1]) : '';
}

/**
 * What a builder's link controls hold while the author is deciding: whether
 * the field reads a page at all, how, and the words exactly as typed.
 */
export interface LinkRuleDraft {
  enabled: boolean;
  mode: LinkMode;
  words: string;
}

/** A builder's starting point: off, on the mode that field is most likely to want. */
export function emptyLinkDraft(mode: LinkMode): LinkRuleDraft {
  return { enabled: false, mode, words: '' };
}

/**
 * The controls loaded from a rule already in the body, so editing a field keeps
 * its link rather than dropping it. A token with no rule opens switched off, on
 * `fallback`.
 */
export function linkDraftFrom(value: string | null | undefined, fallback: LinkMode): LinkRuleDraft {
  const rule = parseLinkRule(value);
  if (!rule) return emptyLinkDraft(fallback);
  return { enabled: true, mode: rule.mode, words: rule.words.join('|') };
}

/**
 * The value a writer takes from the controls: '' while switched off or left
 * empty, so a field nobody pointed at a page is written exactly as before.
 */
export function linkFromDraft(draft: LinkRuleDraft): string {
  return draft.enabled ? linkValue(`${draft.mode}:${draft.words}`) : '';
}
