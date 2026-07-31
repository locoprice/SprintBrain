import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildFormMenuToken,
  formMenuPicks,
  isValidMenuName,
  nextMenuName,
  sanitizeMenuName,
  sanitizeMenuOption,
} from '@/lib/formMenuToken';

// The dashboard writes {formmenu:} tokens with its own mirrored writer
// (src/lib/formMenuToken.ts) because it cannot import extension source, while
// the shipping formula engine is what parses them back at expansion time. These
// tests load the REAL engine and pin both halves against each other — a drift
// between writer and parser is exactly the failure that would ship a menu that
// looks right in the editor and resolves to nothing in a page.
function loadHelper<T>(path: string): T {
  const src = readFileSync(path, 'utf8');
  const mod = { exports: {} as unknown };
  const run = new Function('module', 'exports', src) as (m: typeof mod, e: unknown) => void;
  run(mod, mod.exports);
  return mod.exports as T;
}

interface MenuCfg {
  type: string;
  opts?: string;
  default?: string;
  multiple?: boolean;
  cols?: number;
}

interface FormulaEngine {
  buildFormFieldCfg: (body: string) => Record<string, MenuCfg>;
  buildFormMenuToken: (cfg: {
    options: string[];
    selected: string[];
    name: string;
    multiple?: boolean;
    cols?: number | null;
  }) => string;
  formMenuPicks: (value: string | null | undefined) => string[];
  resolveBody: (body: string, vals: Record<string, unknown>) => string;
  extractFields: (body: string) => string[];
}

const engine = loadHelper<FormulaEngine>(
  resolve(process.cwd(), '..', 'extension', 'formula-engine.js'),
);

describe('formMenuToken — writer', () => {
  it('writes options, name, default, multiple and cols in parse order', () => {
    expect(
      buildFormMenuToken({
        options: ['Choice A', 'Choice B', 'Choice C'],
        selected: ['Choice B'],
        name: 'MENU_1',
        multiple: false,
        cols: null,
      }),
    ).toBe('{formmenu: Choice A,Choice B,Choice C; name=MENU_1; default=Choice B}');

    expect(
      buildFormMenuToken({
        options: ['Bank transfer', 'Card'],
        selected: ['Card', 'Bank transfer'],
        name: 'PAYMENT',
        multiple: true,
        cols: 24,
      }),
    ).toBe('{formmenu: Bank transfer,Card; name=PAYMENT; default=Card,Bank transfer; multiple=yes; cols=24}');
  });

  it('keeps a single-choice menu to one default', () => {
    const token = buildFormMenuToken({
      options: ['A', 'B'],
      selected: ['A', 'B'],
      name: 'PICK',
      multiple: false,
      cols: null,
    });
    expect(token).toBe('{formmenu: A,B; name=PICK; default=A}');
  });

  it('drops blank and duplicate options, and defaults that are not options', () => {
    expect(
      buildFormMenuToken({
        options: ['A', '', '  ', 'A', 'B'],
        selected: ['Zebra'],
        name: 'PICK',
        multiple: false,
        cols: null,
      }),
    ).toBe('{formmenu: A,B; name=PICK}');
  });

  it('collapses the token delimiters inside an option label', () => {
    expect(sanitizeMenuOption('Half-board; breakfast, dinner {included}')).toBe(
      'Half-board breakfast dinner included',
    );
  });

  it('always emits a name the engine accepts', () => {
    expect(sanitizeMenuName('2 nights!')).toBe('MENU_2nights');
    expect(sanitizeMenuName('')).toBe('MENU_');
    expect(isValidMenuName('MENU_1')).toBe(true);
    expect(isValidMenuName('1MENU')).toBe(false);
    expect(isValidMenuName('MENU-1')).toBe(false);
  });

  it('suggests the next free MENU_n for a body', () => {
    expect(nextMenuName('')).toBe('MENU_1');
    expect(nextMenuName('{formmenu: A,B; name=MENU_1}')).toBe('MENU_2');
    expect(nextMenuName('{formmenu: A; name=MENU_1} {formmenu: B; name=MENU_2}')).toBe('MENU_3');
    expect(nextMenuName('{formmenu: A; name=PAYMENT}')).toBe('MENU_1');
  });
});

// Text Blaze writes a menu's options as ';'-separated positional settings that
// can sit in any order among the named ones. The dashboard offers a Text Blaze
// importer, and before this the parser read everything after the first ';' as
// settings — so an imported three-option menu silently became a one-option menu
// and the validator still called it healthy.
describe('formMenuField — Text Blaze syntax compatibility', () => {
  it('keeps every option when they are semicolon-separated', () => {
    expect(engine.buildFormFieldCfg('{formmenu: test a; test b; test c; name=choice}')).toEqual({
      choice: { type: 'dd', opts: 'test a\ntest b\ntest c', default: '' },
    });
  });

  it('accepts named settings before the options', () => {
    expect(engine.buildFormFieldCfg('{formmenu: name=choice; test a; test b}')).toEqual({
      choice: { type: 'dd', opts: 'test a\ntest b', default: '' },
    });
  });

  it('reads default= wherever it sits', () => {
    expect(engine.buildFormFieldCfg('{formmenu: 1980; 1985; name=year; default=1985}')).toEqual({
      year: { type: 'dd', opts: '1980\n1985', default: '1985' },
    });
  });

  it('still parses the comma form this project writes', () => {
    expect(engine.buildFormFieldCfg('{formmenu: a,b,c; name=X; default=b; multiple=yes; cols=20}')).toEqual({
      X: { type: 'dd', opts: 'a\nb\nc', default: 'b', multiple: true, cols: 20 },
    });
  });

  it('accepts the two forms mixed in one token', () => {
    expect(engine.buildFormFieldCfg('{formmenu: a,b; c; name=X; default=c}')).toEqual({
      X: { type: 'dd', opts: 'a\nb\nc', default: 'c' },
    });
  });

  it('gives an unnamed menu a key every read path agrees on', () => {
    const body = 'Pick {formmenu: red; green; blue} please.';
    const key = Object.keys(engine.buildFormFieldCfg(body))[0] ?? '';
    expect(key).toMatch(/^MENU_/);
    // extractFields drives the fill form; resolveBody consumes what it collects.
    // If these disagreed the field would render but never fill.
    expect(engine.extractFields(body)).toEqual([key]);
    expect(engine.resolveBody(body, { [key]: 'green' })).toBe('Pick green please.');
  });

  it('keys an unnamed menu the same inside an {if:} block, where resolveBody recurses', () => {
    const body = '{if: N > 0}Pick {formmenu: red; green; blue}{endif}';
    const key = Object.keys(engine.buildFormFieldCfg(body))[0] ?? '';
    expect(engine.resolveBody(body, { N: 1, [key]: 'blue' })).toBe('Pick blue');
  });

  it('does not invent a field for a menu with no options at all', () => {
    expect(engine.buildFormFieldCfg('{formmenu: }')).toEqual({});
  });
});

describe('formMenuToken — round-trips through the shipping engine', () => {
  it('parses back to the config it was written from', () => {
    const token = buildFormMenuToken({
      options: ['Choice A', 'Choice B', 'Choice C'],
      selected: ['Choice B'],
      name: 'MENU_1',
      multiple: false,
      cols: null,
    });
    expect(engine.buildFormFieldCfg(token)).toEqual({
      MENU_1: { type: 'dd', opts: 'Choice A\nChoice B\nChoice C', default: 'Choice B' },
    });
  });

  it('carries multiple + cols through to the field config', () => {
    const token = buildFormMenuToken({
      options: ['Bank transfer', 'Card'],
      selected: ['Card', 'Bank transfer'],
      name: 'PAYMENT',
      multiple: true,
      cols: 24,
    });
    expect(engine.buildFormFieldCfg(token)).toEqual({
      PAYMENT: {
        type: 'dd',
        opts: 'Bank transfer\nCard',
        default: 'Card, Bank transfer',
        multiple: true,
        cols: 24,
      },
    });
  });

  it('agrees with the engine-side writer character for character', () => {
    const cfg = {
      options: ['Choice A', 'Choice B'],
      selected: ['Choice B'],
      name: 'MENU_1',
      multiple: true,
      cols: 12,
    };
    expect(buildFormMenuToken({ ...cfg, cols: 12 })).toBe(engine.buildFormMenuToken(cfg));
  });

  it('splits a default the same way on both sides', () => {
    expect(formMenuPicks('Card, Bank transfer')).toEqual(['Card', 'Bank transfer']);
    expect(engine.formMenuPicks('Card, Bank transfer')).toEqual(['Card', 'Bank transfer']);
    expect(formMenuPicks('')).toEqual([]);
    expect(engine.formMenuPicks(null)).toEqual([]);
  });
});

describe('formula engine — {formmenu:} resolution', () => {
  it('surfaces the menu as one field and emits the picked value', () => {
    const body = 'Payment: {formmenu: Card,Bank transfer; name=PAYMENT; default=Card}';
    expect(engine.extractFields(body)).toEqual(['PAYMENT']);
    expect(engine.resolveBody(body, { PAYMENT: 'Bank transfer' })).toBe('Payment: Bank transfer');
    // Nothing picked yet — the token contributes no text rather than leaking.
    expect(engine.resolveBody(body, {})).toBe('Payment: ');
  });

  it('emits every pick of a multiple menu', () => {
    const body = 'Extras: {formmenu: Towels,Crib,Parking; name=EXTRAS; multiple=yes}';
    expect(engine.resolveBody(body, { EXTRAS: 'Towels, Parking' })).toBe('Extras: Towels, Parking');
  });

  it('reads the menu value back through a {NAME} reference too', () => {
    const body = '{formmenu: Card,Cash; name=PAYMENT; default=Card}Pay by {PAYMENT}.';
    expect(engine.resolveBody(body, { PAYMENT: 'Cash' })).toBe('CashPay by Cash.');
  });

  // CONTRACT CHANGE (Text Blaze parity): a named setting is now recognised in
  // any position, not only after the first ';'. That is what lets an imported
  // "{formmenu: a; b; c; name=x}" keep all three options. The cost is that a
  // segment which literally opens with "name=" is read as the setting it looks
  // like — the same ambiguity Text Blaze resolves by escaping the '='. Our
  // parser has no escape support, so this is the documented trade.
  it('reads a leading name= as the field name, not as an option', () => {
    const cfg = engine.buildFormFieldCfg('{formmenu: name=Bob; Other; Third}');
    expect(Object.keys(cfg)).toEqual(['Bob']);
    expect(cfg.Bob?.opts).toBe('Other\nThird');
  });

  it('gives a nameless menu a field instead of discarding it', () => {
    // Previously this returned {} and the menu vanished at expansion time.
    // Text Blaze allows unnamed menus, so the engine now keys them itself.
    const cfg = engine.buildFormFieldCfg('{formmenu: A,B}');
    const key = Object.keys(cfg)[0] ?? '';
    expect(key).toMatch(/^MENU_/);
    expect(cfg[key]?.opts).toBe('A\nB');
    expect(engine.extractFields('{formmenu: A,B}')).toEqual([key]);
  });
});
