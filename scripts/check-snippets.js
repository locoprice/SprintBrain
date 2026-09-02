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

// ── FILL-FORM MENU CONTROL PARITY ───────────────────────────────────
// Four surfaces render a {formmenu:} fill form, and each builds the markup
// itself. Every one of them must show all the options at once: checkboxes for
// a multiple menu, radios for a single one.
//
// This replaced a <select>, which failed twice over. It hid the choices behind
// a control people did not read as a menu, and a select with no empty first
// option is preselected by the browser on option 1 — so the field SHOWED a
// choice while the surface still read '' for it, and the pick was dropped from
// the output. Radios cannot drift that way: a ticked radio is the value read,
// and nothing ticked reads ''.
//
// Sprintbrain.html's composer is checked here too. It has its own renderer and
// the old placeholder check never covered it, so it carried that exact bug.
//
// Source assertions rather than behaviour tests, because the markup is built
// inside large DOM-bound render functions, but they pin the exact drift.
const MENU_RENDERERS = [
  ['extension/content/content.js', 'in-page overlay',
    "cfg.multiple ? 'checkbox' : 'radio'", ' name="sb-'],
  // The popup detail reads its fields from the shared view model (see
  // extension/shared/fill-form.js), so its marker names `f`, not `def`. The
  // assertion is unchanged: the control is still picked by the menu's kind.
  ['extension/popup/popup.js', 'popup detail + Sprintbrain.html detail',
    "f.multiple?'checkbox':'radio'", ' name="d-'],
  // The mobile companion reads its fields from the shared view model (inlined
  // by scripts/sync-fill-form.js), so its marker names `fld`, not `c`. The
  // assertion is unchanged: the control is still picked by the menu's kind.
  ['app/public/mobile/index.html', 'mobile companion',
    "fld.multiple?'checkbox':'radio'", ' name="f-'],
  // The composer reads its fields from the shared view model (see
  // extension/shared/fill-form.js), so its marker names `f`, not `def`. The
  // assertion is unchanged: the control is still picked by the menu's kind.
  ['Sprintbrain.html', 'composer',
    "f.multiple ? 'checkbox' : 'radio'", ' name="nvc-'],
];

for (const [rel, label, typeMarker, nameMarker] of MENU_RENDERERS) {
  const src = fs.readFileSync(path.join(__dirname, '..', ...rel.split('/')), 'utf8');
  if (!src.includes(typeMarker)) {
    fail(rel + ' (' + label + ') no longer picks the control by menu kind.\n' +
      '  A single-choice {formmenu:} must render as radios showing every option,\n' +
      '  not as a dropdown that hides them. Expected to find: ' + typeMarker);
  }
  if (!src.includes(nameMarker)) {
    fail(rel + ' (' + label + ') no longer names its radio group.\n' +
      '  Without a name= every single-choice menu in one fill form shares a\n' +
      '  group, so picking in one silently clears the other. Expected: ' + nameMarker);
  }
  if (src.includes('— select —')) {
    fail(rel + ' (' + label + ') still emits a "— select —" option.\n' +
      '  The dropdown was replaced by an always-visible option list; a leftover\n' +
      '  select means one surface drifted back.');
  }
}
console.log('OK Menu renders every option on all ' + MENU_RENDERERS.length + ' fill-form surfaces');

// The options are stacked one per line, never wrapped pills: a row of pills
// reads as tags or filters rather than as a question waiting for an answer.
// Each surface styles its own list, so the layout is pinned on all of them.
const MENU_OPTION_CSS = [
  ['extension/content/content.js', 'in-page overlay', '.sb-multi{display:flex;flex-direction:column'],
  ['extension/popup/popup.html', 'popup detail', '.d-multi{display:flex;flex-direction:column'],
  ['Sprintbrain.html', 'detail list', '#nv-list .d-multi{display:flex;flex-direction:column'],
  ['Sprintbrain.html', 'composer', '.nv-comp-multi{display:flex;flex-direction:column'],
  ['app/public/mobile/index.html', 'mobile companion', '.field-opts{display:flex;flex-direction:column'],
];

for (const [rel, label, marker] of MENU_OPTION_CSS) {
  const src = fs.readFileSync(path.join(__dirname, '..', ...rel.split('/')), 'utf8');
  if (!src.includes(marker)) {
    fail(rel + ' (' + label + ') no longer stacks the menu options one per line.\n' +
      '  Expected to find: ' + marker);
  }
}
console.log('OK Menu options stack one per line on all ' + MENU_OPTION_CSS.length + ' surfaces');

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
// The merge now happens inside extension/shared/fill-form.js, which showOverlay
// calls with the snippet's own body and stored config. The guarantee is
// unchanged: no call site supplies the field config, so none can forget it.
if (!overlayBody.includes('fillForm(snip.body')) {
  fail('showOverlay no longer builds its own fill-form view model.\n' +
    '  Every {formmenu:} / {formtext:} / {formdate:} reached through the picker\n' +
    '  or the context menu would render as a plain text input.');
}
if (!overlayBody.includes('fieldCfg: snip.fieldCfg')) {
  fail('showOverlay no longer passes the snippet\'s stored field_cfg.\n' +
    '  A hand-configured field would silently lose its type.');
}
console.log('OK showOverlay builds the body-declared field config itself');

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
const SLICE_START = 'function sbGenderTokenField(';
const SLICE_END = 'function extractFields(';
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
for (const fn of ['sbBodyFieldCfg', 'sbMenuSpec', 'sbFormMenuPicks', 'sbFormTokenName',
                  'sbFieldContext', 'sbTokenFieldKey']) {
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
  // No usable default: a single-choice menu falls back to its first option, a
  // multiple one stays empty. Asserted explicitly below as well as for parity.
  '{formmenu: A,B; name=M}',
  '{formmenu: A,B; name=M; multiple=yes}',
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

// ── UNANSWERED MENU FALLBACK ────────────────────────────────────────
// A single-choice menu with no usable default used to configure an empty value,
// so a snippet expanded without touching it dropped the choice and shipped the
// sentence with a hole ("...pas possible d'effectuer , car..."). It now opens on
// its first option. A `multiple=yes` menu keeps the empty default: picking none
// of several is a real answer. Asserted on both surfaces, not just for parity.
const FALLBACK_CASES = [
  ['{formmenu: A,B; name=M}', 'A'],
  ['{formmenu: A,B; name=M; default=ZZ}', 'A'],
  ['{formmenu: A,B; name=M; default=B}', 'B'],
  ['{formmenu: A,B; name=M; multiple=yes}', ''],
  ['{formmenu: un check-in anticipé,un check-out tardif}', 'un check-in anticipé'],
];
for (const [body, want] of FALLBACK_CASES) {
  for (const [label, build] of [['engine', engine.buildFormFieldCfg],
                                ['mobile', mobile.sbBodyFieldCfg]]) {
    const cfg = build(body);
    const key = Object.keys(cfg)[0];
    if (!key) fail(label + ' produced no field for ' + JSON.stringify(body));
    if (cfg[key].default !== want) {
      fail(label + ' menu default for ' + JSON.stringify(body) +
        '\n  want: ' + JSON.stringify(want) +
        '\n  got:  ' + JSON.stringify(cfg[key].default));
    }
  }
}
console.log('OK Unanswered menu falls back to its first option (' +
  FALLBACK_CASES.length + ' cases × 2 surfaces)');

// ── FIELD CONTEXT PARITY ────────────────────────────────────────────
// The static text either side of a field is what makes a fill form readable
// ("Rate Plan: [ Refundable ] per night" rather than "{MENU_1yvog3p}"). Three
// surfaces render it and mobile derives it independently, so the two
// implementations are pinned against each other here.
const CONTEXT_CASES = [
  'menu {formmenu: aaaaaaaa,bbbbbbbbbbbb,cccccccc}',
  'Rate Plan: {formmenu: Flex,Saver; name=PLAN} per night, all in.',
  'Pay {formmenu: Card,Cash; name=PAY} on {formdate: name=WHEN} sharp.',
  'Line one is long\nDear {NAME},\nnext line here',
  'Total **{AMOUNT}** [blue]EUR[/blue] due',
  '{formmenu: a,b}',
  'Sum {TOTAL}{button label="Go"}TOTAL = 1 + 2{/button} done',
  'This is a really quite long sentence indeed that runs on {NAME} end',
  'Repeated {X} then again {X} later',
  '{if: N > 0}Pick {formmenu: red,green; name=C} now{endif}',
  'Due {= 1 + 2} on {DATE} sharp',
  '',
];

let cok = 0;
for (const body of CONTEXT_CASES) {
  const want = engine.fieldContext(body);
  let got;
  try {
    got = mobile.sbFieldContext(body);
  } catch (e) {
    fail('mobile sbFieldContext(' + JSON.stringify(body) + ') threw: ' + e.message);
  }
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail('field-context drift for ' + JSON.stringify(body) +
      '\n  engine: ' + JSON.stringify(want) + '\n  mobile: ' + JSON.stringify(got));
  }
  // A context entry with no field to attach to would label nothing.
  for (const key of Object.keys(want)) {
    if (engine.extractFields(body).indexOf(key) === -1) {
      fail('fieldContext produced key "' + key + '" that extractFields does not surface, for ' +
        JSON.stringify(body));
    }
  }
  cok++;
}

// Context must never contain a token's own source — that would show a guest
// the formula rather than the prose around it.
for (const body of CONTEXT_CASES) {
  const ctx = engine.fieldContext(body);
  for (const key of Object.keys(ctx)) {
    const both = ctx[key].before + ' ' + ctx[key].after;
    if (both.indexOf('{') !== -1 || both.indexOf('}') !== -1) {
      fail('fieldContext leaked token source into "' + key + '" for ' + JSON.stringify(body) +
        ': ' + JSON.stringify(ctx[key]));
    }
  }
}

console.log('OK Field-context parity passed all ' + cok + ' cases');

// ── TIME-OF-DAY GREETING ────────────────────────────────────────────
// {greeting} prints the words for the hour it is sent, in the snippet's own
// language. The table is duplicated on the phone for the same reason every
// other resolver is (mobile cannot load the engine), so it is pinned here hour
// by hour: a drift means the desktop opens a message with "Buonasera" while the
// phone opens the same snippet with "Good evening".
for (const fn of ['sbGreetingSlot', 'sbGreetingText', 'sbIsGreetingHead']) {
  if (typeof mobile[fn] !== 'function') fail('mobile/index.html no longer defines ' + fn);
}
if (typeof engine.sbGreetingText !== 'function' || typeof engine.sbGreetingSlot !== 'function') {
  fail('formula-engine no longer exports sbGreetingSlot / sbGreetingText');
}

// The four thresholds, stated as the boundaries rather than as sample hours:
// each pair is the last hour of one slot and the first of the next.
const SLOT_BOUNDS = [
  [0, 'night'], [4, 'night'], [5, 'morning'], [11, 'morning'],
  [12, 'afternoon'], [17, 'afternoon'], [18, 'evening'], [21, 'evening'],
  [22, 'night'], [23, 'night'],
];
for (const [hour, want] of SLOT_BOUNDS) {
  for (const [label, slot] of [['engine', engine.sbGreetingSlot], ['mobile', mobile.sbGreetingSlot]]) {
    if (slot(hour) !== want) {
      fail(label + ' put hour ' + hour + ' in "' + slot(hour) + '", expected "' + want + '"');
    }
  }
}

// Spanish shares one phrase across evening and night, French across morning and
// afternoon. Both are the language, so a "fix" that de-duplicates them is a bug.
const GREETING_SPEC = {
  EN: ['Good morning', 'Good afternoon', 'Good evening', 'Good night'],
  IT: ['Buongiorno', 'Buon pomeriggio', 'Buonasera', 'Buona notte'],
  ES: ['Buenos días', 'Buenas tardes', 'Buenas noches', 'Buenas noches'],
  FR: ['Bonjour', 'Bonjour', 'Bonsoir', 'Bonne nuit'],
};
const SLOT_HOUR = { morning: 9, afternoon: 15, evening: 20, night: 2 };
const SLOT_ORDER = ['morning', 'afternoon', 'evening', 'night'];
for (const lang of Object.keys(GREETING_SPEC)) {
  SLOT_ORDER.forEach((slot, idx) => {
    const want = GREETING_SPEC[lang][idx];
    const got = engine.sbGreetingText(SLOT_HOUR[slot], lang);
    if (got !== want) {
      fail('greeting ' + lang + '/' + slot + ' -> ' + JSON.stringify(got) +
        ', expected ' + JSON.stringify(want));
    }
  });
}

// Every hour, every language, plus the shapes that have to degrade rather than
// throw: an unknown language falls back to English, an override wins, and one
// declared empty prints nothing.
const OVERRIDE_CASES = [
  undefined,
  {},
  { morning: 'Guten Morgen', afternoon: 'Guten Tag', evening: 'Guten Abend', night: 'Gute Nacht' },
  { night: '' },
  { evening: 'Boa noite' },
];
let gok = 0;
for (let hour = 0; hour < 24; hour++) {
  for (const lang of ['EN', 'IT', 'ES', 'FR', 'en', 'it', 'MULTI', 'DE', '', null, undefined]) {
    for (const ov of OVERRIDE_CASES) {
      const want = engine.sbGreetingText(hour, lang, ov);
      const got = mobile.sbGreetingText(hour, lang, ov);
      if (got !== want) {
        fail('greeting drift at hour ' + hour + ' lang ' + JSON.stringify(lang) +
          ' overrides ' + JSON.stringify(ov) +
          '\n  engine: ' + JSON.stringify(want) + '\n  mobile: ' + JSON.stringify(got));
      }
      if (typeof want !== 'string') fail('greeting returned a non-string at hour ' + hour);
      gok++;
    }
  }
}

// An unknown language must land on English, never on nothing.
for (const lang of ['MULTI', 'DE', '', null, undefined, 'nonsense']) {
  if (engine.sbGreetingText(9, lang) !== 'Good morning') {
    fail('greeting for unknown language ' + JSON.stringify(lang) + ' did not fall back to English');
  }
}

// A greeting resolves itself, so it must never surface as a field to fill in,
// on either surface. A field genuinely named {greetings} still must. The engine
// keeps _tokenFieldKey private, so it is read through extractFields; mobile
// exposes the rule itself (extractFields sits outside the sliced region).
const KEY_CASES = [
  ['greeting', ''],
  ['greeting: lang=ES', ''],
  ['GREETING', ''],
  ['Greeting: lang=IT', ''],
  ['greetings', 'greetings'],
  ['NAME', 'NAME'],
];
for (const [tok, want] of KEY_CASES) {
  const got = mobile.sbTokenFieldKey(tok);
  if (got !== want) {
    fail('mobile sbTokenFieldKey(' + JSON.stringify(tok) + ') -> ' + JSON.stringify(got) +
      ', expected ' + JSON.stringify(want));
  }
  const viaEngine = engine.extractFields('{' + tok + '}');
  const engineKey = viaEngine.length ? viaEngine[0] : '';
  if (engineKey !== want) {
    fail('engine extractFields({' + tok + '}) -> ' + JSON.stringify(viaEngine) +
      ', expected ' + (want ? JSON.stringify([want]) : '[]'));
  }
}

// The token is actually wired into resolveBody, asserted against the clock the
// engine itself reads. Re-run if the hour ticks between the two reads, so the
// gate cannot flake once an hour.
let wired = null;
for (let attempt = 0; attempt < 3 && wired === null; attempt++) {
  const before = new Date().getHours();
  const out = engine.resolveBody('{greeting: lang=IT}!', {});
  if (new Date().getHours() === before) wired = [out, engine.sbGreetingText(before, 'IT') + '!'];
}
if (wired === null) fail('could not read the clock twice within one hour');
if (wired[0] !== wired[1]) {
  fail('resolveBody("{greeting: lang=IT}!") -> ' + JSON.stringify(wired[0]) +
    ', expected ' + JSON.stringify(wired[1]) + ': the token is not wired into the resolver');
}

// opts.lang is the snippet's language; a lang= on the token overrides it.
const nowSlotEN = engine.sbGreetingText(new Date().getHours(), 'EN');
if (engine.resolveBody('{greeting}', {}, { lang: 'MULTI' }) !== nowSlotEN) {
  fail('a MULTI body did not fall back to English');
}

console.log('OK Time-of-day greeting parity passed all ' + gok + ' hour/language cases');
