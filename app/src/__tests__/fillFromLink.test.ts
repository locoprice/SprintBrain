import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  backwardDates,
  type SbFillFormViewModel,
  type SbLinkRead,
  type SbLinkResult,
  type SbLinkRule,
} from '@/lib/fillFormEngine';
import { buildFormDateToken } from '@/lib/formDateToken';
import { buildFormMenuToken, parseFormMenuToken, type FormMenuConfig } from '@/lib/formMenuToken';
import { buildFormNumberToken } from '@/lib/formNumberToken';
import { buildFormTextToken } from '@/lib/formTextToken';
import {
  emptyLinkDraft,
  LINK_MODES,
  linkDraftFrom,
  linkFromDraft,
  linkValue,
  parseLinkRule,
  readLinkAttr,
} from '@/lib/linkRule';

// Fill from link, the dashboard's half.
//
// The builders write `link=` with the dashboard's own writers, because the app
// cannot import extension source; the shipping engine parses it and the shared
// fill form reads a page with it. Loading the REAL engine and fill-form here is
// the point: a writer that spells the rule one way and an engine that reads it
// another ships a field that looks pointed at a page in the editor and never
// fills on one. Every page below is made up.
type Requirer = (id: string) => unknown;

function loadShared<T>(path: string, req?: Requirer): T {
  const src = readFileSync(path, 'utf8');
  const mod = { exports: {} as unknown };
  const run = new Function('module', 'exports', 'require', src) as (
    m: typeof mod,
    e: unknown,
    r: Requirer,
  ) => void;
  run(mod, mod.exports, req ?? (() => ({})));
  return mod.exports as T;
}

interface FieldCfg {
  type: string;
  format?: string;
  default?: string;
  opts?: string;
  link?: string;
}

interface FormulaEngine {
  sbParseLinkRule: (raw: unknown) => SbLinkRule | null;
  LINK_MODES: string[];
  buildFormFieldCfg: (body: string) => Record<string, FieldCfg>;
  buildFormNumberToken: (cfg: Record<string, unknown>) => string;
  buildFormDateToken: (cfg: Record<string, unknown>) => string;
  buildFormMenuToken: (cfg: Record<string, unknown>) => string;
}

interface FillFormApi {
  fillForm(
    text: string,
    values: Record<string, string>,
    opts: Record<string, unknown>,
  ): SbFillFormViewModel;
  readFromPage(fields: SbFillFormViewModel['fields'], pieces: string[]): SbLinkRead;
  linkSummary(read: SbLinkRead): string;
  linkNote(result: SbLinkResult | undefined): string;
}

const ENGINE_PATH = resolve(process.cwd(), '..', 'extension', 'formula-engine.js');
const engine = loadShared<FormulaEngine>(ENGINE_PATH);
const ff = loadShared<FillFormApi>(
  resolve(process.cwd(), '..', 'extension', 'shared', 'fill-form.js'),
  (id) => {
    if (id === '../formula-engine.js') return engine;
    throw new Error(`fill-form.js asked for an unexpected module: ${id}`);
  },
);

// Rules as authors write them, and as they mistype them.
const RULES = [
  'after:Start date',
  'before:Boxes|Box',
  'Start date',
  '  before : Box | Boxes  ',
  'BEFORE:Box',
  'After:Total',
  'after:Ref: 7',
  'Ref: 7',
  'during:Start',
  'before:Box|Box|box',
  '|Box|',
  'after:Start date',
  'after:a;b',
  'after:{Total}',
  'after:Line\nbreak',
  'after:\r\nStart',
  'after:',
  'before:|',
  ' | ',
  '',
  '   ',
];

describe('linkRule — the dashboard reads a rule the way the engine does', () => {
  it('offers the engine its own two modes', () => {
    expect([...LINK_MODES]).toEqual(engine.LINK_MODES);
  });

  it.each(RULES)('parses %j identically', (raw) => {
    expect(parseLinkRule(raw)).toEqual(engine.sbParseLinkRule(raw));
  });

  it('reads nothing from nothing, on both sides', () => {
    expect(parseLinkRule(null)).toBeNull();
    expect(parseLinkRule(undefined)).toBeNull();
    expect(engine.sbParseLinkRule(null)).toBeNull();
  });

  it.each(RULES)('writes %j in the engine spelling', (raw) => {
    // The engine writer emits `; link=<its _linkValue>` last, or nothing.
    const theirs = engine.buildFormNumberToken({ name: 'N', link: raw });
    const spelled = /; link=([^}]*)\}$/.exec(theirs)?.[1] ?? '';
    expect(linkValue(raw)).toBe(spelled);
  });

  it('settles on one spelling, so a rule read back and written again is unchanged', () => {
    for (const raw of RULES) {
      const once = linkValue(raw);
      expect(linkValue(once), raw).toBe(once);
    }
    expect(linkValue('Start date')).toBe('after:Start date');
    expect(linkValue('  before : Box | Boxes  ')).toBe('before:Box|Boxes');
  });

  it('finds link= among a token\'s settings the way the engine does', () => {
    for (const raw of RULES.filter((r) => !/[;{}\r\n]/.test(r))) {
      const token = `{formmenu: A,B; name=M; link=${raw}}`;
      expect(readLinkAttr(`; name=M; link=${raw}`), raw).toBe(
        engine.buildFormFieldCfg(token).M?.link ?? '',
      );
    }
    expect(readLinkAttr('; name=M')).toBe('');
  });
});

describe('linkRule — what the builder controls write', () => {
  it('writes nothing while switched off, whatever is typed', () => {
    expect(linkFromDraft({ enabled: false, mode: 'after', words: 'Start date' })).toBe('');
  });

  it('writes nothing for an empty or blank label', () => {
    expect(linkFromDraft({ enabled: true, mode: 'after', words: '' })).toBe('');
    expect(linkFromDraft({ enabled: true, mode: 'before', words: ' | ' })).toBe('');
  });

  it('always spells the mode, so a label holding a colon stays one label', () => {
    expect(linkFromDraft({ enabled: true, mode: 'after', words: 'Ref: 7' })).toBe('after:Ref: 7');
    expect(engine.sbParseLinkRule('after:Ref: 7')).toEqual({ mode: 'after', words: ['Ref: 7'] });
    expect(linkFromDraft({ enabled: true, mode: 'before', words: 'Box|Boxes' })).toBe(
      'before:Box|Boxes',
    );
  });

  it('opens an edited field on the rule it carries, and an unpointed one switched off', () => {
    expect(linkDraftFrom('before:Boxes|Box', 'after')).toEqual({
      enabled: true,
      mode: 'before',
      words: 'Boxes|Box',
    });
    expect(linkDraftFrom('', 'before')).toEqual(emptyLinkDraft('before'));
    expect(linkDraftFrom(undefined, 'after')).toEqual({ enabled: false, mode: 'after', words: '' });
  });

  it('round-trips the controls through a written rule', () => {
    const draft = { enabled: true, mode: 'after' as const, words: 'Start date|Starts' };
    expect(linkDraftFrom(linkFromDraft(draft), 'before')).toEqual(draft);
  });
});

describe('writers — link= lands last and parses back', () => {
  it('number: after the caption, and identical to the engine writer', () => {
    const cfg = {
      name: 'BOXES',
      format: 'plain' as const,
      currency: 'EUR' as const,
      default: '0',
      label: 'Boxes',
      link: 'before:Boxes|Box',
    };
    const token = buildFormNumberToken(cfg);
    expect(token).toBe(
      '{formtext: name=BOXES; type=number; default=0; label=Boxes; link=before:Boxes|Box}',
    );
    expect(token).toBe(engine.buildFormNumberToken(cfg));
    expect(engine.buildFormFieldCfg(token).BOXES).toMatchObject({
      type: 'number',
      default: '0',
      link: 'before:Boxes|Box',
    });
  });

  it('date: after the format, and identical to the engine writer', () => {
    for (const kind of ['date', 'time'] as const) {
      const format = kind === 'date' ? 'long' : 'HH:mm';
      const mine = buildFormDateToken({ name: 'F_1', kind, format, link: 'after:Pick-up' });
      expect(mine).toBe(
        engine.buildFormDateToken({ name: 'F_1', type: kind, format, link: 'after:Pick-up' }),
      );
      expect(mine.endsWith('; link=after:Pick-up}')).toBe(true);
      expect(engine.buildFormFieldCfg(mine).F_1).toMatchObject({ type: kind, format, link: 'after:Pick-up' });
    }
  });

  it('menu: after cols, and identical to the engine writer', () => {
    const cfg = {
      options: ['Standard', 'Express'],
      selected: ['Express'],
      name: 'PLAN',
      multiple: true,
      cols: 12,
      link: 'after:Plan|Service',
    };
    const token = buildFormMenuToken(cfg);
    expect(token).toBe(
      '{formmenu: Standard,Express; name=PLAN; default=Express; multiple=yes; cols=12; link=after:Plan|Service}',
    );
    expect(token).toBe(engine.buildFormMenuToken(cfg));
    expect(engine.buildFormFieldCfg(token).PLAN).toMatchObject({
      type: 'dd',
      opts: 'Standard\nExpress',
      link: 'after:Plan|Service',
    });
  });

  it('text: after the default, in the engine spelling', () => {
    const token = buildFormTextToken({
      name: 'ORDER_REF',
      default: 'none yet',
      link: '  after : Order number | Order no. ',
    });
    expect(token).toBe('{formtext: name=ORDER_REF; default=none yet; link=after:Order number|Order no.}');
    expect(engine.buildFormFieldCfg(token).ORDER_REF).toEqual({
      type: 'text',
      default: 'none yet',
      link: 'after:Order number|Order no.',
    });
  });

  it('a field nobody points at a page is written exactly as before', () => {
    for (const link of [undefined, '', 'after:', ' | ']) {
      expect(buildFormTextToken({ name: 'T', default: '', link })).toBe('{formtext: name=T}');
      expect(
        buildFormNumberToken({ name: 'N', format: 'plain', currency: 'EUR', default: '', link }),
      ).toBe('{formtext: name=N; type=number}');
      expect(buildFormDateToken({ name: 'D', kind: 'date', format: '', link })).toBe(
        '{formdate: name=D}',
      );
      expect(
        buildFormMenuToken({ options: ['A', 'B'], selected: [], name: 'M', multiple: false, cols: null, link }),
      ).toBe('{formmenu: A,B; name=M}');
    }
  });

  it('cannot emit a token that breaks the body, whatever the label holds', () => {
    const tokens = [
      buildFormTextToken({ name: 'T', default: '', link: 'after:a;b{c}\nd' }),
      buildFormNumberToken({ name: 'N', format: 'plain', currency: 'EUR', default: '', link: 'before:x}y' }),
      buildFormDateToken({ name: 'D', kind: 'date', format: '', link: 'after:{Start}' }),
      buildFormMenuToken({ options: ['A'], selected: [], name: 'M', multiple: false, cols: null, link: 'after:P;Q' }),
    ];
    for (const token of tokens) {
      expect(token.match(/[{]/g), token).toHaveLength(1);
      expect(token.match(/[}]/g), token).toHaveLength(1);
      expect(Object.keys(engine.buildFormFieldCfg(token)), token).toHaveLength(1);
    }
  });
});

describe('menu reader — editing a menu keeps its link', () => {
  it('reads the rule back as a setting, never as an option', () => {
    // Without `link` among the reader's named settings, the rule came back as
    // one more choice, and saving the menu would have shipped it.
    const raw = '{formmenu: Standard,Express; name=PLAN; default=Express; link=after:Plan}';
    const cfg = parseFormMenuToken(raw);
    expect(cfg).toEqual({
      options: ['Standard', 'Express'],
      selected: ['Express'],
      name: 'PLAN',
      multiple: false,
      cols: null,
      link: 'after:Plan',
    });
    expect(engine.buildFormFieldCfg(raw).PLAN?.opts).toBe('Standard\nExpress');
  });

  it('accepts the rule anywhere among Text Blaze style settings', () => {
    const raw = '{formmenu: link=after:Plan; Standard; Express; name=PLAN}';
    expect(parseFormMenuToken(raw)?.options).toEqual(['Standard', 'Express']);
    expect(parseFormMenuToken(raw)?.link).toBe('after:Plan');
    expect(engine.buildFormFieldCfg(raw).PLAN?.opts).toBe('Standard\nExpress');
  });

  it('saves an untouched menu with its rule byte for byte', () => {
    const raw = '{formmenu: Standard,Express; name=PLAN; default=Express; link=after:Plan|Service}';
    expect(buildFormMenuToken(parseFormMenuToken(raw) as FormMenuConfig)).toBe(raw);
  });

  it('settles a hand-written rule into the one spelling on its first save, then holds', () => {
    const raw = '{formmenu: A,B; name=M; link= Plan | Service }';
    const once = buildFormMenuToken(parseFormMenuToken(raw) as FormMenuConfig);
    expect(once).toBe('{formmenu: A,B; name=M; link=after:Plan|Service}');
    expect(buildFormMenuToken(parseFormMenuToken(once) as FormMenuConfig)).toBe(once);
  });

  it('leaves a menu without a rule as it was read', () => {
    expect(parseFormMenuToken('{formmenu: A,B; name=M}')).not.toHaveProperty('link');
  });
});

describe('a form built in the editor, filled from a made-up page', () => {
  const body = [
    `Order ${buildFormTextToken({ name: 'ORDER_REF', default: '', link: 'after:Order number' })}`,
    `pick-up ${buildFormDateToken({ name: 'DATE_1', kind: 'date', format: 'long', link: 'after:Pick-up' })}`,
    `return ${buildFormDateToken({ name: 'DATE_2', kind: 'date', format: '', link: 'after:Return' })}`,
    `boxes ${buildFormNumberToken({ name: 'BOXES', format: 'plain', currency: 'EUR', default: '0', link: 'before:Boxes|Box' })}`,
    `bags ${buildFormNumberToken({ name: 'BAGS', format: 'plain', currency: 'EUR', default: '0', link: 'before:Bags|Bag' })}`,
    `plan ${buildFormMenuToken({ options: ['Standard', 'Express'], selected: ['Standard'], name: 'PLAN', multiple: false, cols: null, link: 'after:Plan' })}`,
    `note ${buildFormTextToken({ name: 'NOTE', default: '' })}`,
  ].join('\n');

  const pieces = [
    'Your order',
    'Order number',
    'A-4471',
    'Pick-up',
    'Friday, 09-10-2026',
    '2 Boxes',
    '1 Box',
    'Plan:',
    'Express',
  ];

  const NOW = new Date(2026, 9, 1, 9, 0);

  it('offers the Link box, and says which fields read the page', () => {
    const view = ff.fillForm(body, {}, { now: NOW });
    expect(view.linkable).toBe(true);
    const byKey = Object.fromEntries(view.fields.map((f) => [f.key, f]));
    expect(byKey.BOXES?.link).toEqual({ mode: 'before', words: ['Boxes', 'Box'] });
    expect(byKey.DATE_1?.link).toEqual({ mode: 'after', words: ['Pick-up'] });
    expect(byKey.NOTE?.link).toBeNull();
    expect(view.fields.every((f) => f.fromLink === false)).toBe(true);
  });

  it('fills what the page settles, ready for each control', () => {
    const view = ff.fillForm(body, {}, { now: NOW });
    const read = ff.readFromPage(view.fields, pieces);
    expect(read.values).toEqual({
      ORDER_REF: 'A-4471',
      // The weekday settles which of 9 October and 10 September it is.
      DATE_1: '2026-10-09',
      BOXES: '3',
      // No bag on the page: the count is none, the field's own default.
      BAGS: '0',
      PLAN: 'Express',
    });
    expect(read.filled).toBe(5);
    expect(read.total).toBe(6);
    const notes = Object.fromEntries(read.results.map((r) => [r.key, ff.linkNote(r)]));
    expect(notes).toEqual({
      ORDER_REF: '',
      DATE_1: '',
      DATE_2: 'Not on the page',
      BOXES: '',
      BAGS: 'None on the page',
      PLAN: '',
    });
    expect(ff.linkSummary(read)).toBe(
      'Filled 5 of 6 fields from the page. Fill in the marked ones by hand.',
    );
  });

  it('marks the filled fields and prints them like any typed answer', () => {
    const empty = ff.fillForm(body, {}, { now: NOW });
    const read = ff.readFromPage(empty.fields, pieces);
    const linked = Object.fromEntries(Object.keys(read.values).map((k) => [k, true]));
    const view = ff.fillForm(body, read.values, { now: NOW, lang: 'ES', linked });
    const fromLink = view.fields.filter((f) => f.fromLink).map((f) => f.key);
    expect(fromLink).toEqual(['ORDER_REF', 'DATE_1', 'BOXES', 'BAGS', 'PLAN']);
    expect(view.preview).toContain('Order A-4471');
    expect(view.preview).toContain('pick-up viernes 9 de octubre de 2026');
    expect(view.preview).toContain('boxes 3');
    expect(view.preview).toContain('plan Express');
  });

  it('leaves a snippet with no rule exactly as it was', () => {
    const plain = `Order ${buildFormTextToken({ name: 'ORDER_REF', default: '' })}`;
    const view = ff.fillForm(plain, {}, { now: NOW });
    expect(view.linkable).toBe(false);
    expect(view.fields.map((f) => f.link)).toEqual([null]);
  });
});

describe('the preview writes a page\'s answers the way a hand edit lands', () => {
  // backwardDates reaches the shared module through the page, as the preview does.
  const scope = globalThis as unknown as { window?: unknown };
  beforeAll(() => {
    scope.window = { SBFillForm: ff, SBFormulaEngine: engine };
  });
  afterAll(() => {
    delete scope.window;
  });

  const NOW = new Date(2026, 9, 1, 9, 0);
  const body = [
    `out ${buildFormDateToken({ name: 'START', kind: 'date', format: '', link: 'after:Pick-up' })}`,
    'back {formdate: name=END; after=START; link=after:Return}',
    'boxes {formtext: name=BOXES; type=number; default=0; link=before:Boxes|Box}',
  ].join('\n');

  function held(view: SbFillFormViewModel): Record<string, string> {
    return Object.fromEntries(view.fields.map((f) => [f.key, f.value]));
  }

  it('empties a closing date the page\'s opening one now falls after', () => {
    // The operator had already picked a return; the page names only the pick-up.
    const view = ff.fillForm(body, { START: '2026-10-05', END: '2026-10-12' }, { now: NOW });
    const read = ff.readFromPage(view.fields, ['Pick-up', 'Tuesday 20 October 2026', '2 Boxes']);
    expect(read.values).toEqual({ START: '2026-10-20', BOXES: '2' });
    expect(backwardDates(view.fields, { ...held(view), ...read.values })).toEqual(['END']);
  });

  it('leaves a closing date that still follows its opening one', () => {
    const view = ff.fillForm(body, { START: '2026-10-05', END: '2026-10-30' }, { now: NOW });
    const read = ff.readFromPage(view.fields, ['Pick-up', 'Tuesday 20 October 2026']);
    expect(backwardDates(view.fields, { ...held(view), ...read.values })).toEqual([]);
    // The same day is not before it.
    expect(backwardDates(view.fields, { ...held(view), START: '2026-10-30' })).toEqual([]);
  });

  it('runs the same rule on a hand edit, and an empty closing date stays empty', () => {
    const view = ff.fillForm(body, { START: '2026-10-05', END: '2026-10-12' }, { now: NOW });
    expect(backwardDates(view.fields, { ...held(view), START: '2026-10-13' })).toEqual(['END']);
    expect(backwardDates(view.fields, { ...held(view), START: '2026-10-13', END: '' })).toEqual([]);
    expect(backwardDates(view.fields, { ...held(view), START: '' })).toEqual([]);
  });

  it('compares a datetime the way its picker does', () => {
    const timed =
      '{formdate: name=A; type=datetime} {formdate: name=B; type=datetime; after=A} ' +
      '{formdate: name=C; after=A}';
    const view = ff.fillForm(timed, { A: '2026-10-09T14:00', B: '2026-10-09T13:30', C: '2026-10-09' }, { now: NOW });
    // B is half an hour early; C is a date on the same day, which is not before it.
    expect(backwardDates(view.fields, held(view))).toEqual(['B']);
  });

  it('frees the date ordered after one it empties', () => {
    const chain =
      '{formdate: name=A} {formdate: name=B; after=A} {formdate: name=C; after=B}';
    const view = ff.fillForm(chain, { A: '2026-10-01', B: '2026-10-05', C: '2026-10-03' }, { now: NOW });
    // C is already before B; moving A past B empties B, and an empty B limits nothing.
    expect(backwardDates(view.fields, { ...held(view), A: '2026-10-06' })).toEqual(['B']);
    expect(backwardDates(view.fields, held(view))).toEqual(['C']);
  });

  it('never empties a closing date while it is typed from the keyboard', () => {
    const typed = 'Out {formdate: name=START}\nBack {formdate: name=END; after=START}';
    const view = ff.fillForm(typed, { START: '2026-10-09', END: '2026-10-14' }, { now: NOW });
    // The picker reports a whole date after every keystroke, and the first
    // digit of a year or a day lands well before the opening date.
    for (const step of ['0002-10-14', '0020-10-14', '0202-10-14', '2027-10-14', '2026-10-01', '2026-10-15']) {
      expect(backwardDates(view.fields, { ...held(view), END: step }, ['END'])).toEqual([]);
    }
    // Typing the opening date past it still empties the closing one.
    expect(backwardDates(view.fields, { ...held(view), START: '2026-10-20' }, ['START'])).toEqual(['END']);
  });

  it('lets a closing date kept as typed go on limiting the date after it', () => {
    const chain =
      '{formdate: name=A} {formdate: name=B; after=A} {formdate: name=C; after=B}';
    const view = ff.fillForm(chain, { A: '2026-10-01', B: '2026-10-05', C: '2026-09-20' }, { now: NOW });
    // B typed before A stays, flagged by its picker; C now falls before B.
    expect(backwardDates(view.fields, { ...held(view), B: '2026-09-25' }, ['B'])).toEqual(['C']);
    expect(backwardDates(view.fields, { ...held(view), B: '2026-09-10' }, ['B'])).toEqual([]);
  });
});
