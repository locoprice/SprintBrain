import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildFormNumberToken,
  isValidNumberDefault,
  nextNumberName,
  sanitizeNumberName,
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
  default?: string;
}

interface FormulaEngine {
  buildFormFieldCfg: (body: string) => Record<string, FieldCfg>;
  extractFields: (body: string) => string[];
  evalFormula: (expr: string, vals: Record<string, unknown>) => number | null;
  sbToNumber: (raw: unknown) => number | null;
}

const engine = loadHelper<FormulaEngine>(
  resolve(process.cwd(), '..', 'extension', 'formula-engine.js'),
);

describe('formNumberToken — writer', () => {
  it('writes a plain number without spelling the default format', () => {
    expect(buildFormNumberToken({ name: 'NUM_1', format: 'plain', default: '' })).toBe(
      '{formtext: name=NUM_1; type=number}',
    );
  });

  it('spells currency and percent', () => {
    expect(buildFormNumberToken({ name: 'TOTAL', format: 'currency', default: '' })).toBe(
      '{formtext: name=TOTAL; type=number; format=currency}',
    );
    expect(buildFormNumberToken({ name: 'VAT', format: 'percent', default: '' })).toBe(
      '{formtext: name=VAT; type=number; format=percent}',
    );
  });

  it('carries a default when one is given', () => {
    expect(buildFormNumberToken({ name: 'QTY', format: 'plain', default: '1' })).toBe(
      '{formtext: name=QTY; type=number; default=1}',
    );
  });

  it('cannot emit a token that breaks the body', () => {
    const token = buildFormNumberToken({ name: 'A;B{C}', format: 'plain', default: '1;2' });
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
      const token = buildFormNumberToken({ name: 'N', format: c.format, default: c.def });
      const cfg = engine.buildFormFieldCfg(token);
      expect(cfg.N).toBeDefined();
      expect(cfg.N?.type).toBe('number');
      expect(cfg.N?.format).toBe(c.format);
      expect(cfg.N?.default).toBe(c.wantDefault);
    });
  }

  it('is a field the engine will render', () => {
    const token = buildFormNumberToken({ name: 'TOTAL', format: 'currency', default: '' });
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
