import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Same loading trick as formulaConditions.test.ts: run the REAL shipping engine
// (extension/formula-engine.js) rather than a copy, so these expectations pin
// the behaviour the extension and Sprintbrain.html actually get.
interface FormulaEngine {
  resolveBody: (body: string, vals: Record<string, unknown>, opts?: { lang?: string }) => string;
  extractFields: (body: string) => string[];
  sbNameGender: (name: string, lang?: string) => string;
}

const src = readFileSync(
  resolve(process.cwd(), '..', 'extension', 'formula-engine.js'),
  'utf8',
);
const module_ = { exports: {} as FormulaEngine };
new Function('module', 'exports', src)(module_, module_.exports);
const engine = module_.exports;

describe('name → gender resolution', () => {
  it('reads the romance suffix rule', () => {
    expect(engine.sbNameGender('Lucia')).toBe('f');
    expect(engine.sbNameGender('Marco')).toBe('m');
  });

  it('normalises accents, case and surnames away', () => {
    expect(engine.sbNameGender('LUCÍA')).toBe('f');
    expect(engine.sbNameGender('Lucía Pérez')).toBe('f');
    expect(engine.sbNameGender('  josé  ')).toBe('m');
  });

  it('overrides the suffix rule where it would be wrong', () => {
    expect(engine.sbNameGender('Carmen')).toBe('f');
    expect(engine.sbNameGender('Consuelo')).toBe('f');
    expect(engine.sbNameGender('Luca')).toBe('m');
    expect(engine.sbNameGender('Vicente')).toBe('m');
  });

  it('resolves language-dependent names by language', () => {
    expect(engine.sbNameGender('Andrea', 'IT')).toBe('m');
    expect(engine.sbNameGender('Andrea', 'ES')).toBe('f');
    expect(engine.sbNameGender('Andrea')).toBe('');
  });

  it('returns unknown for unisex names and non-names', () => {
    expect(engine.sbNameGender('Alex')).toBe('');
    expect(engine.sbNameGender('Sasha')).toBe('');
    expect(engine.sbNameGender('')).toBe('');
    expect(engine.sbNameGender('150')).toBe('');
  });
});

describe('automatic greeting inflection', () => {
  it('agrees the greeting with the name', () => {
    expect(engine.resolveBody('Querido {NOMBRE}, buenos días', { NOMBRE: 'Lucia' }))
      .toBe('Querida Lucia, buenos días');
    expect(engine.resolveBody('Querido {NOMBRE}, buenos días', { NOMBRE: 'Marco' }))
      .toBe('Querido Marco, buenos días');
  });

  it('inflects in both directions', () => {
    expect(engine.resolveBody('Querida {N}', { N: 'Marco' })).toBe('Querido Marco');
  });

  it('preserves the authored capitalisation', () => {
    expect(engine.resolveBody('QUERIDO {N}', { N: 'Lucia' })).toBe('QUERIDA Lucia');
    expect(engine.resolveBody('querido {N}', { N: 'Lucia' })).toBe('querida Lucia');
  });

  it('takes the ambiguous name from the language of the greeting word', () => {
    expect(engine.resolveBody('Caro {N}', { N: 'Andrea' })).toBe('Caro Andrea');
    expect(engine.resolveBody('Querido {N}', { N: 'Andrea' })).toBe('Querida Andrea');
    expect(engine.resolveBody('Cher {N}', { N: 'Andrea' })).toBe('Chère Andrea');
  });

  it('leaves the text alone when the name is unknown or unisex', () => {
    expect(engine.resolveBody('Querido {N}', { N: 'Xanthippos' })).toBe('Querido Xanthippos');
    expect(engine.resolveBody('Querido {N}', { N: 'Alex' })).toBe('Querido Alex');
  });

  it('only touches words in the dictionary', () => {
    expect(engine.resolveBody('Hola {N}', { N: 'Lucia' })).toBe('Hola Lucia');
    expect(engine.resolveBody('Dear {N}', { N: 'Lucia' })).toBe('Dear Lucia');
  });

  it('ignores values that are not names', () => {
    expect(engine.resolveBody('Caro {P} euro', { P: '150' })).toBe('Caro 150 euro');
    expect(engine.resolveBody('Bienvenido a {L}', { L: 'Ibiza' })).toBe('Bienvenido a Ibiza');
  });

  it('needs the greeting adjacent to the field', () => {
    expect(engine.resolveBody('Querido amigo mío, saluda a {N}', { N: 'Lucia' }))
      .toBe('Querido amigo mío, saluda a Lucia');
  });

  it('works through double-brace and form fields', () => {
    expect(engine.resolveBody('Querido {{N}}', { N: 'Lucia' })).toBe('Querida Lucia');
    expect(engine.resolveBody('Querido {formtext: name=N}', { N: 'Lucia' })).toBe('Querida Lucia');
  });
});

describe('{gender:} token', () => {
  it('picks the form matching the field', () => {
    const body = '{gender: N; m=Querido; f=Querida} {N}';
    expect(engine.resolveBody(body, { N: 'Lucia' })).toBe('Querida Lucia');
    expect(engine.resolveBody(body, { N: 'Marco' })).toBe('Querido Marco');
  });

  it('falls back to u= when the name is unknown, else to the masculine', () => {
    expect(engine.resolveBody('{gender: N; m=invitado; f=invitada; u=invitado/a}', { N: 'Alex' }))
      .toBe('invitado/a');
    expect(engine.resolveBody('{gender: N; m=invitado; f=invitada}', { N: 'Alex' }))
      .toBe('invitado');
  });

  it('takes the language from lang=, else from the snippet', () => {
    const body = '{gender: N; m=Caro; f=Cara; lang=IT}';
    expect(engine.resolveBody(body, { N: 'Andrea' })).toBe('Caro');
    expect(engine.resolveBody('{gender: N; m=Caro; f=Cara}', { N: 'Andrea' }, { lang: 'IT' }))
      .toBe('Caro');
    expect(engine.resolveBody('{gender: N; m=Querido; f=Querida}', { N: 'Andrea' }, { lang: 'ES' }))
      .toBe('Querida');
  });

  it('wins over automatic inflection', () => {
    // 'Querido' is a dictionary word, so the following {N} would otherwise
    // re-inflect it as Spanish and undo the author's explicit IT choice.
    expect(engine.resolveBody('{gender: N; m=Querido; f=Querida; lang=IT} {N}', { N: 'Andrea' }))
      .toBe('Querido Andrea');
  });

  it('surfaces the field it reads, without duplicating it', () => {
    expect(engine.extractFields('{gender: N; m=Querido; f=Querida} {N} {CHECKIN}'))
      .toEqual(['N', 'CHECKIN']);
    expect(engine.extractFields('{gender: N; m=Q; f=Qa}')).toEqual(['N']);
  });
});
