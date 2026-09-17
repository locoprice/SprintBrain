// Unused-asset rule gate (INACTIVE-001).
//
// The rule that decides whether a snippet or prompt is "unused" exists twice:
//
//   extension/shared/inactivity.js   popup + Sprintbrain.html + content.js
//   app/src/lib/inactivity.ts        the React dashboard
//
// Twice because app/CLAUDE.md section 6 forbids the dashboard importing
// extension source, the same constraint that already forces validateTemplate to
// be mirrored. A mirror without a gate is drift waiting to happen, and this one
// decides what the product tells the user to delete.
//
// So both read scripts/inactivity-cases.json and must answer identically. This
// file checks the extension copy; app/src/__tests__/inactivity.test.ts checks
// the TypeScript copy against the same table. Change the rule and BOTH fail
// until both are updated.
const path = require('path');
const fs = require('fs');

const INA = require(path.join(__dirname, '..', 'extension', 'shared', 'inactivity.js'));
const CASES = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'inactivity-cases.json'), 'utf8'),
);

let failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error('X ' + name + '\n    expected ' + e + '\n    got      ' + a);
    failed++;
    return;
  }
  console.log('  ok  ' + name);
}

for (const fn of ['findInactive', 'message', 'formatDate', 'clampMonths', 'normalizeState',
                  'recordUse', 'recordKeep', 'pruneState']) {
  if (typeof INA[fn] !== 'function') {
    console.error('X inactivity.js no longer exports ' + fn);
    failed++;
  }
}

const NOW = new Date(CASES.now).getTime();

// The extension module takes the recorded last-use dates as a separate map
// (that is the shape the RPC and the local mirror arrive in) and reads the
// snooze list off its storage state. Adapt the shared table to that signature;
// the TypeScript copy takes the same facts in its own shape.
const serverMap = {};
for (const item of CASES.items) {
  if (item.lastUsedAt) serverMap[item.id] = item.lastUsedAt;
}

function stateFor(months) {
  const keptUntil = {};
  for (const [id, iso] of Object.entries(CASES.keptUntil)) {
    keptUntil[id] = new Date(iso).getTime();
  }
  return INA.normalizeState({ thresholdMonths: months, keptUntil });
}

const items = CASES.items.map((i) => ({
  id: i.id,
  name: i.name,
  trigger: i.trigger,
  createdAt: i.createdAt,
}));

for (const exp of CASES.expect) {
  const out = INA.findInactive(items, serverMap, stateFor(exp.months), NOW);
  check(exp._case + ' / ids', out.map((e) => e.id), exp.ids);
  check(exp._case + ' / messages', out.map((e) => INA.message(e)), exp.messages);
  check(exp._case + ' / everUsed', out.map((e) => e.everUsed), exp.everUsed);
}

for (const c of CASES.clampMonths) {
  check('clampMonths(' + JSON.stringify(c.in) + ')', INA.clampMonths(c.in), c.out);
}

for (const c of CASES.formatDate) {
  check('formatDate(' + c.in + ')', INA.formatDate(new Date(c.in).getTime()), c.out);
}

// ── Storage shape ───────────────────────────────────────────────────
// These have no dashboard twin (the dashboard keeps its snooze in localStorage
// and has no offline mirror), so they are asserted here only. They exist
// because a malformed stored object must never take the notice down with it.
check('normalizeState survives junk', INA.normalizeState('not an object'),
  { thresholdMonths: 6, lastUsed: {}, keptUntil: {} });
check('normalizeState drops unparseable dates',
  INA.normalizeState({ lastUsed: { a: 'banana', b: '2026-01-01T00:00:00Z' } }).lastUsed,
  { b: new Date('2026-01-01T00:00:00Z').getTime() });

// Using an asset answers the question the notice asks, so the snooze that stood
// in for that answer goes with it. Without this a kept-then-used snippet would
// stay silent for 90 days and then reappear as if it had never been touched.
const used = INA.recordUse(INA.recordKeep(INA.normalizeState(null), 'x', NOW), 'x', NOW);
check('recordUse stamps the date', used.lastUsed.x, NOW);
check('recordUse clears any standing snooze', used.keptUntil.x, undefined);

// A deleted asset must not keep a snooze alive: ids are reused by Notion sync,
// and an inherited snooze would silence a brand-new snippet.
const pruned = INA.pruneState(
  { lastUsed: { keep: 1, drop: 2 }, keptUntil: { keep: 3, drop: 4 } },
  ['keep'],
);
check('pruneState keeps live ids', Object.keys(pruned.lastUsed), ['keep']);
check('pruneState drops dead ids', Object.keys(pruned.keptUntil), ['keep']);

// Calendar months, not a day count. Mid-month is the case that matters and it
// lands exactly: six months before 15 August 2026 is 15 February 2026, where a
// fixed 183 days would be three days out.
const aug15 = new Date(2026, 7, 15, 12, 0, 0).getTime();
const mid = new Date(INA.cutoffMs(aug15, 6));
check('cutoff from 15 August is 15 February',
  [mid.getDate(), mid.getMonth(), mid.getFullYear()], [15, 1, 2026]);

// Month-end overflow, pinned rather than fixed: February has no 31st, so
// setMonth rolls into March. Asserted so the behaviour cannot change in one
// copy without the other, and documented in both modules.
const aug31 = new Date(2026, 7, 31, 12, 0, 0).getTime();
const end = new Date(INA.cutoffMs(aug31, 6));
check('cutoff from 31 August overflows into early March',
  [end.getDate(), end.getMonth(), end.getFullYear()], [3, 2, 2026]);

if (failed) {
  console.error('\nX ' + failed + ' check(s) failed');
  process.exit(1);
}
console.log('\nOK inactivity rule: the extension copy matches the shared case table');
