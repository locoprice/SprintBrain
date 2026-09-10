import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  SbFieldAdjust,
  SbFillFormViewModel,
  SbDayChoice,
} from '@/lib/fillFormEngine';

// The Adjust panel is drawn from the shared view model on all four fill
// surfaces, and this dashboard reads it through `SbFillField.adjust`. Loading
// the REAL module here is the point: a drift between what fill-form.js offers
// and what the types here promise ships a panel with a control the renderer
// cannot fill, or a missing one nobody notices until a date prints wrong.
//
// scripts/check-fill-form.js asserts the same contract for the vanilla
// surfaces. This file asserts it for the typed one.
type Requirer = (id: string) => unknown;

function loadShared<T>(path: string, req?: Requirer): T {
  const src = readFileSync(path, 'utf8');
  const mod = { exports: {} as unknown };
  const run = new Function('module', 'exports', 'require', src) as (
    m: typeof mod,
    e: unknown,
    r: Requirer,
  ) => void;
  run(mod, mod.exports, req ?? (() => ({})));
  return mod.exports as T;
}

// fill-form.js reaches for the engine as '../formula-engine.js', a path that
// resolves from ITS directory and not from this test's. Handing it the already
// loaded engine keeps both files as the shipping copies rather than stubs.
const ENGINE_PATH = resolve(process.cwd(), '..', 'extension', 'formula-engine.js');
const engine = loadShared<unknown>(ENGINE_PATH);
const requireEngine: Requirer = (id) => {
  if (id === '../formula-engine.js') return engine;
  throw new Error(`fill-form.js asked for an unexpected module: ${id}`);
};

interface FillFormApi {
  fillForm(
    text: string,
    values: Record<string, string>,
    opts: Record<string, unknown>,
  ): SbFillFormViewModel;
  dayValue(type: string, choice: SbDayChoice, current: string, now?: Date): string;
  clockValue(
    type: string,
    hour: string,
    minute: string,
    current: string,
    now?: Date,
  ): string;
}

const ff = loadShared<FillFormApi>(
  resolve(process.cwd(), '..', 'extension', 'shared', 'fill-form.js'),
  requireEngine,
);

// A fixed clock, so "today" is assertable rather than whatever day the suite
// happens to run on. A Sunday, which makes "next monday" the day after.
const NOW = new Date(2026, 7, 30, 9, 15);

const BODY =
  'On {formdate: name=DATE_1; format=DD/MM/YYYY} at {formdate: name=TIME_1; type=time} for {NAME}';

function view(values: Record<string, string> = {}, fieldFmt?: Record<string, string>) {
  return ff.fillForm(BODY, values, { now: NOW, fieldFmt });
}

function adjustOf(index: number): SbFieldAdjust {
  const found = view().fields[index]?.adjust;
  if (!found) throw new Error(`field ${index} carries no Adjust panel`);
  return found;
}

describe('Adjust panel — what each field is offered', () => {
  it('gives one to a date and a time, and none to anything else', () => {
    const fields = view().fields;
    expect(fields.map((f) => f.adjust !== null)).toEqual([true, true, false]);
  });

  it('offers the raw value first, then the closed list for that kind', () => {
    // Dropping the '' entry would leave no way back to "print what the picker
    // holds", which is what an unformatted {formdate:} has always done.
    expect(adjustOf(0).formats.map((f) => f.value)).toEqual([
      '',
      'DD/MM/YYYY',
      'MM/DD/YYYY',
      'DD/MM/dddd',
    ]);
    expect(adjustOf(1).formats.map((f) => f.value)).toEqual(['', 'HH:mm', 'hh:mm A']);
  });

  it('samples every format against the field own value', () => {
    // The two numeric orders are indistinguishable until you see one printed.
    const samples = view({ DATE_1: '2026-08-30' }).fields[0]?.adjust?.formats ?? [];
    expect(samples.map((f) => f.sample)).toEqual([
      '2026-08-30',
      '30/08/2026',
      '08/30/2026',
      '30/08/Sunday',
    ]);
    expect(samples.every((f) => f.label !== '')).toBe(true);
  });

  it('gives a clock no day to jump to, and a calendar no clock to set', () => {
    expect(adjustOf(1).modes).toHaveLength(0);
    expect(adjustOf(1).days).toHaveLength(0);
    expect(adjustOf(0).hours).toHaveLength(0);
  });

  it('offers the builder three day modes, in the builder order', () => {
    expect(adjustOf(0).modes.map((m) => m.value)).toEqual(['none', 'fixed', 'named']);
    expect(adjustOf(0).units.map((u) => u.value)).toEqual(['D', 'W', 'Mo', 'Y']);
  });

  it('opens the clock on the time the field already holds', () => {
    const adjust = view({ TIME_1: '14:37' }).fields[1]?.adjust;
    expect(adjust?.hour).toBe('14');
    expect(adjust?.minute).toBe('37');
    // Stepping in fives but still showing 14:37: snapping to 14:35 would put a
    // time on screen that the field does not hold.
    expect(adjust?.minutes).toContain('37');
    expect(adjust?.minutes).toContain('35');
  });
});

describe('Adjust panel — a day or a clock choice', () => {
  it('lands on the day the operator asked for', () => {
    expect(ff.dayValue('date', { mode: 'none' }, '', NOW)).toBe('2026-08-30');
    expect(ff.dayValue('date', { mode: 'fixed', amount: 3, unit: 'D' }, '', NOW)).toBe(
      '2026-09-02',
    );
    expect(
      ff.dayValue('date', { mode: 'fixed', amount: 2, unit: 'W', back: true }, '', NOW),
    ).toBe('2026-08-16');
    expect(ff.dayValue('date', { mode: 'named', named: 'next monday' }, '', NOW)).toBe(
      '2026-08-31',
    );
  });

  it('counts from today, not from what is already in the picker', () => {
    // Counting from the field would compound every time the amount was nudged.
    expect(
      ff.dayValue('date', { mode: 'fixed', amount: 1, unit: 'D' }, '2026-12-25', NOW),
    ).toBe('2026-08-31');
  });

  it('keeps the time already set when only the day moves', () => {
    expect(
      ff.dayValue('datetime', { mode: 'fixed', amount: 1, unit: 'D' }, '2026-08-30T08:30', NOW),
    ).toBe('2026-08-31T08:30');
  });

  it('answers nothing rather than a wrong value it cannot compute', () => {
    // A zero or negative offset is not a move; writing '' would clear a date
    // the operator had already set.
    expect(ff.dayValue('date', { mode: 'fixed', amount: 0, unit: 'D' }, '', NOW)).toBe(
      '2026-08-30',
    );
    expect(ff.clockValue('date', '09', '05', '', NOW)).toBe('');
  });

  it('sets a clock without disturbing the day beside it', () => {
    expect(ff.clockValue('time', '09', '05', '', NOW)).toBe('09:05');
    expect(ff.clockValue('datetime', '09', '05', '2026-12-25T00:00', NOW)).toBe(
      '2026-12-25T09:05',
    );
  });
});

describe('Adjust panel — a format picked while filling', () => {
  const VALUES = { DATE_1: '2026-08-30' };

  it('prints the author format until somebody chooses another', () => {
    expect(view(VALUES).preview).toBe('On 30/08/2026 at 09:15 for ');
  });

  it('reaches the preview, and the map an insert resolves through', () => {
    const vm = view(VALUES, { DATE_1: 'MM/DD/YYYY' });
    expect(vm.preview).toBe('On 08/30/2026 at 09:15 for ');
    expect(vm.fmtOverride.DATE_1).toBe('MM/DD/YYYY');
  });

  it('never rewrites the value, because formatting is output only', () => {
    // A formula and datetimediff() still read the raw date.
    expect(view(VALUES, { DATE_1: 'MM/DD/YYYY' }).fields[0]?.value).toBe('2026-08-30');
  });

  it('falls back to the picker own value when the raw choice is taken', () => {
    expect(view(VALUES, { DATE_1: '' }).preview).toBe('On 2026-08-30 at 09:15 for ');
  });

  it('ignores a format from the wrong list instead of dropping the author', () => {
    expect(view(VALUES, { DATE_1: 'hh:mm A' }).preview).toBe('On 30/08/2026 at 09:15 for ');
  });
});
