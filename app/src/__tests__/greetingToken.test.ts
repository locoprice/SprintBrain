import { describe, expect, it, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Same loading trick as genderGreeting.test.ts: run the REAL shipping engine
// (extension/formula-engine.js) rather than a copy, so these expectations pin
// what the extension, the popup and Sprintbrain.html actually resolve.
interface FormulaEngine {
  resolveBody: (body: string, vals: Record<string, unknown>, opts?: { lang?: string }) => string;
  extractFields: (body: string) => string[];
  fieldContext: (body: string) => Record<string, { before: string; after: string }>;
  validateTemplate: (body: string) => { ok: boolean; code: string | null; message: string };
  buildFormFieldCfg: (body: string) => Record<string, unknown>;
  sbGreetingSlot: (hour: number) => string;
  sbGreetingText: (
    hour: number,
    lang?: string | null,
    overrides?: Record<string, string>,
  ) => string;
}

const src = readFileSync(resolve(process.cwd(), '..', 'extension', 'formula-engine.js'), 'utf8');
const module_ = { exports: {} as FormulaEngine };
new Function('module', 'exports', src)(module_, module_.exports);
const engine = module_.exports;

/**
 * Resolve a body as if the wall clock read `hour`, so a run at 03:00 CI-time
 * asserts the same thing as a run at 15:00.
 */
function atHour<T>(hour: number, fn: () => T): T {
  vi.useFakeTimers();
  const d = new Date();
  d.setHours(hour, 30, 0, 0);
  vi.setSystemTime(d);
  try {
    return fn();
  } finally {
    vi.useRealTimers();
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('time-of-day slots', () => {
  it('opens each slot on the stated hour', () => {
    expect(engine.sbGreetingSlot(5)).toBe('morning');
    expect(engine.sbGreetingSlot(12)).toBe('afternoon');
    expect(engine.sbGreetingSlot(18)).toBe('evening');
    expect(engine.sbGreetingSlot(22)).toBe('night');
  });

  it('closes each slot on the hour before the next one opens', () => {
    expect(engine.sbGreetingSlot(4)).toBe('night');
    expect(engine.sbGreetingSlot(11)).toBe('morning');
    expect(engine.sbGreetingSlot(17)).toBe('afternoon');
    expect(engine.sbGreetingSlot(21)).toBe('evening');
  });

  it('covers the whole clock, midnight included', () => {
    const slots = new Set<string>();
    for (let h = 0; h < 24; h += 1) slots.add(engine.sbGreetingSlot(h));
    expect([...slots].sort()).toEqual(['afternoon', 'evening', 'morning', 'night']);
    expect(engine.sbGreetingSlot(0)).toBe('night');
    expect(engine.sbGreetingSlot(23)).toBe('night');
  });

  it('does not throw on a value that is not an hour', () => {
    expect(engine.sbGreetingSlot(NaN)).toBe('night');
    expect(engine.sbGreetingSlot(Infinity)).toBe('night');
  });
});

describe('greeting wording per language', () => {
  const TABLE: Record<string, [string, string, string, string]> = {
    EN: ['Good morning', 'Good afternoon', 'Good evening', 'Good night'],
    IT: ['Buongiorno', 'Buon pomeriggio', 'Buonasera', 'Buona notte'],
    ES: ['Buenos días', 'Buenas tardes', 'Buenas noches', 'Buenas noches'],
    FR: ['Bonjour', 'Bonjour', 'Bonsoir', 'Bonne nuit'],
  };

  it.each(Object.entries(TABLE))('reads correctly in %s across the day', (lang, words) => {
    const [morning, afternoon, evening, night] = words;
    expect(engine.sbGreetingText(9, lang)).toBe(morning);
    expect(engine.sbGreetingText(15, lang)).toBe(afternoon);
    expect(engine.sbGreetingText(20, lang)).toBe(evening);
    expect(engine.sbGreetingText(2, lang)).toBe(night);
  });

  it('keeps the phrases a language genuinely repeats', () => {
    // Not a copy-paste slip in the table: Spanish has one phrase for evening and
    // night, French has one for the whole first half of the day.
    expect(engine.sbGreetingText(20, 'ES')).toBe(engine.sbGreetingText(2, 'ES'));
    expect(engine.sbGreetingText(9, 'FR')).toBe(engine.sbGreetingText(15, 'FR'));
  });

  it('accepts a language in any case', () => {
    expect(engine.sbGreetingText(9, 'it')).toBe('Buongiorno');
    expect(engine.sbGreetingText(9, 'Es')).toBe('Buenos días');
  });

  it('falls back to English rather than printing nothing', () => {
    for (const lang of ['MULTI', 'DE', '', null, undefined]) {
      expect(engine.sbGreetingText(9, lang)).toBe('Good morning');
    }
  });
});

describe('{greeting} token', () => {
  it('resolves from the local clock', () => {
    expect(atHour(9, () => engine.resolveBody('{greeting}!', {}))).toBe('Good morning!');
    expect(atHour(20, () => engine.resolveBody('{greeting}!', {}))).toBe('Good evening!');
    expect(atHour(23, () => engine.resolveBody('{greeting}!', {}))).toBe('Good night!');
  });

  it('uses the language the snippet is written in', () => {
    expect(
      atHour(9, () => engine.resolveBody('{greeting}, {NAME}.', { NAME: 'Ada' }, { lang: 'IT' })),
    ).toBe('Buongiorno, Ada.');
    expect(atHour(15, () => engine.resolveBody('{greeting}.', {}, { lang: 'ES' }))).toBe(
      'Buenas tardes.',
    );
    expect(atHour(20, () => engine.resolveBody('{greeting}.', {}, { lang: 'FR' }))).toBe(
      'Bonsoir.',
    );
  });

  it('lets a token override the snippet language, which is what a mixed body needs', () => {
    const body =
      '{greeting: lang=EN} / {greeting: lang=IT} / {greeting: lang=ES} / {greeting: lang=FR}';
    expect(atHour(9, () => engine.resolveBody(body, {}, { lang: 'MULTI' }))).toBe(
      'Good morning / Buongiorno / Buenos días / Bonjour',
    );
  });

  it('accepts per-slot wording, so a language with no table still reads right', () => {
    const body =
      '{greeting: morning=Guten Morgen; afternoon=Guten Tag; evening=Guten Abend; night=Gute Nacht}';
    expect(atHour(9, () => engine.resolveBody(body, {}))).toBe('Guten Morgen');
    expect(atHour(15, () => engine.resolveBody(body, {}))).toBe('Guten Tag');
    expect(atHour(20, () => engine.resolveBody(body, {}))).toBe('Guten Abend');
    expect(atHour(2, () => engine.resolveBody(body, {}))).toBe('Gute Nacht');
  });

  it('falls back to the table for a slot no override names', () => {
    const body = '{greeting: lang=IT; night=Buonanotte}';
    expect(atHour(9, () => engine.resolveBody(body, {}))).toBe('Buongiorno');
    expect(atHour(2, () => engine.resolveBody(body, {}))).toBe('Buonanotte');
  });

  it('honours an override declared empty', () => {
    expect(atHour(2, () => engine.resolveBody('{greeting: night=}Hello', {}))).toBe('Hello');
    expect(atHour(9, () => engine.resolveBody('{greeting: night=} there', {}))).toBe(
      'Good morning there',
    );
  });

  it('is not a field to fill in', () => {
    expect(engine.extractFields('{greeting}')).toEqual([]);
    expect(engine.extractFields('{greeting: lang=ES}')).toEqual([]);
    expect(engine.extractFields('{greeting} {NAME}')).toEqual(['NAME']);
    expect(engine.buildFormFieldCfg('{greeting: lang=ES}')).toEqual({});
  });

  it('does not shadow a field genuinely named greetings', () => {
    expect(engine.extractFields('{greetings}')).toEqual(['greetings']);
    expect(atHour(9, () => engine.resolveBody('{greetings}', { greetings: 'Hola' }))).toBe('Hola');
  });

  it('is a boundary in a fill-form label, never part of the prose', () => {
    const ctx = engine.fieldContext('{greeting} {NAME}, welcome');
    expect(ctx.NAME).toEqual({ before: '', after: ', welcome' });
  });

  it('passes the template validator', () => {
    expect(engine.validateTemplate('{greeting}').ok).toBe(true);
    expect(engine.validateTemplate('{greeting: lang=ES}').ok).toBe(true);
  });

  it('resolves inside a conditional branch', () => {
    const body = '{if: N > 0}{greeting: lang=IT}{else}nothing{endif}';
    expect(atHour(20, () => engine.resolveBody(body, { N: 1 }))).toBe('Buonasera');
    expect(atHour(20, () => engine.resolveBody(body, { N: 0 }))).toBe('nothing');
  });

  it('leaves the word beside it alone: the gender rule owns that', () => {
    // "Buenos días" is not in the gendered-word dictionary, so the name that
    // follows must not rewrite it.
    expect(atHour(9, () => engine.resolveBody('{greeting: lang=ES} {N}', { N: 'Lucía' }))).toBe(
      'Buenos días Lucía',
    );
    // The two features compose: a {gender:} token still inflects its own word.
    expect(
      atHour(9, () =>
        engine.resolveBody('{greeting: lang=ES}, {gender: N; m=querido; f=querida} {N}', {
          N: 'Lucía',
        }),
      ),
    ).toBe('Buenos días, querida Lucía');
  });
});
