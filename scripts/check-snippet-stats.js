// Snippet library counting gate (STATS-001).
//
// Pins the four numbers the popup and Sprintbrain.html both print — total,
// personal, shared, owners — against the row shapes that actually exist in
// production. The bug this gate exists for: a snippet with four translations is
// four rows, and every surface used to fold them differently, so the same
// account reported a different library size in the popup, in Sprintbrain.html
// and in the dashboard.
//
// Loads the REAL shipping module (extension/shared/snippet-stats.js) — the same
// file both surfaces load — so a rule change that breaks a count fails here.
const path = require('path');
const S = require(path.join(__dirname, '..', 'extension', 'shared', 'snippet-stats.js'));

let failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { console.error('X ' + name + '\n    expected ' + e + '\n    got      ' + a); failed++; return; }
  console.log('  ok  ' + name);
}

const ME = 'user-me';
const MATE = 'user-mate';
const OTHER = 'user-other';

function row(o) {
  return Object.assign({ id: o.id, user_id: ME, title: o.id, shortcut: '', body: 'x', lang: 'EN', bodies: {} }, o);
}

// ── grouping base ───────────────────────────────────────────────────
check('base drops the trigger prefix', S.baseTrigger(row({ id: '1', shortcut: '::air' })), 'air');
check('base drops a matching language suffix',
  S.baseTrigger(row({ id: '2', shortcut: '::quoteES', lang: 'ES' })), 'quote');
check('base keeps a suffix that is not the row language',
  S.baseTrigger(row({ id: '3', shortcut: 'wait', lang: 'FR' })), 'wait');
check('base of a triggerless row is empty', S.baseTrigger(row({ id: '4', shortcut: '' })), '');

// ── personal library, no translations ───────────────────────────────
const personal = [
  row({ id: 'p1', shortcut: '::hello', lang_group_id: 'p1' }),
  row({ id: 'p2', shortcut: '::bye', lang_group_id: 'p2' }),
  row({ id: 'p3', shortcut: '::thanks', lang_group_id: 'p3' }),
];
check('personal only', S.stats(personal, ME), { total: 3, personal: 3, shared: 0, owners: 0 });

// ── sibling-row translations (legacy lang_group_id model) ───────────
const siblings = [
  row({ id: 't1', shortcut: '::timeEN', lang: 'EN', lang_group_id: 'g-time' }),
  row({ id: 't2', shortcut: '::timeES', lang: 'ES', lang_group_id: 'g-time' }),
  row({ id: 't3', shortcut: '::timeIT', lang: 'IT', lang_group_id: 'g-time' }),
  row({ id: 't4', shortcut: '::timeFR', lang: 'FR', lang_group_id: 'g-time' }),
];
check('four sibling rows are one snippet', S.stats(siblings, ME), { total: 1, personal: 1, shared: 0, owners: 0 });

// ── translations split across two lang_group_ids (production ::quote) ─
const splitGroup = [
  row({ id: 'q1', shortcut: '::quoteEN', lang: 'EN', lang_group_id: 'quoteEN' }),
  row({ id: 'q2', shortcut: '::quoteES', lang: 'ES', lang_group_id: 'quoteEN' }),
  row({ id: 'q3', shortcut: '::quoteIT', lang: 'IT', lang_group_id: 'quoteEN' }),
  row({ id: 'q4', shortcut: '::quoteFR', lang: 'FR', lang_group_id: 'quoteEN' }),
  row({ id: 'q5', shortcut: '::quoteES', lang: 'ES', lang_group_id: 'quoteES' }),
];
check('a split lang_group_id still counts once', S.stats(splitGroup, ME), { total: 1, personal: 1, shared: 0, owners: 0 });

// ── one row carrying its translations in `bodies` (dashboard model) ──
const embedded = [
  row({ id: 'b1', shortcut: '::welcome', lang: 'EN', bodies: { EN: 'hi', ES: 'hola', IT: 'ciao' } }),
];
check('single-row translations count once', S.stats(embedded, ME), { total: 1, personal: 1, shared: 0, owners: 0 });

// ── an explicit lang_group_id joins rows whose triggers differ ───────
// Production shape: ::form (EN) and ::forms (ES/FR/IT) under one group id.
const typoTrigger = [
  row({ id: 'f1', shortcut: '::form', lang: 'EN', lang_group_id: 'forms' }),
  row({ id: 'f2', shortcut: '::forms', lang: 'ES', lang_group_id: 'forms' }),
  row({ id: 'f3', shortcut: '::forms', lang: 'FR', lang_group_id: 'forms' }),
];
check('an explicit group id joins mismatched triggers', S.stats(typoTrigger, ME), { total: 1, personal: 1, shared: 0, owners: 0 });

// ── the false-merge trap: "wait" must not shed its "IT" ─────────────
const suffixTrap = [
  row({ id: 'w1', shortcut: 'WA', lang: 'ES', lang_group_id: 'w1' }),
  row({ id: 'w2', shortcut: 'wait', lang: 'FR', lang_group_id: 'w2' }),
];
check('wait does not merge into WA', S.stats(suffixTrap, ME), { total: 2, personal: 2, shared: 0, owners: 0 });

// ── shared snippets from two different owners ───────────────────────
const shared = [
  row({ id: 's1', user_id: MATE, shortcut: '::policy', lang_group_id: 's1' }),
  row({ id: 's2', user_id: MATE, shortcut: '::policyES', lang: 'ES', lang_group_id: 's1' }),
  row({ id: 's3', user_id: OTHER, shortcut: '::hours', lang_group_id: 's3' }),
];
check('shared snippets report their owners', S.stats(shared, ME), { total: 2, personal: 0, shared: 2, owners: 2 });

// ── the same trigger owned by two people stays two snippets ─────────
const collision = [
  row({ id: 'c1', user_id: ME, shortcut: 'address', lang: 'EN', lang_group_id: 'c1' }),
  row({ id: 'c2', user_id: MATE, shortcut: 'address', lang: 'FR', lang_group_id: 'c2' }),
];
check('one trigger, two owners, two snippets', S.stats(collision, ME), { total: 2, personal: 1, shared: 1, owners: 1 });

// ── mixed library: everything above in one list ─────────────────────
const mixed = [].concat(personal, siblings, splitGroup, embedded, typoTrigger, suffixTrap, shared, collision);
check('mixed personal + shared', S.stats(mixed, ME), { total: 13, personal: 10, shared: 3, owners: 2 });

// ── the partition invariant holds on every fixture ──────────────────
const fixtures = { personal, siblings, splitGroup, embedded, typoTrigger, suffixTrap, shared, collision, mixed };
Object.keys(fixtures).forEach(function (name) {
  const st = S.stats(fixtures[name], ME);
  check('personal + shared = total (' + name + ')', st.personal + st.shared, st.total);
});

// ── no signed-in user: attribute nothing to a teammate ──────────────
check('unknown viewer counts everything personal', S.stats(mixed, null), { total: 13, personal: 13, shared: 0, owners: 0 });

// ── the one string both surfaces print ──────────────────────────────
check('line with shared owners', S.statsLine(S.stats(mixed, ME)), '10 personal · 3 shared from 2 people');
check('line with one owner', S.statsLine(S.stats(collision, ME)), '1 personal · 1 shared from 1 person');
check('line with nothing shared', S.statsLine(S.stats(personal, ME)), '3 personal');

// ── group shape the list rendering depends on ───────────────────────
const idx = S.index(splitGroup);
check('one group for the split family', idx.groups.length, 1);
check('master is the first row', idx.groups[0].master.id, 'q1');
check('every row maps to that group', splitGroup.map(function (r) { return idx.keyOf[r.id]; }),
  splitGroup.map(function () { return idx.groups[0].key; }));
check('four languages surface', Object.keys(idx.groups[0].byLang).sort(), ['EN', 'ES', 'FR', 'IT']);
check('groupFor resolves a row', S.groupFor(splitGroup, splitGroup[4]).key, idx.groups[0].key);
check('count matches the group total', S.count(mixed), 13);

if (failed) { console.error('\nX snippet stats gate: ' + failed + ' failing check(s)'); process.exit(1); }
console.log('\nOK snippet stats gate: all checks pass');
