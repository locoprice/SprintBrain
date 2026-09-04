/**
 * Number field token writer for the snippet body editor.
 *
 * A number field is stored inline in the body as
 *   `{formtext: name=NUM_1; type=number; format=currency; default=0}`
 * and read back by the formula engine's `buildFormFieldCfg`, which turns it
 * into `{ type: 'number', format: 'currency', default: '0' }`.
 *
 * **Why it rides on `{formtext:}` and not a `{formnumber:}` of its own.** Both
 * parsers — `extension/formula-engine.js` and the phone's mirrored copy — read
 * a token's prefix with a literal `slice(9)`. `formtext:`, `formdate:` and
 * `formmenu:` are all exactly nine characters; `formnumber:` is eleven. A new
 * token would have to land in 24 call sites, in lockstep, before it rendered
 * anywhere, and any surface that had not caught up would drop the field out of
 * the fill form entirely. The attribute needs none of them and degrades to a
 * plain text box instead of vanishing.
 *
 * None of that reaches the author. In the editor, Number is its own field type
 * beside Date/Time, Text and Choice; the shared spelling underneath is an
 * implementation detail nobody writing a snippet has to know about.
 *
 * Like `{formtext:}` and unlike `{formmenu:}`, a number field cannot go
 * unnamed: `_formFieldName` has no fallback key for it, so an unnamed token is
 * skipped, no input renders and the field prints nothing. The dialog prefills
 * `nextNumberName` so that costs the author no thought.
 *
 * `src/__tests__/formNumberField.test.ts` pins this round trip against the real
 * engine, and `scripts/check-snippets.js` asserts the engine and the phone read
 * the result identically.
 */

import { isValidMenuName } from '@/lib/formMenuToken';

/** How the value prints once it leaves the form. */
export type NumberFormat = 'plain' | 'currency' | 'percent';

export const NUMBER_FORMATS: readonly NumberFormat[] = ['plain', 'currency', 'percent'];

/**
 * The currencies a field can be written in, and how each one prints. Mirrors
 * `CURRENCIES` in `extension/formula-engine.js`, which is what actually formats
 * the value; this copy exists so the dialog can show the author the symbol
 * without importing extension source. `formNumberField.test.ts` pins the two
 * lists against each other.
 *
 * The symbol leads in every case. Several of these follow the number in their
 * home locale, but one placement rule keeps five surfaces printing one string.
 */
export const CURRENCIES = {
  EUR: { symbol: '€', label: 'Euro' },
  USD: { symbol: '$', label: 'US dollar' },
  GBP: { symbol: '£', label: 'Pound sterling' },
  CHF: { symbol: 'CHF', label: 'Swiss franc' },
  CAD: { symbol: 'CA$', label: 'Canadian dollar' },
  AUD: { symbol: 'A$', label: 'Australian dollar' },
  JPY: { symbol: '¥', label: 'Japanese yen' },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

/** What a currency field is written in when the author does not say. */
export const DEFAULT_CURRENCY: CurrencyCode = 'EUR';

export interface FormNumberConfig {
  /** Field name — how the rest of the body refers to the value. */
  name: string;
  /** How the value prints. `plain` writes no `format=` at all. */
  format: NumberFormat;
  /** Which currency, read only when `format` is `currency`. */
  currency: CurrencyCode;
  /** Value the field starts with, or '' for an empty field. */
  default: string;
}

/**
 * Engine identifier rules: a letter or underscore, then word characters. One
 * rule covers every kind of field, so this re-exports the menu writer's check
 * rather than restating the same regex a third time.
 */
export const isValidFieldName = isValidMenuName;

/**
 * Forces a name the engine accepts. A token whose name it rejects resolves to
 * nothing at expansion time, which reads to the author as a vanished field.
 */
export function sanitizeNumberName(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, '');
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `NUM_${cleaned}`;
}

/**
 * Whether a typed default is a number the engine will read back.
 *
 * Deliberately permissive about separators: an operator writing `1.200,50` has
 * written a real number, and the engine normalises it on the way in. What it
 * rejects is text — a hand-typed `€` or a stray letter — which would reach
 * `buildFormFieldCfg`, fail to parse, and silently arrive as an empty default.
 *
 * Empty is valid and means "no default", which is not the same as a default of
 * zero: one leaves the box blank, the other pre-answers the field with 0.
 */
export function isValidNumberDefault(raw: string): boolean {
  const s = raw.trim();
  if (s === '') return true;
  return /^[+-]?[0-9]+(?:[.,][0-9]+)*$/.test(s) && /[0-9]/.test(s);
}

/**
 * Writes the token. `plain` is the engine's fallback for a missing or
 * unrecognised `format`, so it is left out rather than spelled — a shorter
 * token that reads the same, and one less thing to keep in step if the default
 * ever moves.
 *
 * `;` `{` `}` and newlines end a token or split it across two lines of the
 * body, so a default carrying any of them would break the snippet. None can
 * survive `isValidNumberDefault`, but the strip stays: this function must not
 * be able to emit a broken token, whoever calls it.
 */
export function buildFormNumberToken(cfg: FormNumberConfig): string {
  const value = cfg.default.replace(/[;{}]/g, ' ').replace(/\s+/g, '').trim();
  let out = `{formtext: name=${sanitizeNumberName(cfg.name)}; type=number`;
  if (cfg.format !== 'plain') out += `; format=${cfg.format}`;
  // Only a currency field carries a currency, and only when it is not the
  // default: a shorter token that parses back the same, since the engine falls
  // back to EUR for a missing or unrecognised code.
  if (cfg.format === 'currency' && cfg.currency !== DEFAULT_CURRENCY) {
    out += `; currency=${cfg.currency}`;
  }
  if (value !== '') out += `; default=${value}`;
  return `${out}}`;
}

/**
 * The next unused `NUM_n` for a body, so an inserted field always carries a
 * working name without the author having to invent one.
 *
 * Every `NUM_n` in the body counts, not just the ones behind a `name=` — a
 * plain `{NUM_1}` placeholder is the same field to the engine, and handing out
 * its name again would silently wire two controls to one value.
 */
export function nextNumberName(body: string): string {
  const used = new Set<number>();
  const re = /NUM_(\d+)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const found = Number.parseInt(match[1] ?? '', 10);
    if (Number.isFinite(found)) used.add(found);
  }
  let n = 1;
  while (used.has(n)) n += 1;
  return `NUM_${n}`;
}
