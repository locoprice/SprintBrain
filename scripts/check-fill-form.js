// Fill-form view-model gate.
//
// extension/shared/fill-form.js decides WHAT a fill form is, so that the four
// surfaces that draw one stop each deciding it for themselves. Before it
// existed the four had already drifted: only the overlay inferred a date field
// from its name, only the overlay opened a date on today, only the overlay
// honoured a stored field_cfg, and the composer showed no prose around a field
// and could not render a datetime at all.
//
// Every assertion below is one of those decisions. A failure here means one
// surface is about to describe a field differently from the others again.
const path = require('path');
const ff = require(path.join(__dirname, '..', 'extension', 'shared', 'fill-form.js'));

function fail(msg) {
  console.error('X ' + msg);
  process.exit(1);
}

for (const fn of ['fillForm', 'inferType', 'chooseLayout']) {
  if (typeof ff[fn] !== 'function') fail('fill-form.js no longer exports ' + fn);
}

// A fixed clock, so the date/time defaults are assertable rather than "today".
const NOW = new Date('2026-08-30T09:15:00');
const opt = (extra) => Object.assign({ now: NOW }, extra || {});

// ── FIELD KIND FROM THE NAME ────────────────────────────────────────
// The rule that made {CHECKIN_DATE} a picker in the overlay and a text box on
// the other three. Split on non-letters, so a formatted name still matches.
const TYPE_CASES = [
  ['NAME', 'text'],
  ['CHECKIN_DATE', 'date'],
  ['DATE_DD/MM/YYYY', 'date'],
  ['TIME_HH:MM', 'time'],
  ['START_DATETIME', 'datetime'],
  ['UPDATED', 'text'],
];
for (const [key, want] of TYPE_CASES) {
  const got = ff.inferType(key);
  if (got !== want) {
    fail('inferType(' + JSON.stringify(key) + ') -> ' + got + ', expected ' + want);
  }
}
console.log('OK Field kind inferred from the name (' + TYPE_CASES.length + ' cases)');

// ── THE VIEW MODEL EVERY SURFACE READS ──────────────────────────────
const SHAPE = ['fields', 'buttons', 'preview', 'layout', 'steps'];
const FIELD_SHAPE = ['key', 'label', 'type', 'format', 'currency', 'options', 'picks', 'multiple',
                     'cols', 'default', 'value', 'before', 'after', 'block', 'visible'];

const vm1 = ff.fillForm(
  'Hola {NOMBRE}, tu {formmenu: A,B,C; name=PLAN; default=B} para el {CHECKIN_DATE}.',
  {}, opt());

for (const k of SHAPE) {
  if (!Object.prototype.hasOwnProperty.call(vm1, k)) {
    fail('the view model no longer carries "' + k + '".\n' +
      '  Every renderer reads this shape; dropping a key breaks them silently.');
  }
}
for (const k of FIELD_SHAPE) {
  if (!Object.prototype.hasOwnProperty.call(vm1.fields[0], k)) {
    fail('a field no longer carries "' + k + '".');
  }
}
console.log('OK View model shape intact (' + SHAPE.length + ' keys, ' + FIELD_SHAPE.length + ' per field)');

// Walk order is the order the author wrote the fields, on every surface.
const order = vm1.fields.map((f) => f.key).join(',');
if (order !== 'NOMBRE,PLAN,CHECKIN_DATE') {
  fail('field order is ' + order + ', expected the order they appear in the text');
}

// A choice list arrives as an array, so no renderer splits the string itself.
const plan = vm1.fields[1];
if (!Array.isArray(plan.options) || plan.options.join('|') !== 'A|B|C') {
  fail('a menu no longer exposes its options as an array: ' + JSON.stringify(plan.options));
}
if (!plan.block) fail('a menu must be marked block, so its prose goes above and below');
if (plan.picks.join(',') !== 'B') {
  fail('menu preselection is ' + JSON.stringify(plan.picks) + ', expected the declared default');
}

// A date with no declared default opens on today rather than empty.
const dateField = vm1.fields[2];
if (dateField['default'] !== '2026-08-30') {
  fail('an undated date field opened on ' + JSON.stringify(dateField['default']) +
    ', expected the current date');
}

// The words either side of the token, so a row reads like the snippet. The
// composer had none of this and labelled controls with the bare key.
if (vm1.fields[0].before !== 'Hola' || vm1.fields[0].after !== ', tu') {
  fail('field context is ' + JSON.stringify([vm1.fields[0].before, vm1.fields[0].after]) +
    ', expected the prose around the token');
}
console.log('OK Options, preselection, date default and surrounding prose all decided once');

// ── STORED CONFIG WINS OVER THE TEXT ────────────────────────────────
// field_cfg is empty on every row today, which is the only reason three of the
// four surfaces ignoring it has never bitten. Pinned so it cannot start.
const vmCfg = ff.fillForm('Total {AMOUNT}', {}, opt({ fieldCfg: { AMOUNT: { type: 'number' } } }));
if (vmCfg.fields[0].type !== 'number') {
  fail('a stored field_cfg no longer overrides what the text declares');
}
// A stored label is the field's display name. Only the phone honoured this,
// and it is part of the documented field_cfg shape, so it travels in the model.
const vmLbl = ff.fillForm('Total {AMOUNT}', {}, opt({ fieldCfg: { AMOUNT: { label: 'Grand total' } } }));
if (vmLbl.fields[0].label !== 'Grand total') {
  fail('a stored field label is no longer carried: ' + JSON.stringify(vmLbl.fields[0].label));
}
if (vmCfg.fields[0].label !== '') {
  fail('a field with no stored label must report an empty one, so each renderer\n' +
    '  keeps its own way of titling an unnamed field');
}
console.log('OK Stored field config and label override the text');

// ── PREVIEW RESOLVES AGAINST WHAT THE FORM SHOWS ────────────────────
// Not against the raw values argument. A single-choice menu nobody touched
// already displays its first option, so resolving without it previewed a hole
// in a sentence the surface was visibly showing as answered.
const vmPrev = ff.fillForm('Pick {formmenu: Uno,Dos; name=M} now', {}, opt());
if (vmPrev.preview !== 'Pick Uno now') {
  fail('preview is ' + JSON.stringify(vmPrev.preview) +
    ', expected it to resolve against the values the form is showing');
}
const vmTyped = ff.fillForm('Hi {N}', { N: 'Ada' }, opt());
if (vmTyped.preview !== 'Hi Ada') fail('preview ignores what the operator typed');
console.log('OK Preview resolves against the values the form displays');

// ── THE STEP-MODE SEAM, DELIBERATELY SWITCHED OFF ───────────────────
// layout and steps exist so that turning on an automatic step mode later is a
// change to chooseLayout() and nowhere else. Until that is a decision somebody
// has actually taken, every form is flat. This gate is what makes turning it on
// deliberate rather than accidental.
const long = 'A{F1}B{F2}C{F3}D{F4}E{F5}F{F6}G{F7}H{F8}';
const vmLong = ff.fillForm(long, {}, opt());
if (vmLong.fields.length !== 8) {
  fail('expected 8 fields in the long case, got ' + vmLong.fields.length);
}
if (vmLong.layout !== 'flat' || vmLong.steps.length !== 0) {
  fail('step mode has been switched on (layout=' + vmLong.layout +
    ', steps=' + vmLong.steps.length + ').\n' +
    '  No renderer draws steps yet, so a form would silently lose its fields.\n' +
    '  Turning this on is a product decision, not a refactor: update this gate\n' +
    '  in the same change that teaches all four surfaces to render steps.');
}
if (ff.chooseLayout(99) !== 'flat') {
  fail('chooseLayout no longer answers flat for every size');
}
console.log('OK Step mode is still off, and off deliberately');

// ── EVERY FIELD IS VISIBLE UNTIL CONDITIONS SHIP ────────────────────
// visible is in the shape from day one so conditional fields change behaviour
// in one function rather than the whole view model.
const vmIf = ff.fillForm('{if: X > 0}{AMOUNT}{endif}', {}, opt());
if (vmIf.fields.some((f) => !f.visible)) {
  fail('a field is being hidden, but conditional visibility has not shipped.\n' +
    '  Renderers still draw every field, so hiding one here would drop it from\n' +
    '  the form while the text still expects an answer.');
}
console.log('OK All fields visible (conditional visibility not shipped yet)');

// ── DEGRADES INSTEAD OF THROWING ────────────────────────────────────
// This runs inside a content script on somebody else's page. A throw there is
// a broken host page, not a broken form.
for (const bad of ['', null, undefined]) {
  let out;
  try { out = ff.fillForm(bad, null, null); }
  catch (e) { fail('fillForm(' + JSON.stringify(bad) + ') threw: ' + e.message); }
  if (!out || !Array.isArray(out.fields) || out.layout !== 'flat') {
    fail('fillForm(' + JSON.stringify(bad) + ') did not return an empty flat form');
  }
}
console.log('OK Empty and missing input degrade to an empty form');

console.log('OK Fill form view model passed all gates');
