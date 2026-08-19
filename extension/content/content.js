// ── SPRINTBRAIN CONTENT SCRIPT v2.62.12 ───────────────────────────
// Configurable dual triggers + confetti celebration + analytics event log
// v2.29.0: lang-modal expansion fix — defer trigger deletion until after
//          language pick (modal focus was wiping the CE selection set by
//          deleteChars, leaving the literal ::shortcut in the field)
// v2.56.0: selection-triggered suggestions — selecting text in any editable
//          field surfaces keyword-mapped snippets in a floating, selection-
//          anchored menu; picking one replaces the selection via the existing
//          expansion pipeline. Toggle: triggerCfg.selectionSuggestions.
// v2.57.0: """ prompt picker merges built-in Base Prompts with the dashboard
//          Prompt List (storage.local.sb_prompts), separated by a "My prompt
//          base" divider; checkBuf no longer gated on snippets.length.

// ── ANALYTICS-001: fire-and-forget per-trigger event ──────────────
function logEvent(snip, fieldsFilled) {
  if (!snip) return;
  try {
    chrome.runtime.sendMessage({
      type: 'log_event',
      payload: {
        snippet_id: snip.id || null,
        user_id: snip.user_id || null,
        shortcut: snip.shortcut || '',
        lang: snip.lang || null,
        fields_filled: fieldsFilled || 0
      }
    });
  } catch(e) { /* extension context lost during reload — silent */ }
}

// ── FORMULA ENGINE ────────────────────────────────────────────────
// Canonical engine lives in extension/formula-engine.js, loaded by
// manifest.json's content_scripts BEFORE this file. Both run in the same
// content-script isolated world, so the UMD module's window.SBFormulaEngine
// global is available here. These aliases bind the call sites below to that
// single source of truth — no more hand-synced inline copy (v2.63.10).
var _SBFE = window.SBFormulaEngine;
var resolveBody        = _SBFE.resolveBody;
var extractFields      = _SBFE.extractFields;
var fieldContext       = _SBFE.fieldContext;
var buildFormFieldCfg  = _SBFE.buildFormFieldCfg;
var formMenuPicks      = _SBFE.formMenuPicks;
var extractButtons     = _SBFE.extractButtons;
var applyButtonCode    = _SBFE.applyButtonCode;
var parsePlaceholders  = _SBFE.parsePlaceholders;
var interpolateSnippet = _SBFE.interpolateSnippet;
var sbFormatDate       = _SBFE.sbFormatDate;

// ── DEFAULT SNIPPETS ──────────────────────────────────
// Intentionally empty, and it must stay that way. Anything listed here ships
// inside the extension bundle, so a signed-out install renders it in the
// picker and every installer can read it. Snippet content arrives from
// Supabase after sign-in: popup.js writes the chrome.storage.local cache that
// this file reads. An empty library is the correct signed-out state.
var DEFAULT_SNIPPETS = [];

// ── STATE ──────────────────────────────────────────────────────────
var snippets = DEFAULT_SNIPPETS.slice();
// Mirrors chrome.storage.local 'sb_session' so the picker can tell an empty
// library apart from a signed-out one and say which it is.
var hasSession = false;
var trigger  = '::';
var triggerCfg = { snippetTrigger: '::', promptTrigger: '"""', snippetActivationKey: 'Tab', promptActivationKey: 'Tab', selectionSuggestions: true };
var lastInputTime = 0; // debounce: prevents keydown + input event double-fire on desktop
var isPasting = false; // guards against paste events feeding the trigger buffer

// ── PROMPT TEMPLATES ──────────────────────────────────────────────
// The """ picker draws from two merged sources:
//   - BASE_PROMPTS: built-in defaults ("Base Prompts"), always available even
//     offline / before sign-in. Future Notion "Base Prompts" sync target.
//   - userPrompts: the user's dashboard "Prompt List", synced from
//     public.prompts -> chrome.storage.local.sb_prompts by the popup
//     (mirrors how snippets reach the content script).
// promptTemplates() lists Base Prompts first, then the dashboard Prompt List; a
// dashboard prompt whose title matches a base one overrides it in place.
var BASE_PROMPTS = [
  { id: 'formal', title: 'Formal tone', body: 'Please rewrite in a formal, professional tone:\n' },
  { id: 'casual', title: 'Casual tone', body: 'Rewrite this in a friendly, casual tone:\n' },
  { id: 'translate', title: 'Translate', body: 'Translate the following text to {language}:\n' },
  { id: 'summarize', title: 'Summarize', body: 'Summarize the following in 2-3 sentences:\n' },
  { id: 'expand', title: 'Expand / elaborate', body: 'Expand on the following with more detail:\n' },
  { id: 'bullet', title: 'Convert to bullets', body: '\u2022 ' }
];
var userPrompts = []; // dashboard Prompt List (chrome.storage.local.sb_prompts)

// Each item is tagged with _group ('base' | 'list') so the picker can draw a
// single divider at the base->dashboard boundary. Items are shallow copies so
// BASE_PROMPTS / userPrompts are never mutated.
function promptTemplates() {
  var merged = BASE_PROMPTS.map(function(p) { return Object.assign({}, p, { _group: 'base' }); });
  if (!userPrompts.length) return merged;
  var idxByTitle = {};
  for (var i = 0; i < merged.length; i++) {
    idxByTitle[(merged[i].title || '').toLowerCase()] = i;
  }
  for (var j = 0; j < userPrompts.length; j++) {
    var p = userPrompts[j];
    var key = (p.title || '').toLowerCase();
    if (key && idxByTitle[key] !== undefined) {
      merged[idxByTitle[key]] = Object.assign({}, p, { _group: 'base' }); // override keeps the base slot
    } else {
      merged.push(Object.assign({}, p, { _group: 'list' }));
    }
  }
  return merged;
}

// ── SELECTION-TRIGGERED SUGGESTIONS (v2.56.0) ─────────────────────
// When the user SELECTS text in any editable field, the selection is scanned
// for trigger keywords and the mapped snippet(s) are offered in a floating menu
// anchored to the selection. Picking one REPLACES the selection through the
// exact same expansion pipeline as a typed trigger (placeholders, fields,
// language variants, celebration, undo) — see selectSuggestionItem().
//
// Enabled by default; the user can disable it from the popup (the toggle writes
// triggerCfg.selectionSuggestions=false, mirrored into selectionSuggestEnabled).
//
// The map is modular/extensible: add a row to grow coverage. `keywords` are
// matched case-insensitively — single words match per-token, multi-word entries
// match as a phrase substring. `snippetIds` are resolved against the LIVE
// `snippets` array at match time (by id, falling back to shortcut base), so only
// snippets that actually exist for this user ever surface.
var selectionSuggestEnabled = true;
var SELECTION_TRIGGERS = [
  { keywords: ['preventivo', 'quote', 'quotation', 'presupuesto', 'cotizacion', 'cotización', 'estimate'],
    snippetIds: ['quoteIT', 'quoteES', 'quoteEN'] },
  { keywords: ['disponibilita', 'disponibilità', 'availability', 'disponibilidad', 'disponible', 'available'],
    snippetIds: ['notavail'] },
  { keywords: ['withdraw', 'ritirare', 'retirar', 'cancel', 'cancelar', 'cancellazione', 'rimborso', 'reembolso', 'refund'],
    snippetIds: ['withdraw'] },
  { keywords: ['followup', 'follow up', 'seguimiento', 'novita', 'novità'],
    snippetIds: ['followup'] },
  { keywords: ['minstay', 'minimum stay', 'soggiorno minimo', 'estancia minima', 'estancia mínima'],
    snippetIds: ['minstay'] }
];

// ── DEFAULT LANGUAGE PREFERENCE ────────────────────────────────────
var defaultLang = 'EN';

// Resolve which variant to use for an insertion, with fallback chain.
// variants: { EN: snip, ES: snip, ... }, preferred: 'IT', etc.
function resolveVariant(variants, preferred) {
  if (!variants) return null;
  var order = [preferred, 'EN', 'ES', 'IT', 'FR'];
  for (var i = 0; i < order.length; i++) {
    var v = variants[order[i]];
    if (v && v.body && v.body.trim()) return v;
  }
  return null;
}

// ── LOAD FROM STORAGE ──────────────────────────────────────────────
// Snippets live in chrome.storage.local (5MB) because the array exceeds
// chrome.storage.sync's 8KB per-item limit (silent failure otherwise).
// Small settings (trigger, triggerCfg, default lang) remain in sync so
// they roam across devices. Cross-device snippet sync goes through Supabase.
try {
  chrome.storage.sync.get(['trigger','triggerCfg','sb_default_lang'], function(data) {
    try {
      if (data && data.trigger) trigger = data.trigger;
      if (data && data.sb_default_lang) defaultLang = data.sb_default_lang;
      if (data && data.triggerCfg) {
        if (data.triggerCfg.snippetTrigger) triggerCfg.snippetTrigger = data.triggerCfg.snippetTrigger;
        if (data.triggerCfg.promptTrigger) triggerCfg.promptTrigger = data.triggerCfg.promptTrigger;
        if (data.triggerCfg.snippetActivationKey) triggerCfg.snippetActivationKey = data.triggerCfg.snippetActivationKey;
        if (data.triggerCfg.promptActivationKey) triggerCfg.promptActivationKey = data.triggerCfg.promptActivationKey;
        if (typeof data.triggerCfg.selectionSuggestions === 'boolean') {
          triggerCfg.selectionSuggestions = data.triggerCfg.selectionSuggestions;
          selectionSuggestEnabled = data.triggerCfg.selectionSuggestions;
        }
      }
    } catch(e) {}
  });

  chrome.storage.local.get('snippets', function(data) {
    try {
      // The local cache is the only snippet source. A chrome.storage.sync copy
      // is never adopted: sync roams across every Chrome signed into the same
      // Google account, so it carried one account's snippets to another.
      // background.js drops the legacy key on update.
      snippets = (data && Array.isArray(data.snippets)) ? data.snippets : [];
    } catch(e) {}
  });

  chrome.storage.local.get('sb_session', function(data) {
    try { hasSession = !!(data && data.sb_session && data.sb_session.user_id); } catch(e) {}
  });

  chrome.storage.local.get('sb_prompts', function(data) {
    try {
      if (data && Array.isArray(data.sb_prompts)) userPrompts = data.sb_prompts;
    } catch(e) {}
  });

  chrome.storage.onChanged.addListener(function(changes, areaName) {
    try {
      // Snippets only fire from local (areaName === 'local'); small settings from sync.
      // A cleared cache (sign-out) arrives with no newValue and must empty the
      // in-memory list, otherwise the picker keeps serving the signed-out user
      // the library from the session that just ended.
      if (changes.snippets) snippets = Array.isArray(changes.snippets.newValue) ? changes.snippets.newValue : [];
      if (changes.sb_session) hasSession = !!(changes.sb_session.newValue && changes.sb_session.newValue.user_id);
      if (changes.sb_prompts && Array.isArray(changes.sb_prompts.newValue)) userPrompts = changes.sb_prompts.newValue;
      if (changes.trigger  && changes.trigger.newValue)  trigger  = changes.trigger.newValue;
      if (changes.sb_default_lang && changes.sb_default_lang.newValue) defaultLang = changes.sb_default_lang.newValue;
      if (changes.triggerCfg && changes.triggerCfg.newValue) {
        var nc = changes.triggerCfg.newValue;
        if (nc.snippetTrigger) triggerCfg.snippetTrigger = nc.snippetTrigger;
        if (nc.promptTrigger) triggerCfg.promptTrigger = nc.promptTrigger;
        if (nc.snippetActivationKey) triggerCfg.snippetActivationKey = nc.snippetActivationKey;
        if (nc.promptActivationKey) triggerCfg.promptActivationKey = nc.promptActivationKey;
        if (typeof nc.selectionSuggestions === 'boolean') {
          triggerCfg.selectionSuggestions = nc.selectionSuggestions;
          selectionSuggestEnabled = nc.selectionSuggestions;
          if (!selectionSuggestEnabled) closeSelSuggest();
        }
      }
    } catch(e) {}
  });
} catch(e) {
  console.error('[Sprintbrain] Storage unavailable, using defaults');
}

// ── KEYSTROKE BUFFER ───────────────────────────────────────────────
var buf     = '';
var MAX_BUF = 40;
var activeEl = null;
var processing = false;
var triggerPending = false;
var triggerPendingMode = null;   // 'snippet' | 'prompt'
var triggerAffix = '';
var triggerDebounceTimer = null;
var TRIGGER_MIN_CHARS = 1;     // show suggestions after ::x (non-destructive, so safe)
var TRIGGER_DEBOUNCE_MS = 120; // short — the picker never touches the field anymore

// ── MATCH SETTLE WINDOW (v2.148.1) ────────────────────────────────
// A shortcut that is also the start of a longer word used to fire the instant
// it matched: typing "::neobooking" expanded "::neob" at the sixth character
// and left "ooking" stranded in the field — and on contenteditable hosts those
// stray characters landed inside the selection the expansion had set, so the
// delete span slid onto the message the user had already written.
//
// A match is now ARMED rather than expanded. It fires when typing settles, and
// one more letter drops it so a longer trigger gets its turn ("::forms" now
// reaches ::forms instead of ::form). Whitespace, Tab and Enter end the word,
// so they expand straight away — nobody waits who does not want to.
var armedMatch = null;   // { snip, expectedLen, el, bufLen }
var armedTimer = null;
var MATCH_SETTLE_MS = 350;

function _cancelArmed() {
  if (armedTimer) { clearTimeout(armedTimer); armedTimer = null; }
  armedMatch = null;
}

function _armMatch(snip, expectedLen, el) {
  _cancelArmed();
  // The matched character never reached the pending-picker bookkeeping — the
  // match branch returns before it. Count it here, so that if the match is
  // dropped a moment later the picker's delete span still covers every
  // character the user typed (one short leaves a stray ":" behind).
  if (triggerPending) triggerAffix += buf.slice(-1);
  // The picker must not open over an armed match: its key handler swallows
  // keystrokes, and those are exactly what decides whether the match survives.
  if (triggerDebounceTimer) { clearTimeout(triggerDebounceTimer); triggerDebounceTimer = null; }
  armedMatch = { snip: snip, expectedLen: expectedLen, el: el, bufLen: buf.length };
  armedTimer = setTimeout(function() { _fireArmed(0); }, MATCH_SETTLE_MS);
}

// trailing: characters typed after the trigger that the expansion must remove
// along with it — the space that confirmed the match. 0 for the settle timer
// and for Tab/Enter, which never reach the field.
function _fireArmed(trailing) {
  var a = armedMatch;
  _cancelArmed();
  if (!a || processing) return;
  buf = '';
  triggerPending = false;
  triggerPendingMode = null;
  triggerAffix = '';
  if (triggerDebounceTimer) { clearTimeout(triggerDebounceTimer); triggerDebounceTimer = null; }
  var span = a.expectedLen + (trailing || 0);
  var variantsMap = _findLangVariants(a.snip);
  if (Object.keys(variantsMap).length > 1) {
    // Do NOT pre-delete the trigger here. For contenteditable hosts,
    // deleteChars only SETS a non-collapsed selection (it relies on the
    // immediate next insertText to consume it). Opening the modal steals
    // focus and destroys that selection — so the trigger text survives.
    // Instead, defer deletion to handleMatch (called when the user picks
    // a language) where deleteChars + insertText fire atomically.
    processing = true;
    injectLangModal(variantsMap, a.el, span);
  } else {
    handleMatch(a.el, a.snip, span);
  }
}

function addKey(k) {
  if (k.length !== 1) return;
  buf += k;
  if (buf.length > MAX_BUF) buf = buf.slice(buf.length - MAX_BUF);
}

function checkBuf() {
  // Not gated on snippets.length: the """ prompt picker (Base Prompts +
  // dashboard Prompt List) must open even when the user has no snippets. The
  // snippet-matching loop below simply no-ops on an empty list.
  if (processing) return;

  // Strip invisible artifacts that Gmail's rich-text contenteditable can
  // splice into the keystroke stream (smart-compose, autocorrect, paste
  // normalization). ZWSP/ZWNJ/ZWJ/BOM/soft-hyphen are removed; NBSP is folded
  // to a regular space so the trigger sequence isn't broken by an invisible
  // char between the two colons. \uXXXX escapes — invisible literal chars in
  // regex are fragile across editors and diffs. Curly "smart quotes" are
  // folded to straight quotes so the prompt trigger (""") still matches in
  // editors that auto-substitute quotes (Word, macOS smart-quotes, etc.).
  var sanitized = buf.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '').replace(/\u00A0/g, ' ').replace(/[\u201C\u201D]/g, '"');
  if (sanitized !== buf) buf = sanitized;

  // A match is armed and waiting out the settle window. Another letter means
  // the user is still typing a longer word, so drop it and let the buffer keep
  // growing. Whitespace ends the word: expand now, and take the terminator with
  // the trigger: leaving it behind would shift the delete span by one and
  // strand a ":" in the field.
  if (armedMatch) {
    var extra = buf.length - armedMatch.bufLen;
    if (extra > 0) {
      if (/^\s+$/.test(buf.slice(armedMatch.bufLen))) { _fireArmed(extra); return; }
      _cancelArmed();
    }
  }

  // Snippet matching contract (v2.24.0):
  //   Every snippet expansion REQUIRES the user to type the configured
  //   snippet trigger (default "::") immediately before the shortcut.
  //   Bare-keyword (implicit) matching was removed in v2.23.2 — typing a
  //   shortcut as part of normal prose ("the price is...") MUST NOT fire.
  //   Two storage shapes are tolerated:
  //
  //     - sc stored with the prefix already baked in ("::time")  -> the
  //       expected typed sequence is just sc itself ("::time").
  //     - sc stored bare ("time")                                -> the
  //       expected typed sequence is trigger + sc ("::time").
  //
  //   In both cases the matched length is exactly what was typed, so we
  //   never delete more or fewer characters than the user produced.
  //
  //   A match does not expand on the spot — it is armed and settles first
  //   (see _armMatch), because a shortcut can be the opening of a longer word
  //   the user is still typing.
  //
  //   Multi-language (v2.26.0): _findLangVariants() detects sibling
  //   translations via lang_group_id (when set) or shortcut-base heuristic
  //   (strips trailing EN/ES/IT/FR/MULTI). Applied in BOTH checkBuf() and
  //   selectTriggerItem() so the modal fires regardless of how the user
  //   selects the snippet.
  var snippetTrigger = (triggerCfg && triggerCfg.snippetTrigger) || '::';
  for (var i = 0; i < snippets.length; i++) {
    var sc = snippets[i].shortcut || '';
    if (!sc) continue;
    var expected = sc.indexOf(snippetTrigger) === 0 ? sc : snippetTrigger + sc;
    if (expected.length <= buf.length && buf.slice(-expected.length).toLowerCase() === expected.toLowerCase()) {
      _armMatch(snippets[i], expected.length, activeEl);
      return;
    }
    // Also match against alternative_queries (ALTERNATIVE-QUERIES-001).
    // Normalization: each query is lowercased and trimmed at save time; the
    // comparison is case-insensitive to handle legacy values.
    var altQueries = Array.isArray(snippets[i].alternative_queries) ? snippets[i].alternative_queries : [];
    for (var j = 0; j < altQueries.length; j++) {
      var aq = (altQueries[j] || '').trim();
      if (!aq) continue;
      var aqExpected = aq.indexOf(snippetTrigger) === 0 ? aq : snippetTrigger + aq;
      if (aqExpected.length <= buf.length && buf.slice(-aqExpected.length).toLowerCase() === aqExpected.toLowerCase()) {
        _armMatch(snippets[i], aqExpected.length, activeEl);
        return;
      }
    }
  }

  // Unique-prefix expansion (v2.148.2): the trigger plus the first letters of a
  // shortcut expands on its own, as long as only one snippet can still be meant
  // — "::neo" is enough for NEO BOOKING. An exact match always wins (the loop
  // above returns first), so "::form" still reaches ::form and never ::forms.
  // Ambiguous prefixes expand nothing and fall through to the suggestion menu,
  // where the user picks. Safe only because a match settles before it fires: the
  // prefix is re-evaluated on every further letter.
  var typedAfter = _typedAfterTrigger(buf, snippetTrigger);
  if (typedAfter && typedAfter.length >= MIN_PREFIX_CHARS) {
    var only = _uniquePrefixSnippet(typedAfter, snippetTrigger);
    if (only) {
      _armMatch(only, snippetTrigger.length + typedAfter.length, activeEl);
      return;
    }
  }

  // Check configurable snippet trigger (e.g. ::) — debounced pending state
  var snippetSeq = triggerCfg.snippetTrigger || '::';
  if (!triggerPending) {
    // Detect trigger sequence — enter pending state instead of showing picker
    if (buf.length >= snippetSeq.length && buf.slice(-snippetSeq.length) === snippetSeq) {
      if (buf.length > snippetSeq.length && buf[buf.length - snippetSeq.length - 1] === snippetSeq[0]) return;
      triggerPending = true;
      triggerPendingMode = 'snippet';
      triggerAffix = '';
      if (triggerDebounceTimer) clearTimeout(triggerDebounceTimer);
      return;
    }
    // Prompt trigger (e.g. """): unlike snippets there is no shortcut to type,
    // so the bare trigger opens the picker immediately (slash-command style)
    // showing all prompts; the picker's own key handler filters as the user
    // types. The snippet trigger keeps its debounced pending behaviour because
    // snippets expand via a full ::shortcut, not a menu.
    var promptSeq = triggerCfg.promptTrigger || '"""';
    if (buf.length >= promptSeq.length && buf.slice(-promptSeq.length) === promptSeq) {
      if (buf.length > promptSeq.length && buf[buf.length - promptSeq.length - 1] === promptSeq[0]) return;
      if (triggerDebounceTimer) { clearTimeout(triggerDebounceTimer); triggerDebounceTimer = null; }
      buf = '';
      showTriggerPicker(activeEl, 'prompt', promptSeq.length, '');
      return;
    }
  } else {
    // We are in pending state — accumulate chars after the trigger
    var lastChar = buf.slice(-1);
    // If user types space or newline, cancel pending trigger
    if (lastChar === ' ' || lastChar === '\n') {
      triggerPending = false;
      triggerPendingMode = null;
      triggerAffix = '';
      if (triggerDebounceTimer) clearTimeout(triggerDebounceTimer);
      return;
    }
    triggerAffix += lastChar;
    if (triggerDebounceTimer) clearTimeout(triggerDebounceTimer);
    // Only show picker after minimum chars AND a pause in typing
    if (triggerAffix.length >= TRIGGER_MIN_CHARS) {
      var _pendingMode = triggerPendingMode;
      var _pendingSeq = _pendingMode === 'snippet' ? snippetSeq : (triggerCfg.promptTrigger || '"""');
      triggerDebounceTimer = setTimeout(function() {
        if (!triggerPending) return;
        var totalLen = _pendingSeq.length + triggerAffix.length;
        var filterStr = triggerAffix;
        triggerPending = false;
        triggerPendingMode = null;
        triggerAffix = '';
        buf = '';
        showTriggerPicker(activeEl, _pendingMode, totalLen, filterStr);
      }, TRIGGER_DEBOUNCE_MS);
    }
    return;
  }
}

// ── UNIQUE-PREFIX MATCHING ───────────────────────────────────────────
// Typing the whole shortcut is not required: the trigger plus enough letters to
// leave one candidate standing expands it. Three letters is the floor — two is
// short enough to fire while the user is still deciding what to type, and in a
// growing library a two-letter opening rarely stays unambiguous for long.
var MIN_PREFIX_CHARS = 3;

// Everything typed since the last trigger sequence, or '' when the buffer holds
// no live trigger. A space ends a trigger, so "::neo hola" yields nothing.
function _typedAfterTrigger(b, seq) {
  var idx = b.lastIndexOf(seq);
  if (idx === -1) return '';
  var run = b.slice(idx + seq.length);
  if (!run || /\s/.test(run)) return '';
  return run;
}

// Strip the trigger sequence from a stored shortcut / alternative query, which
// may or may not carry it baked in ("::air" and "air" are the same trigger).
function _bareTrigger(s, seq) {
  var v = String(s == null ? '' : s).trim();
  return v.indexOf(seq) === 0 ? v.slice(seq.length) : v;
}

// The single snippet a prefix can still mean, or null when it is ambiguous (or
// matches nothing). Language variants of the same snippet count as ONE
// candidate — they are one entry in the picker too, and _findLangVariants opens
// the language modal after the match, exactly as it does for a full shortcut.
function _uniquePrefixSnippet(typed, seq) {
  var q = typed.toLowerCase();
  var families = {};
  var order = [];
  for (var i = 0; i < snippets.length; i++) {
    var s = snippets[i];
    var hit = _bareTrigger(s.shortcut, seq).toLowerCase().indexOf(q) === 0;
    if (!hit) {
      var aqs = Array.isArray(s.alternative_queries) ? s.alternative_queries : [];
      for (var j = 0; j < aqs.length && !hit; j++) {
        if (_bareTrigger(aqs[j], seq).toLowerCase().indexOf(q) === 0) hit = true;
      }
    }
    if (!hit) continue;
    var base = _bareTrigger(s.shortcut, seq).replace(LANG_SUFFIX_RE, '').toLowerCase();
    var key = s.lang_group_id ? ('g:' + s.lang_group_id) : ('b:' + base);
    if (families[key] === undefined) { families[key] = s; order.push(key); }
    if (order.length > 1) return null;   // ambiguous — let the picker decide
  }
  return order.length === 1 ? families[order[0]] : null;
}

// ── LANGUAGE VARIANT DETECTION ───────────────────────────────────────
var LANG_FLAGS = { EN: '🇬🇧', IT: '🇮🇹', ES: '🇪🇸', FR: '🇫🇷', MULTI: '🌐' };
var LANG_NAMES = { EN: 'English', IT: 'Italiano', ES: 'Español', FR: 'Français', MULTI: 'Multi' };
var LANG_SUFFIX_RE = /(?:EN|ES|IT|FR|MULTI)$/i;

// Expand one row's `bodies` map (dashboard single-row model) into language-keyed
// views that share the row but carry each language's own body, so the picker can
// offer every translation and handleMatch inserts the right one.
function _bodiesViews(row) {
  var out = {};
  var b = row && row.bodies;
  if (!b || typeof b !== 'object') return out;
  Object.keys(b).forEach(function (l) {
    var txt = b[l];
    if (typeof txt !== 'string' || !txt.trim()) return;
    var view = {};
    for (var k in row) view[k] = row[k];
    view.lang = l;
    view.body = txt;
    out[l] = view;
  });
  return out;
}

function _findLangVariants(item) {
  // Collect the group's sibling rows first (lang_group_id, falling back to the
  // shortcut base), then reduce them to one entry per language.
  var rows = [];
  var i;
  if (item.lang_group_id) {
    for (i = 0; i < snippets.length; i++) {
      if (snippets[i].lang_group_id === item.lang_group_id) rows.push(snippets[i]);
    }
  }
  if (rows.length <= 1) {
    rows = [];
    var base = (item.shortcut || '').replace(LANG_SUFFIX_RE, '');
    for (i = 0; i < snippets.length; i++) {
      if ((snippets[i].shortcut || '').replace(LANG_SUFFIX_RE, '') === base) rows.push(snippets[i]);
    }
  }
  if (!rows.length) rows = [item];

  // FIRST row per language wins, not the last. Duplicate same-language siblings
  // exist in real data (a re-import created a second row per language), and
  // letting the last one win made the visible variant depend on row order.
  var map = {};
  rows.forEach(function (r) {
    if (r.body && r.body.trim() && !map[r.lang]) map[r.lang] = r;
  });
  // Then fill the gaps from every row's `bodies` map. This runs whatever the
  // group size is: a group can hold sibling rows for ES/IT while EN exists only
  // inside a row's bodies, and gating this on a single-row group dropped that
  // language from the picker entirely.
  rows.forEach(function (r) {
    var views = _bodiesViews(r);
    Object.keys(views).forEach(function (l) {
      if (!map[l]) map[l] = views[l];
    });
  });
  return map;
}

// ── LANGUAGE PICKER MODAL (Shadow DOM) ──────────────────────────────

function injectLangModal(variantsMap, el, scLen) {
  var host = document.createElement('div');
  host.id = 'sb-lang-modal-host';
  host.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;' +
    'display:flex;align-items:center;justify-content:center;' +
    'background:rgba(0,0,0,0.45);font-family:sans-serif;';
  var shadow = host.attachShadow({ mode: 'closed' });

  var style = document.createElement('style');
  style.textContent =
    '.sb-modal{background:#fff;border-radius:12px;padding:28px 32px;width:400px;max-width:90vw;box-shadow:0 8px 40px rgba(0,0,0,0.18);display:flex;flex-direction:column;gap:16px;}' +
    '.sb-modal h2{margin:0;font-size:16px;font-weight:600;color:#1a1a1a;letter-spacing:-0.2px;}' +
    '.sb-modal p.sb-sub{margin:-8px 0 0;font-size:13px;color:#666;}' +
    '.sb-lang-grid{display:flex;flex-wrap:wrap;gap:10px;margin-top:4px;}' +
    '.sb-lang-btn{display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 18px;border-radius:10px;border:1.5px solid #e0e0e0;background:#fafafa;cursor:pointer;font-size:13px;font-weight:500;color:#333;transition:border-color 0.15s,background 0.15s;min-width:80px;flex:1;}' +
    '.sb-lang-btn:hover{border-color:#5c6bc0;background:#eef0fb;color:#5c6bc0;}' +
    '.sb-lang-flag{font-size:26px;line-height:1;}' +
    '.sb-cancel-row{display:flex;justify-content:flex-end;}' +
    '.sb-btn-cancel{padding:8px 18px;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;border:none;background:#f0f0f0;color:#555;transition:opacity 0.15s;}' +
    '.sb-btn-cancel:hover{opacity:0.75;}';

  var modal = document.createElement('div');
  modal.className = 'sb-modal';

  var h2 = document.createElement('h2');
  h2.textContent = '🌐 Available in multiple languages';
  modal.appendChild(h2);

  var sub = document.createElement('p');
  sub.className = 'sb-sub';
  sub.textContent = 'Choose a language to insert';
  modal.appendChild(sub);

  var grid = document.createElement('div');
  grid.className = 'sb-lang-grid';

  var langs = Object.keys(variantsMap);
  langs.forEach(function(langCode) {
    var btn = document.createElement('button');
    btn.className = 'sb-lang-btn';
    var flag = document.createElement('span');
    flag.className = 'sb-lang-flag';
    flag.textContent = LANG_FLAGS[langCode] || '🌐';
    var name = document.createElement('span');
    name.textContent = LANG_NAMES[langCode] || langCode;
    btn.appendChild(flag);
    btn.appendChild(name);
    btn.addEventListener('click', function() {
      cleanup();
      processing = false;
      handleMatch(el, variantsMap[langCode], scLen);
    });
    grid.appendChild(btn);
  });
  modal.appendChild(grid);

  var cancelRow = document.createElement('div');
  cancelRow.className = 'sb-cancel-row';
  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'sb-btn-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelRow.appendChild(cancelBtn);
  modal.appendChild(cancelRow);

  shadow.appendChild(style);
  shadow.appendChild(modal);
  document.body.appendChild(host);

  function cleanup() {
    host.remove();
    document.removeEventListener('keydown', escHandler);
  }

  function cancelFn() {
    cleanup();
    processing = false;
  }

  cancelBtn.addEventListener('click', cancelFn);
  host.addEventListener('click', function(e) { if (e.target === host) cancelFn(); });

  var escHandler = function(e) { if (e.key === 'Escape') cancelFn(); };
  document.addEventListener('keydown', escHandler);

  setTimeout(function() {
    var firstBtn = grid.querySelector('.sb-lang-btn');
    if (firstBtn) firstBtn.focus();
  }, 50);
}

// ── DYNAMIC SNIPPET MODAL (Shadow DOM) ───────────────────────────
/**
 * Renders a centered modal inside a Shadow DOM to collect
 * user input for each {{placeholder}} variable.
 * @param {string[]} variables
 * @param {Function} onConfirm  receives varMap Object
 * @param {Function} onCancel   no arguments
 */
function injectDynamicModal(variables, onConfirm, onCancel) {
  var host = document.createElement('div');
  host.id = 'sb-modal-host';
  host.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;' +
    'display:flex;align-items:center;justify-content:center;' +
    'background:rgba(0,0,0,0.45);font-family:sans-serif;';
  var shadow = host.attachShadow({ mode: 'closed' });

  var style = document.createElement('style');
  style.textContent =
    '.sb-modal{background:#fff;border-radius:12px;padding:28px 32px;width:420px;max-width:90vw;max-height:80vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.18);display:flex;flex-direction:column;gap:16px;}' +
    '.sb-modal h2{margin:0;font-size:16px;font-weight:600;color:#1a1a1a;letter-spacing:-0.2px;}' +
    '.sb-modal p.sb-sub{margin:-8px 0 0;font-size:13px;color:#666;}' +
    '.sb-field{display:flex;flex-direction:column;gap:6px;}' +
    '.sb-field label{font-size:12px;font-weight:500;color:#444;text-transform:uppercase;letter-spacing:0.4px;}' +
    '.sb-field input{border:1.5px solid #e0e0e0;border-radius:8px;padding:9px 12px;font-size:14px;outline:none;transition:border-color 0.15s;}' +
    '.sb-field input:focus{border-color:#5c6bc0;}' +
    '.sb-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:4px;}' +
    '.sb-btn{padding:9px 20px;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;border:none;transition:opacity 0.15s;}' +
    '.sb-btn:hover{opacity:0.85;}' +
    '.sb-btn-cancel{background:#f0f0f0;color:#333;}' +
    '.sb-btn-insert{background:#5c6bc0;color:#fff;}';

  var modal = document.createElement('div');
  modal.className = 'sb-modal';

  var h2 = document.createElement('h2');
  h2.textContent = '\u26A1 Fill in your snippet';
  modal.appendChild(h2);

  var sub = document.createElement('p');
  sub.className = 'sb-sub';
  sub.textContent = variables.length + ' variable' + (variables.length > 1 ? 's' : '') + ' detected';
  modal.appendChild(sub);

  var fieldsContainer = document.createElement('div');
  var inputs = {};
  for (var i = 0; i < variables.length; i++) {
    var varName = variables[i];
    var field = document.createElement('div');
    field.className = 'sb-field';
    var label = document.createElement('label');
    label.textContent = varName.replace(/_/g, ' ');
    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Enter ' + varName.replace(/_/g, ' ') + '\u2026';
    input.dataset.var = varName;
    inputs[varName] = input;
    field.appendChild(label);
    field.appendChild(input);
    fieldsContainer.appendChild(field);
  }
  modal.appendChild(fieldsContainer);

  var actions = document.createElement('div');
  actions.className = 'sb-actions';
  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'sb-btn sb-btn-cancel';
  cancelBtn.textContent = 'Cancel';
  var insertBtn = document.createElement('button');
  insertBtn.className = 'sb-btn sb-btn-insert';
  insertBtn.textContent = 'Insert \u21B5';
  actions.appendChild(cancelBtn);
  actions.appendChild(insertBtn);
  modal.appendChild(actions);

  shadow.appendChild(style);
  shadow.appendChild(modal);
  document.body.appendChild(host);

  setTimeout(function() {
    var keys = Object.keys(inputs);
    if (keys.length) inputs[keys[0]].focus();
  }, 50);

  var cancelFn = function() {
    host.remove();
    document.removeEventListener('keydown', escHandler);
    onCancel();
  };

  cancelBtn.addEventListener('click', cancelFn);
  host.addEventListener('click', function(e) { if (e.target === host) cancelFn(); });

  var escHandler = function(e) {
    if (e.key === 'Escape') cancelFn();
  };
  document.addEventListener('keydown', escHandler);

  insertBtn.addEventListener('click', function() {
    var varMap = {};
    for (var j = 0; j < variables.length; j++) {
      varMap[variables[j]] = inputs[variables[j]].value.trim();
    }
    document.removeEventListener('keydown', escHandler);
    host.remove();
    onConfirm(varMap);
  });

  modal.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      insertBtn.click();
    }
  });
}

// ── MATCH HANDLER ──────────────────────────────────────────────────
// ── TRIGGER SPAN, MEASURED FROM THE FIELD (v2.148.2) ──────────────
// How many characters an expansion removes used to be a running count of
// keystrokes: the matched trigger's length, or the picker's tally of what was
// typed since it opened. Those counters can drift from the field — a menu that
// swallows a keystroke, an editor that rewrites what it received, focus moving
// mid-word — and every drift shows up the same way: part of the trigger is left
// stranded in the message ("::ne" in front of the snippet).
//
// The field is the truth. Read the text in front of the caret, and if the
// counted span does not start exactly at the trigger sequence, delete back to
// where the trigger actually begins instead. A whitespace anywhere in that run
// means the trigger was abandoned mid-message, so the count is left alone.

// Text between the start of the field and the caret, or null when it cannot be
// read (no selection, selection outside the field, cross-origin, etc.).
function _textBeforeCaret(el) {
  try {
    if (!el) return null;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      if (typeof el.selectionStart !== 'number') return null;
      return String(el.value == null ? '' : el.value).slice(0, el.selectionStart);
    }
    if (!_isCEEl(el)) return null;
    var host = _ceHost(el);
    var sel = window.getSelection();
    if (!host || !sel || !sel.rangeCount) return null;
    var r = sel.getRangeAt(0);
    if (host !== r.endContainer && !host.contains(r.endContainer)) return null;
    var pre = document.createRange();
    pre.selectNodeContents(host);
    pre.setEnd(r.endContainer, r.endOffset);
    return pre.toString();
  } catch(_) { return null; }
}

function _fieldTriggerSpan(el, span) {
  try {
    var seq = (triggerCfg && triggerCfg.snippetTrigger) || '::';
    var before = _textBeforeCaret(el);
    if (before == null || !seq) return span;
    // Already reaching the trigger — the count is right, leave it.
    var start = before.length - span;
    if (span > 0 && start >= 0 && before.substring(start, start + seq.length) === seq) return span;
    var tail = before.slice(-MAX_BUF);
    var idx = tail.lastIndexOf(seq);
    if (idx === -1) return span;
    var run = tail.slice(idx);
    // Never shrink the span, and never reach across a word break: only a
    // continuous run from the trigger to the caret is the trigger the user typed.
    if (run.length <= span || /\s/.test(run)) return span;
    return run.length;
  } catch(_) { return span; }
}

function handleMatch(el, snip, scLen) {
  if (processing) return;
  processing = true;
  scLen = _fieldTriggerSpan(el, scLen);
  var fieldSnapshot = captureFieldState(el, scLen);
  deleteChars(el, scLen, function() {
    var vars = parsePlaceholders(snip.body);
    if (vars.length > 0) {
      injectDynamicModal(vars, function(varMap) {
        var newBody = interpolateSnippet(snip.body, varMap);
        var modSnip = {};
        for (var k in snip) modSnip[k] = snip[k];
        modSnip.body = newBody;
        _proceedInsert(el, modSnip, fieldSnapshot, scLen);
      }, function() {
        processing = false;
      });
    } else {
      _proceedInsert(el, snip, fieldSnapshot, scLen);
    }
  });
}

function _proceedInsert(el, snip, fieldSnapshot, scLen) {
  var fields = extractFields(snip.body);
  if (!fields.length) {
    if (isUrgExpired(snip)) { processing = false; return; }
    var text = resolveBody(snip.body, {}, { lang: snip.lang });
    var _isCE = el && (el.isContentEditable || (el.getAttribute &&
      (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '')));
    if (_isCE) {
      // For CE: deleteChars only SET the selection spanning the trigger.
      // Insert synchronously NOW while that selection is still live — execCommand
      // atomically replaces the trigger with the snippet. The celebration is then
      // purely informational; onConfirm only logs. onUndo deletes the inserted
      // region (see restoreFieldState) so the field returns to its pre-trigger state.
      insertText(el, text);
      fieldSnapshot.syncInserted = true;
      // Capture the inserted region for Undo: caret char-offset (end of snippet)
      // and the snippet's visible length, measured the instant insertion finished.
      fieldSnapshot.endCharOffset = _ceCaretCharOffset(_ceHost(el));
      fieldSnapshot.visibleLen = String(text).replace(/[\r\n]/g, '').length;
      showCelebration(
        text,
        function onConfirm() {           // timer expired or user clicked OK
          logEvent(snip, 0);
          processing = false;
        },
        function onUndo() {              // user clicked Undo
          restoreFieldState(fieldSnapshot);
          processing = false;
        }
      );
    } else {
      // Non-CE (textarea / input): deleteChars already stripped the trigger.
      // Defer insertion to onConfirm, as before.
      showCelebration(
        text,
        function onConfirm() {           // timer expired or user clicked OK
          insertText(el, text);
          logEvent(snip, 0);
          processing = false;
        },
        function onUndo() {              // user clicked Undo — never insert
          restoreFieldState(fieldSnapshot);
          processing = false;
        }
      );
    }
  } else {
    // showOverlay merges the body-declared field config itself.
    showOverlay(el, snip, fields, scLen || 0, function() { processing = false; });
  }
}

// ── DELETE N CHARS ─────────────────────────────────────────────────
// On contenteditable hosts that intercept beforeinput (WhatsApp Web's Lexical
// editor, Gmail compose, Slack, etc.), calling execCommand('delete') N times
// in a tight loop is unreliable — the editor batches/normalizes events and
// often only the first delete lands. Selecting the N chars first and then
// issuing a single delete works around that, because the editor sees one
// deleteContentBackward over a non-collapsed range.
//
// We build the selection Range by walking backward through text nodes in
// document order rather than calling Selection.modify N times. Modify-based
// extension fails in WhatsApp Web's "first message" state (empty editor freshly
// populated): Lexical re-normalizes the selection on every modify call and
// the extend goes nowhere, so 0 chars get selected and the trigger survives.
// Walking text nodes builds the final range in one shot, which Lexical
// accepts as a single deleteContentBackward.
function _ceWalkBackChars(rootEl, endNode, endOffset, n) {
  // Returns {node, offset} of the position N characters before (endNode, endOffset),
  // walking only text nodes that are descendants of rootEl. Falls back to
  // (rootEl, 0) if we run out of text before reaching N.
  var remaining = n;
  var node = endNode;
  var offset = endOffset;

  // If we start in an element node (e.g. cursor right after a <br>), descend
  // to the deepest text node at the offset position.
  if (node && node.nodeType === Node.ELEMENT_NODE) {
    var children = node.childNodes;
    if (children.length === 0) {
      // empty element — nothing to consume here, walk to previous text node
    } else {
      var idx = Math.min(offset, children.length) - 1;
      while (idx >= 0) {
        var c = children[idx];
        if (c.nodeType === Node.TEXT_NODE) {
          node = c; offset = c.nodeValue.length; break;
        } else if (c.nodeType === Node.ELEMENT_NODE) {
          // dive to the last text node inside
          var tw = document.createTreeWalker(c, NodeFilter.SHOW_TEXT, null);
          var last = null, t;
          while ((t = tw.nextNode())) last = t;
          if (last) { node = last; offset = last.nodeValue.length; break; }
        }
        idx--;
      }
    }
  }

  while (remaining > 0 && node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (offset >= remaining) {
        offset -= remaining; remaining = 0; break;
      }
      remaining -= offset;
      // move to previous text node within rootEl
      var prev = _prevTextNode(node, rootEl);
      if (!prev) { node = rootEl; offset = 0; break; }
      node = prev; offset = node.nodeValue.length;
    } else {
      var prev2 = _prevTextNode(node, rootEl);
      if (!prev2) { node = rootEl; offset = 0; break; }
      node = prev2; offset = node.nodeValue.length;
    }
  }
  return { node: node, offset: offset };
}

function _prevTextNode(node, rootEl) {
  // Document-order previous text node, bounded by rootEl.
  var tw = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
  var prev = null, t;
  while ((t = tw.nextNode())) {
    if (t === node) return prev;
    prev = t;
  }
  return prev;
}

// Find the actual contenteditable host. `el` may be the inner span/<p> that
// received the keydown — Lexical (WhatsApp Web) routes events through inner
// nodes, and a TreeWalker rooted there only sees one fragment of the typed
// text. We need the element whose `contenteditable` attribute is "true" (the
// root of the editor instance) so the walker can see all text nodes.
function _ceHost(el) {
  var n = el;
  while (n && n.getAttribute) {
    var a = n.getAttribute('contenteditable');
    if (a === 'true' || a === '') return n;
    n = n.parentElement;
  }
  return el;
}

function _isCEEl(el) {
  return !!(el && (el.isContentEditable || (el.getAttribute &&
    (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === ''))));
}

function _selectionInside(sel, el) {
  if (!sel || !sel.rangeCount || !el) return false;
  var n = sel.getRangeAt(0).endContainer;
  while (n) {
    if (n === el) return true;
    n = n.parentNode;
  }
  return false;
}

function deleteChars(el, n, cb) {
  if (!el || n <= 0) { if (cb) cb(); return; }
  var isCE = el.isContentEditable || el.getAttribute && (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '');
  try {
    if (isCE) {
      // Lexical (WhatsApp Web) does NOT honor execCommand('delete') over a
      // non-collapsed range — its beforeinput handler treats deleteContent-
      // Backward as a single-char delete regardless of selection length.
      // Strategy: don't actually delete here. Just SET the selection to span
      // the N chars to remove. The next call (insertText) will fire
      // execCommand('insertText') which Chrome dispatches as one beforeinput
      // {inputType:'insertText'} over the live (non-collapsed) selection.
      // Lexical handles that as an atomic replacement — clean delete + insert
      // in one operation. Run synchronously (no setTimeout) so the selection
      // we just set is still live when insertText executes.
      var sel = window.getSelection();
      if ((!sel || !sel.rangeCount) || !_selectionInside(sel, el)) {
        try { el.focus(); } catch(_) {}
        sel = window.getSelection();
      }
      var host = _ceHost((sel && sel.rangeCount && sel.getRangeAt(0).endContainer.nodeType === 1)
        ? sel.getRangeAt(0).endContainer
        : (sel && sel.rangeCount ? sel.getRangeAt(0).endContainer.parentElement : el));
      if (!host || (host.nodeType !== 1)) host = _ceHost(el);

      if (sel && sel.rangeCount) {
        try {
          var r = sel.getRangeAt(0);
          var start = _ceWalkBackChars(host, r.endContainer, r.endOffset, n);
          var sr = document.createRange();
          sr.setStart(start.node, start.offset);
          sr.setEnd(r.endContainer, r.endOffset);
          sel.removeAllRanges();
          sel.addRange(sr);
          if (cb) cb();
          return;
        } catch(eRange) {}
      }
      // Selection unrecoverable — fall through to the legacy delete loop.
      try { el.focus(); for (var i = 0; i < n; i++) document.execCommand('delete', false, null); } catch(_) {}
    } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.focus();
      var s = (el.selectionStart != null) ? el.selectionStart : (el.value || '').length;
      var np = Math.max(0, s - n);
      var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      var nv = el.value.substring(0, np) + el.value.substring(s);
      if (desc && desc.set) desc.set.call(el, nv); else el.value = nv;
      el.setSelectionRange(np, np);
      el.dispatchEvent(new Event('input', {bubbles:true}));
    } else {
      for (var i = 0; i < n; i++) document.execCommand('delete', false, null);
    }
  } catch(e) {
    try {
      var s2 = el.selectionStart || 0;
      el.value = el.value.substring(0, Math.max(0, s2 - n)) + el.value.substring(s2);
      var np2 = Math.max(0, s2 - n);
      el.setSelectionRange(np2, np2);
      el.dispatchEvent(new Event('input', {bubbles:true}));
    } catch(e2) {}
  }
  setTimeout(function() { if (cb) cb(); }, 20);
}

// ── INSERT TEXT ────────────────────────────────────────────────────
// Multi-line text via execCommand('insertText', '...\n...') is mangled by
// rich-text editors (WhatsApp Web/Lexical drops or reorders the segments).
// Insert one line at a time and emit a real line break between them.

// Per-line insertion: one execCommand per line, a real line break between them.
// Works in plain contenteditables, Gmail, Slack. Editors that own their input
// model (Lexical) accept the break commands and drop them — _cePasteInsert
// handles those; this stays the fallback for everything else.
function _ceLineInsert(text) {
  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (i > 0) {
      var ok = false;
      try { ok = document.execCommand('insertLineBreak', false, null); } catch(e) {}
      if (!ok) {
        try { ok = document.execCommand('insertParagraph', false, null); } catch(e) {}
      }
      if (!ok) {
        try { document.execCommand('insertText', false, '\n'); } catch(e) {}
      }
    }
    // Always emit execCommand on the first line (even when empty) so that
    // the non-collapsed selection set by deleteChars is atomically replaced.
    // Without this, an empty body leaves the trigger text selected in the
    // field — producing the "outputs ::shortcut" symptom.
    if (i === 0 || lines[i]) {
      try { document.execCommand('insertText', false, lines[i]); } catch(e) {}
    }
  }
}

// Lexical (WhatsApp Web) keeps its own input model. It accepts
// execCommand('insertLineBreak') — returning true — and then inserts nothing,
// so the fallbacks above never fire and a multi-paragraph snippet lands as one
// dense block. It does honour a text/plain paste, which it converts into real
// line breaks. Returns true only when the editor claimed the paste.
//
// The trigger is consumed first, with execCommand: that fires a real
// beforeinput carrying target ranges, so the editor deletes exactly the
// selection deleteChars set across the trigger. A paste event carries no target
// ranges — Lexical pastes at its own cached caret and leaves the trigger text
// in the field ("...reserva ♡::neob").
function _cePasteInsert(el, text) {
  var host = _ceHost(el);
  if (!host || typeof DataTransfer !== 'function' || typeof ClipboardEvent !== 'function') return false;

  var dt;
  try {
    dt = new DataTransfer();
    dt.setData('text/plain', text);
  } catch(e) { return false; }

  try { document.execCommand('insertText', false, ''); } catch(e) {}

  var claimed;
  try {
    claimed = !host.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: dt, bubbles: true, cancelable: true
    }));
  } catch(e) { return false; }
  if (!claimed) return false;

  // preventDefault alone does not prove the editor inserted anything — it may
  // reject untrusted events, or read the system clipboard instead of ours.
  // Confirm the body actually landed once the editor has had time to reconcile
  // (Lexical writes to the DOM a microtask later), and fall back to the
  // per-line path if it did not. Probe on the first non-empty line so the check
  // means "the snippet is in the field", not "the field grew".
  var probe = '';
  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (lines[i]) { probe = lines[i].slice(0, 24); break; }
  }
  if (probe) {
    setTimeout(function() {
      if (_ceHost(el).textContent.indexOf(probe) === -1) _ceLineInsert(text);
    }, 120);
  }
  return true;
}

function insertText(el, text) {
  if (!el) return;
  // Normalize CRLF/CR to LF first. A body carrying Windows line endings (JSON
  // import, text pasted from a desktop editor) otherwise splits into lines that
  // each keep a trailing CR: the CR survives into the message as an invisible
  // character, and a blank line — the lone "\r" segment — loses its break
  // entirely, collapsing paragraphs into one block.
  text = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  var isCE = el.isContentEditable || el.getAttribute && (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '');
  try {
    if (isCE) {
      // CRITICAL: do NOT call el.focus() on the CE path. Lexical (WhatsApp Web)
      // resets the DOM selection on focus events, which would wipe the
      // non-collapsed range that deleteChars just set to span the trigger —
      // causing execCommand('insertText') to insert at start-of-field while
      // the trigger text survives. deleteChars already focused the editable
      // when needed; trust it.
      // The first execCommand('insertText') replaces the (possibly non-
      // collapsed) selection with line[0] in one beforeinput insertText event,
      // which Lexical handles atomically. After that the cursor is collapsed
      // at the end of inserted text; subsequent line-break + line pairs append.
      // Use !activeElement.contains(el) rather than !el.contains(activeElement):
      // el may be an inner span while activeElement is the outer contenteditable
      // div (WhatsApp Web / Lexical). The old check had the containment test
      // backwards, causing an unnecessary el.focus() on the inner span, which
      // makes Lexical reset the non-collapsed range set by deleteChars — leaving
      // a fragment of the trigger text in the field.
      if (document.activeElement !== el && !document.activeElement.contains(el)) {
        try { el.focus(); } catch(_) {}
      }
      if (text.indexOf('\n') > -1 && _cePasteInsert(el, text)) return;
      _ceLineInsert(text);
      return;
    }
    el.focus();
    if (document.execCommand('insertText', false, text)) return;
  } catch(e) {}
  try {
    var s = el.selectionStart || 0;
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    var nv = el.value.substring(0, s) + text + el.value.substring(s);
    if (desc && desc.set) desc.set.call(el, nv); else el.value = nv;
    el.setSelectionRange(s + text.length, s + text.length);
    el.dispatchEvent(new Event('input', {bubbles:true}));
  } catch(e) {}
}

// ── URGENCY TIMER ENGINE ──────────────────────────────────────────
function getUrgExpiry(snippetId, durationMs) {
  var key = 'sb-urg-' + snippetId;
  var stored = sessionStorage.getItem(key);
  if (stored) { var exp = parseInt(stored); if (!isNaN(exp)) return exp; }
  var exp = Date.now() + durationMs;
  sessionStorage.setItem(key, String(exp));
  return exp;
}

function buildUrgencyHtml(snip) {
  if (!snip || !snip.enable_urgency_timer || !snip.timer_duration_ms) return '';
  var exp = getUrgExpiry(snip.id, snip.timer_duration_ms);
  var remain = Math.max(0, exp - Date.now());
  var isExpired = remain <= 0;
  var sc = snip.scarcity_count || 0;
  var h = '<div id="sb-urg-bar" data-exp="'+exp+'" style="background:linear-gradient(135deg,#1a1a2e,#16213e);border:2px solid '+(isExpired?'#666':'#d93900')+';border-radius:10px;padding:10px 14px;margin:0 14px 8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:center;'+(isExpired?'opacity:.6;':'animation:sbUrgPulse 2s ease-in-out infinite;')+'">';
  if (isExpired) {
    h += '<span style="font-size:16px">⏰</span><span style="font-size:12px;font-weight:700;color:#c0392b;text-align:center;width:100%">Quote Expired</span>';
  } else {
    h += '<span style="font-size:16px">🔥</span>';
    h += '<div id="sb-urg-timer" style="display:flex;gap:3px;align-items:center">' + renderUrgDigits(remain) + '</div>';
    if (sc > 0) {
      h += '<div style="display:flex;align-items:center;gap:5px;background:rgba(217,57,0,.12);border:1px solid rgba(217,57,0,.35);border-radius:16px;padding:4px 10px">'
        + '<span style="width:6px;height:6px;border-radius:50%;background:#d93900;animation:sbScBlink 1s ease-in-out infinite"></span>'
        + '<span style="font-size:11px;font-weight:700;color:#ff6b35;white-space:nowrap">Only '+sc+' unit'+(sc!==1?'s':'')+' left</span></div>';
    }
  }
  h += '</div>';
  return h;
}

function renderUrgDigits(ms) {
  var totalSec = Math.ceil(ms / 1000);
  var hr = Math.floor(totalSec / 3600);
  var mn = Math.floor((totalSec % 3600) / 60);
  var sc = totalSec % 60;
  function pad(n){ return n < 10 ? '0'+n : ''+n; }
  function dbox(val, lbl) {
    return '<div style="background:rgba(217,57,0,.15);border:1px solid rgba(217,57,0,.4);border-radius:5px;padding:3px 5px;min-width:28px;text-align:center">'
      + '<div style="font-size:16px;font-weight:800;color:#ff6b35;font-family:monospace;line-height:1">'+pad(val)+'</div>'
      + '<div style="font-size:6px;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.05em;margin-top:1px">'+lbl+'</div></div>';
  }
  var sep = '<span style="font-size:14px;font-weight:800;color:#ff6b35;opacity:.5;padding:0 1px">:</span>';
  var html = '';
  if (hr > 0) html += dbox(hr,'hrs') + sep;
  html += dbox(mn,'min') + sep + dbox(sc,'sec');
  return html;
}

var urgRAF = null;
function startUrgTick() {
  if (urgRAF) cancelAnimationFrame(urgRAF);
  urgRAF = null;
  function tick() {
    var bar = document.getElementById('sb-urg-bar');
    if (!bar) { urgRAF = null; return; }
    var exp = parseInt(bar.dataset.exp);
    var remain = Math.max(0, exp - Date.now());
    if (remain <= 0) {
      bar.style.opacity = '0.6'; bar.style.borderColor = '#666'; bar.style.animation = 'none';
      bar.innerHTML = '<span style="font-size:16px">⏰</span><span style="font-size:12px;font-weight:700;color:#c0392b;text-align:center;width:100%">Quote Expired</span>';
      var btn = document.querySelector('#sb-overlay .sb-insert');
      if (btn) { btn.disabled = true; btn.textContent = 'Quote Expired'; btn.style.opacity = '0.5'; btn.style.background = '#666'; }
      urgRAF = null; return;
    }
    var td = document.getElementById('sb-urg-timer');
    if (td) td.innerHTML = renderUrgDigits(remain);
    urgRAF = requestAnimationFrame(tick);
  }
  urgRAF = requestAnimationFrame(tick);
}

function isUrgExpired(snip) {
  if (!snip || !snip.enable_urgency_timer || !snip.timer_duration_ms) return false;
  var exp = getUrgExpiry(snip.id, snip.timer_duration_ms);
  return Date.now() >= exp;
}

// ── OVERLAY ────────────────────────────────────────────────────────
var overlayEl  = null;
var overlayDone = null;
// Trigger/filter length the field overlay must strip from the target field at
// insert time. On contenteditable hosts deleteChars only SETS a selection over
// the trigger (it never deletes), and opening the overlay steals focus and wipes
// that selection — so the trigger survives until doInsert removes it here. 0 for
// textarea/input (trigger already stripped) and for the selection-suggest path.
var overlayTriggerLen = 0;
// Caret position (character offset within the contenteditable host) at the
// moment the overlay opened — the end of the trigger. Recovering the trigger
// from the LIVE selection at insert time is not enough: the overlay took focus,
// and focusing a contenteditable again drops the caret at the start of the
// editor, so the walk backwards found nothing. The snippet then landed at the
// top of the field and the whole trigger survived at the end. -1 when unknown.
var overlayCaretCO = -1;

function showOverlay(targetEl, snip, fields, scLen, done) {
  overlayTriggerLen = scLen || 0;
  // Read the caret BEFORE the overlay exists: deleteChars has just selected the
  // trigger, so the selection end is exactly where the user was typing.
  overlayCaretCO = (overlayTriggerLen > 0 && targetEl && _isCEEl(targetEl))
    ? _ceCaretCharOffset(_ceHost(targetEl))
    : -1;
  triggerPending = false;
  triggerPendingMode = null;
  triggerAffix = '';
  if (triggerDebounceTimer) { clearTimeout(triggerDebounceTimer); triggerDebounceTimer = null; }
  removeOverlay();
  overlayDone = done;
  // Field config the body itself declares via {formtext/date/menu:} tokens,
  // with any explicit field_cfg on top so a hand-configured field still wins.
  //
  // Merged HERE, not at the call sites: three paths open this overlay — the
  // trigger, the picker, and the right-click context menu — and only the
  // trigger used to merge. Via the other two a {formmenu:} arrived as a bare
  // field name and rendered as a plain text box, so the choices could not be
  // picked at all. Keeping it inside means no future entry point can forget.
  var cfgs  = Object.assign({}, buildFormFieldCfg(snip.body), snip.fieldCfg || {});
  // Static text either side of each token, so a row reads like the snippet.
  var ctxs  = fieldContext(snip.body);
  var _now  = new Date();
  var today = sbFormatDate(_now, 'YYYY-MM-DD');
  var nowTime = sbFormatDate(_now, 'HH:mm');
  var nowDT = sbFormatDate(_now, 'YYYY-MM-DD') + 'T' + sbFormatDate(_now, 'HH:mm');

  var fhtml = '';
  for (var i = 0; i < fields.length; i++) {
    var key = fields[i];
    var rawCfg = cfgs[key] || {};
    var cfg = {
      type: rawCfg.type, opts: rawCfg.opts, default: rawCfg.default,
      multiple: rawCfg.multiple, cols: rawCfg.cols
    };
    // Auto-detect date/time/datetime by field name when cfg.type is not set.
    // Split on non-letters so "TIME_HH:MM" / "DATE_DD/MM/YYYY" still expose
    // TIME / DATE as standalone tokens.
    if (!cfg.type) {
      var toks = String(key).toUpperCase().split(/[^A-Z]+/);
      if (toks.indexOf('DATETIME') >= 0) cfg.type = 'datetime';
      else if (toks.indexOf('DATE') >= 0) cfg.type = 'date';
      else if (toks.indexOf('TIME') >= 0) cfg.type = 'time';
      else cfg.type = 'text';
    }
    var opts = cfg.opts ? cfg.opts.split('\n').filter(function(o){ return o.trim(); }) : [];
    var inp;
    // A checkbox group is block-level, so it cannot sit inside an inline
    // sentence — its context goes above and below instead.
    var blockControl = false;
    if (cfg.type === 'dd' && opts.length) {
      // {formmenu: …; cols=N} sizes the field in characters; capped at the
      // overlay width so a long value can never push the panel out of view.
      var wide = cfg.cols ? ' style="width:'+cfg.cols+'ch;max-width:100%"' : '';
      var picked = formMenuPicks(cfg.default);
      if (cfg.multiple) {
        // A native multi-select needs ctrl-click to be usable — checkboxes make
        // "pick several" obvious, and getVals() joins them back into one value.
        blockControl = true;
        inp = '<div class="sb-multi"'+wide+'>' + opts.map(function(o){
          return '<label class="sb-opt"><input type="checkbox" class="sb-inp" data-key="'+key+'" value="'+xesc(o)+'"'+
                 (picked.indexOf(o) >= 0 ? ' checked' : '')+'><span>'+xesc(o)+'</span></label>';
        }).join('') + '</div>';
      } else {
        inp = '<select class="sb-inp" data-key="'+key+'"'+wide+'>' +
          (picked.length ? '' : '<option value="">— select —</option>') +
          opts.map(function(o){
            return '<option value="'+xesc(o)+'"'+(picked.indexOf(o) >= 0 ? ' selected' : '')+'>'+xesc(o)+'</option>';
          }).join('') +
          '</select>';
      }
    } else if (cfg.type === 'date') {
      inp = '<input type="date" class="sb-inp" data-key="'+key+'" value="'+xesc(cfg.default||today)+'">';
    } else if (cfg.type === 'time') {
      inp = '<input type="time" class="sb-inp" data-key="'+key+'" value="'+xesc(cfg.default||nowTime)+'">';
    } else if (cfg.type === 'datetime' || cfg.type === 'datetime-local') {
      inp = '<input type="datetime-local" class="sb-inp" data-key="'+key+'" value="'+xesc(cfg.default||nowDT)+'">';
    } else {
      inp = '<input type="'+(cfg.type==='number'?'number':'text')+'" class="sb-inp" data-key="'+key+'" placeholder="'+key.replace(/_/g,' ')+'" value="'+xesc(cfg.default||'')+'">';
    }
    // The row reads like the snippet — "Rate Plan: [ Refundable ] per night".
    // Only a field with no prose around it falls back to its key, which is
    // otherwise noise: an unnamed menu's key is a hash like MENU_1yvog3p.
    var ctx  = ctxs[key] || { before: '', after: '' };
    var pre  = ctx.before ? '<span class="sb-ctx">'+xesc(ctx.before)+'</span>' : '';
    var post = ctx.after  ? '<span class="sb-ctx">'+xesc(ctx.after)+'</span>'  : '';
    var lbl  = (pre || post) ? '' : '<label class="sb-lbl">{'+xesc(key)+'}</label>';
    fhtml += '<div class="sb-field">' + lbl + (blockControl
      ? (pre ? '<div class="sb-ctxline">'+pre+'</div>' : '') + inp +
        (post ? '<div class="sb-ctxline">'+post+'</div>' : '')
      : '<div class="sb-row">'+pre+inp+post+'</div>') + '</div>';
  }

  // {button} controls: they set field values, they never print. Rendered after
  // the inputs they act on, so the cause sits above the effect.
  var buttons = extractButtons(snip.body);
  if (buttons.length) {
    fhtml += '<div class="sb-btnrow">' + buttons.map(function(b){
      return '<button type="button" class="sb-actbtn" data-btn="'+xesc(b.id)+'">'+xesc(b.label)+'</button>';
    }).join('') + '</div><div class="sb-btnerr" hidden></div>';
  }

  var urgHtml = buildUrgencyHtml(snip);
  var expired = isUrgExpired(snip);

  var el = document.createElement('div');
  el.id = 'sb-overlay';
  el.innerHTML =
    '<div class="sb-hdr">' +
      '<span class="sb-logo">\u26a1 Sprintbrain</span>' +
      '<span class="sb-title">'+xesc(snip.title)+'</span>' +
      '<button class="sb-close">&#x2715;</button>' +
    '</div>' +
    urgHtml +
    '<div class="sb-fields">'+fhtml+'</div>' +
    '<div class="sb-prev" id="sb-prev"></div>' +
    '<div class="sb-foot">' +
      '<button class="sb-insert"'+(expired?' disabled style="opacity:.5;background:#666"':'')+'>'+
        (expired ? 'Quote Expired' : 'Insert message \u21b5') + '</button>' +
      '<span class="sb-tip">Enter \u00b7 Esc to cancel</span>' +
    '</div>';

  el.style.cssText =
    'position:fixed!important;top:50%!important;left:50%!important;' +
    'transform:translate(-50%,-50%)!important;z-index:2147483647!important;' +
    'width:420px!important;max-width:94vw!important;max-height:85vh!important;' +
    'overflow-y:auto!important;' +
    'box-shadow:0 20px 60px rgba(0,0,0,.28),0 4px 16px rgba(0,0,0,.12)!important;';

  var bd = document.createElement('div');
  bd.id = 'sb-bd';
  bd.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:2147483646;';

  document.body.appendChild(bd);
  document.body.appendChild(el);
  overlayEl = el;

  setTimeout(function() {
    var first = el.querySelector('.sb-inp');
    if (first) first.focus();
    updatePrev(snip);
    if (document.getElementById('sb-urg-bar')) startUrgTick();
  }, 50);

  var inps = el.querySelectorAll('.sb-inp');
  for (var j = 0; j < inps.length; j++) {
    (function(inp) {
      inp.addEventListener('input',  function(){ updatePrev(snip); });
      inp.addEventListener('change', function(){ updatePrev(snip); });
      inp.addEventListener('paste',  function(){ setTimeout(function(){ updatePrev(snip); }, 0); });
    })(inps[j]);
  }

  // Action buttons write their results straight into the inputs, so the preview
  // and the eventual insert both read them back through the normal getVals path.
  var errBox = el.querySelector('.sb-btnerr');
  var actBtns = el.querySelectorAll('.sb-actbtn');
  for (var b = 0; b < actBtns.length; b++) {
    (function(btn) {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var spec = null;
        for (var q = 0; q < buttons.length; q++) { if (buttons[q].id === btn.dataset.btn) spec = buttons[q]; }
        if (!spec) return;
        var res = applyButtonCode(spec.statements, getVals());
        var errs = spec.errors.concat(res.errors);
        for (var name in res.values) {
          if (!Object.prototype.hasOwnProperty.call(res.values, name)) continue;
          var target = el.querySelector('.sb-inp[data-key="' + name + '"]');
          if (!target) { errs.push('No field called ' + name); continue; }
          if (target.type === 'checkbox') { errs.push(name + ' is a multi-choice menu'); continue; }
          target.value = String(res.values[name]);
        }
        if (errBox) {
          errBox.textContent = errs.join(' · ');
          errBox.hidden = errs.length === 0;
        }
        updatePrev(snip);
      });
    })(actBtns[b]);
  }

  var closeBtn   = el.querySelector('.sb-close');
  var insertBtn  = el.querySelector('.sb-insert');

  function onCloseClick(e) { e.stopPropagation(); closeOverlay(); }
  function onInsertClick(e) {
    e.stopPropagation();
    // Guard against double-fire (touchstart + click) on mobile
    var now = Date.now();
    if (onInsertClick._last && now - onInsertClick._last < 400) return;
    onInsertClick._last = now;
    doInsert(targetEl, snip);
  }
  function onBdClose(e) {
    var now = Date.now();
    if (onBdClose._last && now - onBdClose._last < 400) return;
    onBdClose._last = now;
    closeOverlay();
  }

  closeBtn.addEventListener('click',      onCloseClick);
  closeBtn.addEventListener('touchstart', onCloseClick, {passive: false});
  insertBtn.addEventListener('click',      onInsertClick);
  insertBtn.addEventListener('touchstart', onInsertClick, {passive: false});
  bd.addEventListener('click',      onBdClose);
  bd.addEventListener('touchstart', onBdClose, {passive: false});
  el.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeOverlay(); }
    if (e.key === 'Enter' && !e.shiftKey) {
      // BUTTON excluded: the browser already activates a focused button on
      // Enter, so inserting here too would fire an action button and insert
      // the message in one keypress.
      var tag = document.activeElement ? document.activeElement.tagName : '';
      if (tag !== 'TEXTAREA' && tag !== 'SELECT' && tag !== 'BUTTON') {
        e.preventDefault(); e.stopPropagation(); doInsert(targetEl, snip);
      }
    }
  });
}

function xesc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function getVals() {
  if (!overlayEl) return {};
  var v = {}, groups = {};
  var inps = overlayEl.querySelectorAll('.sb-inp[data-key]');
  for (var i = 0; i < inps.length; i++) {
    var el = inps[i], k = el.dataset.key;
    // A multiple-choice {formmenu:} is a checkbox group sharing one data-key —
    // every box contributes, checked or not, so the value is the picks in the
    // order the menu declares them.
    if (el.type === 'checkbox') {
      if (!groups[k]) groups[k] = [];
      if (el.checked) groups[k].push(el.value);
    } else {
      v[k] = el.value;
    }
  }
  for (var g in groups) v[g] = groups[g].join(', ');
  return v;
}

function updatePrev(snip) {
  var box = document.getElementById('sb-prev');
  if (!box) return;
  var all = resolveBody(snip.body, getVals(), { lang: snip.lang }).split('\n');
  box.textContent = all.slice(0, 5).join('\n') + (all.length > 5 ? '\n\u2026' : '');
}

function doInsert(targetEl, snip) {
  if (isUrgExpired(snip)) return;
  var vals = getVals();
  var text = resolveBody(snip.body, vals, { lang: snip.lang });
  var fillCount = Object.keys(vals).length;
  closeOverlay();
  if (!targetEl) return;
  var isCE = targetEl.isContentEditable || (targetEl.getAttribute &&
    (targetEl.getAttribute('contenteditable') === 'true' || targetEl.getAttribute('contenteditable') === ''));

  // Celebrate after a synchronous CE insert. Capture the inserted region so the
  // Undo button can delete it — same mechanism as the no-field CE path in
  // _proceedInsert (see restoreFieldState).
  function celebrateSyncCE() {
    var snapshot = captureFieldState(targetEl, overlayTriggerLen);
    snapshot.syncInserted  = true;
    snapshot.endCharOffset = _ceCaretCharOffset(_ceHost(targetEl));
    snapshot.visibleLen    = String(text).replace(/[\r\n]/g, '').length;
    showCelebration(
      text,
      function onConfirm() { logEvent(snip, fillCount); },
      function onUndo()    { restoreFieldState(snapshot); }
    );
  }

  if (isCE && overlayTriggerLen > 0) {
    // CE field overlay: the trigger was never actually deleted (deleteChars only
    // set a selection at match time, which this overlay's focus then wiped).
    // Re-select the trigger and replace it atomically while the selection is live
    // — exactly how the no-field CE path inserts. Without this the literal
    // ::trigger survives and nothing is inserted.
    //
    // Prefer the caret offset recorded when the overlay opened: walking back from
    // the LIVE caret only works in editors that restore their own selection on
    // focus. A plain contenteditable puts the caret back at the start, so the walk
    // found nothing and the trigger stayed in the field. deleteChars remains the
    // fallback for editors whose DOM offsets we could not read.
    if (_ceRestoreTriggerRange(targetEl, overlayCaretCO, overlayTriggerLen)) {
      insertText(targetEl, text);
      celebrateSyncCE();
    } else {
      deleteChars(targetEl, overlayTriggerLen, function() {
        insertText(targetEl, text);
        celebrateSyncCE();
      });
    }
  } else if (isCE) {
    // CE with no captured trigger (context-menu / selection-suggest): nothing to
    // strip, so insert at the live caret now and celebrate with Undo.
    insertText(targetEl, text);
    celebrateSyncCE();
  } else {
    // Textarea/input: the trigger was already stripped before the overlay opened.
    // Defer insertion to confirm so Undo can simply skip it — identical to the
    // no-field non-CE path. insertText() refocuses the field itself.
    var snapshot = captureFieldState(targetEl, overlayTriggerLen);
    showCelebration(
      text,
      function onConfirm() { insertText(targetEl, text); logEvent(snip, fillCount); },
      function onUndo()    { restoreFieldState(snapshot); }
    );
  }
}

function closeOverlay() {
  if (overlayEl) { overlayEl.remove(); overlayEl = null; }
  var bd = document.getElementById('sb-bd');
  if (bd) bd.remove();
  if (overlayDone) { overlayDone(); overlayDone = null; }
}

function removeOverlay() { closeOverlay(); }

// ── CONFETTI ───────────────────────────────────────────────────────
var COLORS = ['#BA7517','#e8a650','#4a9eca','#d4736a','#3B6D11','#7c3aed','#0891b2','#f59e0b','#ec4899','#10b981'];

function launchConfetti() {
  var old = document.getElementById('sb-confetti');
  if (old) old.remove();
  var cv = document.createElement('canvas');
  cv.id = 'sb-confetti';
  cv.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483645;';
  cv.width  = window.innerWidth;
  cv.height = window.innerHeight;
  document.body.appendChild(cv);
  var ctx = cv.getContext('2d');
  var pp = [];
  for (var i = 0; i < 150; i++) {
    var a = Math.random() * Math.PI * 2;
    var sp = 4 + Math.random() * 8;
    pp.push({
      x: cv.width/2 + (Math.random()-0.5)*300,
      y: cv.height*0.35,
      vx: Math.cos(a)*sp, vy: Math.sin(a)*sp - 5,
      w: 6+Math.random()*8, h: 4+Math.random()*5,
      color: COLORS[Math.floor(Math.random()*COLORS.length)],
      rot: Math.random()*360, rv: (Math.random()-0.5)*8,
      alpha: 1, circle: Math.random()>0.5
    });
  }
  var raf;
  function draw() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    var alive = false;
    for (var j = 0; j < pp.length; j++) {
      var p = pp[j];
      p.vy += 0.18; p.vx *= 0.99;
      p.x += p.vx; p.y += p.vy;
      p.rot += p.rv; p.alpha -= 0.009;
      if (p.alpha > 0 && p.y < cv.height) alive = true;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI/180);
      if (p.circle) { ctx.beginPath(); ctx.arc(0,0,p.w/2,0,Math.PI*2); ctx.fill(); }
      else { ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h); }
      ctx.restore();
    }
    if (alive) raf = requestAnimationFrame(draw);
    else { ctx.clearRect(0,0,cv.width,cv.height); cv.remove(); }
  }
  draw();
  setTimeout(function(){ if(cv.parentNode){ cancelAnimationFrame(raf); cv.remove(); } }, 5000);
}

// ── FIELD STATE SNAPSHOT (for Undo) ───────────────────────────────
// Character offset of the current caret within `host`, counting only text-node
// characters (block boundaries contribute nothing) — the same unit insertText's
// visible length uses. Returns -1 if the caret isn't inside the host.
function _ceCaretCharOffset(host) {
  try {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount || !host) return -1;
    var r = sel.getRangeAt(0);
    if (host !== r.endContainer && !host.contains(r.endContainer)) return -1;
    var pre = document.createRange();
    pre.selectNodeContents(host);
    pre.setEnd(r.endContainer, r.endOffset);
    return pre.toString().length;
  } catch(_) { return -1; }
}

// Inverse of _ceCaretCharOffset: resolve a text-character offset within `host`
// to a concrete {node, offset} DOM position.
function _ceCharOffsetToPoint(host, target) {
  var tw = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, null);
  var acc = 0, node;
  while ((node = tw.nextNode())) {
    var len = node.nodeValue.length;
    if (acc + len >= target) return { node: node, offset: Math.max(0, target - acc) };
    acc += len;
  }
  return { node: host, offset: host.childNodes ? host.childNodes.length : 0 };
}

// Re-select the N characters ending at a caret offset captured earlier, so the
// next insertText replaces them. Used when the live selection can no longer be
// trusted because a modal held focus in between (the field overlay). Returns
// false when the offset is unusable, leaving the caller its live-selection path.
function _ceRestoreTriggerRange(el, caretCO, n) {
  try {
    if (typeof caretCO !== 'number' || caretCO < n || n <= 0) return false;
    var host = _ceHost(el);
    if (!host) return false;
    if (document.activeElement !== el && !document.activeElement.contains(el)) {
      try { el.focus(); } catch(_) {}
    }
    var sp = _ceCharOffsetToPoint(host, caretCO - n);
    var ep = _ceCharOffsetToPoint(host, caretCO);
    var r = document.createRange();
    r.setStart(sp.node, sp.offset);
    r.setEnd(ep.node, ep.offset);
    if (r.collapsed || r.toString().length !== n) return false;
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    return true;
  } catch(_) { return false; }
}

function captureFieldState(el, triggerLen) {
  var isCE = el.isContentEditable || (el.getAttribute && (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === ''));
  if (isCE) return { type: 'ce', el: el, triggerLen: triggerLen || 0 };
  return { type: 'value', el: el, triggerLen: triggerLen || 0 };
}

function restoreFieldState(snapshot) {
  if (!snapshot || !snapshot.el) return;
  var el = snapshot.el;
  try {
    if (snapshot.type === 'ce') {
      if (snapshot.syncInserted) {
        // The snippet was inserted synchronously, REPLACING the trigger. So the
        // field's pre-trigger state == the field with the inserted region removed.
        //
        // Native execCommand('undo') is unusable for this: a large multi-block body
        // produces more undo transactions than the editor keeps, so it can never
        // fully revert (confirmed: 7 undos, fragment still stranded). Selecting the
        // inserted region and deleting via execCommand is also unreliable — the
        // editor collapses programmatic multi-block selections before the delete.
        //
        // Instead, delete the inserted region straight from the DOM with a Range
        // (Range.deleteContents bypasses both the undo stack and selection
        // normalization). The region is [endCharOffset - visibleLen, endCharOffset)
        // measured in text characters from the host start — captured the instant the
        // insertion finished — resolved to live DOM points at undo time, so it is
        // immune to node re-identity. The caret collapses to where the trigger began.
        if (document.activeElement !== el && !document.activeElement.contains(el)) {
          try { el.focus(); } catch(_) {}
        }
        var hostU = _ceHost(el);
        var endCO = (typeof snapshot.endCharOffset === 'number') ? snapshot.endCharOffset : -1;
        var vlen  = (typeof snapshot.visibleLen === 'number') ? snapshot.visibleLen : 0;
        var _ok = false;
        if (hostU && endCO >= 0 && vlen > 0) {
          try {
            var startCO = Math.max(0, endCO - vlen);
            var sp = _ceCharOffsetToPoint(hostU, startCO);
            var ep = _ceCharOffsetToPoint(hostU, endCO);
            var delR = document.createRange();
            delR.setStart(sp.node, sp.offset);
            delR.setEnd(ep.node, ep.offset);
            delR.deleteContents();
            try {
              var caretR = document.createRange();
              caretR.setStart(sp.node, sp.offset);
              caretR.collapse(true);
              var selR = window.getSelection();
              selR.removeAllRanges();
              selR.addRange(caretR);
            } catch(_c) { try { hostU.focus(); } catch(_f) {} }
            try { hostU.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' })); }
            catch(_e) { try { hostU.dispatchEvent(new Event('input', { bubbles: true })); } catch(_e2) {} }
            _ok = true;
          } catch(_) {}
        }
        if (!_ok) {
          // Offsets unavailable (selection wasn't captured) — best-effort native undo.
          try { document.execCommand('undo', false, null); } catch(_) {}
        }
        return;
      }
      // deleteChars for CE only SET the selection spanning the trigger (no DOM
      // change). The trigger is still in the field, selected. Atomically delete
      // it via execCommand('insertText', '') — same mechanism insertText uses on
      // confirm, so Lexical/Gmail/Slack handle it as a single beforeinput event.
      if (document.activeElement !== el && !document.activeElement.contains(el)) {
        try { el.focus(); } catch(_) {}
      }
      var sel = window.getSelection();
      var canAtomicDelete = sel && sel.rangeCount > 0 && !sel.getRangeAt(0).collapsed;
      if (canAtomicDelete) {
        try { document.execCommand('insertText', false, ''); } catch(_) {}
      } else if (typeof snapshot.triggerLen === 'number' && snapshot.triggerLen > 0) {
        // Fallback: selection was reset (rare). Re-select N chars backward from
        // the current caret and delete them.
        try {
          var sel2 = window.getSelection();
          if (sel2 && sel2.rangeCount > 0) {
            var r  = sel2.getRangeAt(0);
            var bk = _ceWalkBackChars(_ceHost(el), r.endContainer, r.endOffset, snapshot.triggerLen);
            var nr = document.createRange();
            nr.setStart(bk.node, bk.offset);
            nr.setEnd(r.endContainer, r.endOffset);
            sel2.removeAllRanges();
            sel2.addRange(nr);
            document.execCommand('insertText', false, '');
          }
        } catch(_) {}
      }
    } else {
      if (snapshot.syncInsertedValue) {
        // Context-menu insert ran synchronously (insertion already happened, not
        // deferred). Restore the exact pre-insert value + caret via the native
        // setter so React-controlled fields register the change, then emit input.
        var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        var desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(el, snapshot.prevValue);
        else el.value = snapshot.prevValue;
        try { el.focus(); } catch(_) {}
        if (snapshot.prevSelStart != null && snapshot.prevSelEnd != null) {
          try { el.setSelectionRange(snapshot.prevSelStart, snapshot.prevSelEnd); } catch(_) {}
        }
        try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch(_) {}
        return;
      }
      // textarea / input: deleteChars already stripped the trigger from el.value
      // BEFORE the celebration appeared, and insertText was deferred — never
      // fired. The field is already in the clean post-undo state. Just refocus.
      try { el.focus(); } catch(_) {}
    }
  } catch(e) {}
}

// ── CELEBRATION CARD ───────────────────────────────────────────────
var MSGS = [
  {e:'🎉',h:'Message ready!',s:'Your fingers thank you.'},
  {e:'⚡',h:'Lightning fast!',s:'Zero typos, zero stress.'},
  {e:'🚀',h:'Message launched!',s:'That took one keystroke.'},
  {e:'🏆',h:'Champion move!',s:'TextBlaze who? You don\'t need them.'},
  {e:'✨',h:'Perfectly crafted!',s:'Copy, switch, paste. Done.'},
  {e:'⏱️',h:'Time saved!',s:'Spend it on something better.'},
  {e:'💪',h:'Like a pro!',s:'Your customers will notice.'},
  {e:'🎯',h:'Bullseye!',s:'Right message, right person, right now.'}
];

function showCelebration(text, onConfirm, onUndo) {
  ['sb-celebrate','sb-cel-bd'].forEach(function(id){ var e=document.getElementById(id); if(e)e.remove(); });

  var secs     = Math.max(2, Math.round((text||'').trim().length / 3.3));
  var words    = (text||'').trim().split(/\s+/).length;
  var humanW   = Math.max(1, Math.round(words * 0.15));
  var machineW = words - humanW;
  var machPct  = Math.round(machineW / Math.max(words,1) * 100);
  var humPct   = 100 - machPct;
  var msg = MSGS[Math.floor(Math.random() * MSGS.length)];

  var bd = document.createElement('div');
  bd.id = 'sb-cel-bd';
  bd.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2147483646;';

  var card = document.createElement('div');
  card.id = 'sb-celebrate';
  card.style.cssText =
    'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
    'z-index:2147483647;width:320px;max-width:92vw;' +
    'background:#fff;border-radius:20px;padding:26px 22px;text-align:center;' +
    'box-shadow:0 24px 80px rgba(0,0,0,.22);' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
    'animation:sbCardIn .3s cubic-bezier(.34,1.56,.64,1) forwards;';

  var canUndo    = typeof onUndo === 'function';
  var undoRowHtml = canUndo
    ? '<div style="display:flex;align-items:center;gap:8px;margin-top:8px">' +
        '<button id="sb-cel-undo" style="flex-shrink:0;padding:5px 12px;background:transparent;border:1.5px solid #BED0FF;border-radius:7px;font-size:12px;font-weight:600;color:#1B4FD8;cursor:pointer;font-family:inherit">&#8617; Undo</button>' +
        '<div style="flex:1;height:3px;background:#E4E4E7;border-radius:99px;overflow:hidden">' +
          '<div id="sb-cel-bar" style="height:100%;background:#1B4FD8;border-radius:99px;width:100%"></div>' +
        '</div>' +
        '<span id="sb-cel-cd" style="flex-shrink:0;font-size:10px;color:#A1A1AA;min-width:12px;text-align:right">5</span>' +
      '</div>'
    : '';

  card.innerHTML =
    '<div style="font-size:46px;line-height:1;margin-bottom:9px">'+msg.e+'</div>'+
    '<div style="font-size:19px;font-weight:700;color:#18181B;margin-bottom:5px">'+msg.h+'</div>'+
    '<div style="font-size:12px;color:#52525B;margin-bottom:14px">'+msg.s+'</div>'+
    '<div style="display:inline-flex;align-items:center;gap:10px;background:linear-gradient(135deg,#EEF2FF,#E0EAFF);border:2px solid #BED0FF;border-radius:14px;padding:10px 20px;margin-bottom:14px">'+
      '<span style="font-size:30px;font-weight:800;color:#1B4FD8">'+secs+'</span>'+
      '<span><span style="font-size:12px;font-weight:700;color:#1B4FD8;display:block">seconds saved</span>'+
      '<span style="font-size:10px;color:#A1A1AA;display:block">vs typing from scratch</span></span>'+
    '</div>'+
    '<div style="display:flex;gap:8px;margin-bottom:10px">'+
      '<div style="flex:1;background:#EEF2FF;border:1.5px solid #BED0FF;border-radius:12px;padding:9px 6px;text-align:center">'+
        '<div style="font-size:16px">🧑</div>'+
        '<div style="font-size:8px;font-weight:700;color:#1B4FD8;text-transform:uppercase;letter-spacing:.08em;margin:2px 0">Human</div>'+
        '<div style="font-size:22px;font-weight:800;color:#1B4FD8">'+humanW+'</div>'+
        '<div style="font-size:9px;color:#A1A1AA">words</div>'+
      '</div>'+
      '<div style="flex:1;background:#f5f3ff;border:1.5px solid #c4b5fd;border-radius:12px;padding:9px 6px;text-align:center">'+
        '<div style="font-size:16px">🤖</div>'+
        '<div style="font-size:8px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.08em;margin:2px 0">Machine</div>'+
        '<div style="font-size:22px;font-weight:800;color:#7c3aed">'+machineW+'</div>'+
        '<div style="font-size:9px;color:#A1A1AA">words</div>'+
      '</div>'+
    '</div>'+
    '<div style="width:100%;height:6px;background:#F4F4F5;border-radius:20px;overflow:hidden;display:flex;margin-bottom:4px">'+
      '<div style="width:'+humPct+'%;background:#1B4FD8;border-radius:20px 0 0 20px"></div>'+
      '<div style="width:'+machPct+'%;background:#7c3aed"></div>'+
    '</div>'+
    '<div style="display:flex;justify-content:space-between;font-size:10px;color:#A1A1AA;margin-bottom:14px">'+
      '<span>'+humPct+'% you</span><span>'+machPct+'% Sprintbrain \ud83e\udd16</span>'+
    '</div>'+
    '<button id="sb-cel-ok" style="padding:9px 20px;background:#1B4FD8;border:none;border-radius:9px;font-size:13px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit;width:100%">Paste it now! \ud83d\udccb</button>'+
    undoRowHtml+
    '<div id="sb-cel-skip" style="margin-top:8px;font-size:11px;color:#A1A1AA;cursor:pointer">dismiss</div>';

  document.body.appendChild(bd);
  document.body.appendChild(card);

  var settled = false;
  var autoCloseTimer;
  var countdownIv;

  function dismiss() {
    if (settled) return;
    settled = true;
    clearTimeout(autoCloseTimer);
    clearInterval(countdownIv);
    var c=document.getElementById('sb-celebrate'); if(c)c.remove();
    var b=document.getElementById('sb-cel-bd');    if(b)b.remove();
  }

  function confirm() {
    if (settled) return;
    dismiss();
    if (typeof onConfirm === 'function') onConfirm();
  }

  function undo() {
    if (settled) return;
    dismiss();
    if (typeof onUndo === 'function') onUndo();
  }

  var okBtn   = document.getElementById('sb-cel-ok');
  var skipBtn = document.getElementById('sb-cel-skip');
  var undoBtn = document.getElementById('sb-cel-undo');
  if (okBtn)   okBtn.addEventListener('click',  confirm);
  if (skipBtn) skipBtn.addEventListener('click', confirm);
  if (undoBtn) undoBtn.addEventListener('click', undo);
  bd.addEventListener('click', confirm);

  if (canUndo) {
    var barEl = document.getElementById('sb-cel-bar');
    var cdEl  = document.getElementById('sb-cel-cd');
    var t0    = Date.now();
    countdownIv = setInterval(function() {
      var elapsed = Date.now() - t0;
      var pct = Math.max(0, (1 - elapsed / 5000) * 100);
      if (barEl) barEl.style.width = pct + '%';
      if (cdEl)  cdEl.textContent  = Math.max(0, Math.ceil((5000 - elapsed) / 1000));
    }, 100);
  }

  autoCloseTimer = setTimeout(confirm, 5000);
  launchConfetti();
}

// ── INLINE TRIGGER PICKER ──────────────────────────────────────────
var triggerPickerEl       = null;
var triggerPickerMode     = null; // 'snippet' | 'prompt'
var triggerPickerTarget   = null;
var triggerPickerIdx      = 0;
var triggerPickerQuery    = '';   // chars typed after trigger opens picker
var triggerPickerFiltered = [];   // currently visible (filtered) items
var triggerPickerDeleteLen = 0;   // total chars in field to delete on confirm
// Typing slowly opens the menu before the shortcut is finished, and from then on
// the menu owns the keystrokes — so the unique-prefix rule has to hold here too,
// or the same "::neo" expands by itself when typed fast and waits for Tab when
// typed slowly. Same settle window, same rule, one behaviour.
var pickerAutoTimer = null;
                                  // (trigger sequence + every char typed while picker open)

// Get pixel coords of the text cursor — used to position the picker.
// IMPORTANT: must not mutate the DOM or the live Selection, otherwise the
// cursor shifts (typically to the previous line) before the picker appears
// and subsequent insertions land at the wrong position.
function _getCaretCoords(el) {
  // A focused <textarea>/<input> keeps its caret in its own internal model:
  // window.getSelection() reports a position in the DOCUMENT (BODY), so Method 1
  // measures a 0x0 rect and Method 2 runs — and its span insertion mutates the
  // DOM, which resets the field's caret to 0. Everything typed after the picker
  // opened then landed at the START of the message, and the delete span on
  // insert took the wrong characters with it. Anchor these fields to their own
  // box: nothing about the page DOM is touched.
  if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
    var box = el.getBoundingClientRect();
    return { x: box.left, y: box.bottom };
  }
  // Method 1: getBoundingClientRect() on a collapsed Range — zero DOM mutations.
  // A collapsed range in Chrome returns the caret rect (width:0, height:lineHeight).
  try {
    var sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      var range = sel.getRangeAt(0).cloneRange();
      range.collapse(true);
      var rect = range.getBoundingClientRect();
      if (rect && rect.height > 0) {
        return { x: rect.left, y: rect.bottom };
      }
    }
  } catch(e) {}
  // Method 2: Span-insertion fallback (rare edge cases where Method 1 returns
  // a zero-height rect). Snapshots the selection endpoints before the DOM
  // mutation and restores them afterward so the cursor never drifts.
  try {
    var sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      var liveRange   = sel.getRangeAt(0);
      var startNode   = liveRange.startContainer;
      var startOff    = liveRange.startOffset;
      var endNode     = liveRange.endContainer;
      var endOff      = liveRange.endOffset;
      var insertRange = liveRange.cloneRange();
      insertRange.collapse(true);
      var span = document.createElement('span');
      span.textContent = '\u200b'; // zero-width space
      insertRange.insertNode(span);
      var rect = span.getBoundingClientRect();
      if (span.parentNode) span.parentNode.removeChild(span);
      // Restore original selection to undo the cursor shift caused by insertNode
      try {
        var restored = document.createRange();
        restored.setStart(startNode, startOff);
        restored.setEnd(endNode, endOff);
        sel.removeAllRanges();
        sel.addRange(restored);
      } catch(re) {}
      if (rect && (rect.width > 0 || rect.height > 0)) {
        return { x: rect.left, y: rect.bottom };
      }
    }
  } catch(e) {}
  // Method 3: Fallback — bottom-left of the element
  var elRect = el.getBoundingClientRect();
  return { x: elRect.left, y: elRect.bottom };
}

// Render a shortcut as the canonical `.sctag`: dim the leading trigger prefix
// (e.g. "::") to 0.45 opacity, body at full weight, azure mono — matches the
// harmonized mockup's shortcut-tag pattern.
function _scTag(sc) {
  var s = String(sc == null ? '' : sc);
  var m = s.match(/^([^0-9A-Za-z]+)([\s\S]*)$/);
  var pfx  = xesc(m ? m[1] : '');
  var body = xesc(m ? m[2] : s);
  return '<span style="margin-left:auto;flex:0 0 auto;font-family:\'SF Mono\',\'Cascadia Code\',\'JetBrains Mono\',ui-monospace,Menlo,Consolas,monospace;font-size:12px;font-weight:600;color:#1B4FD8;letter-spacing:.2px;white-space:nowrap">'
    + (pfx ? '<span style="opacity:.45;font-weight:400">' + pfx + '</span>' : '')
    + body
    + '</span>';
}

// Re-render picker items filtered by query string
function _renderPickerItems(query) {
  if (!triggerPickerEl) return;
  var allItems = triggerPickerMode === 'snippet' ? snippets : promptTemplates();
  var q = (query || '').toLowerCase();
  var filtered = q
    ? allItems.filter(function(s) {
        if ((s.title    || '').toLowerCase().indexOf(q) > -1) return true;
        if ((s.shortcut || '').toLowerCase().indexOf(q) > -1) return true;
        var aqs = Array.isArray(s.alternative_queries) ? s.alternative_queries : [];
        for (var ai = 0; ai < aqs.length; ai++) {
          if ((aqs[ai] || '').toLowerCase().indexOf(q) > -1) return true;
        }
        return false;
      })
    : allItems.slice();

  if (triggerPickerMode === 'snippet') {
    var seen = {};
    var deduped = [];
    for (var di = 0; di < filtered.length; di++) {
      var s = filtered[di];
      var base = (s.shortcut || '').replace(LANG_SUFFIX_RE, '');
      var gid  = s.lang_group_id || null;
      var key  = gid ? ('g:' + gid) : ('b:' + base.toLowerCase());
      if (seen[key] !== undefined) {
        if (!LANG_SUFFIX_RE.test(s.shortcut || '')) {
          deduped[seen[key]] = s;
        }
        continue;
      }
      seen[key] = deduped.length;
      deduped.push(s);
    }
    filtered = deduped;
  }
  triggerPickerFiltered = filtered;

  var itemsEl = triggerPickerEl.querySelector('.sb-tp-items');
  if (!itemsEl) return;

  var h = '';
  for (var i = 0; i < triggerPickerFiltered.length; i++) {
    var item = triggerPickerFiltered[i];
    // Divider at the base->dashboard boundary. Non-selectable (not .sb-tp-item),
    // so it never enters nav/highlight/click — those query .sb-tp-item only.
    if (i > 0 && item._group === 'list' && triggerPickerFiltered[i - 1]._group === 'base') {
      h += '<div class="sb-tp-sep" style="margin:5px 4px 2px;padding:7px 8px 3px;border-top:1px solid #E4E4E7;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#A1A1AA;">My prompt base</div>';
    }
    // Shortcut badge for BOTH snippets and prompts (when present) — surfaces the
    // prompt's direct-expansion shortcut in the browser so users learn it. Base
    // Prompts carry no shortcut, so they show none.
    var sc = item.shortcut
      ? _scTag(item.shortcut)
      : '';
    h += '<div class="sb-tp-item" data-idx="' + i + '" style="display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:pointer;font-size:14px;font-weight:500;color:#18181B;line-height:1.3;'
      + (i === 0 ? 'background:#EEF2FF;' : '') + '">'
      + '<span style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + xesc(item.title) + '</span>' + sc
      + '</div>';
  }
  if (!triggerPickerFiltered.length) {
    // An empty library and a query that matched nothing are different problems,
    // and the signed-out case is the common one: say what to do about it.
    var emptyMsg = 'No matches';
    if (!allItems.length) {
      emptyMsg = hasSession
        ? 'No snippets yet. Create one in the dashboard.'
        : 'Sign in from the SprintBrain toolbar icon to load your snippets.';
    }
    h = '<div style="padding:16px 12px;font-size:13px;color:#A1A1AA;text-align:center;line-height:1.45">'
      + xesc(emptyMsg) + '</div>';
  }
  itemsEl.innerHTML = h;
  triggerPickerIdx = 0;

  itemsEl.querySelectorAll('.sb-tp-item').forEach(function(itemEl) {
    function onPickerSelect(e) {
      e.preventDefault();
      var now = Date.now();
      if (onPickerSelect._last && now - onPickerSelect._last < 400) return;
      onPickerSelect._last = now;
      selectTriggerItem(parseInt(itemEl.dataset.idx));
    }
    itemEl.addEventListener('mousedown', onPickerSelect);
    itemEl.addEventListener('touchstart', onPickerSelect, {passive: false});
  });
}


function showTriggerPicker(el, mode, seqLen, filterStr) {
  if (processing) return;
  closeTriggerPicker();
  triggerPickerTarget = el;
  triggerPickerMode   = mode;
  triggerPickerIdx    = 0;
  triggerPickerQuery  = filterStr || '';
  // NON-DESTRUCTIVE: we leave the user's typed text in the field. The picker
  // is a suggestion preview; deletion + insertion only happens on explicit
  // confirm (Tab / Enter / click). The field content remains visible and
  // editable while the picker is open.
  triggerPickerDeleteLen = seqLen || 0;

  var div = document.createElement('div');
  div.id = 'sb-trigger-picker';
  div.style.cssText = 'position:fixed;z-index:2147483647;display:flex;flex-direction:column;background:#fff;border:1px solid #E4E4E7;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.12),0 2px 8px rgba(0,0,0,.06);min-width:260px;max-width:360px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",system-ui,sans-serif;';

  var header = '<div style="flex:0 0 auto;padding:9px 14px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#A1A1AA;border-bottom:1px solid #E4E4E7;display:flex;align-items:center;gap:8px">';
  header += '<span>' + (mode === 'snippet' ? '\u26a1 Insert snippet' : '\ud83e\udd16 Prompt mode \u00b7 ' + xesc(triggerCfg.promptTrigger || '"""')) + '</span>';
  header += '<span style="margin-left:auto;font-weight:500;text-transform:none;letter-spacing:0;color:#A1A1AA;font-size:10px">Tab / Enter to insert</span>';
  header += '</div>';
  header += '<div class="sb-tp-items" style="flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:6px;"></div>';
  div.innerHTML = header;

  // Position at caret, keep inside viewport
  var coords = _getCaretCoords(el);
  var left = Math.max(4, Math.min(coords.x, window.innerWidth - 360));
  var top  = coords.y + 4;
  var spaceBelow = window.innerHeight - top - 20;
  if (spaceBelow < 160) {
    // Flip above cursor
    top = Math.max(4, coords.y - 4 - 320);
    spaceBelow = 320;
  }
  div.style.left      = left + 'px';
  div.style.top       = top  + 'px';
  div.style.maxHeight = Math.min(380, Math.max(160, spaceBelow)) + 'px';

  document.body.appendChild(div);
  triggerPickerEl = div;
  _renderPickerItems(triggerPickerQuery);
}

function selectTriggerItem(idx) {
  if (idx < 0 || idx >= triggerPickerFiltered.length) return;
  var item  = triggerPickerFiltered[idx];
  var el    = triggerPickerTarget;
  var mode  = triggerPickerMode;
  // Full delete span: the trigger sequence (::) + everything typed since.
  // Captured BEFORE closeTriggerPicker resets state.
  var dLen  = triggerPickerDeleteLen || 0;
  closeTriggerPicker();
  if (!el) return;
  dLen = _fieldTriggerSpan(el, dLen);

  // Multi-language detection: if the selected snippet has sibling translations,
  // show the language picker modal instead of inserting directly. The modal
  // re-enters through handleMatch() which handles deletion + the full insertion
  // pipeline (placeholders, formulas, fields, urgency, celebration).
  if (mode === 'snippet') {
    var variantsMap = _findLangVariants(item);
    if (Object.keys(variantsMap).length > 1) {
      // Same fix as in checkBuf(): pass the full delete length through to
      // handleMatch instead of pre-deleting. The CE selection set by
      // deleteChars would be wiped when the modal grabs focus, leaving the
      // trigger string in the field after the user picks a language.
      processing = true;
      injectLangModal(variantsMap, el, dLen);
      return;
    }
  }

  var fieldSnapshot = captureFieldState(el, dLen);

  function doInsert() {
    if (mode === 'snippet') {
      var fields = extractFields(item.body);
      processing = true;
      if (!fields.length) {
        if (isUrgExpired(item)) { processing = false; return; }
        var text = resolveBody(item.body, {}, { lang: item.lang });
        var _isCE2 = el && (el.isContentEditable || (el.getAttribute &&
          (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '')));
        if (_isCE2) {
          // Same sync-insert fix as _proceedInsert: insert while selection is live.
          insertText(el, text);
          fieldSnapshot.syncInserted = true;
          fieldSnapshot.endCharOffset = _ceCaretCharOffset(_ceHost(el));
          fieldSnapshot.visibleLen = String(text).replace(/[\r\n]/g, '').length;
          showCelebration(
            text,
            function onConfirm() {     // timer expired or user clicked OK
              logEvent(item, 0);
              processing = false;
            },
            function onUndo() {        // user clicked Undo
              restoreFieldState(fieldSnapshot);
              processing = false;
            }
          );
        } else {
          // Non-CE: trigger already stripped; defer insertion to onConfirm.
          showCelebration(
            text,
            function onConfirm() {     // timer expired or user clicked OK
              insertText(el, text);
              logEvent(item, 0);
              processing = false;
            },
            function onUndo() {        // user clicked Undo — never insert
              restoreFieldState(fieldSnapshot);
              processing = false;
            }
          );
        }
      } else {
        showOverlay(el, item, fields, dLen, function() { processing = false; });
      }
    } else {
      insertText(el, item.body || '');
      logEvent(item, 0);
    }
  }

  // Delete the trigger + typed filter from the field, then insert the snippet.
  // This is the ONLY place deletion happens — opening the picker no longer
  // touches the field, so the user keeps seeing what they type.
  if (dLen > 0) {
    deleteChars(el, dLen, function() { doInsert(); });
  } else {
    doInsert();
  }
}

function closeTriggerPicker() {
  if (triggerPickerEl) { triggerPickerEl.remove(); triggerPickerEl = null; }
  triggerPickerMode      = null;
  triggerPickerTarget    = null;
  triggerPickerIdx       = 0;
  triggerPickerQuery     = '';
  triggerPickerFiltered  = [];
  triggerPickerDeleteLen = 0;
  if (pickerAutoTimer) { clearTimeout(pickerAutoTimer); pickerAutoTimer = null; }
  triggerPending = false;
  triggerPendingMode = null;
  triggerAffix = '';
  if (triggerDebounceTimer) { clearTimeout(triggerDebounceTimer); triggerDebounceTimer = null; }
}

// Index within triggerPickerFiltered of a prompt whose shortcut EXACTLY equals
// the typed query (case-insensitive), else -1. Drives the prompt trigger's
// direct expansion: typing """ + a prompt's shortcut fires it straight away —
// the prompt-trigger analog of a snippet's ::shortcut. Base Prompts have no
// shortcut, so they never match here and stay menu-only.
function _promptShortcutExactIdx(query) {
  var q = String(query == null ? '' : query).trim().toLowerCase();
  if (!q) return -1;
  for (var i = 0; i < triggerPickerFiltered.length; i++) {
    var sc = String(triggerPickerFiltered[i].shortcut || '').trim().toLowerCase();
    if (sc && sc === q) return i;
  }
  return -1;
}

function handleTriggerPickerKey(e) {
  if (!triggerPickerEl) return false;
  var count = triggerPickerFiltered.length;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    triggerPickerIdx = Math.min(triggerPickerIdx + 1, count - 1);
    updateTriggerPickerHighlight();
    return true;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    triggerPickerIdx = Math.max(triggerPickerIdx - 1, 0);
    updateTriggerPickerHighlight();
    return true;
  }
  if (e.key === 'Tab' || e.key === 'Enter') {
    // Only confirm if there are filtered matches; otherwise let Tab/Enter
    // pass through so the user isn't trapped when their query matches nothing.
    if (count > 0) {
      e.preventDefault();
      selectTriggerItem(triggerPickerIdx);
      return true;
    }
    closeTriggerPicker();
    return false;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    closeTriggerPicker();
    return true;
  }
  // Space closes the picker without inserting — keeps whatever the user
  // typed in the field as normal text, then the space flows through.
  if (e.key === ' ') {
    closeTriggerPicker();
    return false;
  }
  // Printable char — append to query, re-filter, track the extra char as
  // part of the delete-on-confirm span. Let the char reach the field too.
  if (e.key.length === 1) {
    triggerPickerQuery += e.key;
    triggerPickerDeleteLen += 1;
    _renderPickerItems(triggerPickerQuery);
    // Prompt shortcut → direct expansion: typing a prompt's exact shortcut after
    // the prompt trigger ("""foo) fires it immediately — the analog of a
    // snippet's ::shortcut. Deferred one tick so the just-typed char lands in the
    // field first, keeping the delete span aligned with what's on screen. The
    // menu stays open for browsing, Base Prompts, and partial matches.
    if (triggerPickerMode === 'prompt') {
      setTimeout(function() {
        if (!triggerPickerEl || triggerPickerMode !== 'prompt') return;
        var idx = _promptShortcutExactIdx(triggerPickerQuery);
        if (idx > -1) selectTriggerItem(idx);
      }, 0);
    }
    // Snippets: once the typed letters leave a single row standing, that row is
    // the snippet — expand it when typing settles, exactly as a prefix typed too
    // fast for the menu to open would have. Requires a genuine prefix match, so
    // a query that merely appears inside one title still waits for Tab.
    if (triggerPickerMode === 'snippet') {
      if (pickerAutoTimer) clearTimeout(pickerAutoTimer);
      pickerAutoTimer = setTimeout(function() {
        pickerAutoTimer = null;
        if (!triggerPickerEl || triggerPickerMode !== 'snippet') return;
        if (triggerPickerQuery.length < MIN_PREFIX_CHARS) return;
        if (triggerPickerFiltered.length !== 1) return;
        var seq = (triggerCfg && triggerCfg.snippetTrigger) || '::';
        if (!_uniquePrefixSnippet(triggerPickerQuery, seq)) return;
        selectTriggerItem(0);
      }, MATCH_SETTLE_MS);
    }
    // Return true to short-circuit the main keydown handler so the keystroke
    // isn't accidentally appended to the shortcut buffer (which could match
    // a different snippet while the picker is open).
    return true;
  }
  // Backspace — shrink query, shrink delete span, let backspace go into field
  if (e.key === 'Backspace') {
    if (triggerPickerQuery.length > 0) {
      // Deleting is the user disagreeing with the menu — never auto-expand into
      // a correction they are still making.
      if (pickerAutoTimer) { clearTimeout(pickerAutoTimer); pickerAutoTimer = null; }
      triggerPickerQuery = triggerPickerQuery.slice(0, -1);
      triggerPickerDeleteLen = Math.max(0, triggerPickerDeleteLen - 1);
      _renderPickerItems(triggerPickerQuery);
      return true;
    }
    // Nothing left in the query — close, but let the backspace through so
    // the user can keep deleting their trigger sequence normally.
    closeTriggerPicker();
    return false;
  }
  return false;
}

function updateTriggerPickerHighlight() {
  if (!triggerPickerEl) return;
  var items = triggerPickerEl.querySelectorAll('.sb-tp-item');
  for (var i = 0; i < items.length; i++) {
    items[i].style.background = i === triggerPickerIdx ? '#EEF2FF' : '';
  }
  if (items[triggerPickerIdx]) {
    items[triggerPickerIdx].scrollIntoView({ block: 'nearest' });
  }
}

// ── SELECTION-TRIGGERED SUGGESTION MENU ───────────────────────────
// A floating, selection-anchored menu that surfaces snippets mapped to
// keywords found inside the user's current selection. Distinct state from the
// typed-trigger picker (showTriggerPicker) because the behaviour differs: this
// menu has no live-typed filter and, on pick, REPLACES the selection rather than
// deleting a trigger sequence behind the caret.
var selSuggestEl     = null;   // the floating menu element (null when closed)
var selSuggestItems  = [];     // snippet objects currently shown
var selSuggestIdx    = 0;      // keyboard-highlighted row
var selSuggestTarget = null;   // editable host the selection lives in
var selSuggestTimer  = null;   // 200ms debounce timer (per ticket)
var SEL_SUGGEST_DEBOUNCE_MS = 200;
var SEL_SUGGEST_MAX_LEN     = 300;  // ignore very large selections (perf)

// Resolve a configured snippetId to a LIVE snippet object. Matches by `id`
// first (default snippets), then by shortcut base stripped of its trigger
// prefix (Supabase-synced snippets keep shortcuts like "/quoteEN"). Returns
// null when no current snippet matches, so retired mappings simply don't show.
function _resolveSnippetRef(ref) {
  var needle = String(ref || '').toLowerCase();
  if (!needle) return null;
  var i;
  for (i = 0; i < snippets.length; i++) {
    if ((snippets[i].id || '').toLowerCase() === needle) return snippets[i];
  }
  for (i = 0; i < snippets.length; i++) {
    var sc = (snippets[i].shortcut || '').toLowerCase().replace(/^[^a-z0-9]+/, '');
    if (sc === needle) return snippets[i];
  }
  return null;
}

// Pure keyword matcher: returns the resolved, de-duplicated snippet objects
// whose trigger keywords appear in `selText`.
//
// Two-pass approach (ALTERNATIVE-QUERIES-001):
//   Pass 1 — live alternative_queries on each snippet (dynamic, user-configurable).
//   Pass 2 — hardcoded SELECTION_TRIGGERS legacy fallback for snippets that
//             pre-date the alternative_queries field or haven't been updated yet.
//
// Both passes share lang-group-aware deduplication: once any variant of a
// lang group is added to refs, all sibling variants are suppressed in both
// passes. _dedupByLangBase then collapses the final list to one entry per
// group so the multi-language modal fires correctly at expansion time.
function matchSelectionTriggers(selText) {
  if (!selText) return [];
  var lower = selText.toLowerCase();
  var tokenSet = {};
  var toks = lower.split(/[^a-z0-9à-ÿ]+/i);
  for (var t = 0; t < toks.length; t++) { if (toks[t]) tokenSet[toks[t]] = true; }

  var refs = [], seenId = {}, seenGroup = {};

  function _addToRefs(snip) {
    if (seenId[snip.id]) return;
    var lgid = snip.lang_group_id || snip.id;
    if (seenGroup[lgid]) return; // sibling variant already covers this group
    seenId[snip.id] = true;
    seenGroup[lgid] = true;
    refs.push(snip);
  }

  // Pass 1: live alternative_queries — supersedes the hardcoded map for any
  // snippet that has been assigned at least one alternative query.
  for (var i = 0; i < snippets.length; i++) {
    var snip = snippets[i];
    var aqs = Array.isArray(snip.alternative_queries) ? snip.alternative_queries : [];
    if (!aqs.length) continue;
    var hit = false;
    for (var qi = 0; qi < aqs.length; qi++) {
      var kw = (aqs[qi] || '').trim().toLowerCase();
      if (!kw) continue;
      if (kw.indexOf(' ') > -1) { if (lower.indexOf(kw) > -1) { hit = true; break; } }
      else if (tokenSet[kw]) { hit = true; break; }
    }
    if (hit) _addToRefs(snip);
  }

  // Pass 2: hardcoded SELECTION_TRIGGERS legacy fallback.
  // Skipped for any lang group already surfaced in pass 1.
  for (var r = 0; r < SELECTION_TRIGGERS.length; r++) {
    var rule = SELECTION_TRIGGERS[r];
    var rHit = false;
    for (var k = 0; k < rule.keywords.length; k++) {
      var rkw = rule.keywords[k].toLowerCase();
      if (rkw.indexOf(' ') > -1) { if (lower.indexOf(rkw) > -1) { rHit = true; break; } }
      else if (tokenSet[rkw]) { rHit = true; break; }
    }
    if (!rHit) continue;
    for (var s = 0; s < rule.snippetIds.length; s++) {
      var resolved = _resolveSnippetRef(rule.snippetIds[s]);
      if (resolved) _addToRefs(resolved);
    }
  }

  return _dedupByLangBase(refs);
}

// Collapse sibling language variants (quoteEN/quoteES/quoteIT) into a single
// row — the language picker modal handles the per-language choice on insert.
function _dedupByLangBase(list) {
  var seen = {}, out = [];
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    var base = (s.shortcut || s.id || '').replace(LANG_SUFFIX_RE, '');
    var gid  = s.lang_group_id || null;
    var key  = gid ? ('g:' + gid) : ('b:' + base.toLowerCase());
    if (seen[key] !== undefined) {
      if (!LANG_SUFFIX_RE.test(s.shortcut || '')) out[seen[key]] = s;
      continue;
    }
    seen[key] = out.length;
    out.push(s);
  }
  return out;
}

// Is `node` inside one of our own injected UI surfaces? Used to ignore
// selections made within the menus/overlays themselves.
function _isInsideSbUi(node) {
  var ids = { 'sb-overlay':1, 'sb-celebrate':1, 'sb-trigger-picker':1,
              'sb-sel-suggest':1, 'sb-modal-host':1, 'sb-lang-modal-host':1 };
  var n = node;
  while (n) {
    if (n.id && ids[n.id]) return true;
    n = n.parentNode || n.host;
  }
  return false;
}

// Climb to the editable host (input/textarea/contenteditable) containing `node`.
function _selEditableHost(node) {
  var n = node;
  for (var i = 0; n && i < 10; i++) {
    if (n.nodeType === 1) {
      if (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA') return n;
      var a = n.getAttribute && n.getAttribute('contenteditable');
      if (n.isContentEditable || a === 'true' || a === '') return n;
    }
    n = n.parentNode || n.host;
  }
  return null;
}

// Pixel coords of the selection's bounding rect (bottom-left), for anchoring.
function _getSelectionRectCoords(el) {
  try {
    var sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      var rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect && (rect.width > 0 || rect.height > 0)) {
        return { x: rect.left, y: rect.bottom, top: rect.top };
      }
    }
  } catch (e) {}
  var er = (el && el.getBoundingClientRect) ? el.getBoundingClientRect() : { left: 8, bottom: 40, top: 20 };
  return { x: er.left, y: er.bottom, top: er.top };
}

// Place a fixed-position floating menu near `coords`, clamped to the viewport,
// flipping above the anchor when there isn't room below.
function _positionFloatingMenu(div, coords, maxW) {
  var w = maxW || 360;
  var left = Math.max(4, Math.min(coords.x, window.innerWidth - w));
  var top  = coords.y + 6;
  var spaceBelow = window.innerHeight - top - 20;
  if (spaceBelow < 160) {
    top = Math.max(4, (coords.top != null ? coords.top : coords.y) - 6 - 320);
    spaceBelow = 320;
  }
  div.style.left      = left + 'px';
  div.style.top       = top  + 'px';
  div.style.maxHeight = Math.min(380, Math.max(160, spaceBelow)) + 'px';
}

function showSelectionSuggestions(el, matches) {
  closeSelSuggest();
  if (!matches || !matches.length) return;
  selSuggestTarget = el;
  selSuggestItems  = matches;
  selSuggestIdx    = 0;

  var div = document.createElement('div');
  div.id = 'sb-sel-suggest';
  div.style.cssText = 'position:fixed;z-index:2147483647;display:flex;flex-direction:column;background:#fff;border:1px solid #E4E4E7;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.12),0 2px 8px rgba(0,0,0,.06);min-width:260px;max-width:360px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",system-ui,sans-serif;';

  var header = '<div style="flex:0 0 auto;padding:9px 14px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#A1A1AA;border-bottom:1px solid #E4E4E7;display:flex;align-items:center;gap:8px">';
  header += '<span>✨ Suggested snippets</span>';
  header += '<span style="margin-left:auto;font-weight:500;text-transform:none;letter-spacing:0;color:#A1A1AA;font-size:10px">Enter to insert</span>';
  header += '</div>';
  header += '<div class="sb-ss-items" style="flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:6px;"></div>';
  div.innerHTML = header;

  _positionFloatingMenu(div, _getSelectionRectCoords(el), 360);
  document.body.appendChild(div);
  selSuggestEl = div;
  _renderSelSuggestItems();
}

function _renderSelSuggestItems() {
  if (!selSuggestEl) return;
  var itemsEl = selSuggestEl.querySelector('.sb-ss-items');
  if (!itemsEl) return;
  var h = '';
  for (var i = 0; i < selSuggestItems.length; i++) {
    var item = selSuggestItems[i];
    var sc = item.shortcut
      ? _scTag(item.shortcut)
      : '';
    h += '<div class="sb-ss-item" data-idx="' + i + '" style="display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:pointer;font-size:14px;font-weight:500;color:#18181B;line-height:1.3;'
      + (i === selSuggestIdx ? 'background:#EEF2FF;' : '') + '">'
      + '<span style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + xesc(item.title || item.shortcut || 'Snippet') + '</span>' + sc
      + '</div>';
  }
  itemsEl.innerHTML = h;

  itemsEl.querySelectorAll('.sb-ss-item').forEach(function(itemEl) {
    function onPick(e) {
      // preventDefault keeps focus + the live selection on the host field, so
      // _selectionToDeleteSpan() can still read/collapse it on insert.
      e.preventDefault();
      var now = Date.now();
      if (onPick._last && now - onPick._last < 400) return;
      onPick._last = now;
      selectSuggestionItem(parseInt(itemEl.dataset.idx, 10));
    }
    itemEl.addEventListener('mousedown', onPick);
    itemEl.addEventListener('touchstart', onPick, { passive: false });
    itemEl.addEventListener('mouseenter', function() {
      selSuggestIdx = parseInt(itemEl.dataset.idx, 10);
      _updateSelSuggestHighlight();
    });
  });
}

function _updateSelSuggestHighlight() {
  if (!selSuggestEl) return;
  var items = selSuggestEl.querySelectorAll('.sb-ss-item');
  for (var i = 0; i < items.length; i++) {
    items[i].style.background = i === selSuggestIdx ? '#EEF2FF' : '';
  }
  if (items[selSuggestIdx]) items[selSuggestIdx].scrollIntoView({ block: 'nearest' });
}

// Convert the live selection into the (caret-collapsed-at-end + backward-delete
// length) state the typed-trigger path produces, so handleMatch() can reuse the
// exact deletion+insertion pipeline. Returns the delete length, or null if the
// selection is gone/empty. MUST run while the selection is still live.
function _selectionToDeleteSpan(el) {
  if (!el) return null;
  var isCE = el.isContentEditable || (el.getAttribute &&
    (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === ''));
  try {
    if (isCE) {
      var sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
      var txt = sel.toString();
      sel.collapseToEnd();                       // caret now at end of selection
      var len = txt.replace(/\r?\n/g, '').length; // newlines aren't text-node chars
      return len > 0 ? len : null;
    }
    if (el.selectionStart == null || el.selectionEnd == null) return null;
    var span = el.selectionEnd - el.selectionStart;
    if (span <= 0) return null;
    el.setSelectionRange(el.selectionEnd, el.selectionEnd); // collapse to end
    return span;
  } catch (e) { return null; }
}

function selectSuggestionItem(idx) {
  if (idx < 0 || idx >= selSuggestItems.length) return;
  var item = selSuggestItems[idx];
  var el   = selSuggestTarget;
  // Capture/collapse the selection BEFORE closing the menu or opening any modal
  // (a modal steals focus and would wipe the selection).
  var span = _selectionToDeleteSpan(el);
  closeSelSuggest();
  if (!el || span == null) return;

  // Multi-language snippet → language picker first (same flow as the typed
  // trigger). injectLangModal re-enters handleMatch with the delete span.
  var variantsMap = _findLangVariants(item);
  if (Object.keys(variantsMap).length > 1) {
    processing = true;
    injectLangModal(variantsMap, el, span);
  } else {
    handleMatch(el, item, span);
  }
}

function closeSelSuggest() {
  if (selSuggestEl) { selSuggestEl.remove(); selSuggestEl = null; }
  selSuggestItems  = [];
  selSuggestIdx    = 0;
  selSuggestTarget = null;
}

function handleSelSuggestKey(e) {
  if (!selSuggestEl) return false;
  var count = selSuggestItems.length;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selSuggestIdx = Math.min(selSuggestIdx + 1, count - 1);
    _updateSelSuggestHighlight();
    return true;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    selSuggestIdx = Math.max(selSuggestIdx - 1, 0);
    _updateSelSuggestHighlight();
    return true;
  }
  if (e.key === 'Enter' || e.key === 'Tab') {
    if (count > 0) { e.preventDefault(); selectSuggestionItem(selSuggestIdx); return true; }
    closeSelSuggest();
    return false;
  }
  if (e.key === 'Escape') { e.preventDefault(); closeSelSuggest(); return true; }
  return false;
}

// Debounced evaluation of the current selection. Reads the selection from the
// focused form control (input/textarea) or the document selection (CE), then
// shows/hides the menu accordingly.
function evaluateSelectionForSuggest() {
  if (!selectionSuggestEnabled) { closeSelSuggest(); return; }
  // Don't compete with an in-progress expansion / open SprintBrain UI.
  if (processing || overlayEl || triggerPickerEl || triggerPending) return;

  var el = null, text = '';
  var ae = document.activeElement;

  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
    if (ae.tagName === 'INPUT') {
      var ty = (ae.type || 'text').toLowerCase();
      if (['text', 'search', 'url', 'email', 'tel', ''].indexOf(ty) === -1) { closeSelSuggest(); return; }
    }
    if (ae.selectionStart != null && ae.selectionEnd != null && ae.selectionEnd > ae.selectionStart) {
      el = ae;
      text = ae.value.substring(ae.selectionStart, ae.selectionEnd);
    }
  } else {
    var sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      var host = _selEditableHost(sel.getRangeAt(0).startContainer);
      if (host && !_isInsideSbUi(host)) { el = host; text = sel.toString(); }
    }
  }

  if (!el || !text) { closeSelSuggest(); return; }
  text = text.replace(/^\s+|\s+$/g, '');
  if (!text || text.length > SEL_SUGGEST_MAX_LEN) { closeSelSuggest(); return; }

  var matches = matchSelectionTriggers(text);
  if (!matches.length) { closeSelSuggest(); return; }

  showSelectionSuggestions(el, matches);
}

function scheduleSelectionEval() {
  if (!selectionSuggestEnabled) return;
  if (selSuggestTimer) clearTimeout(selSuggestTimer);
  selSuggestTimer = setTimeout(evaluateSelectionForSuggest, SEL_SUGGEST_DEBOUNCE_MS);
}

// mouseup/keyup cover selection in form controls (where `selectionchange` is
// inconsistent across Chrome versions); selectionchange covers contenteditable
// and keyboard/programmatic changes. All funnel through one debounced path.
document.addEventListener('mouseup', scheduleSelectionEval, true);
document.addEventListener('keyup', function(e) {
  // Only react to selection-affecting keys to avoid needless work on every key.
  if (e.shiftKey || e.key === 'ArrowLeft' || e.key === 'ArrowRight' ||
      e.key === 'ArrowUp' || e.key === 'ArrowDown' || (e.ctrlKey || e.metaKey)) {
    scheduleSelectionEval();
  }
}, true);
document.addEventListener('selectionchange', function() {
  var sel = window.getSelection();
  // Collapsed/empty selection closes the menu immediately (no debounce) so it
  // disappears the instant the user deselects.
  if (selSuggestEl && (!sel || sel.isCollapsed)) {
    var ae = document.activeElement;
    var formSel = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') &&
      ae.selectionStart != null && ae.selectionEnd > ae.selectionStart;
    if (!formSel) closeSelSuggest();
  }
  scheduleSelectionEval();
});

// Close picker on outside click/tap or page scroll
document.addEventListener('mousedown', function(e) {
  // The caret is about to move — an armed match would expand at the new spot.
  _cancelArmed();
  if (triggerPickerEl && !triggerPickerEl.contains(e.target)) {
    setTimeout(function() { closeTriggerPicker(); }, 100);
  }
  if (selSuggestEl && !selSuggestEl.contains(e.target)) {
    closeSelSuggest();
  }
});
document.addEventListener('touchstart', function(e) {
  if (triggerPickerEl && !triggerPickerEl.contains(e.target)) {
    setTimeout(function() { closeTriggerPicker(); }, 100);
  }
  if (selSuggestEl && !selSuggestEl.contains(e.target)) {
    closeSelSuggest();
  }
}, {passive: true});
document.addEventListener('scroll', function(e) {
  if (triggerPickerEl && triggerPickerEl.contains(e.target)) return;
  closeTriggerPicker();
  if (!(selSuggestEl && selSuggestEl.contains(e.target))) closeSelSuggest();
}, true);

// ── KEYBOARD LISTENER ──────────────────────────────────────────────
document.addEventListener('keydown', function(e) {
  // Handle the selection-suggestion menu first (arrow/enter/tab/esc nav)
  if (selSuggestEl && handleSelSuggestKey(e)) return;

  // Handle trigger picker keys next
  if (triggerPickerEl && handleTriggerPickerKey(e)) return;

  // Skip if overlay open
  if (overlayEl) return;

  var t = e.target;

  // Skip our own elements
  if (t && t.closest && t.closest('#sb-overlay')) return;
  if (t && t.closest && t.closest('#sb-celebrate')) return;

  // An armed match is one keystroke from expanding. Tab and Enter end the word,
  // so they confirm it immediately — the settle window only exists to catch a
  // longer word, and these two rule that out. Enter is consumed so a chat
  // composer sends the expanded message, never the raw trigger; press it again
  // to send. Editing and navigation keys mean the caret is moving away, so the
  // match is dropped. Printable characters are decided in checkBuf, once they
  // have actually landed in the field.
  if (armedMatch) {
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      _fireArmed(0);
      return;
    }
    if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'Delete' ||
        ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].indexOf(e.key) > -1) {
      _cancelArmed();
    }
  }

  // Cancel pending trigger on Escape
  if (triggerPending && e.key === 'Escape') {
    triggerPending = false;
    triggerPendingMode = null;
    triggerAffix = '';
    if (triggerDebounceTimer) { clearTimeout(triggerDebounceTimer); triggerDebounceTimer = null; }
    return;
  }

  // Handle special keys
  if (e.key === 'Backspace') { buf = buf.slice(0,-1); return; }
  if (e.key === 'Delete')    { buf = ''; return; }
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Enter','Tab'].indexOf(e.key) > -1) {
    buf = ''; return;
  }
  if (e.key.length !== 1) return;

  // Skip modifier-key combos (Ctrl+V, Cmd+V, etc.) — paste is handled separately
  if (e.ctrlKey || e.metaKey) return;

  // Skip if a paste is in progress
  if (isPasting) return;

  // Only track editable elements
  var editable = false;
  if (t) {
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') editable = true;
    else if (t.isContentEditable || t.getAttribute('contenteditable') === 'true' || t.getAttribute('contenteditable') === '') editable = true;
    else {
      // Walk up 6 levels for nested contenteditable (Claude, ChatGPT)
      var p = t;
      for (var i = 0; i < 6; i++) {
        p = p.parentElement;
        if (!p) break;
        if (p.isContentEditable || p.getAttribute('contenteditable') === 'true') { editable = true; break; }
      }
    }
  }
  if (!editable) return;

  activeEl = t;
  lastInputTime = Date.now(); // mark: keydown handled this char, input event should skip it
  addKey(e.key);
  setTimeout(checkBuf, 10);
}, true);

// ── PASTE GUARD ───────────────────────────────────────────────────
// Sets isPasting=true before paste characters reach the input event,
// preventing clipboard content from feeding the trigger buffer regardless
// of whether the browser populates InputEvent.inputType.
document.addEventListener('paste', function() {
  isPasting = true;
  _cancelArmed();
  buf = '';
  triggerPending = false;
  triggerPendingMode = null;
  triggerAffix = '';
  if (triggerDebounceTimer) { clearTimeout(triggerDebounceTimer); triggerDebounceTimer = null; }
  setTimeout(function() { isPasting = false; }, 50);
}, true);

// ── MOBILE INPUT LISTENER ─────────────────────────────────────────
// Soft keyboards (Android) fire `input` events instead of keydown with real keys.
// This listener is the primary trigger path on mobile; on desktop it is suppressed
// by the debounce guard (keydown already set lastInputTime within 50ms).
document.addEventListener('input', function(e) {
  if (overlayEl || triggerPickerEl) return;
  var t = e.target;
  if (!t) return;
  if (t.closest && (t.closest('#sb-overlay') || t.closest('#sb-celebrate'))) return;

  // Only handle text insertions, not deletions or composition commits
  var iType = e.inputType || '';
  if (iType && iType.indexOf('insert') === -1) return;

  // Clear buffer on paste/drop to prevent partial trigger matches
  if (isPasting || iType === 'insertFromPaste' || iType === 'insertFromDrop') {
    buf = '';
    return;
  }

  var data = e.data;
  if (!data || !data.length) return;

  // Debounce: if keydown fired within the last 50ms it already processed this char
  var now = Date.now();
  if (now - lastInputTime < 50) return;

  // Only editable targets
  var editable = false;
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') editable = true;
  else if (t.isContentEditable || t.getAttribute('contenteditable') === 'true' || t.getAttribute('contenteditable') === '') editable = true;
  else {
    var p = t;
    for (var i = 0; i < 6; i++) {
      p = p.parentElement; if (!p) break;
      if (p.isContentEditable || p.getAttribute('contenteditable') === 'true') { editable = true; break; }
    }
  }
  if (!editable) return;

  activeEl = t;
  lastInputTime = now;
  for (var i = 0; i < data.length; i++) addKey(data[i]);
  setTimeout(checkBuf, 10);
}, true);

// ── INJECT STYLES ─────────────────────────────────────────────────
(function() {
  if (document.getElementById('sb-styles')) return;
  var s = document.createElement('style');
  s.id = 'sb-styles';
  s.textContent =
    '#sb-overlay{background:#fff;border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",system-ui,sans-serif;font-size:13px;color:#18181B;}' +
    '#sb-overlay .sb-hdr{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#fff;border-bottom:1px solid #E4E4E7;}' +
    '#sb-overlay .sb-logo{font-weight:700;font-size:13px;color:#1B4FD8;}' +
    '#sb-overlay .sb-title{font-size:11px;color:#52525B;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
    '#sb-overlay .sb-close{background:transparent;border:none;cursor:pointer;font-size:16px;color:#A1A1AA;padding:0;line-height:1;min-width:44px;min-height:44px;display:flex;align-items:center;justify-content:center;touch-action:manipulation;}' +
    '#sb-overlay .sb-close:hover{color:#18181B;}' +
    '#sb-overlay .sb-fields{padding:12px 14px;display:flex;flex-direction:column;gap:8px;max-height:250px;overflow-y:auto;}' +
    '#sb-overlay .sb-field{display:flex;flex-direction:column;gap:3px;}' +
    '#sb-overlay .sb-lbl{font-size:9px;font-weight:700;color:#1B4FD8;text-transform:uppercase;letter-spacing:.08em;font-family:monospace;}' +
    // Inline sentence: the control sits in the prose that surrounds it in the
    // body. Wraps rather than overflowing, since the panel is only 420px.
    '#sb-overlay .sb-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap;}' +
    '#sb-overlay .sb-row .sb-inp{flex:1 1 130px;width:auto;min-width:0;}' +
    '#sb-overlay .sb-ctx{font-size:12px;color:#52525B;line-height:1.35;}' +
    '#sb-overlay .sb-ctxline{font-size:12px;color:#52525B;line-height:1.35;}' +
    '#sb-overlay .sb-inp{background:#F4F4F5;border:1px solid #E4E4E7;border-radius:8px;padding:7px 10px;font-size:16px;color:#18181B;font-family:inherit;outline:none;width:100%;box-sizing:border-box;touch-action:manipulation;transition:border-color .15s,box-shadow .15s;}' +
    '#sb-overlay .sb-inp:focus{border-color:#1B4FD8;background:#fff;box-shadow:0 0 0 3px rgba(27,79,216,.14);}' +
    '#sb-overlay .sb-inp[type=date],#sb-overlay .sb-inp[type=time],#sb-overlay .sb-inp[type=datetime-local]{color:#1B4FD8;border-color:#BED0FF;background:#EEF2FF;}' +
    '#sb-overlay select.sb-inp{-webkit-appearance:none;background-image:url(\'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="6"><path d="M0 0l5 6 5-6z" fill="%231B4FD8"/></svg>\');background-repeat:no-repeat;background-position:right 8px center;padding-right:26px;cursor:pointer;}' +
    '#sb-overlay .sb-btnrow{display:flex;flex-wrap:wrap;gap:6px;padding-top:2px;}' +
    '#sb-overlay .sb-actbtn{background:#EEF2FF;border:1px solid #BED0FF;border-radius:8px;padding:7px 12px;font-size:13px;font-weight:600;color:#1B4FD8;font-family:inherit;cursor:pointer;min-height:32px;touch-action:manipulation;transition:background .15s;}' +
    '#sb-overlay .sb-actbtn:hover{background:#E0EAFF;}' +
    '#sb-overlay .sb-actbtn:active{transform:scale(.97);}' +
    '#sb-overlay .sb-btnerr{color:#DC2626;font-size:11px;line-height:1.5;padding-top:2px;}' +
    '#sb-overlay .sb-multi{display:flex;flex-wrap:wrap;gap:6px;box-sizing:border-box;}' +
    '#sb-overlay .sb-opt{display:inline-flex;align-items:center;gap:6px;background:#F4F4F5;border:1px solid #E4E4E7;border-radius:8px;padding:6px 10px;font-size:13px;color:#18181B;cursor:pointer;min-height:32px;touch-action:manipulation;}' +
    '#sb-overlay .sb-opt:hover{border-color:#BED0FF;}' +
    '#sb-overlay .sb-opt input.sb-inp{width:auto;padding:0;margin:0;background:none;border:none;box-shadow:none;accent-color:#1B4FD8;cursor:pointer;min-height:0;}' +
    '#sb-overlay .sb-opt:has(input:checked){background:#EEF2FF;border-color:#BED0FF;color:#1B4FD8;}' +
    '#sb-overlay .sb-prev{margin:0 14px;padding:8px 10px;background:#F4F4F5;border:1px solid #E4E4E7;border-radius:8px;font-size:11px;color:#52525B;line-height:1.6;white-space:pre-wrap;max-height:70px;overflow:hidden;}' +
    '#sb-overlay .sb-foot{padding:10px 14px;border-top:1px solid #E4E4E7;display:flex;align-items:center;gap:8px;background:#FAFAFA;}' +
    '#sb-overlay .sb-insert{padding:8px 18px;background:#1B4FD8;border:none;border-radius:8px;font-size:13px;font-weight:600;color:#fff;cursor:pointer;font-family:inherit;min-height:44px;touch-action:manipulation;}' +
    '#sb-overlay .sb-insert:hover{background:#1440B0;}' +
    '#sb-overlay .sb-tip{font-size:10px;color:#A1A1AA;}' +
    '#sb-trigger-picker .sb-tp-item,#sb-sel-suggest .sb-ss-item{touch-action:manipulation;border-radius:8px;transition:background .12s ease;}' +
    '#sb-trigger-picker .sb-tp-item:hover,#sb-sel-suggest .sb-ss-item:hover{background:#F4F4F5;}' +
    '@keyframes sbCardIn{0%{opacity:0;transform:translate(-50%,-50%) scale(.75)}100%{opacity:1;transform:translate(-50%,-50%) scale(1)}}' +
    '@keyframes sbUrgPulse{0%,100%{box-shadow:0 0 0 0 rgba(217,57,0,.3)}50%{box-shadow:0 0 14px 3px rgba(217,57,0,.15)}}' +
    '@keyframes sbScBlink{0%,100%{opacity:1}50%{opacity:.3}}';
  document.head.appendChild(s);
})();



// ── CONTEXT MENU MESSAGE HANDLER ──────────────────────────────────
// Receives snippet from background.js when user clicks context menu
chrome.runtime.onMessage.addListener(function(msg) {
  if (msg.type !== 'SB_CONTEXT_INSERT') return;
  var snip = msg.snippet;
  if (!snip) return;

  var fields = extractFields(snip.body);
  var el = document.activeElement;

  // If no active editable element, try to find last focused one
  if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && !el.isContentEditable && el.getAttribute('contenteditable') !== 'true')) {
    // Walk up from body to find contenteditable
    var found = document.querySelector('[contenteditable="true"]:focus, textarea:focus, input:focus');
    if (found) el = found;
  }

  activeEl = el;

  var vars = parsePlaceholders(snip.body);
  if (vars.length > 0) {
    processing = true;
    injectDynamicModal(vars, function(varMap) {
      var newBody = interpolateSnippet(snip.body, varMap);
      var modSnip = {};
      for (var k in snip) modSnip[k] = snip[k];
      modSnip.body = newBody;
      _proceedContextInsert(el, modSnip);
    }, function() {
      processing = false;
    });
  } else {
    _proceedContextInsert(el, snip);
  }
});

function _proceedContextInsert(el, snip) {
  var fields = extractFields(snip.body);
  if (fields.length === 0) {
    if (isUrgExpired(snip)) { processing = false; return; }
    var text = resolveBody(snip.body, {}, { lang: snip.lang });
    var isCE = el && (el.isContentEditable || (el.getAttribute &&
      (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '')));
    var isValueField = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');

    if (isCE) {
      // Insert synchronously, then celebrate with Undo — same proven mechanism as
      // the trigger paths' CE sync-insert (see _proceedInsert): capture the inserted
      // region so restoreFieldState can Range-delete it. onUndo skips logEvent.
      var snapCE = captureFieldState(el, 0);
      insertText(el, text);
      snapCE.syncInserted  = true;
      snapCE.endCharOffset = _ceCaretCharOffset(_ceHost(el));
      snapCE.visibleLen    = String(text).replace(/[\r\n]/g, '').length;
      showCelebration(
        text,
        function onConfirm() { logEvent(snip, 0); processing = false; },
        function onUndo()    { restoreFieldState(snapCE); processing = false; }
      );
    } else if (isValueField) {
      // Textarea/input: the context menu inserts synchronously (no trigger to
      // defer), so Undo can't just "skip" insertion like the trigger paths —
      // snapshot the exact pre-insert value + caret and restore it on Undo.
      var snapVal = captureFieldState(el, 0);
      snapVal.syncInsertedValue = true;
      snapVal.prevValue    = el.value;
      snapVal.prevSelStart = el.selectionStart;
      snapVal.prevSelEnd   = el.selectionEnd;
      insertText(el, text);
      showCelebration(
        text,
        function onConfirm() { logEvent(snip, 0); processing = false; },
        function onUndo()    { restoreFieldState(snapVal); processing = false; }
      );
    } else {
      // No editable target — nothing meaningful was inserted; celebrate without Undo.
      if (el) insertText(el, text);
      showCelebration(text);
      logEvent(snip, 0);
      processing = false;
    }
  } else {
    processing = true;
    showOverlay(el, snip, fields, 0, function() { processing = false; });
  }
}

