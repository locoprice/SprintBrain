import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  NOT_PERSON_WORDS,
  PERSON_NAME_STEMS,
  PERSON_NAME_WORDS,
  buildFormTextToken,
  isPersonNameKey,
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
  format?: string;
}

interface FormulaEngine {
  buildFormFieldCfg: (body: string) => Record<string, FieldCfg>;
  extractFields: (body: string) => string[];
  resolveBody: (
    body: string,
    vals: Record<string, unknown>,
    opts?: { lang?: string },
  ) => string;
  sbIsPersonNameKey: (key: string) => boolean;
  PERSON_NAME_WORDS: Record<string, number>;
  PERSON_NAME_STEMS: string[];
  NOT_PERSON_WORDS: Record<string, number>;
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

  it('marks a field that holds a person name', () => {
    expect(buildFormTextToken({ name: 'GUEST', default: '', personName: true })).toBe(
      '{formtext: name=GUEST; format=name}',
    );
    expect(buildFormTextToken({ name: 'GUEST', default: 'huésped', personName: true })).toBe(
      '{formtext: name=GUEST; format=name; default=huésped}',
    );
  });
});

describe('formTextToken: a person name through the shipping engine', () => {
  const token = buildFormTextToken({ name: 'GUEST', default: 'huésped', personName: true });

  it('declares a text field that prints as a name', () => {
    expect(engine.buildFormFieldCfg(token).GUEST).toEqual({
      type: 'text',
      default: 'huésped',
      format: 'name',
    });
  });

  it('prints what was typed with the capitals of the snippet language', () => {
    expect(engine.resolveBody(`Hey ${token}!`, { GUEST: 'giovanni rossi' }, { lang: 'EN' })).toBe(
      'Hey Giovanni Rossi!',
    );
    expect(engine.resolveBody(`Ciao ${token}!`, { GUEST: 'signor rossi' }, { lang: 'IT' })).toBe(
      'Ciao signor Rossi!',
    );
    expect(engine.resolveBody(`Hola ${token}`, { GUEST: 'maria de la cruz' }, { lang: 'ES' })).toBe(
      'Hola Maria de la Cruz',
    );
    expect(engine.resolveBody(`Hey ${token}`, { GUEST: 'GIOVANNI ROSSI' }, { lang: 'EN' })).toBe(
      'Hey Giovanni Rossi',
    );
  });

  it('prints the default exactly as the author wrote it', () => {
    expect(engine.resolveBody(`Estimado ${token}`, { GUEST: 'huésped' }, { lang: 'ES' })).toBe(
      'Estimado huésped',
    );
  });

  it('leaves a capital typed on purpose alone', () => {
    expect(engine.resolveBody(`Hi ${token}`, { GUEST: 'McDonald' }, { lang: 'EN' })).toBe(
      'Hi McDonald',
    );
  });

  it('never re-cases a plain text field', () => {
    const plain = buildFormTextToken({ name: 'GUEST', default: '' });
    expect(engine.resolveBody(`Hey ${plain}!`, { GUEST: 'giovanni rossi' }, { lang: 'EN' })).toBe(
      'Hey giovanni rossi!',
    );
  });
});

// Every field name in the production library, in the shape it was written, plus
// the ones the rule exists to turn down. Kept in step with PERSON_KEYS in
// scripts/check-snippets.js, which holds the phone to the same answers.
const PERSON_KEYS = [
  'guest_name', 'guestname', 'Guestname', 'GuestName', 'NAME', 'nombrecliente',
  'nomecliente', 'Nomecliente', 'nomeospite', 'first_name', 'lastName', 'full_name',
  'surname', 'cognome', 'nominativo', 'nom', 'prenom', 'prénom', 'nom_client',
  'apellidos', 'name2', 'nomeCompleto', 'clientName', 'nickname',
];
const NOT_PERSON_KEYS = [
  'Nombre_Provedor', 'nombreproveedor', 'Cliente', 'Modello', 'MarcaModello', 'CHECKIN',
  'RATE_PLAN', 'RatePlan', 'Paymentterms', 'DATE_1', 'TIME_1', 'NUM_1', 'TEXT_1', 'G',
  'price', 'linkpreventivo', 'communication', 'saluti', 'username', 'user_name',
  'UserName', 'filename', 'hostname', 'company_name', 'CompanyName', 'nome_azienda',
  'nomeazienda', 'nombre_empresa', 'product_name', 'brand_name', 'model_name',
  'nom_entreprise', 'name_date', '',
];

describe('isPersonNameKey: the editor and the engine read a field name the same way', () => {
  it('keeps the same word lists as the engine', () => {
    expect([...PERSON_NAME_WORDS].sort()).toEqual(Object.keys(engine.PERSON_NAME_WORDS).sort());
    expect([...PERSON_NAME_STEMS].sort()).toEqual([...engine.PERSON_NAME_STEMS].sort());
    expect([...NOT_PERSON_WORDS].sort()).toEqual(Object.keys(engine.NOT_PERSON_WORDS).sort());
  });

  it.each(PERSON_KEYS)('reads %s as a person name', (key) => {
    expect(isPersonNameKey(key)).toBe(true);
    expect(engine.sbIsPersonNameKey(key)).toBe(true);
  });

  it.each(NOT_PERSON_KEYS)('reads %s as something else', (key) => {
    expect(isPersonNameKey(key)).toBe(false);
    expect(engine.sbIsPersonNameKey(key)).toBe(false);
  });
});

describe('formTextToken: a field whose name says it holds a person name', () => {
  it('writes format=name when switched on, even where the name alone would do', () => {
    // A release from before automatic names still reads the attribute.
    expect(buildFormTextToken({ name: 'nome_ospite', default: '', personName: true })).toBe(
      '{formtext: name=nome_ospite; format=name}',
    );
  });

  it('writes format=plain when the author switches it off', () => {
    expect(buildFormTextToken({ name: 'nome_ospite', default: '', personName: false })).toBe(
      '{formtext: name=nome_ospite; format=plain}',
    );
    // Off on a field nobody would read as a name needs no attribute at all.
    expect(buildFormTextToken({ name: 'CITY', default: '', personName: false })).toBe(
      '{formtext: name=CITY}',
    );
  });

  it('leaves the choice to the engine when nobody made one', () => {
    expect(buildFormTextToken({ name: 'nome_ospite', default: '' })).toBe(
      '{formtext: name=nome_ospite}',
    );
  });

  it('prints capitals with no attribute, and as typed with format=plain', () => {
    const auto = buildFormTextToken({ name: 'nome_ospite', default: '' });
    const off = buildFormTextToken({ name: 'nome_ospite', default: '', personName: false });
    expect(engine.resolveBody(`Ciao ${auto}!`, { nome_ospite: 'mario rossi' }, { lang: 'IT' })).toBe(
      'Ciao Mario Rossi!',
    );
    expect(engine.resolveBody(`Ciao ${off}!`, { nome_ospite: 'mario rossi' }, { lang: 'IT' })).toBe(
      'Ciao mario rossi!',
    );
  });

  it('capitalizes a bare {guest_name}, which cannot carry an attribute', () => {
    expect(engine.resolveBody('Hi {guest_name}!', { guest_name: 'francesco' }, { lang: 'EN' })).toBe(
      'Hi Francesco!',
    );
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
