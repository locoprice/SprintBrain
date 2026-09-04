import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildFormNumberToken,
  CURRENCIES,
  CURRENCY_CODES,
  DEFAULT_CURRENCY,
  isValidNumberDefault,
  nextNumberName,
  sanitizeNumberName,
  type CurrencyCode,
  type NumberFormat,
} from '@/lib/formNumberToken';

// Same shape as formTextField.test.ts: the dashboard writes the token with its
// own writer because it cannot import extension source, and the shipping engine
// is what parses it back at expansion time. Loading the REAL engine here is the
// point — a drift between writer and parser ships a field that looks right in
// the editor and resolves to nothing on the page.
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
  currency?: string;
  default?: string;
}

interface FormulaEngine {
  buildFormFieldCfg: (body: string) => Record<string, FieldCfg>;
  extractFields: (body: string) => string[];
  evalFormula: (expr: string, vals: Record<string, unknown>) => number | null;
  sbToNumber: (raw: unknown) => number | null;
  sbFormatNumber: (raw: unknown, format: string, currency?: string) => string;
  buildFormNumberToken: (cfg: Record<string, unknown>) => string;
  nextNumberName: (body: string) => string;
  resolveBody: (body: string, vals: Record<string, unknown>) => string;
  CURRENCIES: Record<string, { symbol: string; group: string; decimals: number }>;
}

const engine = loadHelper<FormulaEngine>(
  resolve(process.cwd(), '..', 'extension', 'formula-engine.js'),
);

describe('formNumberToken — writer', () => {
  it('writes a plain number without spelling the default format', () => {
    expect(buildFormNumberToken({ name: 'NUM_1', format: 'plain', currency: 'EUR', default: '' })).toBe(
      '{formtext: name=NUM_1; type=number}',
    );
  });

  it('spells currency and percent', () => {
    expect(buildFormNumberToken({ name: 'TOTAL', format: 'currency', currency: 'EUR', default: '' })).toBe(
      '{formtext: name=TOTAL; type=number; format=currency}',
    );
    expect(buildFormNumberToken({ name: 'VAT', format: 'percent', currency: 'EUR', default: '' })).toBe(
      '{formtext: name=VAT; type=number; format=percent}',
    );
  });

  it('carries a default when one is given', () => {
    expect(buildFormNumberToken({ name: 'QTY', format: 'plain', currency: 'EUR', default: '1' })).toBe(
      '{formtext: name=QTY; type=number; default=1}',
    );
  });

  it('cannot emit a token that breaks the body', () => {
    const token = buildFormNumberToken({ name: 'A;B{C}', format: 'plain', currency: 'EUR', default: '1;2' });
    expect(token).toBe('{formtext: name=ABC; type=number; default=12}');
    // One opening brace, one closing: the token cannot have split the body.
    expect(token.match(/[{]/g)).toHaveLength(1);
    expect(token.match(/[}]/g)).toHaveLength(1);
  });

  it('repairs a name the engine would reject', () => {
    expect(sanitizeNumberName('9lives')).toBe('NUM_9lives');
    expect(sanitizeNumberName('total price')).toBe('totalprice');
  });
});

describe('formNumberToken — round trip through the real engine', () => {
  const cases: { format: NumberFormat; def: string; wantDefault: string }[] = [
    { format: 'plain', def: '', wantDefault: '' },
    { format: 'currency', def: '', wantDefault: '' },
    { format: 'percent', def: '', wantDefault: '' },
    { format: 'currency', def: '1200.5', wantDefault: '1200.5' },
    // The separators an operator actually types must survive into the config,
    // or the default arrives blank in an <input type="number">.
    { format: 'currency', def: '1.200,50', wantDefault: '1200.5' },
    { format: 'currency', def: '1,200.50', wantDefault: '1200.5' },
    { format: 'plain', def: '-40', wantDefault: '-40' },
    // Zero is an answer, and must not be confused with "no default".
    { format: 'plain', def: '0', wantDefault: '0' },
  ];

  for (const c of cases) {
    it(`${c.format} with default ${JSON.stringify(c.def)} parses back identically`, () => {
      const token = buildFormNumberToken({ name: 'N', format: c.format, currency: 'EUR', default: c.def });
      const cfg = engine.buildFormFieldCfg(token);
      expect(cfg.N).toBeDefined();
      expect(cfg.N?.type).toBe('number');
      expect(cfg.N?.format).toBe(c.format);
      expect(cfg.N?.default).toBe(c.wantDefault);
    });
  }

  it('is a field the engine will render', () => {
    const token = buildFormNumberToken({ name: 'TOTAL', format: 'currency', currency: 'EUR', default: '' });
    expect(engine.extractFields(token)).toEqual(['TOTAL']);
  });

  it('an unnamed number field is dropped, which is why the dialog requires a name', () => {
    expect(engine.buildFormFieldCfg('{formtext: type=number}')).toEqual({});
  });
});

describe('number field — engine-side rules the writer depends on', () => {
  it('an unknown format falls back to plain rather than reaching a renderer', () => {
    const cfg = engine.buildFormFieldCfg('{formtext: name=N; type=number; format=dollars}');
    expect(cfg.N?.format).toBe('plain');
  });

  it('an unknown type stays text, so a typo cannot silently change the control', () => {
    const cfg = engine.buildFormFieldCfg('{formtext: name=N; type=numbr}');
    expect(cfg.N?.type).toBe('text');
  });

  it('a text field is untouched by any of this', () => {
    expect(engine.buildFormFieldCfg('{formtext: name=N; default=Ada}')).toEqual({
      N: { type: 'text', default: 'Ada' },
    });
  });

  it('reads a typed value the way an operator wrote it', () => {
    expect(engine.sbToNumber('1.200,50')).toBe(1200.5);
    expect(engine.sbToNumber('1,200.50')).toBe(1200.5);
    expect(engine.sbToNumber('1200.5')).toBe(1200.5);
    expect(engine.sbToNumber('1.200.000')).toBe(1200000);
    expect(engine.sbToNumber('-40')).toBe(-40);
  });

  it('tells an unanswered field from one that is not a number', () => {
    // Empty contributes nothing to a sum; text is a mistake worth surfacing.
    expect(engine.sbToNumber('')).toBe(0);
    expect(engine.sbToNumber('€1.200')).toBeNull();
    expect(engine.sbToNumber('abc')).toBeNull();
  });

  it('unreadable input no longer resolves to a plausible wrong total', () => {
    // The defect this closes: {=TOTAL * 2} on "€1.200" used to be 0, with no
    // error anywhere — a wrong number reaching a customer looking like a right
    // one. It now refuses to answer instead.
    expect(engine.evalFormula('TOTAL * 2', { TOTAL: '€1.200' })).toBeNull();
    expect(engine.evalFormula('TOTAL * 2', { TOTAL: '1.200,50' })).toBe(2401);
    expect(engine.evalFormula('TOTAL * 2', { TOTAL: '' })).toBe(0);
  });
});

describe('formNumberToken — naming', () => {
  it('hands out the first free NUM_n', () => {
    expect(nextNumberName('')).toBe('NUM_1');
    expect(nextNumberName('{formtext: name=NUM_1; type=number}')).toBe('NUM_2');
  });

  it('counts a bare placeholder too, so two controls cannot share one value', () => {
    expect(nextNumberName('Total: {NUM_1} and {NUM_2}')).toBe('NUM_3');
  });

  it('accepts the separators an operator types, and rejects text', () => {
    expect(isValidNumberDefault('')).toBe(true);
    expect(isValidNumberDefault('1.200,50')).toBe(true);
    expect(isValidNumberDefault('-40')).toBe(true);
    expect(isValidNumberDefault('€1200')).toBe(false);
    expect(isValidNumberDefault('abc')).toBe(false);
    expect(isValidNumberDefault('.')).toBe(false);
  });
});

describe('currency', () => {
  it('leaves the default currency out of the token, since the engine falls back to it', () => {
    expect(
      buildFormNumberToken({ name: 'T', format: 'currency', currency: DEFAULT_CURRENCY, default: '' }),
    ).toBe('{formtext: name=T; type=number; format=currency}');
  });

  it('spells any other currency', () => {
    expect(
      buildFormNumberToken({ name: 'T', format: 'currency', currency: 'USD', default: '' }),
    ).toBe('{formtext: name=T; type=number; format=currency; currency=USD}');
  });

  it('never writes a currency onto a field that has no use for one', () => {
    for (const format of ['plain', 'percent'] as NumberFormat[]) {
      const token = buildFormNumberToken({ name: 'T', format, currency: 'USD', default: '' });
      expect(token).not.toContain('currency=');
    }
  });

  it('every code the dialog offers round-trips through the engine', () => {
    for (const code of CURRENCY_CODES) {
      const token = buildFormNumberToken({ name: 'T', format: 'currency', currency: code, default: '' });
      expect(engine.buildFormFieldCfg(token).T?.currency).toBe(code);
    }
  });

  // The dialog shows the author a symbol; the engine prints it. Two lists that
  // disagree would preview one currency and expand another.
  it('the dialog and the engine agree on every symbol', () => {
    expect(CURRENCY_CODES.slice().sort()).toEqual(Object.keys(engine.CURRENCIES).sort());
    for (const code of CURRENCY_CODES) {
      expect(CURRENCIES[code].symbol).toBe(engine.CURRENCIES[code]?.symbol);
    }
  });

  it('an unknown code falls back rather than printing a code nobody chose', () => {
    const cfg = engine.buildFormFieldCfg('{formtext: name=T; type=number; format=currency; currency=XYZ}');
    expect(cfg.T?.currency).toBe(DEFAULT_CURRENCY);
  });
});

describe('number formatting — output only', () => {
  const money = (c: CurrencyCode) =>
    `Total: {formtext: name=T; type=number; format=currency; currency=${c}}`;

  it('prints the symbol, and groups the way that currency is written', () => {
    expect(engine.resolveBody(money('EUR'), { T: '1200.5' })).toBe('Total: €1.200,50');
    expect(engine.resolveBody(money('USD'), { T: '1200.5' })).toBe('Total: $1,200.50');
    expect(engine.resolveBody(money('GBP'), { T: '1200.5' })).toBe('Total: £1,200.50');
  });

  it('reads what the operator typed, whichever separator they used', () => {
    expect(engine.resolveBody(money('EUR'), { T: '1.200,50' })).toBe('Total: €1.200,50');
    expect(engine.resolveBody(money('EUR'), { T: '1,200.50' })).toBe('Total: €1.200,50');
  });

  it('drops the minor unit for a currency that has none', () => {
    expect(engine.resolveBody(money('JPY'), { T: '1200' })).toBe('Total: ¥1,200');
  });

  it('adds the percent sign without inventing decimals', () => {
    const pct = 'VAT: {formtext: name=V; type=number; format=percent}';
    expect(engine.resolveBody(pct, { V: '15' })).toBe('VAT: 15%');
    expect(engine.resolveBody(pct, { V: '15.5' })).toBe('VAT: 15.5%');
  });

  it('leaves a plain number exactly as typed', () => {
    expect(engine.resolveBody('Qty: {formtext: name=Q; type=number}', { Q: '1200.5' })).toBe(
      'Qty: 1200.5',
    );
  });

  it('prints nothing for an unanswered field, rather than a price of zero', () => {
    expect(engine.resolveBody(money('EUR'), { T: '' })).toBe('Total: ');
  });

  it('prints unreadable input back rather than a formatted zero', () => {
    expect(engine.resolveBody(money('EUR'), { T: 'about 300' })).toBe('Total: about 300');
  });

  it('formats a bare reference the same as its declaration', () => {
    const body = `${money('USD')} again {T}`;
    expect(engine.resolveBody(body, { T: '99' })).toBe('Total: $99.00 again $99.00');
  });

  it('formats inside an {if:} branch, where the field is declared outside it', () => {
    const body = `${money('EUR')}{if: T > 0} due {T}{endif}`;
    expect(engine.resolveBody(body, { T: '50' })).toBe('Total: €50,00 due €50,00');
  });

  it('never lets formatting reach a formula', () => {
    // The whole reason formatting is output-only: a formula reading "€1.200,50"
    // instead of 1200.5 would break every calculation touching a money field.
    expect(engine.evalFormula('T * 0.3', { T: '1.200,50' })).toBe(360.15);
    expect(engine.sbFormatNumber('1200.5', 'currency', 'EUR')).toBe('€1.200,50');
  });

  it('a phone number is why Number is the wrong type for one', () => {
    // Not a bug in the formatter, a reason to reach for Text: the leading zero
    // is gone the moment the value is read as a number.
    expect(engine.sbToNumber('0612345678')).toBe(612345678);
    expect(engine.sbToNumber('+39-333-1234567')).toBeNull();
  });
});

describe('two writers, one token', () => {
  // Sprintbrain.html builds number fields too, and cannot import the dashboard's
  // TypeScript writer, so the engine carries its own — the same arrangement
  // {formmenu:} and {button} already have. These cases exist so the two cannot
  // drift into emitting different tokens for the same choices, which would mean
  // one surface writing a field the other could not reproduce.
  const CASES: { name: string; format: NumberFormat; currency: CurrencyCode; default: string }[] = [
    { name: 'NUM_1', format: 'plain', currency: 'EUR', default: '' },
    { name: 'TOTAL', format: 'currency', currency: 'EUR', default: '' },
    { name: 'TOTAL', format: 'currency', currency: 'USD', default: '1200.5' },
    { name: 'TOTAL', format: 'currency', currency: 'JPY', default: '1.200,50' },
    { name: 'VAT', format: 'percent', currency: 'USD', default: '15' },
    { name: 'N', format: 'plain', currency: 'EUR', default: '-40' },
    { name: 'N', format: 'plain', currency: 'EUR', default: '0' },
  ];

  for (const c of CASES) {
    it(`${c.format}/${c.currency}/${JSON.stringify(c.default)} is written identically`, () => {
      expect(engine.buildFormNumberToken(c)).toBe(buildFormNumberToken(c));
    });
  }

  it('repairs an unusable name the same way on both sides', () => {
    const cfg = { name: '9lives', format: 'plain' as NumberFormat, currency: 'EUR' as CurrencyCode, default: '' };
    expect(engine.buildFormNumberToken(cfg)).toBe(buildFormNumberToken(cfg));
  });

  it('hands out the same next free name on both sides', () => {
    for (const body of ['', '{NUM_1}', '{formtext: name=NUM_1; type=number} {NUM_3}']) {
      expect(engine.nextNumberName(body)).toBe(nextNumberName(body));
    }
  });
});
