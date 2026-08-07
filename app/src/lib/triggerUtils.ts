/**
 * triggerUtils.ts — shared trigger validation logic.
 *
 * Ported from extension/popup/popup.js (validateTriggerSeq, triggerWouldCollide).
 * Pure functions with no side effects and no browser-API dependencies — safe to
 * import in any context (dashboard, tests, future server-side code).
 *
 * The extension popup remains the authoritative source; keep both in sync when
 * the rules change.
 */

import type { ActivationKey } from '@/types/database';

/** All valid activation keys for the trigger engine. */
export const ACTIVATION_KEYS: readonly ActivationKey[] = ['Tab', 'Enter'];

/**
 * Validate a trigger sequence string.
 *
 * Rules (mirrored from popup.js validateTriggerSeq):
 *   - 1–5 characters after trimming
 *   - no whitespace characters
 *   - NOT a single alphanumeric character (would fire on normal typing)
 */
export function validateTriggerSeq(seq: string): boolean {
  const s = seq.trim();
  return (
    s.length >= 1 &&
    s.length <= 5 &&
    !/\s/.test(s) &&
    !/^[a-zA-Z0-9]$/.test(s)
  );
}

/**
 * Detect if two trigger sequences would collide.
 *
 * A collision occurs when one sequence is a prefix of the other (or they are
 * identical), making disambiguation impossible at runtime.
 * Mirrored from popup.js triggerWouldCollide.
 */
export function triggerWouldCollide(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a === b || b.startsWith(a) || a.startsWith(b);
}

// ── Shortcut tokens ──────────────────────────────────────────────────────────
// The rules above govern the trigger *sequence* (the "::" prefix). Below is the
// shortcut *token* that follows it — the part the user names per snippet.

/** Mirrors the 60-character cap in `snippetFormSchema.trigger`. */
export const TRIGGER_MAX_LENGTH = 60;

/**
 * Suggest a shortcut token from a snippet name — "Quote — English" → `quote_english`.
 *
 * Modelled on ACF's Field Label → Field Name behaviour, adapted to what a
 * SprintBrain trigger actually permits (`[a-zA-Z0-9_-]`, 60 chars, no prefix):
 *
 *   - Accents are folded, not dropped. "Español" has to become `espanol`;
 *     stripping the character outright would leave `espaol`.
 *   - Hyphens and underscores the user typed are kept, because both are legal
 *     in a trigger and "Follow-up" reading as `follow-up` is what they meant.
 *     Every other run of invalid characters — spaces, em dashes, emoji, the
 *     "💰" that opens half this account's snippet titles — collapses to a
 *     single underscore.
 *   - Lowercased. Trigger matching is case-insensitive in the extension
 *     (`content.js` lowercases both sides), so case is cosmetic, and a
 *     lowercase token is the faster one to type mid-conversation.
 *
 * Returns '' when a name yields no usable characters, so the caller writes
 * nothing rather than a bare separator.
 */
export function deriveTriggerFromName(name: string): string {
  return (name ?? '')
    .normalize('NFD')                 // split accents off the letters they sit on
    .replace(/\p{M}/gu, '')           // …then drop them: é → e, ñ → n
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')    // any run of illegal characters → one separator
    .replace(/^[_-]+|[_-]+$/g, '')    // never lead or trail with a separator
    .slice(0, TRIGGER_MAX_LENGTH)
    .replace(/[_-]+$/, '');           // the slice itself can expose a trailing one
}

/** Canonical defaults, matching the extension popup's initial triggerCfg. */
export const DEFAULT_TRIGGER_CONFIG = {
  snippetTrigger: '::',
  promptTrigger: '"""',
  snippetActivationKey: 'Tab' as ActivationKey,
  promptActivationKey: 'Tab' as ActivationKey,
} as const;
