import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildFormDateToken,
  DATE_FORMAT_OPTIONS,
  DATE_FORMATS,
  DEFAULT_DATE_FORMAT,
  DEFAULT_TIME_FORMAT,
  nextDateName,
  normalizeDateFormat,
  sanitizeDateName,
  TIME_FORMAT_OPTIONS,
  TIME_FORMATS,
} from '@/lib/formDateToken';

// Same shape as formNumberField.test.ts: the dashboard writes the token with its
// own writer because it cannot import extension source, and the shipping engine
// is what parses it back at expansion time. Loading the REAL engine here is the
// point — a drift between writer and parser ships a field that looks right in
// the editor and prints the wrong date on the page.
function loadHelper<T>(path: string): T {
  const src = readFileSync(path, 'utf8');
  const mod = { exports: {} as unknown };
  const run = new Function('module', 'exports', src) as (m: typeof mod, e: unknown) => void;
  run(mod, mod.exports);
  return mod.exports as T;
}

interface FieldCfg {
  type: string;
  format?: string;
  default?: string;
}

interface FormulaEngine {
  buildFormFieldCfg: (body: string) => Record<string, FieldCfg>;
  buildFormDateToken: (cfg: Record<string, unknown>) => string;
  nextFieldName: (body: string, prefix: string) => string;
  sbFormatDateValue: (raw: unknown, format: string) => string;
  resolveBody: (body: string, vals: Record<string, unknown>) => string;
  DATE_FORMATS: string[];
  TIME_FORMATS: string[];
}

const engine = loadHelper<FormulaEngine>(
  resolve(process.cwd(), '..', 'extension', 'formula-engine.js'),
);

describe('formDateToken — writer', () => {
  it('leaves the default kind unwritten', () => {
    expect(buildFormDateToken({ name: 'DATE_1', kind: 'date', format: 'DD/MM/YYYY' })).toBe(
      '{formdate: name=DATE_1; format=DD/MM/YYYY}',
    );
  });

  it('spells a time field', () => {
    expect(buildFormDateToken({ name: 'TIME_1', kind: 'time', format: 'hh:mm A' })).toBe(
      '{formdate: name=TIME_1; type=time; format=hh:mm A}',
    );
  });

  it('writes no format when none is chosen, which is the pre-format shape', () => {
    expect(buildFormDateToken({ name: 'D', kind: 'date', format: '' })).toBe('{formdate: name=D}');
  });

  it('drops a format the field does not have rather than passing it on', () => {
    // The engine would ignore it anyway; a token carrying a format nothing reads
    // is a lie about what will print.
    expect(buildFormDateToken({ name: 'D', kind: 'date', format: 'hh:mm A' })).toBe(
      '{formdate: name=D}',
    );
    expect(buildFormDateToken({ name: 'T', kind: 'time', format: 'DD/MM/YYYY' })).toBe(
      '{formdate: name=T; type=time}',
    );
    // Case carries meaning: MM is the month, mm the minute.
    expect(buildFormDateToken({ name: 'D', kind: 'date', format: 'dd/mm/yyyy' })).toBe(
      '{formdate: name=D}',
    );
  });

  it('forces a name the engine will accept', () => {
    expect(sanitizeDateName('9th', 'date')).toBe('DATE_9th');
    expect(sanitizeDateName('when is it', 'time')).toBe('whenisit');
    expect(buildFormDateToken({ name: '1', kind: 'time', format: 'HH:mm' })).toBe(
      '{formdate: name=TIME_1; type=time; format=HH:mm}',
    );
  });

  it('agrees with the engine writer token for token', () => {
    const kinds = ['date', 'time'] as const;
    for (const kind of kinds) {
      const formats = kind === 'time' ? TIME_FORMATS : DATE_FORMATS;
      for (const format of [...formats, '']) {
        const mine = buildFormDateToken({ name: 'F_1', kind, format });
        const theirs = engine.buildFormDateToken({ name: 'F_1', type: kind, format });
        expect(mine).toBe(theirs);
      }
    }
  });
});

describe('formDateToken — round trip through the shipping engine', () => {
  it('parses back to the kind and format it was written with', () => {
    const cfg = engine.buildFormFieldCfg(
      buildFormDateToken({ name: 'DATE_1', kind: 'date', format: 'MM/DD/YYYY' }) +
        buildFormDateToken({ name: 'TIME_1', kind: 'time', format: 'hh:mm A' }),
    );
    expect(cfg.DATE_1).toMatchObject({ type: 'date', format: 'MM/DD/YYYY' });
    expect(cfg.TIME_1).toMatchObject({ type: 'time', format: 'hh:mm A' });
  });

  it('prints each offered format the way its sample says it will', () => {
    for (const o of DATE_FORMAT_OPTIONS) {
      expect(engine.sbFormatDateValue('2026-09-04', o.value)).toBe(o.sample);
    }
    for (const o of TIME_FORMAT_OPTIONS) {
      expect(engine.sbFormatDateValue('14:30', o.value)).toBe(o.sample);
    }
  });

  it('says which half of the day a 12-hour time is in', () => {
    expect(engine.sbFormatDateValue('09:05', 'hh:mm A')).toBe('09:05 AM');
    expect(engine.sbFormatDateValue('00:05', 'hh:mm A')).toBe('12:05 AM');
    expect(engine.sbFormatDateValue('12:00', 'hh:mm A')).toBe('12:00 PM');
    expect(engine.sbFormatDateValue('23:59', 'hh:mm A')).toBe('11:59 PM');
  });

  it('resolves a written token to the formatted value', () => {
    const body = buildFormDateToken({ name: 'DATE_1', kind: 'date', format: 'DD/MM/YYYY' });
    expect(engine.resolveBody(body, { DATE_1: '2026-09-04' })).toBe('04/09/2026');
  });

  it('leaves every date written before the format attribute existed untouched', () => {
    expect(engine.resolveBody('{formdate: name=D}', { D: '2026-09-04' })).toBe('2026-09-04');
    expect(engine.resolveBody('{start_date}', { start_date: '2026-09-04' })).toBe('2026-09-04');
  });

  it('prints nothing for an unanswered field and verbatim for an unreadable one', () => {
    expect(engine.sbFormatDateValue('', 'DD/MM/YYYY')).toBe('');
    expect(engine.sbFormatDateValue('whenever', 'DD/MM/YYYY')).toBe('whenever');
  });
});

describe('formDateToken — names', () => {
  it('hands out the next free name so a range is the same field twice', () => {
    let body = '';
    body += buildFormDateToken({ name: nextDateName(body, 'date'), kind: 'date', format: 'DD/MM/YYYY' });
    expect(body).toContain('name=DATE_1');
    body += buildFormDateToken({ name: nextDateName(body, 'date'), kind: 'date', format: 'DD/MM/YYYY' });
    expect(body).toContain('name=DATE_2');
  });

  it('counts a bare placeholder as the same field', () => {
    // Handing DATE_1 out twice would wire two controls to one value.
    expect(nextDateName('arriving {DATE_1}', 'date')).toBe('DATE_2');
    expect(nextDateName('at {TIME_1} and {TIME_2}', 'time')).toBe('TIME_3');
    expect(nextDateName('', 'time')).toBe('TIME_1');
  });

  it('agrees with the engine name helper', () => {
    for (const body of ['', '{DATE_1}', '{DATE_1}{DATE_3}', 'no fields', '{TIME_2}']) {
      expect(nextDateName(body, 'date')).toBe(engine.nextFieldName(body, 'DATE_'));
      expect(nextDateName(body, 'time')).toBe(engine.nextFieldName(body, 'TIME_'));
    }
  });
});

describe('formDateToken — the choices the builders offer', () => {
  it('mirrors the engine lists exactly', () => {
    expect([...DATE_FORMATS]).toEqual(engine.DATE_FORMATS);
    expect([...TIME_FORMATS]).toEqual(engine.TIME_FORMATS);
  });

  it('labels every format it offers, and offers no format it cannot label', () => {
    expect(DATE_FORMAT_OPTIONS.map((o) => o.value)).toEqual([...DATE_FORMATS]);
    expect(TIME_FORMAT_OPTIONS.map((o) => o.value)).toEqual([...TIME_FORMATS]);
  });

  it('opens on a format that is in its own list', () => {
    expect(normalizeDateFormat('date', DEFAULT_DATE_FORMAT)).toBe(DEFAULT_DATE_FORMAT);
    expect(normalizeDateFormat('time', DEFAULT_TIME_FORMAT)).toBe(DEFAULT_TIME_FORMAT);
  });
});
