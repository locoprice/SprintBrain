import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildFormMenuToken,
  findMenuTokenAt,
  formMenuPicks,
  isValidMenuName,
  nextMenuName,
  parseFormMenuToken,
  sanitizeMenuName,
  sanitizeMenuOption,
  type FormMenuConfig,
  type MenuTokenRange,
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
  fieldContext: (body: string) => Record<string, { before: string; after: string }>;
  parseFormMenuToken: (raw: string) => FormMenuConfig | null;
  findMenuTokenAt: (body: string, caret: number) => MenuTokenRange | null;
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

// Reading a token back is what turns "insert a menu" into "edit this menu".
// The same matrix is asserted engine-side in scripts/check-snippets.js as
// MENU_READ_CASES, so the two readers cannot drift.
const MENU_READ_CASES = [
  '{formmenu: Choice A,Choice B,Choice C; name=MENU_1; default=Choice B}',
  '{formmenu: Bank transfer,Card; name=PAYMENT; default=Card,Bank transfer; multiple=yes; cols=24}',
  '{formmenu: 1980; 1985; name=YEAR; default=1985}',
  '{formmenu: name=YEAR; 1980; 1985}',
  '{formmenu: A,B; name=M; default=ZZ}',
  '{formmenu: A,B,C; name=M; default=A,C}',
  '{formmenu: A,B}',
  '{formmenu: red; green; blue}',
];

const NOT_MENU_TOKENS = ['{formtext: name=G}', '{formmenuish: A}', 'plain text', '{formmenu: A,B', ''];

describe('formMenuToken — reader', () => {
  it('reads options, name, default, multiple and cols back out', () => {
    expect(
      parseFormMenuToken('{formmenu: A,B,C; name=PICK; default=B; multiple=yes; cols=20}'),
    ).toEqual({
      options: ['A', 'B', 'C'],
      selected: ['B'],
      name: 'PICK',
      multiple: true,
      cols: 20,
    });
  });

  it('leaves an unnamed menu unnamed rather than baking in the engine key', () => {
    // The engine keys these as MENU_<hash> for filling. Writing that back into
    // the token would silently pin a name the author never chose.
    expect(parseFormMenuToken('{formmenu: A,B}')?.name).toBe('');
  });

  it('drops a default that is not one of the options', () => {
    expect(parseFormMenuToken('{formmenu: A,B; default=ZZ}')?.selected).toEqual([]);
  });

  it('keeps a single-choice menu to one preselection', () => {
    expect(parseFormMenuToken('{formmenu: A,B,C; default=A,C}')?.selected).toEqual(['A']);
  });

  it('returns null for anything that is not a complete menu token', () => {
    for (const raw of NOT_MENU_TOKENS) {
      expect(parseFormMenuToken(raw), raw).toBeNull();
      expect(engine.parseFormMenuToken(raw), raw).toBeNull();
    }
  });

  it('agrees with the engine-side reader on every case', () => {
    for (const raw of MENU_READ_CASES) {
      expect(parseFormMenuToken(raw), raw).toEqual(engine.parseFormMenuToken(raw));
    }
  });

  // build() sanitises, dedupes and drops unknown defaults, so a hand-written
  // token is normalised the first time it is saved. What must hold is that
  // saving again changes nothing — otherwise every edit would rewrite the body.
  it('is idempotent once a token has been through the builder', () => {
    for (const raw of MENU_READ_CASES) {
      const cfg = parseFormMenuToken(raw);
      expect(cfg, raw).not.toBeNull();
      const once = buildFormMenuToken(cfg as FormMenuConfig);
      const twice = buildFormMenuToken(parseFormMenuToken(once) as FormMenuConfig);
      expect(twice, raw).toBe(once);
    }
  });

  it('round-trips a built token back to the config it came from', () => {
    const cfg: FormMenuConfig = {
      options: ['Choice A', 'Choice B'],
      selected: ['Choice B'],
      name: 'MENU_1',
      multiple: false,
      cols: 12,
    };
    expect(parseFormMenuToken(buildFormMenuToken(cfg))).toEqual(cfg);
  });
});

describe('formMenuToken — locating the menu under the caret', () => {
  const body = 'Hi {formtext: name=G}, pick {formmenu: A,B; name=P} then {formmenu: X,Y}';
  const first = { start: 28, end: 51, raw: '{formmenu: A,B; name=P}' };
  const second = { start: 57, end: 72, raw: '{formmenu: X,Y}' };

  it('finds the token the caret sits in, including on either brace', () => {
    expect(findMenuTokenAt(body, 28)).toEqual(first); // on the opening brace
    expect(findMenuTokenAt(body, 40)).toEqual(first); // inside
    expect(findMenuTokenAt(body, 51)).toEqual(first); // just past the closing brace
    expect(findMenuTokenAt(body, 60)).toEqual(second);
  });

  it('returns null outside any menu', () => {
    expect(findMenuTokenAt(body, 0)).toBeNull();
    expect(findMenuTokenAt(body, 10)).toBeNull(); // inside the {formtext:}
    expect(findMenuTokenAt(body, 54)).toBeNull(); // in the prose between menus
    expect(findMenuTokenAt('no tokens here', 5)).toBeNull();
    expect(findMenuTokenAt('{formmenu: A,B', 5)).toBeNull(); // never closed
  });

  it('clamps a caret outside the body instead of throwing', () => {
    expect(findMenuTokenAt(body, -10)).toBeNull();
    expect(findMenuTokenAt(body, 9999)).toEqual(second);
  });

  it('agrees with the engine-side finder across the whole body', () => {
    for (let caret = 0; caret <= body.length; caret += 1) {
      expect(findMenuTokenAt(body, caret), `caret ${caret}`).toEqual(
        engine.findMenuTokenAt(body, caret),
      );
    }
  });
});

// The edit path composes three pieces: find the token under the caret, rebuild
// it from the dialog, splice it back. Getting the range wrong overwrites
// unrelated body text, which is the one failure here that destroys work rather
// than just looking wrong — so the composition is asserted, not just its parts.
describe('formMenuToken — editing a menu in place', () => {
  const body =
    'Hi {NAME}, pick {formmenu: Option A,Option B; name=PLAN; default=Option B}' +
    ' and {formmenu: X,Y; name=SECOND}.';

  function editAt(source: string, caret: number, change: (cfg: FormMenuConfig) => FormMenuConfig) {
    const found = findMenuTokenAt(source, caret);
    if (!found) return null;
    const cfg = parseFormMenuToken(found.raw);
    if (!cfg) return null;
    const token = buildFormMenuToken(change(cfg));
    return source.slice(0, found.start) + token + source.slice(found.end);
  }

  it('replaces only the menu the caret is in', () => {
    const caret = body.indexOf('; name=PLAN');
    const next = editAt(body, caret, (cfg) => ({ ...cfg, options: [...cfg.options, 'Option C'] }));
    expect(next).toBe(
      'Hi {NAME}, pick {formmenu: Option A,Option B,Option C; name=PLAN; default=Option B}' +
        ' and {formmenu: X,Y; name=SECOND}.',
    );
  });

  it('edits the second menu without touching the first', () => {
    const caret = body.indexOf('name=SECOND');
    const next = editAt(body, caret, (cfg) => ({ ...cfg, selected: ['Y'] }));
    expect(next).toBe(
      'Hi {NAME}, pick {formmenu: Option A,Option B; name=PLAN; default=Option B}' +
        ' and {formmenu: X,Y; name=SECOND; default=Y}.',
    );
  });

  it('leaves the body byte-identical when nothing is changed', () => {
    const caret = body.indexOf('; name=PLAN');
    expect(editAt(body, caret, (cfg) => cfg)).toBe(body);
  });

  it('renames and drops options without disturbing the surrounding text', () => {
    const caret = body.indexOf('Option A');
    const next = editAt(body, caret, () => ({
      options: ['Yes', 'No'],
      selected: ['No'],
      name: 'PLAN',
      multiple: false,
      cols: null,
    }));
    expect(next).toBe(
      'Hi {NAME}, pick {formmenu: Yes,No; name=PLAN; default=No}' +
        ' and {formmenu: X,Y; name=SECOND}.',
    );
  });

  // submitMenuToken re-checks the stored range against the live body before
  // writing. Without that guard an edit made against a changed body would
  // splice over whatever now sits at those offsets.
  it('detects a stale range instead of overwriting the wrong span', () => {
    const found = findMenuTokenAt(body, body.indexOf('name=SECOND'));
    expect(found).not.toBeNull();
    const range = found as MenuTokenRange;
    const shifted = `A longer prefix — ${body}`;
    expect(shifted.slice(range.start, range.end)).not.toBe(range.raw);
    expect(body.slice(range.start, range.end)).toBe(range.raw);
  });

  it('still edits correctly when the body holds nothing but the menu', () => {
    const only = '{formmenu: A,B; name=M}';
    expect(editAt(only, 0, (cfg) => ({ ...cfg, selected: ['B'] }))).toBe(
      '{formmenu: A,B; name=M; default=B}',
    );
  });
});

// A fill form that labels a control "{MENU_1yvog3p}" tells the operator
// nothing. fieldContext supplies the prose around each token so the row reads
// like the snippet. The same matrix is asserted against the mobile mirror in
// scripts/check-snippets.js as CONTEXT_CASES.
describe('formula engine — surrounding text for a field', () => {
  it('takes the static text either side of the token', () => {
    expect(engine.fieldContext('Rate Plan: {formmenu: Flex,Saver; name=PLAN} per night')).toEqual({
      PLAN: { before: 'Rate Plan:', after: 'per night' },
    });
  });

  it('stops at the neighbouring token, not the neighbouring field', () => {
    expect(engine.fieldContext('Pay {formmenu: Card,Cash; name=PAY} on {formdate: name=W} sharp')).toEqual({
      PAY: { before: 'Pay', after: 'on' },
      W: { before: 'on', after: 'sharp' },
    });
  });

  it('never crosses a newline', () => {
    expect(engine.fieldContext('Some other line\nDear {NAME},\nand more')).toEqual({
      NAME: { before: 'Dear', after: ',' },
    });
  });

  it('strips the markers resolveBody strips, so it quotes what the guest reads', () => {
    expect(engine.fieldContext('Total **{AMOUNT}** [blue]EUR[/blue] due')).toEqual({
      AMOUNT: { before: 'Total', after: 'EUR due' },
    });
  });

  it('never leaks a {button} code block into a label', () => {
    const ctx = engine.fieldContext('Sum {TOTAL}{button label="Go"}TOTAL = 1 + 2{/button} done');
    expect(ctx.TOTAL).toEqual({ before: 'Sum', after: '' });
  });

  it('truncates a long lead-in from the left, keeping the words nearest the control', () => {
    const ctx = engine.fieldContext(
      'This is a really quite long sentence indeed that runs on {NAME} end',
    );
    expect(ctx.NAME?.before.startsWith('…')).toBe(true);
    expect(ctx.NAME?.before.endsWith('runs on')).toBe(true);
    expect(ctx.NAME?.after).toBe('end');
  });

  it('returns empty strings when a field stands alone, so the key can be shown instead', () => {
    const ctx = engine.fieldContext('{formmenu: a,b}');
    const key = Object.keys(ctx)[0] ?? '';
    expect(ctx[key]).toEqual({ before: '', after: '' });
  });

  it('only describes fields extractFields actually surfaces', () => {
    const body = '{if: N > 0}Pick {formmenu: red,green; name=C} now{endif} at {time: HH:mm}';
    const fields = engine.extractFields(body);
    for (const key of Object.keys(engine.fieldContext(body))) {
      expect(fields, key).toContain(key);
    }
  });
});

// Requirement checked rather than assumed: several menus and formulas in one
// body must resolve together. This works today; the test stops a future parser
// change from breaking it silently.
describe('formula engine — many dynamic pieces in one body', () => {
  it('resolves menus, formulas, a date token and a plain field at once', () => {
    const body =
      'Rate: {formmenu: Flex,Saver; name=PLAN; default=Saver} for {NIGHTS} nights.\n' +
      'Subtotal {= RATE * NIGHTS} EUR, with tax {= round(RATE * NIGHTS * 1.1)} EUR.\n' +
      'Extras: {formmenu: Towels,Crib; name=EX; multiple=yes}';
    expect(engine.extractFields(body)).toEqual(['PLAN', 'NIGHTS', 'EX']);
    expect(
      engine.resolveBody(body, { PLAN: 'Flex', NIGHTS: 3, RATE: 100, EX: 'Towels, Crib' }),
    ).toBe('Rate: Flex for 3 nights.\nSubtotal 300 EUR, with tax 330 EUR.\nExtras: Towels, Crib');
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
