// Pro lock gate (docs/pro-features/README.md).
//
// Five features call the AI service and cost real money per use: Ask
// SprintBrain, Draft with AI, Translate from EN, Suggest labels and Read a
// picture. Until the Pro plan exists each is shown locked ("Available to Pro
// users soon") and cannot start a request. Their switches live in
// app/src/lib/proFeatures.ts; the phone carries its own copy of the label and
// of the Ask and Picture switches. This pins what must agree:
//
//   1. One label, on the dashboard and on the phone.
//   2. The phone's Ask and Picture switches follow the dashboard's.
//   3. Every entry point reads its switch, and shows the lock.
//   4. A request can leave only from the one place that sits behind a switch:
//      a new caller of an AI function fails this gate until it is gated. The
//      phone may call one server function that is not AI, read-link (Fill
//      from link): it fetches a public web page and calls no AI service, so
//      it is free and has no switch. It is named, not matched by a pattern,
//      so every other new call still fails here.
//   5. The manual follows the switches: a feature's page is published while it
//      is on and kept unpublished while it is off ("document only what works").
//
// It does not forbid switching a feature on: that is a deliberate step, and
// the checks above say what has to move with it.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

let failed = 0;
function check(name, ok, detail) {
  if (!ok) {
    console.error('X ' + name + (detail ? '\n    ' + detail : ''));
    failed++;
    return;
  }
  console.log('  ok  ' + name);
}

const LIB = read('app/src/lib/proFeatures.ts');
const MOBILE = read('app/public/mobile/index.html');
const DOCS_JSON = read('user-docs/docs.json');

// ── The switches ───────────────────────────────────────────────────────────
const FEATURES = ['ask', 'draft', 'translate', 'labels', 'picture'];
const on = {};
for (const m of LIB.matchAll(/^\s*(ask|draft|translate|labels|picture):\s*(true|false),/gm)) on[m[1]] = m[2] === 'true';
check('proFeatures.ts declares a switch for each of the five features', FEATURES.every((f) => f in on), JSON.stringify(on));

// ── 1. One label ───────────────────────────────────────────────────────────
const label = (LIB.match(/export const PRO_SOON_LABEL = '([^']+)'/) || [])[1];
check('the dashboard label is "Available to Pro users soon"', label === 'Available to Pro users soon', String(label));
check('the phone shows the same words', MOBILE.includes("var PRO_SOON_LABEL='" + label + "';"));

// ── 2. The phone's switch ──────────────────────────────────────────────────
const phone = MOBILE.match(/var ASK_AVAILABLE=(true|false);/);
check('the phone has an Ask switch', phone !== null);
check('the phone Ask switch matches the dashboard\'s', phone !== null && (phone[1] === 'true') === on.ask,
  'phone ' + (phone && phone[1]) + ' vs dashboard ' + on.ask);
const phonePicture = MOBILE.match(/var PICTURE_AVAILABLE=(true|false);/);
check('the phone has a Picture switch', phonePicture !== null);
check('the phone Picture switch matches the dashboard\'s', phonePicture !== null && (phonePicture[1] === 'true') === on.picture,
  'phone ' + (phonePicture && phonePicture[1]) + ' vs dashboard ' + on.picture);

// ── 3. Every entry point reads its switch and shows the lock ───────────────
const ENTRY_POINTS = [
  ['ask', 'app/src/features/search/GlobalSearch.tsx'],
  ['draft', 'app/src/components/shared/DraftWithAi.tsx'],
  ['translate', 'app/src/features/snippets/NewSnippetDialog.tsx'],
  ['labels', 'app/src/features/labels/LabelSuggestions.tsx'],
];
for (const [feature, file] of ENTRY_POINTS) {
  const source = read(file);
  check(file.split('/').pop() + ' reads the ' + feature + ' switch', source.includes("isProFeatureAvailable('" + feature + "')"));
  check(file.split('/').pop() + ' shows the lock and its tooltip', source.includes('<ProSoonLock') && source.includes('<ProSoon'));
}
check('the phone guards the question before any request', /function openAsk\(question\)\{\s*if\(!ASK_AVAILABLE\)return;/.test(MOBILE));
check('a tap on a locked phone row says the label', MOBILE.includes('if(!ASK_AVAILABLE){showToast(PRO_SOON_LABEL);return;}'));
check('the phone shows the lock on all three Ask rows', (MOBILE.match(/class="ask-lock"/g) || []).length === 3);
check('the phone row shows the label in plain sight, since a phone has no hover', MOBILE.includes(':PRO_SOON_LABEL;'));
check('the phone reads no picture while its switch is off', /function readPicture\(file\)\{\s*if\(!PICTURE_AVAILABLE\|\|/.test(MOBILE));
check('a tap on the locked Read a picture row says the label', MOBILE.includes("if(!PICTURE_AVAILABLE){showToast(PRO_SOON_LABEL);return;}"));
check('the locked Read a picture row shows the lock and the label in plain sight',
  MOBILE.includes('class="cap-pic-lock"') && MOBILE.includes("textContent=!PICTURE_AVAILABLE?PRO_SOON_LABEL"));
check('while locked, Save to Brain says how to copy a picture\'s text without it', MOBILE.includes("textContent=PICTURE_AVAILABLE?'':PICTURE_TIP;"));

// ── 4. A request leaves from one place only ────────────────────────────────
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir + '/' + entry.name;
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      walk(rel, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}
const SOURCES = walk('app/src');
const CALLERS = [
  ['draftApi.draft(', ['app/src/components/shared/DraftWithAi.tsx']],
  ['askApi.ask(', ['app/src/features/search/AskAnswer.tsx']],
  ['translateApi.translateBody(', ['app/src/features/snippets/NewSnippetDialog.tsx']],
  ['labelSuggestApi.suggestForSnippet(', ['app/src/features/labels/LabelSuggestions.tsx']],
];
for (const [call, allowed] of CALLERS) {
  const found = SOURCES.filter((file) => read(file).includes(call)).sort();
  check(call + ' is called only from ' + allowed.join(', '), JSON.stringify(found) === JSON.stringify(allowed.slice().sort()), found.join(', '));
}
check('the phone sends Ask from one place, runAsk', (MOBILE.match(/\/functions\/v1\/ask-sprintbrain/g) || []).length === 1);
// A function's own text: from its declaration to the first line holding only
// its closing brace. A lazy match straight to the call would run on past the
// end of the function and pass with the call moved anywhere further down.
const fnBody = (head) => {
  const at = MOBILE.indexOf(head);
  if (at === -1) return '';
  const end = MOBILE.indexOf('\n}', at);
  return end === -1 ? '' : MOBILE.slice(at, end + 2);
};
check('the phone sends Read a picture from one place, readPicture', (MOBILE.match(/\/functions\/v1\/read-picture/g) || []).length === 1
  && fnBody('function readPicture(file){').includes('/functions/v1/read-picture'));
// Free server functions the phone may call without a switch. Not AI: adding a
// name here is a statement that the function never calls the AI service.
const PHONE_FREE_FUNCTIONS = ['read-link'];
const PHONE_AI_FUNCTIONS = ['ask-sprintbrain', 'read-picture'];
const phoneCalls = (MOBILE.match(/\/functions\/v1\/[a-z-]+/g) || []).map((u) => u.slice('/functions/v1/'.length));
check('the phone sends Fill from link from one place, fillFromLink', (MOBILE.match(/\/functions\/v1\/read-link/g) || []).length === 1
  && fnBody('function fillFromLink(){').includes('/functions/v1/read-link'));
check('the phone calls no other AI function', phoneCalls.every((fn) => PHONE_AI_FUNCTIONS.includes(fn) || PHONE_FREE_FUNCTIONS.includes(fn)),
  phoneCalls.join(', '));
check('the search panel only opens an answer when the Ask switch is on', read(ENTRY_POINTS[0][1]).includes('const canAsk = askAvailable && showAskRow;'));
check('Translate does nothing while locked', read(ENTRY_POINTS[2][1]).includes('if (!translateAvailable) return;'));

// ── 5. The manual follows the switches ─────────────────────────────────────
const PAGES = [
  ['ask', 'ask', 'ask-sprintbrain.mdx'],
  ['draft', 'draft', 'draft-with-ai.mdx'],
];
for (const [feature, folder, kept] of PAGES) {
  const published = exists('user-docs/' + folder + '/overview.mdx') && DOCS_JSON.includes('"' + folder + '/overview"');
  const keptHere = exists('docs/pro-features/' + kept);
  if (on[feature]) {
    check(feature + ' is on, so its manual page is published', published && !keptHere);
  } else {
    check(feature + ' is locked, so its manual page stays out of the published manual', !published && keptHere,
      'published=' + published + ', kept in docs/pro-features=' + keptHere);
  }
}

// Read a picture lives on the phone, so its manual is a section of the phone's
// page rather than a page of its own: kept in docs/pro-features while locked.
const MOBILE_PAGE = read('user-docs/apps/mobile.mdx');
const pictureDocumented = MOBILE_PAGE.includes('**Read a picture**');
if (on.picture) {
  check('picture is on, so the phone page documents Read a picture', pictureDocumented);
} else {
  check('picture is locked, so the phone page leaves Read a picture out', !pictureDocumented);
  check('picture is locked, so its manual section is kept in docs/pro-features', exists('docs/pro-features/read-picture.mdx'));
}

if (failed > 0) {
  console.error('\n' + failed + ' Pro lock check(s) failed.');
  process.exit(1);
}
console.log('\nPro lock checks passed.');
