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

for (const fn of ['fillForm', 'inferType', 'chooseLayout', 'dayValue', 'clockValue', 'fixedShift']) {
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
const SHAPE = ['fields', 'buttons', 'preview', 'layout', 'steps', 'fmtOverride'];
const FIELD_SHAPE = ['key', 'label', 'type', 'format', 'currency', 'options', 'picks', 'multiple',
                     'cols', 'default', 'value', 'before', 'after', 'block', 'visible', 'adjust'];

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

// ── THE ADJUST PANEL ────────────────────────────────────────────────
// The Date/Time builder's three decisions, offered again while the form is
// open. Every surface draws its own controls from this one description, so a
// change here is a change on all four at once.
const vmAdj = ff.fillForm(
  'On {formdate: name=DATE_1; format=DD/MM/YYYY} at {formdate: name=TIME_1; type=time} for {NAME}',
  {}, opt());
const [adjDate, adjTime, adjText] = vmAdj.fields;

if (adjText.adjust !== null) {
  fail('a text field carries an Adjust panel; only a date or a time has one');
}
// The raw choice first, then the closed list. Dropping it would leave no way
// back to "print what the picker holds", which is what an unformatted
// {formdate:} has always done.
const dateFmts = adjDate.adjust.formats.map((f) => f.value).join('|');
if (dateFmts !== '|DD/MM/YYYY|MM/DD/YYYY|DD/MM/dddd') {
  fail('date formats on offer are ' + dateFmts + ', expected the raw value then DATE_FORMATS');
}
const timeFmts = adjTime.adjust.formats.map((f) => f.value).join('|');
if (timeFmts !== '|HH:mm|hh:mm A') {
  fail('time formats on offer are ' + timeFmts + ', expected the raw value then TIME_FORMATS');
}
// Every choice is labelled and sampled against the field's own value: the two
// numeric orders are indistinguishable until you see one printed.
if (adjDate.adjust.formats.some((f) => !f.label || f.sample === undefined)) {
  fail('a format choice arrived without a label or a sample');
}
// A clock has no day to jump to, and a calendar has no clock to set.
if (adjTime.adjust.modes.length !== 0 || adjTime.adjust.days.length !== 0) {
  fail('a time field is being offered a day choice');
}
if (adjDate.adjust.hours.length !== 0) {
  fail('a date field is being offered a clock');
}
if (adjDate.adjust.modes.map((m) => m.value).join(',') !== 'none,fixed,named') {
  fail('the day modes are not the builder\'s three, in the builder\'s order');
}
// Hours and minutes are only meaningful on something that holds a clock.
if (adjTime.adjust.hours.length !== 24) fail('a clock is not offering 24 hours');
if (adjTime.adjust.minutes.indexOf('15') === -1) fail('a clock is not stepping in fives');
console.log('OK Adjust panel offers the builder\'s three decisions');

// A day choice writes a value the operator could have picked by hand, so it
// must come back in the picker's own spelling on every surface.
if (ff.dayValue('date', { mode: 'none' }, '', NOW) !== '2026-08-30') {
  fail('"Today" did not land on the current day');
}
if (ff.dayValue('date', { mode: 'fixed', amount: 3, unit: 'D' }, '', NOW) !== '2026-09-02') {
  fail('a three-day offset did not land three days out');
}
if (ff.dayValue('date', { mode: 'named', named: 'next monday' }, '', NOW) !== '2026-08-31') {
  fail('"Next Monday" did not land on the Monday after NOW');
}
// The clock half belongs to the operator and survives a move of the calendar.
if (ff.dayValue('datetime', { mode: 'fixed', amount: 1, unit: 'D' }, '2026-08-30T08:30', NOW)
    !== '2026-08-31T08:30') {
  fail('moving the day of a datetime discarded the time already set on it');
}
if (ff.clockValue('time', '09', '05', '', NOW) !== '09:05') fail('a clock choice did not set the time');
if (ff.clockValue('date', '09', '05', '', NOW) !== '') fail('a date field accepted a clock');
console.log('OK Day and clock choices write the picker\'s own value');

// ── A FORMAT PICKED WHILE FILLING ───────────────────────────────────
// Output only. The value in the picker is untouched, so a formula and
// datetimediff() still read the raw date, and nothing is saved to the snippet.
const BODY_FMT = 'On {formdate: name=DATE_1; format=DD/MM/YYYY}';
const VAL_FMT = { DATE_1: '2026-08-30' };
if (ff.fillForm(BODY_FMT, VAL_FMT, opt()).preview !== 'On 30/08/2026') {
  fail('the author\'s format is not being applied when nobody has overridden it');
}
const vmOv = ff.fillForm(BODY_FMT, VAL_FMT, opt({ fieldFmt: { DATE_1: 'MM/DD/YYYY' } }));
if (vmOv.preview !== 'On 08/30/2026') {
  fail('a format picked while filling did not reach the preview: ' + vmOv.preview);
}
if (vmOv.fields[0].value !== '2026-08-30') {
  fail('a format choice rewrote the value; formatting is output only');
}
if (vmOv.fmtOverride.DATE_1 !== 'MM/DD/YYYY') {
  fail('fmtOverride does not carry what the form is showing, so an insert would differ');
}
// '' is a real answer: print what the picker holds.
if (ff.fillForm(BODY_FMT, VAL_FMT, opt({ fieldFmt: { DATE_1: '' } })).preview !== 'On 2026-08-30') {
  fail('"As picked" did not fall back to the picker\'s own value');
}
// A format this kind of field does not have is a caller bug, and honouring it
// would quietly drop the author's.
if (ff.fillForm(BODY_FMT, VAL_FMT, opt({ fieldFmt: { DATE_1: 'HH:mm' } })).preview !== 'On 30/08/2026') {
  fail('a format from the wrong list was honoured instead of ignored');
}
console.log('OK A format picked while filling is output only, and closed');

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

// ── THE PREVIEW IS ALWAYS TEXT ──────────────────────────────────────
// It is rendered directly as the body of a message. A renderer handed anything
// other than a string puts "[object Object]" in front of a customer, and React
// refuses outright and blanks the editor - which is what shipped in v3.20.0,
// when a loop variable named `src` overwrote the snippet body it shares scope
// with. Nothing above caught it because no test body carried a field ordering.
const PREVIEW_BODIES = [
  'plain text, no fields at all',
  'Hola {NOMBRE}',
  '{formdate: name=D; format=DD/MM/YYYY}',
  // The shape that broke it: a field that points at another field.
  '{formdate: name=S; format=DD/MM/YYYY} {formdate: name=E; after=S; format=DD/MM/YYYY}',
  '{formdate: name=S} {formdate: name=E; after=S} {= datespan(S,E,"inclusive") } days',
  // Pointing at something that is not there, or at itself.
  '{formdate: name=E; after=MISSING}',
  '{formdate: name=E; after=E}',
  '{formtext: name=T} {formdate: name=E; after=T}',
  '',
];
for (const body of PREVIEW_BODIES) {
  const vm = ff.fillForm(body, {}, opt());
  if (typeof vm.preview !== 'string') {
    fail('the preview is a ' + (Array.isArray(vm.preview) ? 'array' : typeof vm.preview) +
      ' for ' + JSON.stringify(body) + '\n' +
      '  It is rendered as message text. Anything but a string blanks the editor.');
  }
  // And every field the renderers switch on must still be the right shape.
  for (const f of vm.fields) {
    if (typeof f.key !== 'string' || typeof f.type !== 'string') {
      fail('a field lost its shape for ' + JSON.stringify(body) + ': ' + JSON.stringify(f));
    }
    if (typeof f.min !== 'string' || typeof f.notBefore !== 'string') {
      fail('a field ordering key is not a string for ' + JSON.stringify(body) +
        ': ' + JSON.stringify({ min: f.min, notBefore: f.notBefore }));
    }
  }
}
console.log('OK The preview is text for every body (' + PREVIEW_BODIES.length + ' shapes)');

console.log('OK Fill form view model passed all gates');
