/**
 * Automatic-date token writer for the snippet body editor.
 *
 * A `{time:}` token is **not a field**. Nobody fills it in: it is worked out
 * when the snippet expands, the way `{greeting}` is. That is the whole
 * difference from `{formdate:}` (see `@/lib/formDateToken`), and it is why the
 * two sit in the same rail group but write different tokens.
 *
 *   `{time: DD/MM/YYYY}`                                  today
 *   `{time: DD/MM/YYYY; shift=+3D}`                       three days out
 *   `{time: DD/MM/YYYY; shift=next monday}`               whichever day that is
 *   `{time: DD/MM/YYYY HH:mm; shift=tomorrow; at=09:00}`  tomorrow at nine
 *
 * **One `shift=` attribute for two kinds of move.** A fixed offset and a named
 * anchor both answer "which day is this message about", and they never compose:
 * a date is either counted forward or landed on. Two attributes would need a
 * rule for what happens when someone writes both.
 *
 * **Order is load-bearing.** The shift picks the day, then `at=` pins the clock
 * on it. Reversed, "tomorrow at 09:00" would set nine o'clock today and then add
 * a day's worth of whatever hour it happened to be.
 *
 * This file mirrors `buildFormTimeToken` / `sbApplyShift` / `sbNamedShift` /
 * `sbApplyAt` in `extension/formula-engine.js`, which is what actually resolves
 * the token at expansion time; the copy exists so the dialog can preview without
 * importing extension source. `src/__tests__/formTimeToken.test.ts` pins the two
 * against each other, and `scripts/check-snippets.js` pins the engine against
 * the phone.
 */

/** The anchors the builder offers, in the order it offers them. */
export const NAMED_SHIFTS = [
  'tomorrow',
  'yesterday',
  'next monday',
  'next tuesday',
  'next wednesday',
  'next thursday',
  'next friday',
  'next saturday',
  'next sunday',
  'start of month',
  'start of next month',
  'end of month',
  'end of next month',
] as const;

export type NamedShift = (typeof NAMED_SHIFTS)[number];

/** How each anchor reads in the dropdown. Sentence case, not the raw token. */
export const NAMED_SHIFT_LABELS: Record<NamedShift, string> = {
  tomorrow: 'Tomorrow',
  yesterday: 'Yesterday',
  'next monday': 'Next Monday',
  'next tuesday': 'Next Tuesday',
  'next wednesday': 'Next Wednesday',
  'next thursday': 'Next Thursday',
  'next friday': 'Next Friday',
  'next saturday': 'Next Saturday',
  'next sunday': 'Next Sunday',
  'start of month': 'Start of this month',
  'start of next month': 'Start of next month',
  'end of month': 'End of this month',
  'end of next month': 'End of next month',
};

/** The units a fixed offset can count in. `Mo` is months; `M` is minutes. */
export const SHIFT_UNITS = [
  { value: 'D', label: 'Days' },
  { value: 'W', label: 'Weeks' },
  { value: 'Mo', label: 'Months' },
  { value: 'Y', label: 'Years' },
  { value: 'H', label: 'Hours' },
  { value: 'M', label: 'Minutes' },
] as const;

export type ShiftUnit = (typeof SHIFT_UNITS)[number]['value'];

/** Which of the three ways the date is chosen. */
export type ShiftMode = 'none' | 'fixed' | 'named';

const WEEKDAY_NAMES = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
];

const FIXED_SHIFT_RE = /^([+-])\s*(\d+)\s*(Mo|M|H|D|W|Y)$/i;
const AT_RE = /^(\d{1,2}):(\d{2})$/;

function shiftKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * An anchored shift. Returns a new Date, or null when the name is not one this
 * grammar knows — the caller treats null as "no shift" rather than guessing.
 *
 * The clock is left where it was: which time an anchored date carries is `at=`'s
 * business.
 */
export function applyNamedShift(from: Date, name: string): Date | null {
  const key = shiftKey(name);
  const out = new Date(from.getTime());
  if (key === 'tomorrow') {
    out.setDate(out.getDate() + 1);
    return out;
  }
  if (key === 'yesterday') {
    out.setDate(out.getDate() - 1);
    return out;
  }
  if (key.startsWith('next ')) {
    const want = WEEKDAY_NAMES.indexOf(key.slice(5));
    if (want === -1) return null;
    // Strictly after today. Written on a Monday, "next Monday" means the one a
    // week away — nobody says it about the day they are standing in.
    let delta = (want - out.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    out.setDate(out.getDate() + delta);
    return out;
  }
  // setDate(1) before setMonth, and the two-argument setMonth for month ends:
  // both avoid the overflow that turns 31 January into 3 March.
  if (key === 'start of month') {
    out.setDate(1);
    return out;
  }
  if (key === 'start of next month') {
    out.setDate(1);
    out.setMonth(out.getMonth() + 1);
    return out;
  }
  if (key === 'end of month') {
    out.setMonth(out.getMonth() + 1, 0);
    return out;
  }
  if (key === 'end of next month') {
    out.setMonth(out.getMonth() + 2, 0);
    return out;
  }
  return null;
}

/** A fixed offset or an anchor. Anything else leaves the date untouched. */
export function applyShift(from: Date, shift: string): Date {
  if (!shift) return from;
  const m = FIXED_SHIFT_RE.exec(shift.replace(/\s+/g, ''));
  if (m) {
    const sign = m[1] === '-' ? -1 : 1;
    const n = Number.parseInt(m[2] ?? '0', 10) * sign;
    const unit = (m[3] ?? '').toLowerCase();
    const out = new Date(from.getTime());
    if (unit === 'm') out.setMinutes(out.getMinutes() + n);
    else if (unit === 'h') out.setHours(out.getHours() + n);
    else if (unit === 'd') out.setDate(out.getDate() + n);
    else if (unit === 'w') out.setDate(out.getDate() + n * 7);
    else if (unit === 'mo') out.setMonth(out.getMonth() + n);
    else if (unit === 'y') out.setFullYear(out.getFullYear() + n);
    return out;
  }
  return applyNamedShift(from, shift) ?? from;
}

/** Whether the parser will act on this shift, rather than silently ignore it. */
export function isValidShift(shift: string): boolean {
  if (FIXED_SHIFT_RE.test(shift.replace(/\s+/g, ''))) return true;
  return applyNamedShift(new Date(), shift) !== null;
}

/** Whether this is a clock time. Out of range is a typo, not a time. */
export function isValidAt(at: string): boolean {
  const m = AT_RE.exec(at.replace(/\s+/g, ''));
  if (!m) return false;
  return Number.parseInt(m[1] ?? '', 10) <= 23 && Number.parseInt(m[2] ?? '', 10) <= 59;
}

/** Pins the clock, leaving the day alone. Seconds go to zero. */
export function applyAt(from: Date, at: string): Date {
  if (!isValidAt(at)) return from;
  const m = AT_RE.exec(at.replace(/\s+/g, ''));
  const out = new Date(from.getTime());
  out.setHours(Number.parseInt(m?.[1] ?? '0', 10), Number.parseInt(m?.[2] ?? '0', 10), 0, 0);
  return out;
}

/** Builds the `shift=` value for a fixed offset, or '' when it would be a no-op. */
export function fixedShift(amount: number, unit: ShiftUnit, back: boolean): string {
  if (!Number.isFinite(amount) || amount <= 0) return '';
  return `${back ? '-' : '+'}${Math.floor(amount)}${unit}`;
}

export interface FormTimeConfig {
  /** An `sbFormatDate` pattern, e.g. `DD/MM/YYYY HH:mm`. */
  format: string;
  /** A fixed offset (`+3D`) or an anchor (`next monday`). '' for "now". */
  shift: string;
  /** `HH:mm` to pin the clock. Only written when the format prints one. */
  at: string;
}

/** Whether the format prints a clock at all, which is what makes `at=` visible. */
export function formatShowsTime(format: string): boolean {
  return /[Hhms]/.test(format);
}

/**
 * Writes the token.
 *
 * A shift or a time the parser would ignore is dropped rather than written: a
 * token carrying `shift=whenever` resolves to today, which reads as a working
 * token printing the wrong day. Same for `at=` beside a date-only format, where
 * it would change nothing a reader can see.
 *
 * `;` `{` `}` and newlines end a token or split it across two lines of the body,
 * so they are stripped whatever the caller passes.
 */
export function buildFormTimeToken(cfg: Partial<FormTimeConfig>): string {
  const format = (cfg.format ?? '').replace(/[;{}]/g, ' ').replace(/\s+/g, ' ').trim();
  let out = `{time: ${format || 'YYYY-MM-DD'}`;
  const shift = (cfg.shift ?? '').replace(/[;{}]/g, ' ').replace(/\s+/g, ' ').trim();
  if (shift !== '' && isValidShift(shift)) out += `; shift=${shift}`;
  const at = (cfg.at ?? '').replace(/\s+/g, '');
  if (at !== '' && isValidAt(at) && formatShowsTime(format)) out += `; at=${at}`;
  return `${out}}`;
}

/**
 * What the token will print, resolved against `now`. Mirrors the engine's
 * `sbParseTimeToken` for the subset the builder can produce, so the dialog can
 * show a live preview without loading extension source.
 */
export function previewTime(
  cfg: Partial<FormTimeConfig>,
  now: Date,
  formatDate: (d: Date, fmt: string) => string,
): string {
  const format = (cfg.format ?? '').trim() || 'YYYY-MM-DD';
  let base = new Date(now.getTime());
  const shift = (cfg.shift ?? '').trim();
  if (shift) base = applyShift(base, shift);
  const at = (cfg.at ?? '').trim();
  if (at && formatShowsTime(format)) base = applyAt(base, at);
  return formatDate(base, format);
}
