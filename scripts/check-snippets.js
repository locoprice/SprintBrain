// Formula-engine behavior gate.
//
// Loads the REAL shipping engine (extension/formula-engine.js) and pins its
// output on representative inputs — including the numeric-comparison conditionals
// that the previous Function()-based smoke test could not exercise (and which had
// silently regressed in production: {if: OTA_PRICE > 0} never rendered).
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const engine = require(path.join(__dirname, '..', 'extension', 'formula-engine.js'));

function fail(msg) {
  console.error('X ' + msg);
  process.exit(1);
}

// { name, body, vals, expect } — expect is the exact resolveBody() output.
const cases = [
  { name: 'plain variable',     body: 'Hi {NAME}',                          vals: { NAME: 'Ada' },        expect: 'Hi Ada' },
  { name: 'arithmetic formula', body: 'Total {= PRICE * QTY}',              vals: { PRICE: 10, QTY: 3 },  expect: 'Total 30' },
  { name: 'double-brace round', body: '{{= round(PRICE * 1.03) }}',         vals: { PRICE: 100 },         expect: '103' },
  { name: 'cmp > true',         body: '{if: OTA > 0}save{endif}',           vals: { OTA: 150 },           expect: 'save' },
  { name: 'cmp > false',        body: '{if: OTA > 0}save{endif}',           vals: { OTA: 0 },             expect: '' },
  { name: 'cmp >= else',        body: '{if: N >= 5}big{else}small{endif}',  vals: { N: 4 },               expect: 'small' },
  { name: 'string equality',    body: '{if: LANG = "EN"}Hello{endif}',      vals: { LANG: 'en' },         expect: 'Hello' },
  { name: 'graceful undefined', body: 'A{= BROKEN + 2}B',                   vals: {},                     expect: 'A2B' },
];

let ok = 0;
for (const c of cases) {
  let got;
  try {
    got = engine.resolveBody(c.body, Object.assign({}, c.vals));
  } catch (e) {
    fail('case "' + c.name + '" threw: ' + e.message);
  }
  if (got !== c.expect) {
    fail('case "' + c.name + '" -> got ' + JSON.stringify(got) + ', expected ' + JSON.stringify(c.expect));
  }
  ok++;
}

console.log('OK Formula engine passed all ' + ok + ' cases');

// ── TEMPLATE VALIDATOR PARITY (STATUS-ICONS-001) ────────────────────
// validateTemplate is mirrored in app/src/lib/statusSignals.ts because the
// dashboard cannot import extension source. This matrix is asserted on BOTH
// sides — the identical list lives in app/src/__tests__/statusSignals.test.ts
// as PARITY_CASES — so the two copies cannot drift without a gate failing.
const validationCases = [
  // Sound
  { body: 'Hi {NAME}', code: null },
  { body: 'Total {= PRICE * QTY}', code: null },
  { body: '{{= round(PRICE * 1.03) }}', code: null },
  { body: '{if: OTA > 0}save{endif}', code: null },
  { body: '{if: N >= 5}big{else}small{endif}', code: null },
  { body: '{if: A}a{elseif: B}b{else}c{endif}', code: null },
  { body: '{if: A}{if: B}both{endif}{endif}', code: null },
  { body: 'plain text with no tokens at all', code: null },
  // Prose and code shapes that must NOT be flagged.
  { body: 'JSON example: {"sentiment":"positive"}', code: null },
  { body: 'function f() { return 1; }', code: null },
  // Faults
  { body: 'Dear {name, welcome', code: 'unterminated-token' },
  { body: '{{NAME}', code: 'unterminated-token' },
  { body: '{if: A}no closer', code: 'unclosed-if' },
  { body: '{if: A}{if: B}only one closer{endif}', code: 'unclosed-if' },
  { body: 'nothing opened it{endif}', code: 'orphan-branch' },
  { body: 'stray {else} branch', code: 'orphan-branch' },
  { body: '{button label="Discount"}P = P * 0.9{/button}', code: null },
  { body: 'a{if: A}x{endif}{button label="b"}P = 1{/button}z', code: null },
  { body: '{button label="Discount"}P = P * 0.9', code: 'unclosed-button' },
  { body: 'stray {/button} closer', code: 'orphan-branch' },
];

if (typeof engine.validateTemplate !== 'function') {
  fail('formula-engine no longer exports validateTemplate');
}

let vok = 0;
for (const c of validationCases) {
  const got = engine.validateTemplate(c.body);
  if (got.code !== c.code) {
    fail('validateTemplate(' + JSON.stringify(c.body) + ') -> code ' +
      JSON.stringify(got.code) + ', expected ' + JSON.stringify(c.code));
  }
  if (got.ok !== (c.code === null)) {
    fail('validateTemplate(' + JSON.stringify(c.body) + ') -> ok ' + got.ok +
      ' disagrees with code ' + JSON.stringify(got.code));
  }
  if ((got.message.length > 0) !== (c.code !== null)) {
    fail('validateTemplate(' + JSON.stringify(c.body) + ') -> message/code mismatch');
  }
  vok++;
}

// Nothing should ever crash the validator, whatever it is handed.
for (const junk of [null, undefined, '', '{', '}', '{}', '{{', '}}']) {
  try {
    engine.validateTemplate(junk);
  } catch (e) {
    fail('validateTemplate(' + JSON.stringify(junk) + ') threw: ' + e.message);
  }
}

console.log('OK Template validator passed all ' + vok + ' parity cases');

// ── FILL-FORM PLACEHOLDER PARITY ────────────────────────────────────
// Three surfaces render a single-choice {formmenu:} as a <select>, and each
// builds the markup itself. A select with no empty first option is preselected
// by the browser on option 1 — so the field SHOWS a choice while the surface
// still reads '' for it, and the pick is silently dropped from the output.
//
// popup.js shipped without it from v2.132.0 until this check existed. It is a
// source assertion rather than a behaviour test because the markup is built
// inside large DOM-bound render functions, but it pins the exact drift.
const PLACEHOLDER = '<option value="">— select —</option>';
const FILL_FORM_RENDERERS = [
  ['extension/content/content.js', 'in-page overlay'],
  ['extension/popup/popup.js', 'popup detail + Sprintbrain.html'],
  ['app/public/mobile/index.html', 'mobile companion'],
];

for (const [rel, label] of FILL_FORM_RENDERERS) {
  const src = fs.readFileSync(path.join(__dirname, '..', ...rel.split('/')), 'utf8');
  if (!src.includes(PLACEHOLDER)) {
    fail(rel + ' (' + label + ') no longer emits the "— select —" option.\n' +
      '  A {formmenu:} with no default= would show option 1 as picked while the\n' +
      '  surface reads an empty value, dropping the choice from the output.');
  }
}
console.log('OK Fill-form placeholder present on all ' + FILL_FORM_RENDERERS.length + ' renderers');

// showOverlay is reached from three places — the trigger, the picker and the
// right-click context menu. Two of them passed the raw snippet, whose field_cfg
// is {} for a body-declared menu, so a {formmenu:} rendered as a plain text box
// and its options could not be picked at all. The merge now lives INSIDE
// showOverlay; this pins it there so a call site can never own it again.
const CONTENT_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'extension', 'content', 'content.js'), 'utf8');
const overlayStart = CONTENT_SRC.indexOf('function showOverlay(');
if (overlayStart === -1) fail('content.js no longer defines showOverlay');
const overlayEnd = CONTENT_SRC.indexOf('\nfunction ', overlayStart + 1);
const overlayBody = CONTENT_SRC.slice(overlayStart, overlayEnd === -1 ? undefined : overlayEnd);
if (!overlayBody.includes('buildFormFieldCfg(snip.body)')) {
  fail('showOverlay no longer merges buildFormFieldCfg(snip.body).\n' +
    '  Every {formmenu:} / {formtext:} / {formdate:} reached through the picker\n' +
    '  or the context menu would render as a plain text input.');
}
console.log('OK showOverlay merges the body-declared field config');

// ── FORM MENU READER ────────────────────────────────────────────────
// parseFormMenuToken / findMenuTokenAt are what let a builder re-open a menu
// already in a body. Sprintbrain.html calls them directly; the dashboard keeps
// a mirror in app/src/lib/formMenuToken.ts, and the identical matrix lives in
// app/src/__tests__/formMenuField.test.ts as MENU_READ_CASES.
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

if (typeof engine.parseFormMenuToken !== 'function' || typeof engine.findMenuTokenAt !== 'function') {
  fail('formula-engine no longer exports parseFormMenuToken / findMenuTokenAt');
}

let rok = 0;
for (const raw of MENU_READ_CASES) {
  const cfg = engine.parseFormMenuToken(raw);
  if (!cfg) fail('parseFormMenuToken(' + JSON.stringify(raw) + ') returned null');
  // Saving an edited menu must not keep rewriting the body: build() normalises
  // once, and every save after that has to be a no-op.
  const once = engine.buildFormMenuToken(cfg);
  const twice = engine.buildFormMenuToken(engine.parseFormMenuToken(once));
  if (once !== twice) {
    fail('menu round-trip is not idempotent for ' + JSON.stringify(raw) +
      '\n  first:  ' + once + '\n  second: ' + twice);
  }
  // What the builder reopens must be the menu the fill form renders.
  const viaCfg = engine.buildFormFieldCfg(once);
  const key = Object.keys(viaCfg)[0];
  if (!key || viaCfg[key].opts !== cfg.options.join('\n')) {
    fail('reader and buildFormFieldCfg disagree on options for ' + JSON.stringify(raw));
  }
  rok++;
}

for (const junk of ['{formtext: name=G}', '{formmenuish: A}', 'plain text', '{formmenu: A,B', '', null, undefined]) {
  if (engine.parseFormMenuToken(junk) !== null) {
    fail('parseFormMenuToken(' + JSON.stringify(junk) + ') should be null');
  }
}

// A caret on either brace counts as inside; between two touching menus the
// earlier one wins. Getting this wrong replaces the wrong span of the body.
const findBody = 'Hi {formtext: name=G}, pick {formmenu: A,B; name=P} then {formmenu: X,Y}';
const findCases = [
  [0, null], [10, null], [54, null],
  [28, 28], [40, 28], [51, 28],
  [57, 57], [60, 57], [72, 57],
  [-5, null], [9999, 57],
];
for (const [caret, wantStart] of findCases) {
  const got = engine.findMenuTokenAt(findBody, caret);
  const gotStart = got ? got.start : null;
  if (gotStart !== wantStart) {
    fail('findMenuTokenAt(caret ' + caret + ') -> start ' + gotStart + ', expected ' + wantStart);
  }
  if (got && findBody.slice(got.start, got.end) !== got.raw) {
    fail('findMenuTokenAt(caret ' + caret + ') returned a range that does not hold its raw text');
  }
}

console.log('OK Form menu reader passed all ' + rok + ' cases');

// ── MOBILE FIELD-CONFIG PARITY ──────────────────────────────────────
// The mobile companion (app/public/mobile/index.html) keeps its own resolver —
// a known exception to the single-source rule, because it cannot load the
// extension engine. buildFormFieldCfg is hand-mirrored there as sbBodyFieldCfg,
// and a drift means a {formmenu:} renders as a text box on the phone: the
// operator retypes an option instead of picking one and a typo reaches a guest.
//
// The mirrored helpers are pure (no DOM), so they are sliced out of the HTML
// and run in a throwaway vm context. The slice markers are load-bearing: if
// either moves, this gate fails loudly rather than silently passing.
const MOBILE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'app', 'public', 'mobile', 'index.html'), 'utf8');
const SLICE_START = 'var SB_MENU_KEYS=';
const SLICE_END = 'function sbIsFormToken(';
const sliceFrom = MOBILE_SRC.indexOf(SLICE_START);
const sliceTo = MOBILE_SRC.indexOf(SLICE_END);
if (sliceFrom === -1 || sliceTo === -1 || sliceTo <= sliceFrom) {
  fail('mobile/index.html: cannot slice the field-config helpers — the markers ' +
    JSON.stringify(SLICE_START) + ' .. ' + JSON.stringify(SLICE_END) + ' moved');
}

const mobile = {};
vm.createContext(mobile);
try {
  vm.runInNewContext(MOBILE_SRC.slice(sliceFrom, sliceTo), mobile);
} catch (e) {
  fail('mobile field-config helpers failed to evaluate: ' + e.message);
}
for (const fn of ['sbBodyFieldCfg', 'sbMenuSpec', 'sbFormMenuPicks', 'sbFormTokenName']) {
  if (typeof mobile[fn] !== 'function') fail('mobile/index.html no longer defines ' + fn);
}

// Key order is walk order on both sides, but canonicalise anyway so a parity
// failure always means a real difference in what the two surfaces would render.
function canon(cfg) {
  return JSON.stringify(Object.keys(cfg).sort().map((k) =>
    [k, Object.keys(cfg[k]).sort().map((p) => [p, cfg[k][p]])]));
}

const fieldCfgCases = [
  // The shape the dashboard's FormMenuDialog writes.
  '{formmenu: Refundable,Semiflexible,NOT Refundable - always cheaper; name=RATE_PLAN; default=Refundable}',
  // Text Blaze writes options ';'-separated, and name= may sit anywhere.
  '{formmenu: 1980; 1985; name=YEAR; default=1985}',
  '{formmenu: name=YEAR; 1980; 1985}',
  // multiple=yes keeps every declared pick; single-choice trims to the first.
  '{formmenu: A,B,C; name=M; default=A,C; multiple=yes}',
  '{formmenu: A,B,C; name=M; default=A,C}',
  // A default naming an option that no longer exists must be dropped.
  '{formmenu: A,B; name=M; default=ZZ}',
  '{formmenu: A,B; name=M; cols=20}',
  // Unnamed menus key off the token itself — the hash must agree exactly.
  '{formmenu: A,B}',
  '{formmenu: name=M}',
  '{formtext: name=GUEST; default=Ada}',
  '{formdate: name=CHECKIN; default=2026-08-06}',
  'Hi {formtext: name=G}, plan {formmenu: A,B; name=P; default=B} and {formmenu: X,Y}',
  'no tokens at all',
  '',
];

let mok = 0;
for (const body of fieldCfgCases) {
  const want = canon(engine.buildFormFieldCfg(body));
  let got;
  try {
    got = canon(mobile.sbBodyFieldCfg(body));
  } catch (e) {
    fail('mobile sbBodyFieldCfg(' + JSON.stringify(body) + ') threw: ' + e.message);
  }
  if (got !== want) {
    fail('field-config drift for ' + JSON.stringify(body) +
      '\n  engine: ' + want + '\n  mobile: ' + got);
  }
  mok++;
}

for (const v of ['A, B', 'A,B', ' A ,, B ', '', null, undefined]) {
  const want = JSON.stringify(engine.formMenuPicks(v));
  const got = JSON.stringify(mobile.sbFormMenuPicks(v));
  if (got !== want) {
    fail('formMenuPicks drift for ' + JSON.stringify(v) +
      ' -> engine ' + want + ', mobile ' + got);
  }
}

console.log('OK Mobile field-config parity passed all ' + mok + ' cases');
