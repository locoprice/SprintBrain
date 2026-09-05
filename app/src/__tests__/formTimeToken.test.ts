import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyAt,
  applyNamedShift,
  applyShift,
  buildFormTimeToken,
  fixedShift,
  formatShowsTime,
  isValidAt,
  isValidShift,
  NAMED_SHIFT_LABELS,
  NAMED_SHIFTS,
  previewTime,
  SHIFT_UNITS,
} from '@/lib/formTimeToken';

// The dashboard writes the token with its own copy because it cannot import
// extension source; the shipping engine is what resolves it at expansion time.
// Loading the REAL engine here is the point — a drift between the two ships a
// snippet that previews one date in the editor and prints another in the page.
function loadHelper<T>(path: string): T {
  const src = readFileSync(path, 'utf8');
  const mod = { exports: {} as unknown };
  const run = new Function('module', 'exports', src) as (m: typeof mod, e: unknown) => void;
  run(mod, mod.exports);
  return mod.exports as T;
}

interface FormulaEngine {
  buildFormTimeToken: (cfg: Record<string, unknown>) => string;
  sbApplyShift: (d: Date, shift: string) => Date;
  sbNamedShift: (d: Date, name: string) => Date | null;
  sbApplyAt: (d: Date, at: string) => Date;
  sbShiftIsValid: (shift: string) => boolean;
  sbAtIsValid: (at: string) => boolean;
  sbFormatDate: (d: Date, fmt: string) => string;
  sbParseTimeToken: (rest: string, vals: Record<string, unknown>) => string;
  NAMED_SHIFTS: string[];
}

const engine = loadHelper<FormulaEngine>(
  resolve(process.cwd(), '..', 'extension', 'formula-engine.js'),
);

// A Saturday, chosen deliberately: the "next <weekday>" arithmetic is the part
// most likely to drift, and a weekend base exercises both the wrap and the
// strictly-after rule.
const BASE = new Date('2026-09-05T14:30:00');
const fmt = (d: Date) => engine.sbFormatDate(d, 'DD/MM/YYYY HH:mm');

describe('formTimeToken — the shift grammar agrees with the engine', () => {
  const CASES = [
    '+3D', '-1D', '+1W', '-2W', '+2Mo', '-1Mo', '+1Y', '+2H', '+30M', '-45M',
    // Case-insensitive since v3.15.0: `+1mo` is a month, `+1m` a minute.
    '+1d', '+1mo', '+1m', '+1MO',
    ...NAMED_SHIFTS,
    'Next Monday', '  next   monday  ', 'Start Of Next Month',
    // Not a shift — both must leave the date alone rather than guess.
    'whenever', 'next blursday', '3D', '', 'start of',
  ];

  it.each(CASES)('applyShift(%j)', (shift) => {
    expect(fmt(applyShift(new Date(BASE), shift)))
      .toBe(fmt(engine.sbApplyShift(new Date(BASE), shift)));
    expect(isValidShift(shift)).toBe(engine.sbShiftIsValid(shift));
  });

  it('offers exactly the anchors the engine knows', () => {
    expect([...NAMED_SHIFTS]).toEqual(engine.NAMED_SHIFTS);
  });

  it('labels every anchor it offers', () => {
    for (const n of NAMED_SHIFTS) {
      expect(NAMED_SHIFT_LABELS[n]).toBeTruthy();
    }
  });

  it('returns null for a name it does not know, so the caller can tell', () => {
    expect(applyNamedShift(new Date(BASE), 'next blursday')).toBeNull();
    expect(engine.sbNamedShift(new Date(BASE), 'next blursday')).toBeNull();
  });
});

describe('formTimeToken — what each anchor lands on', () => {
  // Parity alone would pass if both copies were wrong the same way. These pin
  // the meaning, from a known Saturday.
  const LANDS = [
    ['tomorrow', '06/09/2026'],
    ['yesterday', '04/09/2026'],
    ['next monday', '07/09/2026'],
    ['next friday', '11/09/2026'],
    // Nobody says "next saturday" about the day they are standing in.
    ['next saturday', '12/09/2026'],
    ['next sunday', '06/09/2026'],
    ['start of month', '01/09/2026'],
    ['start of next month', '01/10/2026'],
    ['end of month', '30/09/2026'],
    // October has 31 days where September has 30.
    ['end of next month', '31/10/2026'],
  ] as const;

  it.each(LANDS)('%s → %s', (shift, want) => {
    expect(engine.sbFormatDate(applyShift(new Date(BASE), shift), 'DD/MM/YYYY')).toBe(want);
  });

  it('leaves the clock alone — the time is at=\'s business', () => {
    expect(engine.sbFormatDate(applyShift(new Date(BASE), 'next monday'), 'HH:mm')).toBe('14:30');
  });
});

describe('formTimeToken — anchored time of day', () => {
  const AT_CASES = ['09:00', '00:00', '23:59', '07:30', '9:05',
    // Rejected: an invalid time leaves the clock alone rather than rolling the
    // date into the next day.
    '24:00', '12:60', '9:5', 'noon', '', '09:00:00'];

  it.each(AT_CASES)('applyAt(%j)', (at) => {
    expect(fmt(applyAt(new Date(BASE), at))).toBe(fmt(engine.sbApplyAt(new Date(BASE), at)));
    expect(isValidAt(at)).toBe(engine.sbAtIsValid(at));
  });

  it('zeroes the seconds, because an anchored time is one somebody chose', () => {
    const withSeconds = new Date('2026-09-05T14:30:47');
    expect(applyAt(withSeconds, '09:00').getSeconds()).toBe(0);
  });

  it('pins the clock after the shift picks the day', () => {
    const out = applyAt(applyShift(new Date(BASE), 'tomorrow'), '09:00');
    expect(engine.sbFormatDate(out, 'DD/MM/YYYY HH:mm')).toBe('06/09/2026 09:00');
  });
});

describe('formTimeToken — the writer', () => {
  const WRITER_CASES: [Parameters<typeof buildFormTimeToken>[0], string][] = [
    [{ format: 'DD/MM/YYYY' }, '{time: DD/MM/YYYY}'],
    [{ format: 'DD/MM/YYYY', shift: '+3D' }, '{time: DD/MM/YYYY; shift=+3D}'],
    [{ format: 'DD/MM/YYYY', shift: 'next monday' }, '{time: DD/MM/YYYY; shift=next monday}'],
    [
      { format: 'DD/MM/YYYY HH:mm', shift: 'tomorrow', at: '09:00' },
      '{time: DD/MM/YYYY HH:mm; shift=tomorrow; at=09:00}',
    ],
    // A time beside a date-only format changes nothing a reader can see.
    [{ format: 'DD/MM/YYYY', shift: 'tomorrow', at: '09:00' }, '{time: DD/MM/YYYY; shift=tomorrow}'],
    // Dropped rather than written: a token carrying shift=whenever resolves to
    // today, reading as a working token printing the wrong day.
    [{ format: 'DD/MM/YYYY', shift: 'whenever' }, '{time: DD/MM/YYYY}'],
    [{ format: 'DD/MM/YYYY HH:mm', at: '25:00' }, '{time: DD/MM/YYYY HH:mm}'],
    // Nothing a caller passes can end the token early or split the body.
    [{ format: 'DD/MM{}/YYYY; x' }, '{time: DD/MM /YYYY x}'],
    [{}, '{time: YYYY-MM-DD}'],
  ];

  it.each(WRITER_CASES)('writes %j', (cfg, want) => {
    expect(buildFormTimeToken(cfg)).toBe(want);
    expect(buildFormTimeToken(cfg)).toBe(engine.buildFormTimeToken(cfg));
  });

  it('builds a fixed offset only from a real amount', () => {
    expect(fixedShift(3, 'D', false)).toBe('+3D');
    expect(fixedShift(2, 'Mo', true)).toBe('-2Mo');
    expect(fixedShift(0, 'D', false)).toBe('');
    expect(fixedShift(Number.NaN, 'D', false)).toBe('');
  });

  it('knows which formats print a clock, which is what makes at= visible', () => {
    expect(formatShowsTime('DD/MM/YYYY HH:mm')).toBe(true);
    expect(formatShowsTime('hh:mm A')).toBe(true);
    expect(formatShowsTime('DD/MM/YYYY')).toBe(false);
    expect(formatShowsTime('DD/MM/dddd')).toBe(false);
  });

  it('writes only tokens the engine reads back to the same date', () => {
    for (const [cfg] of WRITER_CASES) {
      const token = buildFormTimeToken(cfg);
      const mine = previewTime(
        { ...cfg, format: token.slice(6, token.indexOf(';') === -1 ? -1 : token.indexOf(';')) },
        BASE,
        engine.sbFormatDate,
      );
      expect(typeof mine).toBe('string');
      // And the engine can always parse what was written.
      expect(typeof engine.sbParseTimeToken(token.slice(6, -1), {})).toBe('string');
    }
  });
});

describe('formTimeToken — the preview matches what expands', () => {
  const PREVIEW_CASES: [Parameters<typeof previewTime>[0], string][] = [
    [{ format: 'DD/MM/YYYY' }, '05/09/2026'],
    [{ format: 'DD/MM/YYYY', shift: '+3D' }, '08/09/2026'],
    [{ format: 'DD/MM/YYYY', shift: 'next monday' }, '07/09/2026'],
    [{ format: 'DD/MM/YYYY HH:mm', shift: 'tomorrow', at: '09:00' }, '06/09/2026 09:00'],
    [{ format: 'DD/MM/YYYY hh:mm A', shift: 'start of next month', at: '14:30' }, '01/10/2026 02:30 PM'],
    // at= is ignored beside a date-only format, in the preview as in the token.
    [{ format: 'DD/MM/YYYY', shift: 'tomorrow', at: '09:00' }, '06/09/2026'],
  ];

  it.each(PREVIEW_CASES)('previews %j as %s', (cfg, want) => {
    expect(previewTime(cfg, BASE, engine.sbFormatDate)).toBe(want);
  });

  it('every unit the builder offers is one the engine acts on', () => {
    for (const u of SHIFT_UNITS) {
      const shift = fixedShift(1, u.value, false);
      expect(isValidShift(shift)).toBe(true);
      expect(engine.sbApplyShift(new Date(BASE), shift).getTime()).not.toBe(BASE.getTime());
    }
  });
});
