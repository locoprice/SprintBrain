// Shipped-content + language-variant gate (SECURITY-001 / LANG-001).
//
// Two regressions this gate exists for, both found on 2026-08-19:
//
// 1. The extension shipped a real snippet library in DEFAULT_SNIPPETS. Anyone
//    who installed it saw that library in the in-page picker without an
//    account, because a signed-out install seeded the defaults into
//    chrome.storage.local. Nothing the bundle ships may contain snippet
//    content; a signed-out library is empty, by design.
//
// 2. _findLangVariants dropped languages. It expanded a row's `bodies` map only
//    when the group held one row, so a group with sibling rows for ES/IT never
//    surfaced an EN that lived inside a bodies map. Same-language duplicate
//    siblings (real data: a re-import created a second row per language) also
//    let the LAST row win, so which translation appeared depended on row order.
//
// Loads the REAL content.js in a vm context, the same file the browser runs.
const path = require('path');
const fs = require('fs');
const vm = require('vm');

let failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { console.error('X ' + name + '\n    expected ' + e + '\n    got      ' + a); failed++; return; }
  console.log('  ok  ' + name);
}

const ENGINE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'extension', 'formula-engine.js'), 'utf8');
const CONTENT_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'extension', 'content', 'content.js'), 'utf8');
// content.js groups language variants through the shared rule, which the
// manifest loads ahead of it. The gate has to load it in the same order.
const STATS_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'extension', 'shared', 'snippet-stats.js'), 'utf8');
// The same goes for the Interactive Steps setting it reads while loading.
const STEPS_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'extension', 'shared', 'interactive-steps.js'), 'utf8');

// ── minimal host: only what content.js touches while loading ────────
const noop = function () {};
const stubEl = {
  id: '', style: {}, dataset: {}, textContent: '',
  appendChild: noop, remove: noop, addEventListener: noop, setAttribute: noop,
  querySelector: () => null, querySelectorAll: () => [], getAttribute: () => null,
};
const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  innerWidth: 1280, innerHeight: 800,
  document: {
    addEventListener: noop, removeEventListener: noop,
    createElement: () => Object.assign({}, stubEl),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    head: Object.assign({}, stubEl), body: Object.assign({}, stubEl),
    activeElement: null,
  },
  chrome: {
    storage: {
      local: { get: (k, cb) => cb && cb({}), set: (o, cb) => cb && cb(), remove: noop },
      sync:  { get: (k, cb) => cb && cb({}), set: (o, cb) => cb && cb(), remove: noop },
      onChanged: { addListener: noop },
    },
    runtime: { id: 'gate', lastError: null, sendMessage: noop, onMessage: { addListener: noop } },
  },
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

try {
  vm.runInContext(ENGINE_SRC, sandbox);
  vm.runInContext(STATS_SRC, sandbox);
  vm.runInContext(STEPS_SRC, sandbox);
  vm.runInContext(CONTENT_SRC, sandbox);
} catch (e) {
  console.error('X content.js failed to evaluate in the gate context: ' + e.message);
  process.exit(1);
}

// ── 1. nothing ships a snippet library ──────────────────────────────
if (!Array.isArray(sandbox.DEFAULT_SNIPPETS)) {
  console.error('X content.js no longer defines DEFAULT_SNIPPETS');
  process.exit(1);
}
check('DEFAULT_SNIPPETS ships empty', sandbox.DEFAULT_SNIPPETS.length, 0);

// A body that reaches the bundle is readable by anyone who installs it, so the
// file itself must stay free of snippet prose and of any customer's identity.
// These markers are drawn from what the 2026-08-19 leak actually shipped.
//
// Scope note: this list targets snippet CONTENT, not vocabulary. SELECTION_TRIGGERS
// still carries industry words ('presupuesto', 'minimum stay') as match keywords
// and customer-shaped snippet ids. That is a separate industry-neutrality gap
// (see the Industry-Neutral section of CLAUDE.md), tracked on its own, and adding
// those words here would make this gate fail for a reason it does not test.
const LEAK_MARKERS = ['leibtour', 'check-in:', 'ecotasa', 'airbnb'];
const contentLower = CONTENT_SRC.toLowerCase();
LEAK_MARKERS.forEach(function (m) {
  check('content.js ships no "' + m + '"', contentLower.indexOf(m), -1);
});

// ── 2. language variants ────────────────────────────────────────────
if (typeof sandbox._findLangVariants !== 'function') {
  console.error('X content.js no longer exposes _findLangVariants');
  process.exit(1);
}
function langsOf(map) { return Object.keys(map).sort(); }

// Duplicate same-language siblings: one entry per language, first row wins.
sandbox.snippets = [
  { id: 'a1', lang_group_id: 'g', shortcut: 'x', lang: 'ES', body: 'ES first',  bodies: {} },
  { id: 'a2', lang_group_id: 'g', shortcut: 'x', lang: 'ES', body: 'ES second', bodies: {} },
  { id: 'a3', lang_group_id: 'g', shortcut: 'x', lang: 'IT', body: 'IT one',    bodies: {} },
];
let m = sandbox._findLangVariants(sandbox.snippets[0]);
check('duplicate siblings collapse per language', langsOf(m), ['ES', 'IT']);
check('first row wins for a duplicated language', m.ES.id, 'a1');

// A language that exists ONLY in a bodies map still surfaces when the group
// already has two or more sibling rows. This is the case that hid English.
sandbox.snippets = [
  { id: 'b1', lang_group_id: 'g', shortcut: 'y', lang: 'ES', body: 'ES', bodies: { EN: 'EN from bodies' } },
  { id: 'b2', lang_group_id: 'g', shortcut: 'y', lang: 'IT', body: 'IT', bodies: {} },
];
m = sandbox._findLangVariants(sandbox.snippets[0]);
check('bodies-only language surfaces in a multi-row group', langsOf(m), ['EN', 'ES', 'IT']);
check('bodies-only variant carries its own body', m.EN.body, 'EN from bodies');
check('a real row still beats a bodies entry', m.ES.body, 'ES');

// The single-row dashboard model keeps working.
sandbox.snippets = [
  { id: 'c1', lang_group_id: null, shortcut: 'z', lang: 'EN', body: 'EN',
    bodies: { EN: 'EN', IT: 'IT body', ES: 'ES body' } },
];
m = sandbox._findLangVariants(sandbox.snippets[0]);
check('single row expands its bodies map', langsOf(m), ['EN', 'ES', 'IT']);

// A lone snippet with no translations stays lone (the picker inserts directly
// instead of opening the language modal).
sandbox.snippets = [{ id: 'd1', lang_group_id: null, shortcut: 'w', lang: 'EN', body: 'only', bodies: {} }];
m = sandbox._findLangVariants(sandbox.snippets[0]);
check('a lone snippet reports one variant', langsOf(m), ['EN']);

// -- 2b. a group must never swallow a DIFFERENT snippet ---------------
// Reported 2026-08-19: the CLASS RENT A CAR folder showed a card named
// "ATTESA RISPOSTA PROPRIETA'" with the shortcut "wait", and the WHATSAPP
// snippet that actually lives there could not be reached at all. Cause: "wait"
// is French, and stripping a trailing "IT" it never had based it to "wa",
// which collided with the unrelated "WA". Both rows are real, and they belong
// to two different people.
sandbox.snippets = [
  { id: '05cb46e5', user_id: 'a6cda5af', lang_group_id: null, shortcut: 'WA',   lang: 'ES', body: 'Buenos dias', bodies: {} },
  { id: '62e46f54', user_id: '086af9eb', lang_group_id: null, shortcut: 'wait', lang: 'FR', body: "J'ai deja contacte", bodies: {} },
];
m = sandbox._findLangVariants(sandbox.snippets[0]);
check('a language code that is not the row own language is kept', langsOf(m), ['ES']);
check('the colliding row keeps its own body', m.ES.id, '05cb46e5');
m = sandbox._findLangVariants(sandbox.snippets[1]);
check('the other side of the collision stands alone too', langsOf(m), ['FR']);

// The guard must not stop a real variant from merging: here the code DOES
// match the row's own language.
sandbox.snippets = [
  { id: 'e1', user_id: 'u1', lang_group_id: null, shortcut: '::air',   lang: 'ES', body: 'ES', bodies: {} },
  { id: 'e2', user_id: 'u1', lang_group_id: null, shortcut: '::airIT', lang: 'IT', body: 'IT', bodies: {} },
];
m = sandbox._findLangVariants(sandbox.snippets[0]);
check('a language code that IS the row own language still merges', langsOf(m), ['ES', 'IT']);

// Sharing a folder never moves ownership, so two teammates whose triggers
// collide stay two snippets. Both LeibTour admins own a '::discount'.
sandbox.snippets = [
  { id: 'f1', user_id: 'u1', lang_group_id: null, shortcut: '::discount', lang: 'EN', body: 'mine',   bodies: {} },
  { id: 'f2', user_id: 'u2', lang_group_id: null, shortcut: '::discount', lang: 'ES', body: 'theirs', bodies: {} },
];
m = sandbox._findLangVariants(sandbox.snippets[0]);
check('rows owned by different people never merge', langsOf(m), ['EN']);

// Same owner, same base trigger, one of them also carrying a group id: these
// ARE one snippet and must merge. Live data had this pair under
// 'budgetstay' and splitting them would hide a translation.
sandbox.snippets = [
  { id: 'g1', user_id: 'u1', lang_group_id: 'budgetstay', shortcut: 'budgetstay', lang: 'ES', body: 'grouped',   bodies: {} },
  { id: 'g2', user_id: 'u1', lang_group_id: null,         shortcut: 'budgetstay', lang: 'FR', body: 'ungrouped', bodies: {} },
];
m = sandbox._findLangVariants(sandbox.snippets[0]);
check('a group id and a matching base trigger are one snippet', langsOf(m), ['ES', 'FR']);

// A lang_group_id is trigger-shaped in practice ('altern', 'discount',
// 'budgetstay'), so it lives in its own namespace: it must never join a row
// just because that row's TRIGGER is spelled the same way. The two rows below
// share no trigger and must stay apart.
sandbox.snippets = [
  { id: 'h1', user_id: 'u1', lang_group_id: 'budgetstay', shortcut: '::alpha',    lang: 'ES', body: 'alpha', bodies: {} },
  { id: 'h2', user_id: 'u1', lang_group_id: null,         shortcut: 'budgetstay', lang: 'FR', body: 'other', bodies: {} },
];
m = sandbox._findLangVariants(sandbox.snippets[0]);
check('a group id never collides with an unrelated base trigger', langsOf(m), ['ES']);

// -- 2c. the mobile card shows a variant from the folder it is listed in --
// groupMatches admits a group as soon as ANY variant is in the active folder,
// so the card has to render a variant from that folder. Without this the
// CLASS RENT A CAR list rendered a sibling that lives in another folder, and
// printed that sibling's name and shortcut on the row.
{
  const MOBILE_SRC = fs.readFileSync(
    path.join(__dirname, '..', 'app', 'public', 'mobile', 'index.html'), 'utf8');
  const FROM = 'function pickActiveVariant(';
  const TO = 'function lastUseOf(';
  const from = MOBILE_SRC.indexOf(FROM), to = MOBILE_SRC.indexOf(TO);
  if (from === -1 || to === -1 || to <= from) {
    console.error('X mobile/index.html: cannot slice pickActiveVariant, the markers moved');
    failed++;
  } else {
    // The slice is pure apart from these two, which the app owns.
    const mob = {
      _langPref: {},
      inFolderSubtree: function (fid, folder) { return fid === folder; },
    };
    vm.createContext(mob);
    vm.runInNewContext(MOBILE_SRC.slice(from, to), mob);

    const group = {
      key: 'sg:05cb46e5',
      variants: [
        { id: 'wa', lang: 'ES', title: 'WHATSAPP', folder_id: 'class-rent-a-car' },
        { id: 'attesa', lang: 'FR', title: "ATTESA RISPOSTA PROPRIETA'", folder_id: 'snippet-valenx' },
      ],
    };
    check('a folder-filtered card shows that folder own variant',
      mob.pickActiveVariant(group, 'ALL', 'class-rent-a-car').title, 'WHATSAPP');

    // A stored language preference must not drag in a variant from elsewhere.
    mob._langPref['sg:05cb46e5'] = 'FR';
    check('a stored language pick cannot override the folder',
      mob.pickActiveVariant(group, 'ALL', 'class-rent-a-car').title, 'WHATSAPP');
    check('the stored language pick still wins with no folder filter',
      mob.pickActiveVariant(group, 'ALL', 'ALL').title, "ATTESA RISPOSTA PROPRIETA'");
    mob._langPref = {};

    // An explicit language filter still chooses inside the folder.
    check('an explicit language filter picks within the folder',
      mob.pickActiveVariant(group, 'ES', 'class-rent-a-car').title, 'WHATSAPP');
  }
}

// -- 2d. the memory panel means what a trigger means ------------------
// The Context panel groups search results into facts and picks one translation
// to insert. It must use the same notion of "one snippet" and the same body per
// language as expansion, or it offers a translated snippet several times and
// inserts text a trigger would never have produced.
{
  // Loaded into the same context AFTER content.js, the order the manifest
  // cannot use: with SBMemoryPicker already defined, content.js would try to
  // mount the panel on a page this gate does not have.
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'extension', 'shared', 'memory-pack.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'extension', 'content', 'memory-picker.js'), 'utf8'), sandbox);
  const pack = sandbox.SBMemoryPack;
  const picker = sandbox.SBMemoryPicker;
  if (typeof sandbox.sbMemorySnippetInfo !== 'function' || typeof sandbox.sbMemoryPreferredLangs !== 'function') {
    console.error('X content.js no longer exposes sbMemorySnippetInfo / sbMemoryPreferredLangs');
    failed++;
  } else {
    // Four sibling rows, one fact. Production shape: the airport message.
    sandbox.snippets = [
      { id: 'air-en', user_id: 'u1', lang_group_id: 'air', shortcut: 'air',   lang: 'EN', body: 'EN airport', bodies: { EN: 'EN airport' } },
      { id: 'air-es', user_id: 'u1', lang_group_id: 'air', shortcut: '::air', lang: 'ES', body: 'ES aeropuerto', bodies: { ES: 'ES aeropuerto' } },
      { id: 'air-fr', user_id: 'u1', lang_group_id: 'air', shortcut: '::air', lang: 'FR', body: 'FR aeroport', bodies: { FR: 'FR aeroport' } },
      { id: 'air-it', user_id: 'u1', lang_group_id: 'air', shortcut: '::air', lang: 'IT', body: 'IT aeroporto', bodies: { IT: 'IT aeroporto' } },
      // One row holding its translations inside `bodies`, the dashboard model.
      { id: 'bed', user_id: 'u1', lang_group_id: null, shortcut: 'bed', lang: 'MULTI', body: 'MULTI bed',
        bodies: { MULTI: 'MULTI bed', EN: 'EN bed', IT: 'IT letto' } },
      // A teammate whose trigger collides. Never the same snippet.
      { id: 'air-other', user_id: 'u2', lang_group_id: null, shortcut: 'air', lang: 'EN', body: 'theirs', bodies: {} },
    ];

    const infos = ['air-en', 'air-es', 'air-fr', 'air-it'].map((id) => sandbox.sbMemorySnippetInfo(id));
    check('every translation of one snippet reports the same fact',
      infos.map((i) => i.groupKey).filter((k, n, all) => all.indexOf(k) === n).length, 1);
    check('a fact lists every translation', Object.keys(infos[0].variants).sort(), ['EN', 'ES', 'FR', 'IT']);
    check('a sibling translation points at its own row', infos[0].variants.IT.id, 'air-it');
    check('each row reports its own language', infos.map((i) => i.lang), ['EN', 'ES', 'FR', 'IT']);

    const bed = sandbox.sbMemorySnippetInfo('bed');
    check('a bodies-map snippet lists its inside translations', Object.keys(bed.variants).sort(), ['EN', 'IT', 'MULTI']);
    check('an inside translation points back at its own row', bed.variants.IT.id, 'bed');

    check('a teammate with a colliding trigger is a different fact',
      sandbox.sbMemorySnippetInfo('air-other').groupKey === infos[0].groupKey, false);
    check('a row missing from the local library reports nothing', sandbox.sbMemorySnippetInfo('not-cached'), null);

    // The body the panel inserts for a language, read from the row the database
    // returns, equals the body a trigger would expand for that language.
    let mismatches = [];
    ['air-en', 'bed'].forEach((id) => {
      const variants = sandbox._findLangVariants(sandbox.snippets.find((s) => s.id === id));
      Object.keys(variants).forEach((lang) => {
        const fetched = sandbox.snippets.find((s) => s.id === variants[lang].id);
        const panel = pack.bodyForLang(fetched, lang);
        if (panel !== variants[lang].body) mismatches.push(id + ':' + lang + ' panel="' + panel + '" trigger="' + variants[lang].body + '"');
      });
    });
    check('the panel inserts the body a trigger would expand, for every language', mismatches, []);

    // Preference order follows resolveVariant: the default language first.
    check('preferred languages put the default first', sandbox.sbMemoryPreferredLangs('IT'), ['IT', 'EN', 'ES', 'FR']);
    check('a default already in the fallback is not repeated', sandbox.sbMemoryPreferredLangs('EN'), ['EN', 'ES', 'IT', 'FR']);
    check('no default still yields the fallback order', sandbox.sbMemoryPreferredLangs(undefined), ['EN', 'ES', 'IT', 'FR']);

    // End to end through the engine: the four sibling rows arrive from search
    // as four candidates and leave as one, in the default language.
    const candidates = infos.map((info, n) => Object.assign(
      pack.candidateFromSearchRow({ kind: 'snippet', source_id: ['air-en', 'air-es', 'air-fr', 'air-it'][n], title: 'AIRPORT', summary: '', tokens: 3, rank: 0.03 - n * 0.001 }),
      { groupKey: info.groupKey, lang: info.lang }));
    const clusters = pack.clusterCandidates(candidates, sandbox.sbMemoryPreferredLangs('IT'));
    check('four translations leave the engine as one fact', clusters.length, 1);
    check('the fact is offered in the default language', clusters[0].candidate.id, 'air-it');

    // The whole panel step, search rows to facts, on the real content.js,
    // engine and panel code. Rows arrive in the order knowledge_search ranks.
    const row = (kind, id, tokens, rank, summary) =>
      ({ kind, source_id: id, title: id, summary: summary || id + ' summary', tokens, rank });
    const facts = picker.factsFromSearchRows([
      row('snippet', 'air-fr', 3, 0.032), row('snippet', 'air-en', 3, 0.031),
      row('snippet', 'air-it', 3, 0.03), row('snippet', 'bed', 3, 0.02),
      row('memory', 'm1', 5, 0.01),
    ], sandbox.sbMemorySnippetInfo, sandbox.sbMemoryPreferredLangs('IT'));

    check('the panel lists facts, not rows', facts.map((f) => f.id), ['air-it', 'bed', 'm1']);
    check('a fact carries the best rank of its translations', facts[0].rank, 0.032);
    check('a fact lists every translation, matched or not', facts[0].langs, ['EN', 'ES', 'IT', 'FR']);
    check('a matched translation keeps what the search said about it',
      [facts[0].variantId, facts[0].tokens, facts[0].summary], ['air-it', 3, 'air-it summary']);
    check('an inside translation is described from the library',
      [facts[1].lang, facts[1].variantId, facts[1].tokens, facts[1].summary], ['IT', 'bed', 2, 'IT letto']);
    check('a memory item passes through untouched',
      [facts[2].langs === undefined, facts[2].variantId === undefined, facts[2].tokens], [true, true, 5]);

    // The draft matched only the French wording, but the user reads Italian.
    const french = picker.factsFromSearchRows([row('snippet', 'air-fr', 3, 0.04)],
      sandbox.sbMemorySnippetInfo, sandbox.sbMemoryPreferredLangs('IT'));
    check('a preferred translation the search did not match is still chosen',
      [french[0].id, french[0].lang, french[0].variantId, french[0].summary], ['air-fr', 'IT', 'air-it', 'IT aeroporto']);

    // A cold local library groups nothing, which is the behaviour before
    // translations were grouped, not something new and wrong.
    sandbox.snippets = [];
    const cold = picker.factsFromSearchRows([row('snippet', 'air-fr', 3, 0.02), row('snippet', 'air-it', 3, 0.01)],
      sandbox.sbMemorySnippetInfo, sandbox.sbMemoryPreferredLangs('IT'));
    check('with no local library every row stays its own fact', cold.map((f) => f.id), ['air-fr', 'air-it']);

    // Pre-selection. knowledge_search returns everything that plausibly matches;
    // only facts close to the best score start ticked, the rest stay listed.
    // Score shapes taken from real drafts against a production library.
    const fact = (id, rank, tokens) => ({ id, rank, tokens });
    check('only facts close to the best score start ticked',
      Object.keys(picker.preselect([fact('airport', 46.6, 60), fact('client', 26.9, 70), fact('late-fee', 24.6, 50)], 2000)),
      ['airport']);
    check('a close second starts ticked too',
      Object.keys(picker.preselect([fact('discount', 26.3, 180), fact('extra-seat', 24.0, 80)], 2000)).sort(),
      ['discount', 'extra-seat']);
    check('a browse starts with nothing ticked',
      Object.keys(picker.preselect([fact('recent-a', 0, 10), fact('recent-b', 0, 10)], 2000)), []);
    check('a strong fact that does not fit is skipped, not terminal',
      Object.keys(picker.preselect([fact('long', 50, 900), fact('short', 45, 200), fact('shorter', 44, 90)], 1000)).sort(),
      ['long', 'shorter']);
  }
}

// -- 3. the signed-out picker says what to do ------------------------
// An empty library must not render as a bare "No matches": that is what a
// signed-out install now shows, and it has to point at sign-in.
if (typeof sandbox._renderPickerItems === 'function') {
  const itemsBox = { innerHTML: '', querySelectorAll: () => [] };
  sandbox.triggerPickerEl = { querySelector: () => itemsBox };
  sandbox.triggerPickerMode = 'snippet';

  sandbox.snippets = [];
  sandbox.hasSession = false;
  sandbox._renderPickerItems('');
  check('signed-out empty library points at sign-in', /Sign in/.test(itemsBox.innerHTML), true);

  sandbox.hasSession = true;
  sandbox._renderPickerItems('');
  check('signed-in empty library points at the dashboard', /dashboard/.test(itemsBox.innerHTML), true);

  sandbox.snippets = [{ id: 'e1', shortcut: 'hello', title: 'Hello', lang: 'EN', body: 'hi', bodies: {} }];
  sandbox._renderPickerItems('zzz');
  check('a query that matches nothing still says No matches', /No matches/.test(itemsBox.innerHTML), true);
  sandbox.triggerPickerEl = null;
} else {
  console.error('X content.js no longer exposes _renderPickerItems');
  failed++;
}

if (failed) { console.error('\nX ' + failed + ' check(s) failed'); process.exit(1); }
console.log('OK lang-variants + shipped-content gate');
