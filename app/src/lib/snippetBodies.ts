import type { SnippetBodies, SnippetLanguage } from '@/types/database';

/**
 * Per-language body map edits (CLEAR-LANG-001).
 *
 * One rule, in one place: a language slot either holds text or does not exist.
 * An empty string is never a valid value. `normalizeBodies` (snippetsApi) drops
 * empty slots on read and `mergeActiveBody` drops the active one on write, so a
 * slot left at `''` in the form is a translation that looks present to the
 * editor, survives a language switch, and reaches the row as a stub every
 * reader then has to skip. Keeping the map canonical while it is being edited
 * is what makes "clear this language" mean deleted rather than blanked.
 *
 * Both helpers return a new map, since the form state is immutable.
 */

/**
 * Write `text` into `lang`. Empty text deletes the slot instead of storing a
 * blank, which is what makes clearing the textarea by hand equivalent to
 * pressing Clear. The emptiness test matches `mergeActiveBody` in snippetsApi
 * so the form and the persisted row agree on what counts as a filled slot.
 */
export function setBodySlot(
  bodies: SnippetBodies,
  lang: SnippetLanguage,
  text: string,
): SnippetBodies {
  const next: SnippetBodies = { ...bodies };
  if (text.length > 0) {
    next[lang] = text;
  } else {
    delete next[lang];
  }
  return next;
}

/**
 * Remove `lang` outright, so the snippet reads as never having carried that
 * translation.
 */
export function clearBodySlot(bodies: SnippetBodies, lang: SnippetLanguage): SnippetBodies {
  const next: SnippetBodies = { ...bodies };
  delete next[lang];
  return next;
}
