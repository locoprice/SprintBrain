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

/** Canonical defaults, matching the extension popup's initial triggerCfg. */
export const DEFAULT_TRIGGER_CONFIG = {
  snippetTrigger: '::',
  promptTrigger: '"""',
  snippetActivationKey: 'Tab' as ActivationKey,
  promptActivationKey: 'Tab' as ActivationKey,
} as const;
