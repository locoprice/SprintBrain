// Formula-engine behavior gate.
//
// Loads the REAL shipping engine (extension/formula-engine.js) and pins its
// output on representative inputs — including the numeric-comparison conditionals
// that the previous Function()-based smoke test could not exercise (and which had
// silently regressed in production: {if: OTA_PRICE > 0} never rendered).
const path = require('path');
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
