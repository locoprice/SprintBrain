import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load the REAL shipping formula engine (extension/formula-engine.js) the same
// way deletionSync.test.ts loads sync-deletion.js: evaluate the UMD source in a
// fresh module scope so Vite never transforms it. content/content.js loads this
// exact file via the manifest (window.SBFormulaEngine), so pinning behavior here
// guards the live content path too — there is no separate inline copy to drift.
function loadHelper<T>(path: string): T {
  const src = readFileSync(path, 'utf8');
  const mod = { exports: {} as unknown };
  const run = new Function('module', 'exports', src) as (m: typeof mod, e: unknown) => void;
  run(mod, mod.exports);
  return mod.exports as T;
}

interface FormulaEngine {
  resolveBody: (body: string, vals: Record<string, unknown>) => string;
  evalCondition: (expr: string, vals: Record<string, unknown>) => number | null;
}

const engine = loadHelper<FormulaEngine>(
  resolve(process.cwd(), '..', 'extension', 'formula-engine.js'),
);

describe('formula engine — conditional comparisons', () => {
  // Regression: numeric comparisons used to fall through to safeEval (which has
  // no comparison operators) and return NaN -> null -> false, so the documented
  // {if: OTA_PRICE > 0} block never rendered. This hit the live ::quote snippets.
  it('evaluates >, <, >=, <=, ==, != numerically', () => {
    expect(engine.evalCondition('OTA_PRICE > 0', { OTA_PRICE: 200 })).toBe(1);
    expect(engine.evalCondition('OTA_PRICE > 0', { OTA_PRICE: 0 })).toBe(0);
    expect(engine.evalCondition('N < 5', { N: 3 })).toBe(1);
    expect(engine.evalCondition('N >= 5', { N: 5 })).toBe(1);
    expect(engine.evalCondition('N <= 4', { N: 5 })).toBe(0);
    expect(engine.evalCondition('N == 2', { N: 2 })).toBe(1);
    expect(engine.evalCondition('N != 2', { N: 3 })).toBe(1);
  });

  it('renders the {if: OTA_PRICE > 0} savings block end-to-end', () => {
    const body = 'Price {YOUR}{if: OTA_PRICE > 0} — save {= OTA_PRICE - YOUR}{endif}';
    expect(engine.resolveBody(body, { YOUR: 100, OTA_PRICE: 150 })).toBe('Price 100 — save 50');
    expect(engine.resolveBody(body, { YOUR: 100, OTA_PRICE: 0 })).toBe('Price 100');
  });

  it('compares against arithmetic operands', () => {
    expect(engine.evalCondition('PRICE - 25 > 100', { PRICE: 130 })).toBe(1);
    expect(engine.evalCondition('PRICE - 25 > 100', { PRICE: 120 })).toBe(0);
  });

  // Guard the pre-existing condition forms so the new branch never regresses them.
  it('preserves quoted string-equality conditions', () => {
    expect(engine.evalCondition('LANG = "EN"', { LANG: 'en' })).toBe(1);
    expect(engine.evalCondition('LANG != "EN"', { LANG: 'ES' })).toBe(1);
    expect(engine.evalCondition('LANG = "EN"', { LANG: 'es' })).toBe(0);
  });

  it('preserves truthy and arithmetic-only conditions', () => {
    expect(engine.evalCondition('COUNT', { COUNT: 3 })).toBe(3);
    expect(engine.evalCondition('COUNT', { COUNT: 0 })).toBe(0);
  });
});
