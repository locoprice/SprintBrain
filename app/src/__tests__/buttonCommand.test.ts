import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateTemplate } from '@/lib/statusSignals';

// Loads the REAL shipping engine (extension/formula-engine.js) so these cases
// pin the code the extension actually runs, not a copy. Same pattern as
// formulaConditions.test.ts.
function loadHelper<T>(path: string): T {
  const src = readFileSync(path, 'utf8');
  const mod = { exports: {} as unknown };
  const run = new Function('module', 'exports', src) as (m: typeof mod, e: unknown) => void;
  run(mod, mod.exports);
  return mod.exports as T;
}

interface ButtonSpec {
  id: string;
  label: string;
  trim: string;
  code: string;
  statements: { name: string; expr: string }[];
  errors: string[];
}

interface FormulaEngine {
  extractButtons: (body: string) => ButtonSpec[];
  parseButtonCode: (code: string) => { statements: { name: string; expr: string }[]; errors: string[] };
  applyButtonCode: (
    statements: { name: string; expr: string }[],
    vals: Record<string, unknown>,
  ) => { values: Record<string, number>; errors: string[] };
  resolveBody: (body: string, vals: Record<string, unknown>) => string;
  extractFields: (body: string) => string[];
  validateTemplate: (body: string | null | undefined) => { ok: boolean; code: string | null; message: string };
}

const engine = loadHelper<FormulaEngine>(
  resolve(process.cwd(), '..', 'extension', 'formula-engine.js'),
);

const DISCOUNT = 'Price: {PRICE}\n{button label="10% off" trim=left}PRICE = PRICE * 0.9{/button}\nThanks.';

/** First button in a body, asserted present so the cases read without guards. */
function firstButton(body: string): ButtonSpec {
  const [btn] = engine.extractButtons(body);
  if (!btn) throw new Error(`no button parsed from: ${body}`);
  return btn;
}

describe('{button} — parsing', () => {
  it('reads the label, trim and code block', () => {
    const btn = firstButton(DISCOUNT);
    expect(btn).toMatchObject({
      id: 'btn0',
      label: '10% off',
      trim: 'left',
      code: 'PRICE = PRICE * 0.9',
      statements: [{ name: 'PRICE', expr: 'PRICE * 0.9' }],
      errors: [],
    });
  });

  it('accepts quoted labels with spaces and unquoted single-word settings', () => {
    const btn = firstButton('{button label="Apply city tax" trim=yes}T = 2{/button}');
    expect(btn.label).toBe('Apply city tax');
    expect(btn.trim).toBe('yes');
  });

  it('defaults a nameless button to Run and an unknown trim to no', () => {
    const btn = firstButton('{button trim=sideways}A = 1{/button}');
    expect(btn.label).toBe('Run');
    expect(btn.trim).toBe('no');
  });

  it('numbers several buttons in document order', () => {
    const buttons = engine.extractButtons(
      '{button label="A"}X = 1{/button} {button label="B"}X = 2{/button}',
    );
    expect(buttons.map((b) => [b.id, b.label])).toEqual([
      ['btn0', 'A'],
      ['btn1', 'B'],
    ]);
  });

  it('splits statements on newlines and semicolons', () => {
    const parsed = engine.parseButtonCode('A = 1; B = 2\nC = 3');
    expect(parsed.statements).toEqual([
      { name: 'A', expr: '1' },
      { name: 'B', expr: '2' },
      { name: 'C', expr: '3' },
    ]);
    expect(parsed.errors).toEqual([]);
  });

  it('reports an unreadable line instead of dropping it', () => {
    const parsed = engine.parseButtonCode('A = 1\njust some prose\nB =');
    expect(parsed.statements).toEqual([{ name: 'A', expr: '1' }]);
    expect(parsed.errors).toHaveLength(2);
  });

  it('is not confused by a field whose name merely starts with button', () => {
    expect(engine.extractButtons('{buttonish}')).toEqual([]);
    expect(engine.extractFields('{buttonish}')).toEqual(['buttonish']);
  });
});

describe('{button} — execution', () => {
  it('assigns the evaluated expression to the field', () => {
    const btn = firstButton(DISCOUNT);
    expect(engine.applyButtonCode(btn.statements, { PRICE: 200 })).toEqual({
      values: { PRICE: 180 },
      errors: [],
    });
  });

  it('applies statements in order, so a later line sees an earlier result', () => {
    const btn = firstButton('{button label="x"}A = 10; B = A * 2{/button}');
    expect(engine.applyButtonCode(btn.statements, { A: 0, B: 0 }).values).toEqual({ A: 10, B: 20 });
  });

  it('reports an expression it cannot work out and still applies the rest', () => {
    const btn = firstButton('{button label="x"}A = 5\nB = nope(1){/button}');
    const res = engine.applyButtonCode(btn.statements, { A: 0, B: 0 });
    expect(res.values).toEqual({ A: 5 });
    expect(res.errors).toEqual(['Could not work out "nope(1)"']);
  });

  // The security property that matters: a code block can only ever produce
  // numbers. Host identifiers are not reachable — they resolve to 0 like any
  // other unknown variable, or fail outright. Nothing callable escapes.
  it.each(['constructor', 'globalThis', 'process', 'this', '__proto__', 'Math', 'window'])(
    'never lets %s through as anything but a number',
    (identifier) => {
      const btn = firstButton(`{button label="x"}A = ${identifier}{/button}`);
      const res = engine.applyButtonCode(btn.statements, { A: 0 });
      if ('A' in res.values) {
        expect(typeof res.values.A).toBe('number');
        expect(res.values.A).toBe(0);
      } else {
        expect(res.errors).toHaveLength(1);
      }
    },
  );
});

describe('{button} — output', () => {
  it('contributes nothing to the resolved text', () => {
    expect(engine.resolveBody(DISCOUNT, { PRICE: 200 })).toBe('Price: 200\nThanks.');
  });

  it('is not surfaced as a fill-in field', () => {
    expect(engine.extractFields(DISCOUNT)).toEqual(['PRICE']);
  });

  const trimCase = (trim: string) => `A\n{button label="x" trim=${trim}}P = 1{/button}\nB`;

  it('honours every trim setting', () => {
    expect(engine.resolveBody(trimCase('no'), {})).toBe('A\n\nB');
    expect(engine.resolveBody(trimCase('left'), {})).toBe('A\nB');
    expect(engine.resolveBody(trimCase('right'), {})).toBe('A\nB');
    expect(engine.resolveBody(trimCase('yes'), {})).toBe('AB');
  });

  it('drops only the head when the closer is missing, keeping the rest readable', () => {
    expect(engine.resolveBody('Hi {button label="x"}P = 1', {})).toBe('Hi P = 1');
  });
});

describe('{button} — template validation parity', () => {
  const cases: [string, string | null][] = [
    ['{button label="x"}P = 1{/button}', null],
    ['a{if: A}x{endif}{button label="b"}P = 1{/button}z', null],
    ['{button label="x"}P = 1', 'unclosed-button'],
    ['stray {/button} closer', 'orphan-branch'],
    ['{if: A}x', 'unclosed-if'],
  ];

  it.each(cases)('engine and dashboard agree on %j', (body, code) => {
    expect(engine.validateTemplate(body).code).toBe(code);
    expect(validateTemplate(body).code).toBe(code);
  });
});
