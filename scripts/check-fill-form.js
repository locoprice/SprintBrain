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

for (const fn of ['fillForm', 'inferType', 'chooseLayout', 'dayValue', 'clockValue', 'fixedShift',
                  'linkUrl', 'readFromPage', 'linkText', 'linkSummary', 'linkNote']) {
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
const SHAPE = ['fields', 'buttons', 'preview', 'layout', 'steps', 'fmtOverride', 'linkable'];
const FIELD_SHAPE = ['key', 'label', 'type', 'format', 'currency', 'options', 'picks', 'multiple',
                     'cols', 'default', 'value', 'before', 'after', 'block', 'visible', 'adjust',
                     'link', 'fromLink'];

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
if (dateFmts !== '|DD/MM/YYYY|MM/DD/YYYY|DD/MM/dddd|long') {
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

// ── FILL FROM LINK ──────────────────────────────────────────────────
// A pasted page fills the form. The reader lives in fill-form.js so the four
// surfaces cannot read one page four ways. Every case below is a way a wrong
// value could reach a message unseen; each must come back filled correctly or
// refused, never guessed. The pages here are made up and name no trade.
const LINK_BODY =
  'Order for {formtext: name=WHO; link=after:Customer} ' +
  '{formtext: name=BOXES; type=number; default=0; link=before:Boxes|Box} boxes and ' +
  '{formtext: name=BAGS; type=number; default=0; link=before:Bags|Bag} bags, ' +
  'from {formdate: name=START; format=long; link=after:Pick-up} ' +
  'to {formdate: name=END; format=long; after=START; link=after:Return}, ' +
  '{= datespan(START, END, "between") } days. Plan: {formmenu: Basic,Plus; name=PLAN; link=after:Plan} ' +
  'Not linked: {formtext: name=NOTE}';
const LINK_PAGE = [
  'Your order', 'Customer', 'Ada Lovelace',
  'Pick-up', ':', 'Friday, 09-10-2026 14:00',
  'Return', 'Sunday, 11-10-2026 11:00',
  'Shelf 1', '2 Boxes', 'Shelf 2', '1 Box',
  'Plan: Plus'
];
const vmL = ff.fillForm(LINK_BODY, {}, opt({ lang: 'ES' }));
if (vmL.linkable !== true) fail('a form whose fields carry link= is not offered the Link box');
if (ff.fillForm('Hola {NOMBRE}', {}, opt()).linkable !== false) {
  fail('a form with no link= offers the Link box; every snippet written before it must look the same');
}
const noteField = vmL.fields.find((f) => f.key === 'NOTE');
if (noteField.link !== null) fail('a field with no link= carries a reading rule: ' + JSON.stringify(noteField.link));
const boxField = vmL.fields.find((f) => f.key === 'BOXES');
if (!boxField.link || boxField.link.mode !== 'before' || boxField.link.words.join('|') !== 'Boxes|Box') {
  fail('link=before:Boxes|Box parsed as ' + JSON.stringify(boxField.link));
}
const readL = ff.readFromPage(vmL.fields, LINK_PAGE);
const wantL = { WHO: 'Ada Lovelace', BOXES: '3', BAGS: '0', START: '2026-10-09', END: '2026-10-11', PLAN: 'Plus' };
for (const k of Object.keys(wantL)) {
  if (readL.values[k] !== wantL[k]) {
    fail('Fill from link read ' + k + ' as ' + JSON.stringify(readL.values[k]) + ', expected ' + JSON.stringify(wantL[k]));
  }
}
if (Object.prototype.hasOwnProperty.call(readL.values, 'NOTE')) fail('a field with no link= was filled from the page');
if (readL.filled !== 6 || readL.total !== 6) fail('read counted ' + readL.filled + '/' + readL.total + ', expected 6/6');
const bagsR = readL.results.find((r) => r.key === 'BAGS');
if (!bagsR || !bagsR.none) fail('a count the page never mentions must be marked as its default, not as read');
const vmL2 = ff.fillForm(LINK_BODY, readL.values, opt({ lang: 'ES', linked: { START: true } }));
const wantPreview = 'viernes 9 de octubre de 2026 to domingo 11 de octubre de 2026, 2 days';
if (vmL2.preview.indexOf(wantPreview) === -1) {
  fail('a page-filled form previews ' + JSON.stringify(vmL2.preview) + '\n  expected it to contain ' + JSON.stringify(wantPreview));
}
if (!vmL2.fields.find((f) => f.key === 'START').fromLink || vmL2.fields.find((f) => f.key === 'END').fromLink) {
  fail('fromLink must follow opts.linked exactly');
}
console.log('OK Fill from link reads a page into the form (' + Object.keys(wantL).length + ' fields)');

// Dates: read when the page settles them, refused when it does not.
const dateCase = (type, text) => {
  const r = ff.readFromPage([{ key: 'K', type, link: { mode: 'after', words: ['When'] }, options: [], 'default': '' }],
    ['When', text]);
  return r.values.K !== undefined ? r.values.K : r.results[0].status;
};
const DATE_READS = [
  ['date', 'Friday, 09-10-2026 14:00', '2026-10-09'],
  ['date', 'Thursday, 09-10-2026', '2026-09-10'],  // the weekday settles the order
  ['date', '09-10-2026', 'unclear'],               // two readings, nothing to choose
  ['date', 'Saturday, 09-10-2026', 'unclear'],     // the weekday fits neither
  ['date', '13/10/2026', '2026-10-13'],
  ['date', '10/13/2026', '2026-10-13'],
  ['date', '2026-10-09', '2026-10-09'],
  ['date', '31/02/2026', 'unclear'],
  ['date', 'no date at all', 'unclear'],
  ['date', '9 de octubre de 2026', '2026-10-09'],
  ['date', 'venerdì 9 ottobre 2026', '2026-10-09'],
  ['date', '1er octobre 2026', '2026-10-01'],
  ['date', 'Oct 9, 2026', '2026-10-09'],
  ['date', 'Sun 10 Oct 2026', 'unclear'],          // 10 October 2026 is a Saturday
  ['datetime', 'Friday, 09-10-2026 14:00', '2026-10-09T14:00'],
  ['datetime', 'Friday, 09-10-2026', 'unclear'],   // no clock, none invented
  ['time', 'at 9:30 pm', '21:30'],
  ['time', '14h30', '14:30'],
  ['number', '€ 1.200,50', '1200.5'],
  ['number', 'none', 'unclear'],
];
for (const [type, text, want] of DATE_READS) {
  const got = dateCase(type, text);
  if (got !== want) fail('reading a ' + type + ' from ' + JSON.stringify(text) + ' gave ' + JSON.stringify(got) + ', expected ' + JSON.stringify(want));
}
console.log('OK Fill from link reads or refuses every date and number (' + DATE_READS.length + ' cases)');

// A choice the menu does not offer is refused, not forced onto the first option.
const menuRead = ff.readFromPage([{ key: 'M', type: 'dd', options: ['Basic', 'Plus'], multiple: false,
  link: { mode: 'after', words: ['Plan'] }, 'default': '' }], ['Plan', 'Gold']);
if (menuRead.results[0].status !== 'unclear' || menuRead.values.M !== undefined) {
  fail('a page naming an option the menu does not have must leave the menu alone');
}
// A closing date the page puts before its opening one: one of the two is wrong,
// and the form's ordering rule would empty the closing date without a word. It
// is refused instead, like any other value the page does not settle.
const orderBody = '{formdate: name=S; link=after:From} {formdate: name=E; after=S; link=after:To}';
const orderRead = ff.readFromPage(ff.fillForm(orderBody, {}, opt()).fields,
  ['From', 'Sunday, 11-10-2026', 'To', 'Friday, 09-10-2026']);
if (orderRead.values.E !== undefined || orderRead.results[1].status !== 'unclear' || orderRead.filled !== 1) {
  fail('a closing date before its opening one was filled: ' + JSON.stringify(orderRead));
}
// A label that is not on the page leaves the field as it was.
const missRead = ff.readFromPage([{ key: 'T', type: 'text', link: { mode: 'after', words: ['Reference'] }, 'default': '' }],
  ['Something else']);
if (missRead.results[0].status !== 'missing' || missRead.filled !== 0) fail('a label missing from the page was not reported as missing');
console.log('OK Fill from link refuses what the page does not settle');

// The link itself: secure web addresses only, a missing scheme added.
const LINK_URLS = [
  ['', '', 'link-empty'],
  ['www.example.com/order?id=7', 'https://www.example.com/order?id=7', ''],
  ['https://example.com/a', 'https://example.com/a', ''],
  ['http://example.com/a', '', 'link-not-secure'],
  ['https://localhost/a', '', 'link-invalid'],
  ['ftp://example.com/a', '', 'link-invalid'],
  ['https://exa mple.com', '', 'link-invalid'],
];
for (const [raw, url, problem] of LINK_URLS) {
  const got = ff.linkUrl(raw);
  if (got.url !== url || got.problem !== problem) {
    fail('linkUrl(' + JSON.stringify(raw) + ') -> ' + JSON.stringify(got) + ', expected ' + JSON.stringify({ url, problem }));
  }
}
for (const key of ['reading', 'from-link', 'link_unreachable', 'rate_limited', 'offline', 'failed']) {
  if (typeof ff.linkText(key) !== 'string' || ff.linkText(key) === '') fail('no words for ' + key);
}
if (ff.linkText('no-such-code') !== ff.linkText('failed')) fail('an unknown error code must read as the generic failure');
console.log('OK Fill from link checks the link and has words for every outcome');

console.log('OK Fill form view model passed all gates');
