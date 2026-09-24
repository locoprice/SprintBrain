/**
 * Formula writer for the snippet body editor.
 *
 * One block holds the numbers and the answer, so the fill form asks for every
 * number the formula reads:
 *
 * ```
 * {formtext: name=NUM_1; type=number} - {formtext: name=NUM_2; type=number} = {=NUM_1 - NUM_2}
 * ```
 *
 * which expands to `100 - 25 = 75`.
 *
 * **Why the number fields come with it.** A bare `{=A - B}` declares no field,
 * so no fill form opens, A and B read as "not answered" and the snippet prints
 * 0 every time. The formula is only as good as the boxes behind it, so the
 * builder writes both in one insert.
 *
 * The builder's other mode, "Adjust a price", works from a box the body
 * already has and writes only the answer; see `PRICE_ADJUSTMENTS` below.
 *
 * **Adding a formula.** Every operation is one entry in `FORMULA_OPERATIONS`
 * (or `PRICE_ADJUSTMENTS` for a change to an existing price):
 * how many numbers it takes, what prints before the `=`, and the expression the
 * engine works out. The dialog, the validation and the tests read the list, so
 * a new entry needs nothing else here. If the expression calls a function the
 * engine does not know yet, add it to `safeEval` and `FUNS` in
 * `extension/formula-engine.js` and to `sbEvalFormula` in
 * `app/public/mobile/index.html`; `scripts/check-snippets.js` fails until the
 * two agree.
 *
 * Nothing else reaches the engine: the numbers are ordinary number fields and
 * the answer is an ordinary `{= }` formula, which every expansion surface (the
 * overlay, the popup, the live preview and mobile) already resolves.
 * `src/__tests__/formulaToken.test.ts` pins the round trip against the real
 * engine.
 */

import {
  buildFormNumberToken,
  DEFAULT_CURRENCY,
  isValidFieldName,
  nextNumberName,
} from '@/lib/formNumberToken';

export type FormulaOperation =
  | 'add'
  | 'subtract'
  | 'multiply'
  | 'divide'
  | 'average'
  | 'percentOf'
  | 'percentChange';

export interface FormulaOperationSpec {
  id: FormulaOperation;
  /** Button text in the dialog. */
  label: string;
  /** One line on what it works out, and what happens at the edge cases. */
  hint: string;
  /** What 100, 25 and 5 (or the two-number equivalent) print as. */
  sample: string;
  minOperands: number;
  maxOperands: number;
  /**
   * What each row is, for an operation whose numbers are not interchangeable.
   * Absent when any number can sit in any row.
   */
  roles?: readonly string[];
  /** Drawn between rows in the dialog, for an operation without roles. */
  rowSign?: string;
  /** What prints before the `=`, built from the field tokens. */
  working: (fields: string[]) => string;
  /** What the engine works out, built from the field names. */
  expression: (names: string[]) => string;
  /** Printed straight after the answer, e.g. `%`. */
  suffix?: string;
  /**
   * When the answer exists at all. Without it a suffix would print alone, as
   * `= %`, when the answer cannot be worked out.
   */
  guard?: (names: string[]) => string;
}

/** Past this the fill form stops being quicker than a calculator. */
export const MAX_OPERANDS = 10;

/** Fewer than two numbers is not a formula. */
export const MIN_OPERANDS = 2;

// The printed working uses signs a reader recognises in any language: × and
// the arrow instead of words like "of" or "from", which would put English into
// an Italian or Spanish message.
export const FORMULA_OPERATIONS: readonly FormulaOperationSpec[] = [
  {
    id: 'add',
    rowSign: '+',
    label: 'Add',
    hint: 'Adds every number.',
    sample: '100 + 25 + 5 = 130',
    minOperands: MIN_OPERANDS,
    maxOperands: MAX_OPERANDS,
    working: (f) => f.join(' + '),
    expression: (n) => n.join(' + '),
  },
  {
    id: 'subtract',
    rowSign: '-',
    label: 'Subtract',
    hint: 'Takes each number from the first, left to right.',
    sample: '100 - 25 - 5 = 70',
    minOperands: MIN_OPERANDS,
    maxOperands: MAX_OPERANDS,
    working: (f) => f.join(' - '),
    expression: (n) => n.join(' - '),
  },
  {
    id: 'multiply',
    rowSign: '×',
    label: 'Multiply',
    hint: 'Multiplies every number.',
    sample: '4 × 2.5 = 10',
    minOperands: MIN_OPERANDS,
    maxOperands: MAX_OPERANDS,
    working: (f) => f.join(' × '),
    expression: (n) => n.join(' * '),
  },
  {
    id: 'divide',
    rowSign: '/',
    label: 'Divide',
    hint: 'Divides the first number by the others, left to right. Dividing by 0 prints no answer instead of a wrong one.',
    sample: '100 / 4 = 25',
    minOperands: MIN_OPERANDS,
    maxOperands: MAX_OPERANDS,
    working: (f) => f.join(' / '),
    expression: (n) => n.join(' / '),
  },
  {
    id: 'average',
    rowSign: '+',
    label: 'Average',
    hint: 'The mean of every number. An empty box still counts, as 0.',
    sample: '(100 + 25 + 5) / 3 = 43.33',
    minOperands: MIN_OPERANDS,
    maxOperands: MAX_OPERANDS,
    working: (f) => `(${f.join(' + ')}) / ${f.length}`,
    // The sum over the count rather than avg(): an extension older than
    // v3.48.0 has no avg() and would print nothing. Same answer on every one.
    expression: (n) => `(${n.join(' + ')}) / ${n.length}`,
  },
  {
    id: 'percentOf',
    label: 'Percent of',
    hint: 'A percentage of an amount. Type 15 for 15 percent.',
    sample: '200 × 15% = 30',
    minOperands: 2,
    maxOperands: 2,
    roles: ['Amount', 'Percent'],
    working: ([amount, percent]) => `${amount} × ${percent}%`,
    expression: ([amount, percent]) => `${amount} * ${percent} / 100`,
  },
  {
    id: 'percentChange',
    label: 'Percent change',
    hint: 'How much the second number rose or fell against the first. From 0 there is no percentage, so it prints no answer.',
    sample: '100 → 80 = -20%',
    minOperands: 2,
    maxOperands: 2,
    roles: ['From', 'To'],
    working: ([from, to]) => `${from} → ${to}`,
    expression: ([from, to]) => `(${to} - ${from}) / ${from} * 100`,
    suffix: '%',
    guard: ([from]) => `${from} != 0`,
  },
];

export function getFormulaOperation(id: FormulaOperation): FormulaOperationSpec {
  const spec = FORMULA_OPERATIONS.find((op) => op.id === id);
  if (!spec) throw new Error(`Unknown formula operation: ${id}`);
  return spec;
}

/**
 * How many decimals the answer keeps. 2 is what the engine does anyway, so it
 * writes no `round()` at all.
 */
export type FormulaDecimals = 0 | 1 | 2;

export const DEFAULT_DECIMALS: FormulaDecimals = 2;

/**
 * Wraps an expression so the answer keeps `decimals` decimals.
 *
 * Written only with the one-argument `round()`, never `round(X, 1)`. The
 * dashboard ships the moment it deploys, but each person's extension updates
 * on its own schedule, and a release before v3.48.0 drops round()'s second
 * argument: `round(X, 1)` would print 3 where 3.3 was meant. `round(X * 10) /
 * 10` gives the same answer on every version.
 */
export function withRounding(expr: string, decimals: FormulaDecimals): string {
  if (decimals === DEFAULT_DECIMALS) return expr;
  if (decimals === 0) return `round(${expr})`;
  const scale = 10 ** decimals;
  return `round((${expr}) * ${scale}) / ${scale}`;
}

export interface FormulaConfig {
  operation: FormulaOperation;
  /** Field names in the order the operation reads them. */
  names: string[];
  decimals: FormulaDecimals;
  /**
   * The block lands inside an `{if:}` already, so no guard of its own is
   * written. Conditions cannot nest: the engine closes a block at the first
   * `{endif}`, so an inner one would end the outer one early and leave the rest
   * of the line printing when it should not.
   */
  inCondition?: boolean;
}

/** Whether a cursor sits inside an `{if:}` block, judged by the text before it. */
export function insideCondition(before: string): boolean {
  const opens = (before.match(/\{if:/gi) ?? []).length;
  const closes = (before.match(/\{endif\}/gi) ?? []).length;
  return opens > closes;
}

/**
 * The next `count` unused `NUM_n` names for a body. Each one handed out counts
 * as used for the next, so a three-number formula never wires two boxes to one
 * value.
 */
export function nextNumberNames(body: string, count: number): string[] {
  const names: string[] = [];
  let seen = body;
  for (let i = 0; i < count; i += 1) {
    const name = nextNumberName(seen);
    names.push(name);
    seen += ` ${name}`;
  }
  return names;
}

/** Whether two rows share a name, which would wire two boxes to one value. */
export function hasDuplicateNames(names: string[]): boolean {
  return new Set(names.map((n) => n.toUpperCase())).size !== names.length;
}

/**
 * Whether the block can be written: as many numbers as the operation takes,
 * each a name the engine accepts, and no two alike.
 */
export function isValidFormula(cfg: FormulaConfig): boolean {
  const spec = getFormulaOperation(cfg.operation);
  const { names } = cfg;
  if (names.length < spec.minOperands || names.length > spec.maxOperands) return false;
  if (!names.every(isValidFieldName)) return false;
  return !hasDuplicateNames(names);
}

/** Writes the block: the number fields, then ` = ` and the answer. */
export function buildFormulaToken(cfg: FormulaConfig): string {
  const spec = getFormulaOperation(cfg.operation);
  const fields = cfg.names.map((name) =>
    buildFormNumberToken({ name, format: 'plain', currency: DEFAULT_CURRENCY, default: '' }),
  );
  const answer = withRounding(spec.expression(cfg.names), cfg.decimals);
  const result = spec.guard && !cfg.inCondition
    ? `{if: ${spec.guard(cfg.names)}}{=${answer}}${spec.suffix ?? ''}{endif}`
    : `{=${answer}}${spec.suffix ?? ''}`;
  return `${spec.working(fields)} = ${result}`;
}

// ── ADJUST A PRICE ──────────────────────────────────────────────────
// The second mode of the builder, for a price the snippet already asks for.
// A quote types its prices once and works several lines out of them, so this
// writes only the answer, `{=YOUR_PRICE * 0.985}`, at the cursor: no new box,
// and no working printed beside it.

export type PriceAdjustment =
  | 'minusPercent'
  | 'plusPercent'
  | 'percentOf'
  | 'minusPrice'
  | 'savingPercent';


export interface PriceAdjustmentSpec {
  id: PriceAdjustment;
  label: string;
  hint: string;
  /** Takes a percentage: typed in the builder, or a rate the snippet has. */
  needsPercent: boolean;
  /** Takes a second price from the snippet. */
  needsOther: boolean;
  /** What a new rate for this change is called unless the author renames it. */
  rateName?: string;
  /** Where the rounding starts when this change is picked. */
  defaultDecimals: FormulaDecimals;
  /**
   * `percent` goes into the expression as written: a number such as `1.5`, or
   * a rate's name. Either way it stays readable in the body, so changing 1.5
   * to 2 later is an edit of the number itself, not of a multiplier like 0.985
   * someone has to work out.
   */
  expression: (price: string, other: string, percent: string) => string;
  suffix?: string;
  guard?: (price: string) => string;
}

export const PRICE_ADJUSTMENTS: readonly PriceAdjustmentSpec[] = [
  {
    id: 'minusPercent',
    label: 'Minus %',
    hint: 'The price less a percentage, like a discount. 1.5 turns 100 into 98.5.',
    needsPercent: true,
    needsOther: false,
    rateName: 'DISCOUNT',
    defaultDecimals: 2,
    expression: (price, _other, pct) => `${price} * (100 - ${pct}) / 100`,
  },
  {
    id: 'plusPercent',
    label: 'Plus %',
    hint: 'The price plus a percentage, like a fee or a markup. 3 turns 100 into 103.',
    needsPercent: true,
    needsOther: false,
    rateName: 'MARKUP',
    defaultDecimals: 2,
    expression: (price, _other, pct) => `${price} * (100 + ${pct}) / 100`,
  },
  {
    id: 'percentOf',
    label: '% of',
    hint: 'A part of the price, like a deposit. 30 turns 100 into 30.',
    needsPercent: true,
    needsOther: false,
    rateName: 'PERCENT',
    defaultDecimals: 2,
    expression: (price, _other, pct) => `${price} * ${pct} / 100`,
  },
  {
    id: 'minusPrice',
    label: 'Minus a price',
    hint: 'This price less another one, like what the client saves. 150 less 100 is 50.',
    needsPercent: false,
    needsOther: true,
    defaultDecimals: 2,
    expression: (price, other) => `${price} - ${other}`,
  },
  {
    id: 'savingPercent',
    label: 'Saving in %',
    hint: 'How much lower the other price is, as a percentage of this one. 150 against 100 is 33%. Prints nothing while this price is empty.',
    needsPercent: false,
    needsOther: true,
    defaultDecimals: 0,
    expression: (price, other) => `(${price} - ${other}) / ${price} * 100`,
    suffix: '%',
    guard: (price) => `${price} > 0`,
  },
];

export function getPriceAdjustment(id: PriceAdjustment): PriceAdjustmentSpec {
  const spec = PRICE_ADJUSTMENTS.find((a) => a.id === id);
  if (!spec) throw new Error(`Unknown price adjustment: ${id}`);
  return spec;
}

// ── RATES ───────────────────────────────────────────────────────────
// A rate is a percentage with a name, `{var: BANK_DISCOUNT = 1.5}`. Every line
// that uses it reads the one number, so changing a discount or a markup is one
// edit however many lines depend on it. The engine and the phone already read
// `{var:}`; it prints nothing.
//
// A rate is read from where it is set onward, so a line above it would get 0.
// Callers pass only the body before the cursor to `ratesInBody`.

export interface SnippetRate {
  name: string;
  value: string;
}

/** The rates set in a body, first setting of each name, in order. */
export function ratesInBody(body: string): SnippetRate[] {
  const out: SnippetRate[] = [];
  const re = /\{var:\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\d+(?:\.\d+)?)\s*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const name = m[1] ?? '';
    if (!out.some((r) => r.name === name)) out.push({ name, value: m[2] ?? '' });
  }
  return out;
}

export function buildRateToken(name: string, value: string): string {
  return `{var: ${name} = ${value}}`;
}

/** `base` if nothing in `taken` claims it, else `base_2`, `base_3`, and so on. */
export function freeName(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map((t) => t.toUpperCase()));
  if (!used.has(base.toUpperCase())) return base;
  let n = 2;
  while (used.has(`${base}_${n}`.toUpperCase())) n += 1;
  return `${base}_${n}`;
}

export interface PriceAdjustConfig {
  adjustment: PriceAdjustment;
  /** A field the body already declares. */
  price: string;
  /** The second field, read only by adjustments that take one. */
  other: string;
  /** Whether the percentage is typed here or read from an existing rate. */
  percentSource: 'typed' | 'rate';
  /** As typed: `1.5` or `1,5`. */
  percent: string;
  /** The existing rate, when `percentSource` is `rate`. */
  rate: string;
  /**
   * Saves the typed percentage as a new rate under this name, written just
   * before the answer. '' writes the number straight into the formula.
   */
  newRate: string;
  decimals: FormulaDecimals;
  /** As in `FormulaConfig`: the answer lands inside an `{if:}` already. */
  inCondition?: boolean;
}

/**
 * The fields a price can be read from: number boxes first, then text boxes,
 * which older snippets use for prices and a formula reads just the same.
 * Menus, dates and times hold no amount.
 */
export function priceFieldNames(fields: readonly { key: string; type: string }[]): string[] {
  return [
    ...fields.filter((f) => f.type === 'number'),
    ...fields.filter((f) => f.type === 'text'),
  ].map((f) => f.key);
}

/** A typed percentage as a number, or null when it is not one. */
export function parsePercent(raw: string): number | null {
  const s = raw.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

/**
 * Whether the change can be written. A discount past 100% is not one. Whether
 * a new rate's name is free depends on the body, so the dialog checks that.
 */
export function isValidPriceAdjust(cfg: PriceAdjustConfig): boolean {
  const spec = getPriceAdjustment(cfg.adjustment);
  if (!isValidFieldName(cfg.price)) return false;
  if (spec.needsOther && (!isValidFieldName(cfg.other) || cfg.other === cfg.price)) return false;
  if (!spec.needsPercent) return true;
  if (cfg.percentSource === 'rate') return isValidFieldName(cfg.rate);
  const pct = parsePercent(cfg.percent);
  if (pct === null) return false;
  if (cfg.adjustment === 'minusPercent' && pct > 100) return false;
  return cfg.newRate === '' || isValidFieldName(cfg.newRate);
}

/** Writes the answer for the cursor, with a new rate just before it if one is saved. */
export function buildPriceAdjustToken(cfg: PriceAdjustConfig): string {
  const spec = getPriceAdjustment(cfg.adjustment);
  let operand = '';
  let rateToken = '';
  if (spec.needsPercent) {
    if (cfg.percentSource === 'rate') {
      operand = cfg.rate;
    } else {
      const literal = String(parsePercent(cfg.percent) ?? 0);
      if (cfg.newRate !== '') {
        rateToken = buildRateToken(cfg.newRate, literal);
        operand = cfg.newRate;
      } else {
        operand = literal;
      }
    }
  }
  const expr = spec.expression(cfg.price, cfg.other, operand);
  const answer = `{=${withRounding(expr, cfg.decimals)}}${spec.suffix ?? ''}`;
  return rateToken + (spec.guard && !cfg.inCondition ? `{if: ${spec.guard(cfg.price)}}${answer}{endif}` : answer);
}

// ── FORMULAS ALREADY IN A BODY ──────────────────────────────────────
// What the builder lists under "In this snippet", each with the range a Remove
// button deletes. A formula is removed whole, as it was inserted: its guard,
// its rate and, for a New numbers block, its number boxes and the working in
// front of it. Anything another formula still reads stays, since removing it
// would make that formula read 0 without a word.

export interface FormulaInBody {
  /** Where the answer token itself sits, for the list's order and its key. */
  at: number;
  /** The range the Remove button deletes. */
  removeStart: number;
  removeEnd: number;
  /** The words on the same line, so the author knows which line this is. */
  context: string;
  /** What it works out, in plain words. */
  description: string;
}

const ANSWER_TOKEN = /\{=([^}]*)\}/g;
const NUMBER_BOX = /\{formtext:[^}]*type=number[^}]*\}/i;

/** Whether every bracket in `s` closes, so an unwrap never splits a formula. */
function balanced(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** The rounding the builder wrapped around an answer, and what is inside it. */
function unwrapRounding(expr: string): { inner: string; rounding: string } {
  const oneDecimal = /^round\(\((.*)\) \* 10\) \/ 10$/.exec(expr);
  if (oneDecimal && balanced(oneDecimal[1] ?? '')) return { inner: oneDecimal[1] ?? '', rounding: '1 decimal' };
  const whole = /^round\((.*)\)$/.exec(expr);
  if (whole && balanced(whole[1] ?? '') && !(whole[1] ?? '').includes(',')) {
    return { inner: whole[1] ?? '', rounding: 'whole number' };
  }
  return { inner: expr, rounding: '' };
}

/** A formula's answer in plain words, or the expression itself when it is not one the builder writes. */
export function describeFormula(expr: string, rates: readonly SnippetRate[] = []): string {
  const { inner, rounding } = unwrapRounding(expr.trim());
  const pct = (x: string) => {
    const rate = rates.find((r) => r.name === x);
    return rate ? `${x} (${rate.value}%)` : `${x}%`;
  };
  const w = '([A-Za-z_][A-Za-z0-9_]*)';
  const n = '([A-Za-z_][A-Za-z0-9_]*|\\d+(?:\\.\\d+)?)';
  let m: RegExpExecArray | null;
  let text = '';
  if ((m = new RegExp(`^${w} \\* \\(100 - ${n}\\) / 100$`).exec(inner))) text = `${m[1]} minus ${pct(m[2] ?? '')}`;
  else if ((m = new RegExp(`^${w} \\* \\(100 \\+ ${n}\\) / 100$`).exec(inner))) text = `${m[1]} plus ${pct(m[2] ?? '')}`;
  else if ((m = new RegExp(`^${w} \\* ${n} / 100$`).exec(inner))) text = `${pct(m[2] ?? '')} of ${m[1]}`;
  else if ((m = new RegExp(`^\\(${w} - ${w}\\) / \\1 \\* 100$`).exec(inner))) text = `Saving in %: ${m[2]} against ${m[1]}`;
  else if ((m = new RegExp(`^\\(${w} - ${w}\\) / \\2 \\* 100$`).exec(inner))) text = `Percent change from ${m[2]} to ${m[1]}`;
  else if ((m = new RegExp(`^\\(${w}(?: \\+ ${w})+\\) / \\d+$`).exec(inner))) text = `Average of ${inner.slice(1, inner.lastIndexOf(')')).split(' + ').join(', ')}`;
  else if (new RegExp(`^${w}(?: - ${w})+$`).test(inner)) text = inner.split(' - ').join(' minus ');
  else if (new RegExp(`^${w}(?: \\+ ${w})+$`).test(inner)) text = `Add ${inner.split(' + ').join(', ')}`;
  else if (new RegExp(`^${w}(?: \\* ${w})+$`).test(inner)) text = `Multiply ${inner.split(' * ').join(', ')}`;
  else if (new RegExp(`^${w}(?: / ${w})+$`).test(inner)) text = `Divide ${inner.split(' / ').join(' by ')}`;
  else return `Formula: ${expr.trim()}`;
  return rounding ? `${text}, ${rounding}` : text;
}

/** The author's words on the line, without tokens or style markers. */
function lineContext(body: string, from: number, to: number): string {
  const lineStart = body.lastIndexOf('\n', from - 1) + 1;
  const nl = body.indexOf('\n', to);
  const lineEnd = nl === -1 ? body.length : nl;
  const clean = (s: string) =>
    s.replace(/\{[^}]*\}/g, ' ')
      .replace(/\*\*/g, '')
      .replace(/\[\/?(?:blue|yellow|red)\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const before = clean(body.slice(lineStart, from));
  const text = before !== '' ? before : clean(body.slice(to, lineEnd));
  return text.length > 40 ? `${text.slice(0, 40).trim()}…` : text;
}

/** Whether `name` appears as a whole word inside any token outside the range. */
function usedElsewhere(body: string, name: string, start: number, end: number): boolean {
  const rest = body.slice(0, start) + body.slice(end);
  const re = new RegExp(`\\{[^}]*\\b${name}\\b[^}]*\\}`);
  return re.test(rest);
}

export function formulasInBody(body: string): FormulaInBody[] {
  const rates = ratesInBody(body);
  const out: FormulaInBody[] = [];
  const re = new RegExp(ANSWER_TOKEN.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const expr = m[1] ?? '';
    const at = m.index;
    let start = at;
    let end = at + m[0].length;

    // The builder's own guard: `{if: G}{=…}%{endif}`, with nothing else inside.
    const guardBefore = /\{if:[^}]*\}$/.exec(body.slice(0, start));
    const guardAfter = /^%?\{endif\}/.exec(body.slice(end));
    if (guardBefore && guardAfter) {
      start = guardBefore.index;
      end += guardAfter[0].length;
    } else if (body.charAt(end) === '%') {
      end += 1;
    }

    // A rate saved with this formula goes with it, unless another line reads it.
    const rateBefore = /\{var:\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\d+(?:\.\d+)?\s*\}$/.exec(body.slice(0, start));
    if (rateBefore && !usedElsewhere(body, rateBefore[1] ?? '', rateBefore.index, end)) {
      start = rateBefore.index;
    }

    // A New numbers block: number boxes and the working, then ` = ` and this
    // answer. The boxes go too, unless another formula reads one of them.
    const working = /((?:\{formtext:[^}]*\}|[ \t+\-×/()→%\d.,])*)= $/.exec(body.slice(0, start));
    if (working && NUMBER_BOX.test(working[1] ?? '')) {
      const boxes = [...(working[1] ?? '').matchAll(/name=([A-Za-z_][A-Za-z0-9_]*)/g)].map((b) => b[1] ?? '');
      const blockStart = working.index + ((working[1] ?? '').length - (working[1] ?? '').trimStart().length);
      const ownsBoxes =
        boxes.length > 0 &&
        boxes.every((b) => new RegExp(`\\b${b}\\b`).test(expr) && !usedElsewhere(body, b, blockStart, end));
      if (ownsBoxes) start = blockStart;
    }

    out.push({
      at,
      removeStart: start,
      removeEnd: end,
      context: lineContext(body, start, end),
      description: describeFormula(expr, rates),
    });
  }
  return out;
}
