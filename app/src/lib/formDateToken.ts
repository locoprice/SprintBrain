/**
 * Date and time field token writer for the snippet body editor.
 *
 * A date field is stored inline in the body as
 *   `{formdate: name=DATE_1; format=DD/MM/YYYY}`
 * and a time field as
 *   `{formdate: name=TIME_1; type=time; format=hh:mm A}`
 * Both are read back by the formula engine's `buildFormFieldCfg`, which turns
 * them into `{ type: 'date' | 'time', format, default }`.
 *
 * **Why the kind and the format ride on `{formdate:}`.** Same constraint that
 * put a number on `{formtext:}`: every parser reads a token's prefix with a
 * literal `slice(9)`, and `formtext:`, `formdate:` and `formmenu:` are all
 * exactly nine characters. A `{formtime:}` of its own would have to land in
 * every one of those call sites, in lockstep, and any surface that had not
 * caught up would drop the field out of the fill form entirely. An attribute
 * needs none of them and degrades to a date picker instead of vanishing.
 *
 * **No format means no formatting.** That is what makes this backward
 * compatible: every `{formdate:}` written before the attribute existed carries
 * none, so all of them keep printing exactly what they printed. Formatting is
 * output only — `datetimediff()` and the fill form both still read the raw
 * picker value.
 *
 * `src/__tests__/formDateField.test.ts` pins this round trip against the real
 * engine, and `scripts/check-snippets.js` asserts the engine and the phone read
 * and print the result identically.
 */

import { isValidMenuName } from '@/lib/formMenuToken';

/** The two kinds the Date/Time builder writes. */
export type DateFieldKind = 'date' | 'time';

/**
 * The date formats the builder offers, in the order it offers them. Mirrors
 * `DATE_FORMATS` in `extension/formula-engine.js`, which is what actually
 * prints the value; this copy exists so the dialog can label the choices
 * without importing extension source.
 */
export const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'DD/MM/dddd'] as const;

/** Mirrors `TIME_FORMATS` in the engine. */
export const TIME_FORMATS = ['HH:mm', 'hh:mm A'] as const;

export type DateFormat = (typeof DATE_FORMATS)[number];
export type TimeFormat = (typeof TIME_FORMATS)[number];

/** What the author starts on: the order most of the world writes a date in. */
export const DEFAULT_DATE_FORMAT: DateFormat = 'DD/MM/YYYY';
/** And the clock most of the world reads. */
export const DEFAULT_TIME_FORMAT: TimeFormat = 'HH:mm';

/**
 * How each choice reads in the dropdown, and what it prints. The sample is the
 * point: "DD/MM/YYYY" tells an author nothing they can check at a glance, and
 * the two numeric orders are indistinguishable until you see a day past the
 * twelfth in the first slot.
 */
export const DATE_FORMAT_OPTIONS: readonly { value: DateFormat; label: string; sample: string }[] = [
  { value: 'DD/MM/YYYY', label: 'Day / Month / Year', sample: '04/09/2026' },
  { value: 'MM/DD/YYYY', label: 'Month / Day / Year', sample: '09/04/2026' },
  { value: 'DD/MM/dddd', label: 'Day / Month / Weekday', sample: '04/09/Friday' },
];

export const TIME_FORMAT_OPTIONS: readonly { value: TimeFormat; label: string; sample: string }[] = [
  { value: 'HH:mm', label: '24-hour', sample: '14:30' },
  { value: 'hh:mm A', label: '12-hour (AM/PM)', sample: '02:30 PM' },
];

export interface FormDateConfig {
  /** Field name — how the rest of the body refers to the value. */
  name: string;
  /** Whether the fill form opens a calendar or a clock. */
  kind: DateFieldKind;
  /** How the value prints. '' writes no `format=` and prints the raw value. */
  format: string;
}

/**
 * Engine identifier rules: a letter or underscore, then word characters. One
 * rule covers every kind of field, so this re-exports the menu writer's check
 * rather than restating the same regex a fourth time.
 */
export const isValidFieldName = isValidMenuName;

/**
 * Forces a name the engine accepts. A token whose name it rejects resolves to
 * nothing at expansion time, which reads to the author as a vanished field.
 */
export function sanitizeDateName(raw: string, kind: DateFieldKind): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, '');
  if (/^[A-Za-z_]/.test(cleaned)) return cleaned;
  return `${kind === 'time' ? 'TIME_' : 'DATE_'}${cleaned}`;
}

/**
 * Whether a format is one this kind of field actually has. An unrecognised one
 * is absorbed rather than passed on: the engine would ignore it anyway, and a
 * token carrying a format nothing reads is a lie about what will print.
 */
export function normalizeDateFormat(kind: DateFieldKind, format: string): string {
  const list: readonly string[] = kind === 'time' ? TIME_FORMATS : DATE_FORMATS;
  return list.includes(format.trim()) ? format.trim() : '';
}

/**
 * Writes the token.
 *
 * `date` is the engine's fallback for a missing or unrecognised `type`, so it
 * is left out rather than spelled — a shorter token that parses back the same.
 *
 * No `default=` is written. A date or time field already opens on now (see
 * `nowDefault` in `extension/shared/fill-form.js`), which is the answer nearly
 * every one of them wants, and a hardcoded date goes stale the day after it is
 * saved.
 */
export function buildFormDateToken(cfg: FormDateConfig): string {
  let out = `{formdate: name=${sanitizeDateName(cfg.name, cfg.kind)}`;
  if (cfg.kind === 'time') out += '; type=time';
  const format = normalizeDateFormat(cfg.kind, cfg.format);
  if (format !== '') out += `; format=${format}`;
  return `${out}}`;
}

/**
 * The next unused `DATE_n` / `TIME_n` for a body, so an inserted field always
 * carries a working name without the author having to invent one. Inserting
 * twice is how a range is written: `DATE_1` opens it and `DATE_2` closes it.
 *
 * Every `DATE_n` in the body counts, not just the ones behind a `name=` — a
 * plain `{DATE_1}` placeholder is the same field to the engine, and handing out
 * its name again would silently wire two controls to one value.
 */
export function nextDateName(body: string, kind: DateFieldKind): string {
  const prefix = kind === 'time' ? 'TIME_' : 'DATE_';
  const used = new Set<number>();
  const re = new RegExp(`${prefix}([0-9]+)`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const found = Number.parseInt(match[1] ?? '', 10);
    if (Number.isFinite(found)) used.add(found);
  }
  let n = 1;
  while (used.has(n)) n += 1;
  return `${prefix}${n}`;
}
