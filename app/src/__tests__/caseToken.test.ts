import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// {case: upper|lower|title|sentence}…{/case} — extension/formula-engine.js.
//
// The region is resolved BEFORE it is cased, so a field or a formula inside it
// expands normally and only then takes the case. That ordering is what makes
// {case: upper}{formtext: name}{/case} print the value in capitals rather than
// the literal token, and it is pinned below.
//
// Title case is the fussy one. Capitalizing every word is not title case: the
// articles, the coordinating conjunctions and the short prepositions stay
// lowercase, so it is "The Art of Public Speaking", never "The Art Of Public
// Speaking". Three exemptions override that: the first word, the last word, and
// the word opening a subtitle after a colon.
//
// The mobile companion keeps its OWN copy of these rules (it cannot load the
// extension engine), so a change here has to be ported to
// app/public/mobile/index.html by hand or the same snippet prints differently
// on the phone.

function loadHelper<T>(path: string): T {
  const src = readFileSync(path, 'utf8');
  const mod = { exports: {} as unknown };
  const run = new Function('module', 'exports', src) as (m: typeof mod, e: unknown) => void;
  run(mod, mod.exports);
  return mod.exports as T;
}

interface FormulaEngine {
  resolveBody: (body: string, vals: Record<string, unknown>) => string;
  extractFields: (body: string) => string[];
  validateTemplate: (body: string) => { ok: boolean; code: string | null; message: string };
}

const engine = loadHelper<FormulaEngine>(
  resolve(process.cwd(), '..', 'extension', 'formula-engine.js'),
);

const title = (body: string) => engine.resolveBody(`{case: title}${body}{/case}`, {});

describe('{case:} — the four modes', () => {
  it('prints a region in capitals or in lowercase', () => {
    expect(engine.resolveBody('{case: upper}hello world{/case}', {})).toBe('HELLO WORLD');
    expect(engine.resolveBody('{case: lower}HELLO World{/case}', {})).toBe('hello world');
  });

  it('opens every sentence in sentence mode', () => {
    expect(engine.resolveBody('{case: sentence}HELLO there. HOW are you? fine!{/case}', {})).toBe(
      'Hello there. How are you? Fine!',
    );
  });

  it('leaves the text alone when the mode is not recognised', () => {
    // A typo must never silently delete what the author wrote.
    expect(engine.resolveBody('{case: sideways}Left Alone{/case}', {})).toBe('Left Alone');
  });

  it('drops only the head when the region is never closed', () => {
    expect(engine.resolveBody('{case: upper}tail', {})).toBe('tail');
    expect(engine.validateTemplate('{case: upper}x').code).toBe('unclosed-case');
  });
});

describe('{case:} — resolves before it cases', () => {
  it('cases the value a field holds, not the token', () => {
    expect(engine.resolveBody('{case: upper}{formtext: name=who}{/case}', { who: 'valentina' })).toBe(
      'VALENTINA',
    );
    expect(title('{formtext: name=who} of london')).toBe(' Of London');
    expect(engine.resolveBody('{case: title}{formtext: name=who} of london{/case}', { who: 'the tower' })).toBe(
      'The Tower of London',
    );
  });

  it('cases the result of a formula', () => {
    expect(engine.resolveBody('{case: upper}total {= 2*3} eur{/case}', {})).toBe('TOTAL 6 EUR');
  });

  it('still surfaces a field declared inside the region', () => {
    expect(engine.extractFields('{case: upper}{formtext: name=who}{/case}')).toEqual(['who']);
  });
});

describe('{case: title} — small words stay lowercase', () => {
  it('lowercases articles, conjunctions and short prepositions', () => {
    expect(title('the art of public speaking')).toBe('The Art of Public Speaking');
    expect(title('journal of applied linguistics')).toBe('Journal of Applied Linguistics');
    expect(title('war and peace but not now')).toBe('War and Peace but Not Now');
    expect(title('a tale of a city')).toBe('A Tale of a City');
  });

  it('always capitalizes the first word, even a small one', () => {
    expect(title('of mice and men')).toBe('Of Mice and Men');
    expect(title('the')).toBe('The');
  });

  it('always capitalizes the last word, even a small one', () => {
    expect(title('something to live for')).toBe('Something to Live For');
  });

  it('capitalizes the word that opens a subtitle', () => {
    expect(title('the guide: a manual for beginners')).toBe('The Guide: A Manual for Beginners');
  });

  it('keeps prepositions of four letters or more capitalized', () => {
    expect(title('the bridge over the river')).toBe('The Bridge Over the River');
  });

  it('treats a hyphenated compound as separate words', () => {
    expect(title('state-of-the-art design')).toBe('State-of-the-Art Design');
  });

  it('normalizes text that arrives shouting', () => {
    expect(title('THE ART OF SPEAKING')).toBe('The Art of Speaking');
  });

  it('leaves text with no letters untouched', () => {
    expect(title('   ')).toBe('   ');
    expect(title('123 456')).toBe('123 456');
  });
});
