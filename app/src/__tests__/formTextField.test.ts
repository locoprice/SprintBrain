import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildFormTextToken,
  isValidFieldName,
  nextTextName,
  sanitizeTextDefault,
  sanitizeTextName,
} from '@/lib/formTextToken';

// The dashboard writes {formtext:} tokens with its own writer
// (src/lib/formTextToken.ts) because it cannot import extension source, while
// the shipping formula engine is what parses them back at expansion time. These
// tests load the REAL engine and pin both halves against each other — a drift
// between writer and parser is exactly the failure that would ship a field that
// looks right in the editor and resolves to nothing in a page.
function loadHelper<T>(path: string): T {
  const src = readFileSync(path, 'utf8');
  const mod = { exports: {} as unknown };
  const run = new Function('module', 'exports', src) as (m: typeof mod, e: unknown) => void;
  run(mod, mod.exports);
  return mod.exports as T;
}

interface FieldCfg {
  type: string;
  default?: string;
}

interface FormulaEngine {
  buildFormFieldCfg: (body: string) => Record<string, FieldCfg>;
  extractFields: (body: string) => string[];
  resolveBody: (body: string, vals: Record<string, unknown>) => string;
}

const engine = loadHelper<FormulaEngine>(
  resolve(process.cwd(), '..', 'extension', 'formula-engine.js'),
);

describe('formTextToken — writer', () => {
  it('writes a bare named field', () => {
    expect(buildFormTextToken({ name: 'TEXT_1', default: '' })).toBe('{formtext: name=TEXT_1}');
  });

  it('carries a default when there is one', () => {
    expect(buildFormTextToken({ name: 'GUEST', default: 'Ada' })).toBe(
      '{formtext: name=GUEST; default=Ada}',
    );
  });

  it('repairs a name the engine would reject', () => {
    // A name starting with a digit is not an identifier, and a token the engine
    // rejects expands to nothing — so it is prefixed rather than emitted broken.
    expect(buildFormTextToken({ name: '2nd guest', default: '' })).toBe(
      '{formtext: name=TEXT_2ndguest}',
    );
  });

  it('keeps the token grammar out of a default', () => {
    expect(buildFormTextToken({ name: 'N', default: 'a; b {c} d' })).toBe(
      '{formtext: name=N; default=a b c d}',
    );
  });

  it('drops a default that is only whitespace', () => {
    expect(buildFormTextToken({ name: 'N', default: '   ' })).toBe('{formtext: name=N}');
  });
});

describe('formTextToken — helpers', () => {
  it('accepts identifiers and rejects everything else', () => {
    expect(isValidFieldName('TEXT_1')).toBe(true);
    expect(isValidFieldName('_private')).toBe(true);
    expect(isValidFieldName('')).toBe(false);
    expect(isValidFieldName('2nd')).toBe(false);
    expect(isValidFieldName('has space')).toBe(false);
  });

  it('sanitizes names and defaults', () => {
    expect(sanitizeTextName('guest name!')).toBe('guestname');
    expect(sanitizeTextName('')).toBe('TEXT_');
    expect(sanitizeTextDefault('one\ntwo')).toBe('one two');
    expect(sanitizeTextDefault('  padded  ')).toBe('padded');
    // A comma is safe: a text field holds one value, read to the next ';'.
    expect(sanitizeTextDefault('Rome, Italy')).toBe('Rome, Italy');
  });

  it('hands out the lowest free TEXT_n', () => {
    expect(nextTextName('')).toBe('TEXT_1');
    expect(nextTextName('{formtext: name=TEXT_1}')).toBe('TEXT_2');
    // A bare placeholder is the same field to the engine, so its name is taken.
    expect(nextTextName('Hi {TEXT_1}, see {formtext: name=TEXT_2}')).toBe('TEXT_3');
    expect(nextTextName('{formtext: name=TEXT_2}')).toBe('TEXT_1');
    expect(nextTextName('{formtext: name=GUEST}')).toBe('TEXT_1');
  });
});

describe('formTextToken — round trip through the shipping engine', () => {
  const CASES: Array<{ name: string; default: string }> = [
    { name: 'TEXT_1', default: '' },
    { name: 'GUEST', default: 'Ada' },
    { name: 'CITY', default: 'Rome, Italy' },
    { name: '_note', default: 'see below' },
  ];

  for (const cfg of CASES) {
    it(`declares a text field for ${cfg.name}`, () => {
      const token = buildFormTextToken(cfg);
      const built = engine.buildFormFieldCfg(token);

      expect(Object.keys(built)).toEqual([cfg.name]);
      expect(built[cfg.name]?.type).toBe('text');
      expect(built[cfg.name]?.default).toBe(sanitizeTextDefault(cfg.default));
      expect(engine.extractFields(token)).toEqual([cfg.name]);
    });

    it(`emits the value filled in for ${cfg.name}`, () => {
      const token = buildFormTextToken(cfg);
      expect(engine.resolveBody(`Hi ${token}!`, { [cfg.name]: 'Ada' })).toBe('Hi Ada!');
      // Nothing filled in means nothing printed — never the raw token.
      expect(engine.resolveBody(`Hi ${token}!`, {})).toBe('Hi !');
    });
  }

  it('survives a default that carried the grammar', () => {
    const token = buildFormTextToken({ name: 'N', default: 'a; default=b' });
    const built = engine.buildFormFieldCfg(token);
    expect(built.N?.default).toBe('a default=b');
  });

  it('keeps two fields apart in one body', () => {
    const body = `${buildFormTextToken({ name: 'TEXT_1', default: 'x' })} / ${buildFormTextToken({
      name: 'TEXT_2',
      default: 'y',
    })}`;
    expect(engine.extractFields(body)).toEqual(['TEXT_1', 'TEXT_2']);
    expect(engine.resolveBody(body, { TEXT_1: 'a', TEXT_2: 'b' })).toBe('a / b');
  });

  it('drops an unnamed field — the reason the builder requires a name', () => {
    // Pins the engine behaviour the dialog is designed around: unlike a menu,
    // {formtext:} has no derived key, so an unnamed one declares no field and
    // prints nothing. If this ever changes, the name may become optional.
    expect(engine.buildFormFieldCfg('{formtext: default=Ada}')).toEqual({});
    expect(engine.extractFields('{formtext: default=Ada}')).toEqual([]);
    expect(engine.resolveBody('Hi {formtext: default=Ada}!', {})).toBe('Hi !');
  });
});
