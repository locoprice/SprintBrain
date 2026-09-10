import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildDateRangeToken,
  calendarDayDiff,
  nextRangeNames,
  previewRange,
  RANGE_MODE_OPTIONS,
  RANGE_MODES,
  sanitizeRangeText,
  type RangeMode,
} from '@/lib/dateRangeToken';

// The dashboard writes the block with its own copy because it cannot import
// extension source; the shipping engine is what resolves it at expansion time.
// Loading the REAL engine here is the point — a drift between the two states a
// different duration in the editor than the one that reaches the customer.
function loadHelper<T>(path: string): T {
  const src = readFileSync(path, 'utf8');
  const mod = { exports: {} as unknown };
  const run = new Function('module', 'exports', src) as (m: typeof mod, e: unknown) => void;
  run(mod, mod.exports);
  return mod.exports as T;
}

interface FormulaEngine {
  buildDateRangeToken: (cfg: Record<string, unknown>) => string;
  buildFormFieldCfg: (body: string) => Record<string, { type: string; format?: string }>;
  resolveBody: (body: string, vals: Record<string, unknown>) => string;
  validateTemplate: (body: string) => { ok: boolean };
  sbCalendarDayDiff: (a: Date, b: Date) => number;
  sbIsCalendarUnit: (unit: string) => boolean;
  RANGE_MODES: string[];
}

const engine = loadHelper<FormulaEngine>(
  resolve(process.cwd(), '..', 'extension', 'formula-engine.js'),
);

const VALS = { START_1: '2026-09-01', END_1: '2026-09-03' };

describe('dateRangeToken — the two counts stay distinct', () => {
  // The single most damaging way to get this wrong: 1 to 3 September is 2 apart
  // and 3 counting both ends. Swapping them over- or under-states every quote.
  it('counts 1 to 3 September as 2 apart and 3 inclusive', () => {
    const between = buildDateRangeToken({ start: 'START_1', end: 'END_1', mode: 'between' });
    const inclusive = buildDateRangeToken({ start: 'START_1', end: 'END_1', mode: 'inclusive' });
    expect(engine.resolveBody(between, { ...VALS })).toBe('2');
    expect(engine.resolveBody(inclusive, { ...VALS })).toBe('3');
  });

  it('prints both in the order they read', () => {
    const token = buildDateRangeToken({
      start: 'START_1', end: 'END_1', mode: 'both',
      inclusiveLabel: 'days', betweenLabel: 'nights', joiner: 'and',
    });
    expect(engine.resolveBody(token, { ...VALS })).toBe('3 days and 2 nights');
  });

  it('offers exactly the modes the engine knows', () => {
    expect([...RANGE_MODES]).toEqual(engine.RANGE_MODES);
    expect(RANGE_MODE_OPTIONS.map((o) => o.value)).toEqual([...RANGE_MODES]);
  });

  // The sample beside each radio is a promise about what that mode prints. It
  // shows the numbers alone, so it is asserted against a block carrying no
  // labels - which is also what stops shipped copy naming anyone's trade.
  it('labels every mode with the number it actually produces', () => {
    for (const o of RANGE_MODE_OPTIONS) {
      const token = buildDateRangeToken({
        start: 'START_1', end: 'END_1', mode: o.value, joiner: 'and',
      });
      expect(engine.resolveBody(token, { ...VALS })).toBe(o.sample);
    }
  });

  it('ships no trade vocabulary in its own copy', () => {
    const shipped = RANGE_MODE_OPTIONS.map((o) => `${o.label} ${o.sample}`).join(' ');
    for (const word of ['night', 'guest', 'hotel', 'booking', 'stay', 'check-in', 'property']) {
      expect(shipped.toLowerCase()).not.toContain(word);
    }
  });
});

describe('dateRangeToken — the writer agrees with the engine', () => {
  const CASES: Partial<Parameters<typeof buildDateRangeToken>[0]>[] = [
    { start: 'START_1', end: 'END_1', mode: 'between', betweenLabel: 'nights' },
    { start: 'START_1', end: 'END_1', mode: 'inclusive', inclusiveLabel: 'days' },
    { start: 'START_1', end: 'END_1', mode: 'both', inclusiveLabel: 'days', betweenLabel: 'nights', joiner: 'and' },
    { start: 'START_1', end: 'END_1', mode: 'both', joiner: '' },
    { start: 'A', end: 'B', mode: 'both', withFields: true, format: 'DD/MM/YYYY', joiner: 'and' },
    { start: 'A', end: 'B', mode: 'both', withFields: true, withTime: true, format: 'DD/MM/YYYY HH:mm', joiner: 'and' },
    // A name the engine would reject falls back rather than writing a dead field.
    { start: '9bad', end: '', mode: 'both', joiner: 'and' },
    // An unknown mode falls back to both on both sides.
    { start: 'A', end: 'B', mode: 'nonsense' as RangeMode, joiner: 'and' },
    {},
  ];

  it.each(CASES)('writes %j the same as the engine', (cfg) => {
    expect(buildDateRangeToken(cfg)).toBe(engine.buildDateRangeToken(cfg));
  });

  it('never lets a label break the body', () => {
    const token = buildDateRangeToken({
      start: 'START_1', end: 'END_1', mode: 'both',
      inclusiveLabel: 'a{b}c\nd', betweenLabel: '}{', joiner: 'and',
    });
    expect(engine.validateTemplate(token).ok).toBe(true);
    expect(token).toBe(engine.buildDateRangeToken({
      start: 'START_1', end: 'END_1', mode: 'both',
      inclusiveLabel: 'a{b}c\nd', betweenLabel: '}{', joiner: 'and',
    }));
  });

  it('strips only what cannot survive in a body', () => {
    expect(sanitizeRangeText('  nights  ')).toBe('nights');
    expect(sanitizeRangeText('a{b}c')).toBe('a b c');
    expect(sanitizeRangeText('one\ntwo')).toBe('one two');
    // Accents and non-Latin words are exactly what the label box is for.
    expect(sanitizeRangeText('notti')).toBe('notti');
    expect(sanitizeRangeText('días')).toBe('días');
  });
});

describe('dateRangeToken — the pickers it brings', () => {
  it('writes plain dates by default', () => {
    const cfg = engine.buildFormFieldCfg(
      buildDateRangeToken({ start: 'START_1', end: 'END_1', mode: 'both', withFields: true, format: 'DD/MM/YYYY' }),
    );
    expect(cfg.START_1).toMatchObject({ type: 'date', format: 'DD/MM/YYYY' });
    expect(cfg.END_1).toMatchObject({ type: 'date', format: 'DD/MM/YYYY' });
  });

  it('writes datetimes when a time is wanted, and prints them formatted', () => {
    const token = buildDateRangeToken({
      start: 'START_1', end: 'END_1', mode: 'both', withFields: true, withTime: true,
      format: 'DD/MM/YYYY HH:mm', inclusiveLabel: 'days', betweenLabel: 'nights', joiner: 'and',
    });
    const cfg = engine.buildFormFieldCfg(token);
    expect(cfg.START_1).toMatchObject({ type: 'datetime', format: 'DD/MM/YYYY HH:mm' });
    expect(engine.resolveBody(token, { START_1: '2026-09-01T15:00', END_1: '2026-09-03T11:00' }))
      .toBe('01/09/2026 15:00 03/09/2026 11:00 3 days and 2 nights');
  });

  it('writes only the count when reusing existing fields', () => {
    const token = buildDateRangeToken({ start: 'CHECKIN', end: 'CHECKOUT', mode: 'between', betweenLabel: 'nights' });
    expect(token).not.toContain('formdate');
    expect(engine.resolveBody(token, { CHECKIN: '2026-09-01', CHECKOUT: '2026-09-03' })).toBe('2 nights');
  });

  it('hands out a matching pair of free names', () => {
    expect(nextRangeNames('')).toEqual({ start: 'START_1', end: 'END_1' });
    // Both halves move together: a range numbered apart reads as two unrelated
    // fields rather than one span.
    expect(nextRangeNames('{START_1} {END_1}')).toEqual({ start: 'START_2', end: 'END_2' });
    expect(nextRangeNames('{END_1}{START_2}')).toEqual({ start: 'START_3', end: 'END_3' });
  });
});

describe('dateRangeToken — the count the clock cannot move', () => {
  // The reason the block uses `calendar` and not `day`. Every one of these is a
  // fraction, or the wrong whole number, under the old unit.
  const CAL: [string, string, number][] = [
    ['2026-09-01', '2026-09-03', 2],
    ['2026-09-01T15:00', '2026-09-03T11:00', 2],
    ['2026-09-01T23:59', '2026-09-02T00:01', 1],
    // Both European clock changes.
    ['2026-10-24', '2026-10-26', 2],
    ['2027-03-27', '2027-03-29', 2],
    ['2026-12-30', '2027-01-02', 3],
    ['2028-02-27', '2028-03-01', 3],
  ];

  it.each(CAL)('%s to %s is %i apart', (a, b, want) => {
    const token = buildDateRangeToken({ start: 'A', end: 'B', mode: 'between' });
    expect(engine.resolveBody(token, { A: a, B: b })).toBe(String(want));
  });

  it('matches the engine helper exactly', () => {
    for (const [a, b] of CAL) {
      const da = new Date(a);
      const db = new Date(b);
      expect(calendarDayDiff(da, db)).toBe(engine.sbCalendarDayDiff(da, db));
    }
  });

  it('reads every spelling of the unit, and nothing else', () => {
    for (const u of ['calendar', 'Calendar', 'cal', 'calendarday', 'calendardays']) {
      expect(engine.sbIsCalendarUnit(u)).toBe(true);
    }
    for (const u of ['day', 'days', 'hour', '', 'calendarish']) {
      expect(engine.sbIsCalendarUnit(u)).toBe(false);
    }
  });
});

describe('dateRangeToken — the preview matches what expands', () => {
  const start = new Date(2026, 8, 1);
  const end = new Date(2026, 8, 3);

  it.each(RANGE_MODES)('previews %s as the engine resolves it', (mode) => {
    const cfg = {
      start: 'START_1', end: 'END_1', mode,
      inclusiveLabel: 'days', betweenLabel: 'nights', joiner: 'and',
    };
    const token = buildDateRangeToken(cfg);
    expect(previewRange(cfg, start, end)).toBe(engine.resolveBody(token, { ...VALS }));
  });

  it('says nothing rather than guessing when a date is unreadable', () => {
    expect(previewRange({ mode: 'both' }, new Date('nope'), end)).toBe('');
  });

  it('prints the bare number when a label is left blank', () => {
    expect(previewRange({ mode: 'between', betweenLabel: '' }, start, end)).toBe('2');
    expect(previewRange({ mode: 'inclusive', inclusiveLabel: '' }, start, end)).toBe('3');
  });
});
