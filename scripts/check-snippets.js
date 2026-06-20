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
