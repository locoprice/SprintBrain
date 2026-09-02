// fill-form.js — the single source of truth for WHAT a fill form is.
//
// Four surfaces draw a fill form and each builds its own markup:
//
//   extension/content/content.js   the in-page overlay (three entry points)
//   extension/popup/popup.js       the popup detail + Sprintbrain.html detail
//   app/src/features/snippets/     the dashboard editor's live preview
//     SnippetPreview.tsx           (was Sprintbrain.html's composer until v3.5.0)
//   app/public/mobile/index.html   the mobile companion (inlined copy)
//
// They must keep their own markup: different CSS namespaces, different hosts,
// one of them a phone. What they must NOT keep is their own answer to "which
// fields are there, what kind is each, what words sit around it, what does the
// preview say". Every one of those was decided four times and had already
// drifted: the composer showed no surrounding prose and could not render a
// datetime at all, and only the overlay honoured a stored field_cfg or opened a
// date on today.
//
// So this module returns a VIEW MODEL and never a string of HTML. Renderers map
// it onto their own DOM. Adding a surface means writing markup, never
// re-deciding behaviour.
//
// `layout` and `steps` are computed here and ignored by every renderer today.
// They are the seam for a future automatic step mode: turning it on is a change
// to chooseLayout() in this file and nowhere else. It is deliberately not wired
// up, because the longest form in the library is three fields.
(function(root) {
  'use strict';

  // The engine is the parser; this module is the decision layer above it.
  // Node (the gates) requires it; every browser surface has already loaded it.
  var FE = null;
  if (typeof module !== 'undefined' && module.exports) {
    FE = require('../formula-engine.js');
  }
  // A surface may supply its own engine as root.SBFillFormEngine. The mobile
  // companion is a single-file app that cannot load extension/formula-engine.js,
  // so it keeps its own parser and adapts it to this interface. Every other
  // surface has the real engine on the page already.
  function engine() {
    return FE || root.SBFillFormEngine || root.SBFormulaEngine || null;
  }

  // Fields per form before a step layout would earn its place. Nothing reads
  // this yet: chooseLayout always answers 'flat'. It sits next to the rule it
  // will govern so the future change is one obvious place.
  var STEP_THRESHOLD = 6;

  function trim(s) {
    return String(s === null || s === undefined ? '' : s).replace(/^\s+|\s+$/g, '');
  }

  // A field's kind when its token declared none. Split on non-letters so
  // "TIME_HH:MM" and "DATE_DD/MM/YYYY" still expose TIME / DATE as whole words.
  // This lived only in content.js, so {CHECKIN_DATE} was a date picker in the
  // overlay and a plain text box on the other three surfaces.
  function inferType(key) {
    var toks = String(key).toUpperCase().split(/[^A-Z]+/);
    if (toks.indexOf('DATETIME') >= 0) return 'datetime';
    if (toks.indexOf('DATE') >= 0) return 'date';
    if (toks.indexOf('TIME') >= 0) return 'time';
    return 'text';
  }

  // An empty date/time field opens on now rather than on nothing. Only the
  // overlay did this; the other three opened blank and the operator typed a
  // date that was almost always today.
  function nowDefault(type, now, fmt) {
    if (!fmt) return '';
    if (type === 'date') return fmt(now, 'YYYY-MM-DD');
    if (type === 'time') return fmt(now, 'HH:mm');
    if (type === 'datetime') return fmt(now, 'YYYY-MM-DD') + 'T' + fmt(now, 'HH:mm');
    return '';
  }

  // Ordered field keys: walk order of the text first, which is the order the
  // author wrote them and the order all four surfaces already render, then any
  // {{placeholder}} the walk does not cover.
  function fieldKeys(E, text) {
    var out = (E.extractFields(text) || []).slice();
    var ph = E.parsePlaceholders ? (E.parsePlaceholders(text) || []) : [];
    for (var i = 0; i < ph.length; i++) {
      if (out.indexOf(ph[i]) === -1) out.push(ph[i]);
    }
    return out;
  }

  // Always 'flat' today. The count arrives AFTER hidden fields are dropped, so
  // a conditional form is measured at the size it actually renders: a snippet
  // with ten mostly-hidden fields must not paginate a form showing three.
  function chooseLayout(visibleCount) {
    return 'flat';
  }

  function buildSteps(fields, layout) {
    return layout === 'steps' ? [fields.map(function(f) { return f.key; })] : [];
  }

  // text    the snippet or prompt body. A string, never a row: prompts keep
  //         theirs in a different column and must be able to use this later
  //         without the module knowing what a snippet is.
  // values  what the operator has entered so far, keyed by field name.
  // opts    { fieldCfg, lang, now } — fieldCfg is a stored override that wins
  //         over whatever the text declares.
  function fillForm(text, values, opts) {
    var E = engine();
    var src = (text === null || text === undefined) ? '' : String(text);
    var vals = values || {};
    var o = opts || {};

    // No engine means the page loaded wrong. Degrade to an empty form rather
    // than throw inside a content script running on somebody else's page.
    if (!E) return { fields: [], buttons: [], preview: src, layout: 'flat', steps: [] };

    var now = o.now || new Date();
    var fmt = E.sbFormatDate || null;

    // Declared by the text, then any stored config on top. Merged HERE because
    // the overlay learned the hard way that a call site will forget: reached
    // through the picker or the context menu, a {formmenu:} arrived as a bare
    // name and rendered as a plain text box.
    var declared = E.buildFormFieldCfg(src) || {};
    var stored = o.fieldCfg || {};
    var keys = fieldKeys(E, src);
    var ctxs = E.fieldContext ? (E.fieldContext(src) || {}) : {};

    var fields = [];
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var raw = {};
      var dcl = declared[key] || {};
      var st = stored[key] || {};
      var p;
      for (p in dcl) if (Object.prototype.hasOwnProperty.call(dcl, p)) raw[p] = dcl[p];
      for (p in st) if (Object.prototype.hasOwnProperty.call(st, p)) raw[p] = st[p];

      var type = raw.type || inferType(key);
      var isMenu = type === 'dd';
      var options = (isMenu && raw.opts)
        ? String(raw.opts).split('\n').filter(function(x) { return trim(x) !== ''; })
        : [];
      var def = raw['default'];
      if (def === undefined || def === null || def === '') {
        def = isMenu ? '' : nowDefault(type, now, fmt);
      }
      var ctx = ctxs[key] || { before: '', after: '' };
      var val = Object.prototype.hasOwnProperty.call(vals, key) ? vals[key] : def;

      fields.push({
        key: key,
        // Display name from a stored field_cfg. Empty when none is set: it is
        // the renderer that decides how to title an unnamed field, and they do
        // not agree (the overlay prints {KEY}, the phone humanises it).
        label: raw.label || '',
        type: type,
        options: options,
        picks: (isMenu && E.formMenuPicks) ? E.formMenuPicks(val) : [],
        multiple: raw.multiple === true,
        cols: raw.cols || 0,
        'default': def,
        value: val,
        before: ctx.before || '',
        after: ctx.after || '',
        // A choice list is block level, so the prose around its token goes
        // above and below rather than beside it on one line.
        block: isMenu,
        // Always visible today. Conditional visibility will compute this from
        // the same {if:} the text already uses; nothing else in the shape moves.
        visible: true
      });
    }

    var shown = [];
    for (var j = 0; j < fields.length; j++) if (fields[j].visible) shown.push(fields[j]);
    var layout = chooseLayout(shown.length);

    // The preview resolves against the EFFECTIVE values, which is each field's
    // entry falling back to its default — not the raw `values` argument. A
    // single-choice menu the operator never touched already reads as its first
    // option in the form, so resolving against raw values previewed a hole in a
    // sentence the surface was visibly showing as answered.
    var eff = {};
    for (var e1 = 0; e1 < fields.length; e1++) eff[fields[e1].key] = fields[e1].value;

    var preview = src;
    try {
      preview = E.resolveBody(E.interpolateSnippet(src, eff), eff, { lang: o.lang || '' });
    } catch (e) { preview = src; }

    return {
      fields: fields,
      buttons: E.extractButtons ? (E.extractButtons(src) || []) : [],
      preview: preview,
      layout: layout,
      steps: buildSteps(shown, layout)
    };
  }

  var API = {
    fillForm: fillForm,
    inferType: inferType,
    chooseLayout: chooseLayout,
    STEP_THRESHOLD: STEP_THRESHOLD
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else if (typeof define === 'function' && define.amd) {
    define(function() { return API; });
  } else {
    root.SBFillForm = API;
  }

}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this));
