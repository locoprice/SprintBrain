/**
 * Date-range token writer for the snippet body editor.
 *
 * Two dates and the span between them, written as one block:
 *
 * ```
 * {formdate: name=START_1; format=DD/MM/YYYY} {formdate: name=END_1; format=DD/MM/YYYY}
 * {= datetimediff(START_1,END_1,"calendar") + 1 } days and
 * {= datetimediff(START_1,END_1,"calendar") } nights
 * ```
 *
 * **The span is two different numbers, and the difference is the whole point.**
 * 1 to 3 September is **2** apart on a calendar and **3** if you count both
 * ends. Confusing them overstates or understates every quote built on it.
 *
 * **The engine writes the arithmetic, the author writes the word.** A hotel
 * calls the first nights, a rental calls it days, a clinic calls it sessions.
 * Nothing here names a trade, which is the root `CLAUDE.md` rule; the labels are
 * free text the author types once per snippet.
 *
 * **`calendar`, never `day`.** `datetimediff(…, "day")` divides elapsed
 * milliseconds, so it answers `2.04` across the October clock change and `1.83`
 * once the operator picks a time of day. `calendar` compares the dates
 * themselves. `day` is untouched, so every body already written keeps its
 * answer.
 *
 * Mirrors `buildDateRangeToken` in `extension/formula-engine.js`, which is what
 * actually resolves the block. `src/__tests__/dateRangeToken.test.ts` pins the
 * two against each other, and `scripts/check-snippets.js` pins the engine
 * against the phone.
 */

import { isValidMenuName } from '@/lib/formMenuToken';

/** Which of the two counts the block prints. */
export type RangeMode = 'between' | 'inclusive' | 'both';

export const RANGE_MODES: readonly RangeMode[] = ['between', 'inclusive', 'both'];

/**
 * How each choice reads, and what it prints for 1 to 3 September. The sample is
 * the point: "2" and "3" for the same pair of dates is the difference an author
 * has to see before picking, not after sending.
 */
export const RANGE_MODE_OPTIONS: readonly {
  value: RangeMode;
  label: string;
  sample: string;
}[] = [
  { value: 'between', label: 'Days between the two dates', sample: '2' },
  { value: 'inclusive', label: 'Counting both dates', sample: '3' },
  // The numbers only. The words beside them are the author's, and a sample that
  // guessed at them would both go stale and put a trade's vocabulary into
  // shipped product copy, which the root CLAUDE.md forbids.
  { value: 'both', label: 'Both', sample: '3 and 2' },
];

/** Whether the block brings its own date pickers or reads two already there. */
export type RangeSource = 'insert' | 'reuse';

export interface DateRangeConfig {
  /** Field name holding the earlier date. */
  start: string;
  /** Field name holding the later date. */
  end: string;
  mode: RangeMode;
  /** The word after the inclusive count, e.g. `days`. '' prints the bare number. */
  inclusiveLabel: string;
  /** The word after the between count, e.g. `nights`. */
  betweenLabel: string;
  /** What joins the two in `both` mode, e.g. `and`. Language-specific, so typed. */
  joiner: string;
  /** Whether to write the two date pickers alongside the count. */
  withFields: boolean;
  /** Whether those pickers offer a time as well as a date. */
  withTime: boolean;
  /** The format the pickers print in. Ignored when `withFields` is false. */
  format: string;
}

export const DEFAULT_JOINER = 'and';

/**
 * What the label boxes start with. `days` is what every trade counts; the
 * second word is left empty because there is no neutral one, and an empty label
 * prints the bare number rather than putting a guess in someone's message.
 */
export const DEFAULT_INCLUSIVE_LABEL = 'days';
export const DEFAULT_BETWEEN_LABEL = '';

/** The simplest answer, and the one that needs no typing to be correct. */
export const DEFAULT_RANGE_MODE: RangeMode = 'inclusive';

/** Engine identifier rules, shared with every other field builder. */
export const isValidFieldName = isValidMenuName;

/**
 * Strips what cannot survive in a body. `{` and `}` end a token, and a newline
 * splits the block across two lines, so neither can reach the output whatever
 * the caller passes.
 */
export function sanitizeRangeText(raw: string): string {
  return raw.replace(/[{}]/g, ' ').replace(/\s+/g, ' ').trim();
}

function rangeName(raw: string, fallback: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, '');
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : fallback;
}

/** One count, with its label if it has one. */
function countPart(
  start: string,
  end: string,
  inclusive: boolean,
  label: string,
): string {
  // datespan, not datetimediff: a range entered backwards, or with a date still
  // blank, prints nothing rather than a negative or a confident zero.
  const expr = `{= datespan(${start},${end},"${inclusive ? 'inclusive' : 'between'}") }`;
  const text = sanitizeRangeText(label);
  return text === '' ? expr : `${expr} ${text}`;
}

/**
 * The next free `START_n` / `END_n` pair for a body, so an inserted range always
 * carries working names. Both move together: a range whose halves were numbered
 * differently would read as two unrelated fields.
 */
export function nextRangeNames(body: string): { start: string; end: string } {
  const used = new Set<number>();
  const re = /(?:START|END)_(\d+)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const found = Number.parseInt(match[1] ?? '', 10);
    if (Number.isFinite(found)) used.add(found);
  }
  let n = 1;
  while (used.has(n)) n += 1;
  return { start: `START_${n}`, end: `END_${n}` };
}

/**
 * Writes the block. Mirrors the engine's writer exactly, including the order in
 * `both` mode: counting both ends reads first, so it comes out as "3 days and 2
 * nights" rather than the reverse.
 */
export function buildDateRangeToken(cfg: Partial<DateRangeConfig>): string {
  const start = rangeName(cfg.start ?? '', 'START_1');
  const end = rangeName(cfg.end ?? '', 'END_1');
  const mode: RangeMode = RANGE_MODES.includes(cfg.mode as RangeMode)
    ? (cfg.mode as RangeMode)
    : 'both';

  const parts: string[] = [];
  if (cfg.withFields) {
    const type = cfg.withTime ? 'datetime' : 'date';
    const fmt = sanitizeRangeText(cfg.format ?? '');
    for (const name of [start, end]) {
      let token = `{formdate: name=${name}`;
      if (type !== 'date') token += `; type=${type}`;
      // The closing date cannot open before the opening one. Written onto the
      // token so the rule travels with the snippet to every fill surface,
      // rather than living in whichever builder created it.
      if (name === end) token += `; after=${start}`;
      if (fmt !== '') token += `; format=${fmt}`;
      parts.push(`${token}}`);
    }
  }

  if (mode === 'both') {
    const joiner = sanitizeRangeText(cfg.joiner ?? '');
    parts.push(countPart(start, end, true, cfg.inclusiveLabel ?? ''));
    if (joiner !== '') parts.push(joiner);
    parts.push(countPart(start, end, false, cfg.betweenLabel ?? ''));
  } else {
    const inclusive = mode === 'inclusive';
    parts.push(
      countPart(start, end, inclusive, (inclusive ? cfg.inclusiveLabel : cfg.betweenLabel) ?? ''),
    );
  }
  return parts.join(' ');
}

/**
 * What the block prints for a given pair of dates, so the dialog can show the
 * sentence before it lands in the body. Mirrors the engine's `calendar` unit:
 * compare the dates through `Date.UTC`, which has no DST and no clock.
 */
export function calendarDayDiff(a: Date, b: Date): number {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / 86400000);
}

/**
 * The sentence the block will print, for a start and end the author has typed
 * into the dialog. Returns '' when either date is unreadable, which is what the
 * dialog shows rather than a number built on a guess.
 */
export function previewRange(cfg: Partial<DateRangeConfig>, start: Date, end: Date): string {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '';
  const between = calendarDayDiff(start, end);
  // A range that runs backwards is not a short range, it is not a range. The
  // engine declines to answer, so the preview must not promise a number.
  if (between < 0) return '';
  const inclusive = between + 1;
  const mode: RangeMode = RANGE_MODES.includes(cfg.mode as RangeMode)
    ? (cfg.mode as RangeMode)
    : 'both';
  const withLabel = (n: number, label: string) => {
    const text = sanitizeRangeText(label ?? '');
    return text === '' ? String(n) : `${n} ${text}`;
  };
  if (mode === 'between') return withLabel(between, cfg.betweenLabel ?? '');
  if (mode === 'inclusive') return withLabel(inclusive, cfg.inclusiveLabel ?? '');
  const joiner = sanitizeRangeText(cfg.joiner ?? '');
  const head = withLabel(inclusive, cfg.inclusiveLabel ?? '');
  const tail = withLabel(between, cfg.betweenLabel ?? '');
  return joiner === '' ? `${head} ${tail}` : `${head} ${joiner} ${tail}`;
}
