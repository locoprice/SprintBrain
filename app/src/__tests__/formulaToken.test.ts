import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildFormNumberToken } from '@/lib/formNumberToken';
import {
  buildFormulaToken,
  buildPriceAdjustToken,
  describeFormula,
  FORMULA_OPERATIONS,
  formulasInBody,
  isValidFormula,
  isValidPriceAdjust,
  MAX_OPERANDS,
  nextNumberNames,
  PRICE_ADJUSTMENTS,
  freeName,
  insideCondition,
  priceFieldNames,
  ratesInBody,
  type FormulaDecimals,
  type FormulaOperation,
  type PriceAdjustConfig,
} from '@/lib/formulaToken';

// The dashboard writes the block and the shipping engine resolves it, so the
// round trip runs against the REAL engine: a formula that looks right in the
// editor and prints 0 on the page is exactly the defect this builder replaces.
function loadHelper<T>(path: string): T {
  const src = readFileSync(path, 'utf8');
  const mod = { exports: {} as unknown };
  const run = new Function('module', 'exports', src) as (m: typeof mod, e: unknown) => void;
  run(mod, mod.exports);
  return mod.exports as T;
}

interface FormulaEngine {
  extractFields: (body: string) => string[];
  buildFormFieldCfg: (body: string) => Record<string, { type: string }>;
  resolveBody: (body: string, vals: Record<string, unknown>) => string;
  validateTemplate: (body: string) => { ok: boolean };
}

const engine = loadHelper<FormulaEngine>(
  resolve(process.cwd(), '..', 'extension', 'formula-engine.js'),
);

/** Builds the block for `values.length` numbers and expands it with them. */
function run(operation: FormulaOperation, values: string[], decimals: FormulaDecimals = 2): string {
  const names = nextNumberNames('', values.length);
  const body = buildFormulaToken({ operation, names, decimals });
  const vals: Record<string, string> = {};
  names.forEach((n, i) => { vals[n] = values[i] ?? ''; });
  return engine.resolveBody(body, vals);
}

describe('formulaToken: writer', () => {
  it('writes the number fields and the answer in one block', () => {
    expect(buildFormulaToken({ operation: 'subtract', names: ['NUM_1', 'NUM_2'], decimals: 2 })).toBe(
      '{formtext: name=NUM_1; type=number} - {formtext: name=NUM_2; type=number} = {=NUM_1 - NUM_2}',
    );
  });

  it('wraps the answer in round() only when fewer than two decimals are asked for', () => {
    // Only the one-argument round(), which every released extension reads:
    // an extension older than v3.48.0 drops round()'s second argument.
    expect(buildFormulaToken({ operation: 'divide', names: ['A', 'B'], decimals: 0 })).toBe(
      '{formtext: name=A; type=number} / {formtext: name=B; type=number} = {=round(A / B)}',
    );
    expect(buildFormulaToken({ operation: 'divide', names: ['A', 'B'], decimals: 1 })).toBe(
      '{formtext: name=A; type=number} / {formtext: name=B; type=number} = {=round((A / B) * 10) / 10}',
    );
  });

  it('writes only what every released extension reads: no avg(), no two-argument round()', () => {
    // The dashboard deploys at once; each extension updates later. Anything a
    // pre-v3.48.0 extension cannot read prints blank or wrong until it does.
    const written: string[] = [];
    for (const op of FORMULA_OPERATIONS) {
      for (const decimals of [0, 1, 2] as FormulaDecimals[]) {
        written.push(buildFormulaToken({ operation: op.id, names: nextNumberNames('', op.minOperands + 1 > op.maxOperands ? op.minOperands : op.minOperands + 1), decimals }));
      }
    }
    for (const adjustment of ['minusPercent', 'plusPercent', 'percentOf', 'minusPrice', 'savingPercent'] as const) {
      for (const decimals of [0, 1, 2] as FormulaDecimals[]) {
        written.push(buildPriceAdjustToken({
          adjustment, price: 'P', other: 'Q', percentSource: 'typed', percent: '1.5', rate: '', newRate: 'R', decimals,
        }));
      }
    }
    for (const token of written) {
      expect(token).not.toMatch(/avg\(/);
      expect(token).not.toMatch(/round\([^()]*(\([^()]*\)[^()]*)*,/);
    }
  });

  it('hands out names the body does not use yet', () => {
    expect(nextNumberNames('', 3)).toEqual(['NUM_1', 'NUM_2', 'NUM_3']);
    expect(nextNumberNames('{formtext: name=NUM_1; type=number} {NUM_3}', 2)).toEqual(['NUM_2', 'NUM_4']);
  });

  it('refuses too few or too many numbers, bad names and repeats', () => {
    expect(isValidFormula({ operation: 'add', names: ['A', 'B'], decimals: 2 })).toBe(true);
    expect(isValidFormula({ operation: 'add', names: ['A'], decimals: 2 })).toBe(false);
    expect(isValidFormula({ operation: 'add', names: nextNumberNames('', MAX_OPERANDS + 1), decimals: 2 })).toBe(false);
    expect(isValidFormula({ operation: 'percentOf', names: ['A', 'B', 'C'], decimals: 2 })).toBe(false);
    expect(isValidFormula({ operation: 'add', names: ['A', '1B'], decimals: 2 })).toBe(false);
    expect(isValidFormula({ operation: 'add', names: ['A', ''], decimals: 2 })).toBe(false);
    expect(isValidFormula({ operation: 'add', names: ['PRICE', 'price'], decimals: 2 })).toBe(false);
  });
});

describe('formulaToken: every operation against the engine', () => {
  it.each(FORMULA_OPERATIONS.map((op) => [op.id]))(
    '%s asks for each number as a number field and writes a sound template',
    (id) => {
      const spec = FORMULA_OPERATIONS.find((op) => op.id === id)!;
      const names = nextNumberNames('', spec.minOperands);
      const body = buildFormulaToken({ operation: spec.id, names, decimals: 2 });
      expect(engine.extractFields(body)).toEqual(names);
      const cfg = engine.buildFormFieldCfg(body);
      expect(names.map((n) => cfg[n]?.type)).toEqual(names.map(() => 'number'));
      expect(engine.validateTemplate(body).ok).toBe(true);
    },
  );

  it('prints each sample exactly as the dialog promises', () => {
    const inputs: Record<FormulaOperation, string[]> = {
      add: ['100', '25', '5'],
      subtract: ['100', '25', '5'],
      multiply: ['4', '2.5'],
      divide: ['100', '4'],
      average: ['100', '25', '5'],
      percentOf: ['200', '15'],
      percentChange: ['100', '80'],
    };
    for (const spec of FORMULA_OPERATIONS) {
      expect(run(spec.id, inputs[spec.id])).toBe(spec.sample);
    }
  });

  it('adds and subtracts two and three numbers', () => {
    expect(run('add', ['5', '10'])).toBe('5 + 10 = 15');
    expect(run('add', ['5', '10', '15'])).toBe('5 + 10 + 15 = 30');
    expect(run('subtract', ['100', '25'])).toBe('100 - 25 = 75');
    expect(run('subtract', ['10', '25', '5'])).toBe('10 - 25 - 5 = -20');
  });

  it('multiplies and divides, left to right', () => {
    expect(run('multiply', ['2', '3', '4'])).toBe('2 × 3 × 4 = 24');
    expect(run('divide', ['100', '4', '5'])).toBe('100 / 4 / 5 = 5');
    expect(run('divide', ['10', '3'])).toBe('10 / 3 = 3.33');
  });

  it('prints no answer rather than a wrong one when dividing by 0', () => {
    expect(run('divide', ['100', '0'])).toBe('100 / 0 = ');
    expect(run('percentChange', ['0', '80'])).toBe('0 → 80 = ');
    expect(run('percentChange', ['', '80'])).toBe(' → 80 = ');
  });

  it('averages, counting an empty box as 0', () => {
    expect(run('average', ['2', '4'])).toBe('(2 + 4) / 2 = 3');
    expect(run('average', ['6', ''])).toBe('(6 + ) / 2 = 3');
  });

  it('works out percentages both ways', () => {
    expect(run('percentOf', ['80', '12.5'])).toBe('80 × 12.5% = 10');
    expect(run('percentChange', ['80', '100'])).toBe('80 → 100 = 25%');
  });

  it('rounds the answer to the decimals asked for', () => {
    expect(run('divide', ['10', '3'], 0)).toBe('10 / 3 = 3');
    expect(run('divide', ['10', '3'], 1)).toBe('10 / 3 = 3.3');
    expect(run('average', ['1', '2.26'], 1)).toBe('(1 + 2.26) / 2 = 1.6');
  });

  it('handles decimals in either separator without float noise', () => {
    expect(run('subtract', ['0.3', '0.1'])).toBe('0.3 - 0.1 = 0.2');
    expect(run('add', ['1,5', '2.25'])).toBe('1,5 + 2.25 = 3.75');
  });

  it('prints no answer when a value is not a number', () => {
    expect(run('add', ['5', 'abc'])).toBe('5 + abc = ');
  });
});

describe('formulaToken: adjust a price', () => {
  const base: PriceAdjustConfig = {
    adjustment: 'minusPercent',
    price: 'YOUR_PRICE',
    other: 'LIST_PRICE',
    percentSource: 'typed',
    percent: '',
    rate: '',
    newRate: '',
    decimals: 2,
  };

  it('keeps the percentage readable in the formula, so it can be changed by hand', () => {
    expect(buildPriceAdjustToken({ ...base, percent: '1.5' })).toBe('{=YOUR_PRICE * (100 - 1.5) / 100}');
    expect(buildPriceAdjustToken({ ...base, percent: '1,5' })).toBe('{=YOUR_PRICE * (100 - 1.5) / 100}');
    expect(buildPriceAdjustToken({ ...base, adjustment: 'plusPercent', percent: '3' })).toBe('{=YOUR_PRICE * (100 + 3) / 100}');
    expect(buildPriceAdjustToken({ ...base, adjustment: 'percentOf', percent: '30' })).toBe('{=YOUR_PRICE * 30 / 100}');
  });

  it('saves a typed percentage as a rate just before the answer', () => {
    expect(buildPriceAdjustToken({ ...base, percent: '1.5', newRate: 'BANK_DISCOUNT' })).toBe(
      '{var: BANK_DISCOUNT = 1.5}{=YOUR_PRICE * (100 - BANK_DISCOUNT) / 100}',
    );
  });

  it('reuses a rate the snippet already has', () => {
    expect(buildPriceAdjustToken({ ...base, adjustment: 'percentOf', percentSource: 'rate', rate: 'BANK_DISCOUNT' })).toBe(
      '{=YOUR_PRICE * BANK_DISCOUNT / 100}',
    );
  });

  it('writes the gap to another price, and the saving in % behind a guard', () => {
    // Your price first, the original second: the saving is original minus yours.
    expect(buildPriceAdjustToken({ ...base, adjustment: 'minusPrice' })).toBe('{=LIST_PRICE - YOUR_PRICE}');
    expect(buildPriceAdjustToken({ ...base, adjustment: 'savingPercent', decimals: 0 })).toBe(
      '{if: LIST_PRICE > 0}{=round((LIST_PRICE - YOUR_PRICE) / LIST_PRICE * 100)}%{endif}',
    );
  });

  it('names every input a change needs, so the Price line window can label it', () => {
    for (const spec of PRICE_ADJUSTMENTS) {
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.hint.length).toBeGreaterThan(0);
      if (spec.needsPercent) expect(spec.percentLabel, `${spec.id} needs a percentLabel`).toBeTruthy();
      if (spec.needsOther) expect(spec.otherLabel, `${spec.id} needs an otherLabel`).toBeTruthy();
    }
  });

  it('writes no guard of its own inside a condition, since blocks cannot nest', () => {
    expect(insideCondition('{if: LIST_PRICE > 0}You save (-')).toBe(true);
    expect(insideCondition('{if: A > 0}x{endif} then ')).toBe(false);
    const saving = buildPriceAdjustToken({
      ...base, adjustment: 'savingPercent', decimals: 0, inCondition: true,
    });
    expect(saving).toBe('{=round((LIST_PRICE - YOUR_PRICE) / LIST_PRICE * 100)}%');
    const line = `{if: LIST_PRICE > 0}You save (-${saving}){endif}END`;
    expect(engine.resolveBody(line, { LIST_PRICE: '150', YOUR_PRICE: '100' })).toBe('You save (-33%)END');
    // The nested version printed a stray ")" here.
    expect(engine.resolveBody(line, { LIST_PRICE: '0', YOUR_PRICE: '100' })).toBe('END');
    expect(buildFormulaToken({ operation: 'percentChange', names: ['A', 'B'], decimals: 2, inCondition: true })).toBe(
      '{formtext: name=A; type=number} → {formtext: name=B; type=number} = {=(B - A) / A * 100}%',
    );
  });

  it('refuses a change it cannot write', () => {
    expect(isValidPriceAdjust({ ...base, percent: '' })).toBe(false);
    expect(isValidPriceAdjust({ ...base, percent: 'abc' })).toBe(false);
    expect(isValidPriceAdjust({ ...base, percent: '0' })).toBe(false);
    expect(isValidPriceAdjust({ ...base, percent: '120' })).toBe(false);
    expect(isValidPriceAdjust({ ...base, adjustment: 'plusPercent', percent: '120' })).toBe(true);
    expect(isValidPriceAdjust({ ...base, percent: '5', newRate: '9X' })).toBe(false);
    expect(isValidPriceAdjust({ ...base, percentSource: 'rate', rate: '' })).toBe(false);
    expect(isValidPriceAdjust({ ...base, adjustment: 'minusPrice', other: 'YOUR_PRICE' })).toBe(false);
    expect(isValidPriceAdjust({ ...base, adjustment: 'minusPrice', other: '' })).toBe(false);
    expect(isValidPriceAdjust({ ...base, price: '', percent: '5' })).toBe(false);
  });

  it('finds the rates a body sets, first setting of each name', () => {
    expect(ratesInBody('{var: A = 1.5}x{var: B = 3}{var: A = 9}{var: C = X + 1}')).toEqual([
      { name: 'A', value: '1.5' },
      { name: 'B', value: '3' },
    ]);
    expect(freeName('DISCOUNT', ['PRICE'])).toBe('DISCOUNT');
    expect(freeName('DISCOUNT', ['discount', 'DISCOUNT_2'])).toBe('DISCOUNT_3');
  });

  it('offers number boxes first, then text boxes, and never menus or dates', () => {
    expect(priceFieldNames([
      { key: 'NOTE', type: 'text' },
      { key: 'WHEN', type: 'date' },
      { key: 'PRICE', type: 'number' },
      { key: 'PLAN', type: 'dd' },
    ])).toEqual(['PRICE', 'NOTE']);
  });

  it('each change gives the answer its hint promises', () => {
    const at = (cfg: Partial<PriceAdjustConfig>, vals: Record<string, string>) =>
      engine.resolveBody(buildPriceAdjustToken({ ...base, ...cfg }), { ...vals });
    expect(at({ percent: '1.5' }, { YOUR_PRICE: '100' })).toBe('98.5');
    expect(at({ adjustment: 'plusPercent', percent: '3' }, { YOUR_PRICE: '100' })).toBe('103');
    expect(at({ adjustment: 'percentOf', percent: '30' }, { YOUR_PRICE: '100' })).toBe('30');
    expect(at({ percent: '1.5', newRate: 'R' }, { YOUR_PRICE: '100' })).toBe('98.5');
    expect(at({ adjustment: 'minusPrice' }, { YOUR_PRICE: '100', LIST_PRICE: '150' })).toBe('50');
    expect(at({ adjustment: 'savingPercent', decimals: 0 }, { YOUR_PRICE: '100', LIST_PRICE: '150' })).toBe('33%');
    // No original price, no percentage: nothing prints rather than a stray %.
    expect(at({ adjustment: 'savingPercent', decimals: 0 }, { YOUR_PRICE: '100', LIST_PRICE: '' })).toBe('');
  });

  it('measures a saving against the original price: 100 against 200 is 50%, not -100%', () => {
    // The Carla snippet: the difference and the percentage, both from the same two boxes.
    const cfg = { ...base, price: 'PRICE', other: 'OTHER_PRICE' };
    const line =
      buildPriceAdjustToken({ ...cfg, adjustment: 'minusPrice' }) + ' ' +
      buildPriceAdjustToken({ ...cfg, adjustment: 'savingPercent', decimals: 0 });
    expect(engine.resolveBody(line, { PRICE: '100', OTHER_PRICE: '200' })).toBe('100 50%');
    // A price above the original is a negative saving, which stays visible.
    expect(engine.resolveBody(line, { PRICE: '200', OTHER_PRICE: '100' })).toBe('-100 -100%');
  });

  it('gives the two price choices the same labels, so the order is never a guess', () => {
    for (const id of ['minusPrice', 'savingPercent'] as const) {
      const spec = PRICE_ADJUSTMENTS.find((a) => a.id === id)!;
      expect(spec.priceLabel).toBe('Your price');
      expect(spec.otherLabel).toBe('Original price');
      // The example needs the original above the price, or it would print a negative saving.
      expect(Number(spec.sample?.other)).toBeGreaterThan(Number(spec.sample?.price));
    }
  });

  // Every row of a real quote, built with the button alone: the discount is
  // saved once as a rate and two lines read it.
  const price = buildFormNumberToken({ name: 'YOUR_PRICE', format: 'plain', currency: 'EUR', default: '' });
  const list = buildFormNumberToken({ name: 'LIST_PRICE', format: 'plain', currency: 'EUR', default: '' });
  const adj = (cfg: Partial<PriceAdjustConfig>) => buildPriceAdjustToken({ ...base, ...cfg });
  const quote = (rateLine: string) =>
    `Your price: ${price}€\n` +
    `Bank transfer: ${rateLine}€\n` +
    `Pay by transfer and save ${adj({ adjustment: 'minusPrice' })}€ + ` +
    `${adj({ adjustment: 'percentOf', percentSource: 'rate', rate: 'BANK_DISCOUNT' })}€\n` +
    `List price: ${list}€\n` +
    `You save: ${adj({ adjustment: 'minusPrice' })}€ ` +
    `(-${adj({ adjustment: 'savingPercent', decimals: 0 })})`;

  it('builds every row of a quote from two typed prices and one rate', () => {
    const body = quote(adj({ percent: '1.5', newRate: 'BANK_DISCOUNT' }));
    expect(engine.resolveBody(body, { YOUR_PRICE: '100', LIST_PRICE: '150' })).toBe(
      'Your price: 100€\nBank transfer: 98.5€\nPay by transfer and save 50€ + 1.5€\n' +
      'List price: 150€\nYou save: 50€ (-33%)',
    );
  });

  it('changing the rate once changes every line that reads it', () => {
    const body = quote(adj({ percent: '1.5', newRate: 'BANK_DISCOUNT' })).replace(
      '{var: BANK_DISCOUNT = 1.5}',
      '{var: BANK_DISCOUNT = 2}',
    );
    expect(engine.resolveBody(body, { YOUR_PRICE: '100', LIST_PRICE: '150' })).toBe(
      'Your price: 100€\nBank transfer: 98€\nPay by transfer and save 50€ + 2€\n' +
      'List price: 150€\nYou save: 50€ (-33%)',
    );
  });
});

describe('formulaToken: formulas already in a body', () => {
  const remove = (body: string, index: number) => {
    const f = formulasInBody(body)[index]!;
    return body.slice(0, f.removeStart) + body.slice(f.removeEnd);
  };

  const quote =
    '**★ Your Price:** {formtext: name=YOUR_PRICE; type=number}€\n' +
    '- Bank Transfer: {var: BANK_DISCOUNT = 1.5}{=YOUR_PRICE * (100 - BANK_DISCOUNT) / 100}€\n' +
    '{if: OTA_PRICE > 0}[save {=OTA_PRICE - YOUR_PRICE}€ + {=YOUR_PRICE * BANK_DISCOUNT / 100}€ = ' +
    '{=OTA_PRICE - YOUR_PRICE + round(YOUR_PRICE * BANK_DISCOUNT / 100)}€ total]\n{endif}' +
    '**Original Price:** {formtext: name=OTA_PRICE; type=number}€\n' +
    '{if: OTA_PRICE > 0}✓ You save: {=OTA_PRICE - YOUR_PRICE}€ (-{=round((OTA_PRICE - YOUR_PRICE) / OTA_PRICE * 100)}%){endif}';

  it('lists every formula in a quote, in plain words, with the line it sits on', () => {
    expect(formulasInBody(quote).map((f) => [f.context, f.description])).toEqual([
      ['- Bank Transfer:', 'YOUR_PRICE minus BANK_DISCOUNT (1.5%)'],
      ['[save', 'OTA_PRICE minus YOUR_PRICE'],
      ['[save € +', 'BANK_DISCOUNT (1.5%) of YOUR_PRICE'],
      ['[save € + € =', 'Formula: OTA_PRICE - YOUR_PRICE + round(YOUR_PRICE * BANK_DISCOUNT / 100)'],
      ['✓ You save:', 'OTA_PRICE minus YOUR_PRICE'],
      ['✓ You save: € (-', 'Saving in %: YOUR_PRICE against OTA_PRICE, whole number'],
    ]);
  });

  it('keeps a rate other lines still read when its own line is removed', () => {
    const after = remove(quote, 0);
    expect(after).toContain('- Bank Transfer: {var: BANK_DISCOUNT = 1.5}€');
    expect(engine.resolveBody(after, { YOUR_PRICE: '100', OTA_PRICE: '150' })).toContain('[save 50€ + 1.5€ = 52€ total]');
  });

  it('removes a rate with its line when nothing else reads it', () => {
    const body = 'Price: {formtext: name=P; type=number}\nCard: {var: MARKUP = 3}{=P * (100 + MARKUP) / 100}€';
    expect(remove(body, 0)).toBe('Price: {formtext: name=P; type=number}\nCard: €');
  });

  it('removes the saving in % with its guard and its % sign', () => {
    const body = 'Old: {formtext: name=A; type=number}\nNew: {formtext: name=B; type=number}\nSave {if: A > 0}{=round((A - B) / A * 100)}%{endif}!';
    expect(remove(body, 0)).toBe('Old: {formtext: name=A; type=number}\nNew: {formtext: name=B; type=number}\nSave !');
  });

  it('removes a New numbers block whole: its boxes, its working and its answer', () => {
    const block = buildFormulaToken({ operation: 'subtract', names: ['NUM_1', 'NUM_2'], decimals: 2 });
    const body = `Total: ${block}\nThanks`;
    expect(formulasInBody(body)[0]?.description).toBe('NUM_1 minus NUM_2');
    expect(remove(body, 0)).toBe('Total: \nThanks');
  });

  it('leaves the boxes of a block when another formula still reads them', () => {
    const block = buildFormulaToken({ operation: 'add', names: ['NUM_1', 'NUM_2'], decimals: 2 });
    const body = `${block}\nDouble: {=NUM_1 * 2}`;
    expect(remove(body, 0)).toBe(
      '{formtext: name=NUM_1; type=number} + {formtext: name=NUM_2; type=number} = \nDouble: {=NUM_1 * 2}',
    );
  });

  it('describes every operation the builder writes', () => {
    const d = (op: FormulaOperation, decimals: FormulaDecimals = 2) =>
      formulasInBody(buildFormulaToken({ operation: op, names: ['A', 'B'], decimals }))[0]?.description;
    expect(d('add')).toBe('Add A, B');
    expect(d('subtract')).toBe('A minus B');
    expect(d('multiply')).toBe('Multiply A, B');
    expect(d('divide')).toBe('Divide A by B');
    expect(d('divide', 0)).toBe('Divide A by B, whole number');
    expect(d('divide', 1)).toBe('Divide A by B, 1 decimal');
    expect(d('average')).toBe('Average of A, B');
    expect(d('percentOf')).toBe('B% of A');
    expect(d('percentChange')).toBe('Percent change from A to B');
    expect(describeFormula('P * (100 - 1.5) / 100')).toBe('P minus 1.5%');
    expect(describeFormula('P * (100 + 3) / 100')).toBe('P plus 3%');
    expect(describeFormula('P * 30 / 100')).toBe('30% of P');
  });

  it('finds nothing in a body without formulas', () => {
    expect(formulasInBody('Hello {formtext: name=A; type=number}')).toEqual([]);
  });
});

describe('hand-typed spreadsheet-style formulas', () => {
  // The shape of a real quote snippet, written straight into the body.
  const quote =
    'Price: {formtext: default=0; name=YOUR_PRICE}\n' +
    'Transfer: {=YOUR_PRICE * 0.985}\n' +
    'List: {formtext: default=0; name=LIST_PRICE}\n' +
    '{if: LIST_PRICE > 0}You save {=LIST_PRICE - YOUR_PRICE} ' +
    '(-{=round((LIST_PRICE - YOUR_PRICE) / LIST_PRICE * 100)}%){endif}';

  it('resolves a quote with multiply, subtract, a percentage and a condition', () => {
    expect(engine.resolveBody(quote, { YOUR_PRICE: '850', LIST_PRICE: '1000' })).toBe(
      'Price: 850\nTransfer: 837.25\nList: 1000\nYou save 150 (-15%)',
    );
    expect(engine.resolveBody(quote, { YOUR_PRICE: '850', LIST_PRICE: '0' })).toBe(
      'Price: 850\nTransfer: 837.25\nList: 0\n',
    );
  });

  it('keeps the decimals round() is given, and averages with avg()', () => {
    expect(engine.resolveBody('{=round(X, 1)}', { X: '2.456' })).toBe('2.5');
    expect(engine.resolveBody('{=round(X, -2)}', { X: '1234' })).toBe('1200');
    expect(engine.resolveBody('{=avg(A, B, C)}', { A: '1', B: '2', C: '4' })).toBe('2.33');
  });
});
