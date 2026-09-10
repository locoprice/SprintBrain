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

  // ── ADJUSTING A DATE WHILE THE FORM IS OPEN ─────────────────────
  // The three decisions the Date/Time builder makes when a snippet is written —
  // which format, which day, what time on it — offered again to the person
  // filling the form in. Same closed lists, same words, same order, so learning
  // the builder is learning this.
  //
  // Two of the three are shortcuts into the picker and nothing more: a day or a
  // clock choice writes a value the operator could have picked by hand. Only
  // the format is a separate answer, because it changes how the value prints
  // rather than what the value is, and it travels to the engine as
  // resolveBody's `fmtOverride`.
  //
  // None of it is written back to the snippet. The author's token is untouched
  // by anyone filling it in, which is what keeps a shared snippet from drifting
  // every time a colleague expands it.

  // How each format reads. The engine owns the lists; these are the words for
  // them, in one place rather than once per surface.
  var FORMAT_LABELS = {
    'DD/MM/YYYY': 'Day / Month / Year',
    'MM/DD/YYYY': 'Month / Day / Year',
    'DD/MM/dddd': 'Day / Month / Weekday',
    'HH:mm': '24-hour',
    'hh:mm A': '12-hour (AM/PM)'
  };

  // The first entry of every format list: the value exactly as the picker
  // returned it, which is what a {formdate:} carrying no format= prints.
  var RAW_FORMAT_LABEL = 'As picked';

  // Sentence case, not the raw token. Mirrors NAMED_SHIFT_LABELS in
  // app/src/lib/formTimeToken.ts, which labels the same anchors in the builder.
  var NAMED_DAY_LABELS = {
    'tomorrow': 'Tomorrow',
    'yesterday': 'Yesterday',
    'next monday': 'Next Monday',
    'next tuesday': 'Next Tuesday',
    'next wednesday': 'Next Wednesday',
    'next thursday': 'Next Thursday',
    'next friday': 'Next Friday',
    'next saturday': 'Next Saturday',
    'next sunday': 'Next Sunday',
    'start of month': 'Start of this month',
    'start of next month': 'Start of next month',
    'end of month': 'End of this month',
    'end of next month': 'End of next month'
  };

  // The units a fixed offset counts in. A date picker cannot show an hour or a
  // minute, so a date field is offered only the four that move a whole day; a
  // datetime holds both halves and is offered all six. The builder offers all
  // six because a {time:} token prints whatever format it is given.
  var DAY_UNITS = [
    { value: 'D',  label: 'Days' },
    { value: 'W',  label: 'Weeks' },
    { value: 'Mo', label: 'Months' },
    { value: 'Y',  label: 'Years' }
  ];
  var CLOCK_UNITS = [
    { value: 'H', label: 'Hours' },
    { value: 'M', label: 'Minutes' }
  ];

  // Minutes step in fives, as they do in the builder's clock: nobody anchors a
  // message to 09:07, and sixty entries to scroll past to reach half past is
  // worse than the granularity is worth.
  var MINUTE_STEP = 5;

  // The three ways a day is chosen, in the builder's order and its words.
  var DAY_MODES = [
    { value: 'none',  label: 'Today' },
    { value: 'fixed', label: 'Count forward' },
    { value: 'named', label: 'A named day' }
  ];

  function pad2(n) {
    var s = String(n);
    return s.length < 2 ? '0' + s : s;
  }

  // A datetime picker value is 'YYYY-MM-DDTHH:mm'. Either half may be missing
  // while the operator is part way through typing one, so both readers answer
  // '' rather than guessing at the other half.
  function dateHalf(v) {
    var s = trim(v), t = s.indexOf('T');
    return t === -1 ? (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '') : s.slice(0, t);
  }

  function clockHalf(v) {
    var s = trim(v), t = s.indexOf('T');
    if (t !== -1) return s.slice(t + 1, t + 6);
    return /^\d{2}:\d{2}$/.test(s) ? s : '';
  }

  // Whether a fixed offset moves the clock rather than the calendar. `Mo` is
  // months and `M` is minutes, so the unit is anchored at both ends — without
  // the '$' a '+3Mo' would read as three hours' worth of nonsense.
  var CLOCK_SHIFT_RE = /^[+-]\d+(H|M)$/i;

  /** The `shift=` value for a fixed offset, or '' when it would be a no-op. */
  function fixedShift(amount, unit, back) {
    var n = parseInt(amount, 10);
    if (!isFinite(n) || n <= 0) return '';
    return (back ? '-' : '+') + n + String(unit || 'D');
  }

  // A date and a time each carry a format from their own list. A datetime
  // prints both halves, so its list is every pairing of the two with a space
  // between - the engine's own rule in _dateFormatOk, so what the Adjust panel
  // offers is exactly what a token can hold. Building it here rather than
  // hardcoding six strings keeps it right when either list changes.
  function formatList(E, type) {
    if (type === 'date') return (E.DATE_FORMATS || []).slice();
    if (type === 'time') return (E.TIME_FORMATS || []).slice();
    if (type === 'datetime') {
      var dates = E.DATE_FORMATS || [], times = E.TIME_FORMATS || [], out = [];
      for (var i = 0; i < dates.length; i++) {
        for (var j = 0; j < times.length; j++) out.push(dates[i] + ' ' + times[j]);
      }
      return out;
    }
    return [];
  }

  function formatOk(E, type, fmt) {
    var list = formatList(E, type), f = trim(fmt);
    for (var i = 0; i < list.length; i++) if (list[i] === f) return f;
    return '';
  }

  /**
   * The Adjust panel for one field: which formats it may print in, which days
   * it may jump to, and what its clock offers. null for every field that is not
   * a date, so a renderer can ask one question instead of three.
   *
   * Each format carries a live sample of THIS field's own value rather than a
   * fixed specimen date. The two numeric orders are indistinguishable until you
   * see a day past the twelfth, and the value in hand is the one the operator
   * is deciding about.
   */
  function adjustFor(E, type, value, now) {
    if (type !== 'date' && type !== 'time' && type !== 'datetime') return null;
    var fmt = E.sbFormatDate || null;
    var sampleSrc = trim(value) || nowDefault(type, now, fmt);
    var formats = [];
    var list = formatList(E, type);
    if (list.length) {
      formats.push({
        value: '',
        label: RAW_FORMAT_LABEL,
        sample: E.sbFormatDateValue ? E.sbFormatDateValue(sampleSrc, '') : sampleSrc
      });
      for (var i = 0; i < list.length; i++) {
        formats.push({
          value: list[i],
          label: FORMAT_LABELS[list[i]] || list[i],
          sample: E.sbFormatDateValue ? E.sbFormatDateValue(sampleSrc, list[i]) : sampleSrc
        });
      }
    }

    var hasDay = type === 'date' || type === 'datetime';
    var hasClock = type === 'time' || type === 'datetime';

    var days = [];
    if (hasDay) {
      var named = E.NAMED_SHIFTS || [];
      for (var d = 0; d < named.length; d++) {
        days.push({ value: named[d], label: NAMED_DAY_LABELS[named[d]] || named[d] });
      }
    }

    var hours = [], minutes = [], hour = '', minute = '';
    if (hasClock) {
      for (var h = 0; h < 24; h++) hours.push(pad2(h));
      for (var m = 0; m < 60; m += MINUTE_STEP) minutes.push(pad2(m));
      var clock = clockHalf(sampleSrc);
      hour = clock.slice(0, 2);
      minute = clock.slice(3, 5);
      // A field opens on the current minute, which is rarely a multiple of
      // five. Adding it to the list rather than snapping to the nearest step
      // means the control shows the time the field actually holds — a clock
      // reading 09:35 beside a field holding 09:37 is a small lie the operator
      // has no reason to expect.
      if (minute && minutes.indexOf(minute) === -1) {
        minutes.push(minute);
        minutes.sort();
      }
      if (hours.indexOf(hour) === -1) hour = '';
    }

    return {
      formats: formats,
      modes: hasDay ? DAY_MODES.slice() : [],
      units: hasDay ? (type === 'datetime' ? DAY_UNITS.concat(CLOCK_UNITS) : DAY_UNITS.slice()) : [],
      days: days,
      hours: hours,
      minutes: minutes,
      // What the clock controls should open on: the time already in the field.
      hour: hour,
      minute: minute
    };
  }

  /**
   * The picker value a day choice lands on.
   *
   * `choice` is { mode: 'none'|'fixed'|'named', amount, unit, back, named }.
   * Renderers draw the three modes; what each one MEANS is decided here, so the
   * phone and the in-page overlay can never disagree about which Monday "Next
   * Monday" is.
   *
   * Counted from `now`, never from what is already in the picker: "count
   * forward 3 days" means three days from today, and counting from the field
   * would compound every time the operator nudged the number.
   *
   * On a datetime the clock half is the operator's and survives the move —
   * unless the offset is itself an hour or a minute, which is a move of the
   * clock and nothing else.
   */
  function dayValue(type, choice, current, now) {
    var E = engine();
    if (!E || !E.sbFormatDate) return '';
    var c = choice || {};
    var base = now || new Date();
    var shift = '';
    if (c.mode === 'named') shift = trim(c.named);
    else if (c.mode === 'fixed') shift = fixedShift(c.amount, c.unit, c.back === true);

    var moved = (shift && E.sbApplyShift) ? E.sbApplyShift(base, shift) : new Date(base.getTime());
    var day = E.sbFormatDate(moved, 'YYYY-MM-DD');
    if (type !== 'datetime') return day;
    var clock = CLOCK_SHIFT_RE.test(shift)
      ? E.sbFormatDate(moved, 'HH:mm')
      : (clockHalf(current) || E.sbFormatDate(base, 'HH:mm'));
    return day + 'T' + clock;
  }

  /**
   * The picker value a clock choice lands on. A date field has no clock, so it
   * answers '' rather than inventing one.
   */
  function clockValue(type, hour, minute, current, now) {
    var E = engine();
    if (!E || !E.sbFormatDate) return '';
    var clock = pad2(parseInt(hour, 10) || 0) + ':' + pad2(parseInt(minute, 10) || 0);
    if (type === 'time') return clock;
    if (type !== 'datetime') return '';
    return (dateHalf(current) || E.sbFormatDate(now || new Date(), 'YYYY-MM-DD')) + 'T' + clock;
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
  // opts    { fieldCfg, fieldFmt, lang, now } — fieldCfg is a stored override
  //         that wins over whatever the text declares. fieldFmt is the format
  //         the operator picked in the Adjust panel, keyed the same way; it
  //         lives beside `values` because it is the same kind of thing, an
  //         answer given while the form is open and never saved.
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
    var picked = o.fieldFmt || {};
    var keys = fieldKeys(E, src);
    var ctxs = E.fieldContext ? (E.fieldContext(src) || {}) : {};

    // What each date and time field will actually print, on its way to the
    // engine. Every one of them is listed, not only the ones the operator
    // touched, so the preview and the insert read the format off the same
    // answer the form is showing.
    var fmtOverride = {};
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

      // The format this field prints in: the author's, unless the operator
      // picked another in the Adjust panel. '' is a real answer on both sides —
      // print the picker's own value — so the override is read by presence.
      var effFmt = '';
      if (type === 'date' || type === 'time' || type === 'datetime') {
        effFmt = formatOk(E, type, raw.format || '');
        if (Object.prototype.hasOwnProperty.call(picked, key)) {
          var want = trim(picked[key]), ok = formatOk(E, type, want);
          // '' is a real answer: print the picker's own value. A format this
          // kind of field does not have is a caller bug, and honouring it would
          // quietly drop the author's, so it is ignored instead — the same rule
          // the engine applies to fmtOverride.
          if (want === '' || ok) effFmt = ok;
        }
        fmtOverride[key] = effFmt;
      }

      fields.push({
        key: key,
        // Display name from a stored field_cfg. Empty when none is set: it is
        // the renderer that decides how to title an unnamed field, and they do
        // not agree (the overlay prints {KEY}, the phone humanises it).
        label: raw.label || '',
        type: type,
        // How the value prints once it leaves the form. A number carries
        // 'plain', 'currency' or 'percent'; a date or a time carries one of the
        // engine's DATE_FORMATS / TIME_FORMATS (a datetime pairs one of each),
        // or '' for the raw picker value.
        // Always '' for every other kind of field, so a renderer can read it
        // without first asking what type it is holding. Formatting is output
        // only — the value a formula reads stays the raw number, or
        // {=SUBTOTAL * VAT / 100} would start doing arithmetic on "€1,200.50",
        // and datetimediff() would stop reading a date it formatted itself.
        format: type === 'number' ? (raw.format || 'plain') : effFmt,
        // ISO code behind a currency field, so a renderer can show the symbol
        // beside the input without re-parsing the token. '' for every other
        // field, and for a number that is not money.
        currency: type === 'number' && raw.format === 'currency'
          ? (raw.currency || 'EUR') : '',
        // The field this one may not open before, or '' for no ordering. Named
        // notBefore because `after` on a field is already the prose printed
        // after its token, and the two are nothing to do with each other.
        // A renderer emits `min` now and re-reads it whenever that field
        // changes, because the limit follows what the operator just picked.
        notBefore: (type === 'date' || type === 'datetime') ? (raw.after || '') : '',
        // The earliest this field may hold, in the picker's own value format.
        // Resolved below, once every field's value is known: the field being
        // pointed at is often the one after this in walk order.
        min: '',
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
        // What the Adjust panel offers this field — formats, named days, units,
        // clock. null for everything that is not a date, so a renderer asks one
        // question rather than three.
        adjust: adjustFor(E, type, val, now),
        // Always visible today. Conditional visibility will compute this from
        // the same {if:} the text already uses; nothing else in the shape moves.
        visible: true
      });
    }

    // ── ORDERING BETWEEN TWO FIELDS ──────────────────────────────
    // A closing date may not fall before its opening one. This is not the same
    // rule as limiting a date against today: a quote sent in September for a
    // trip in March has two dates that are both far in the future, and only
    // their order can be wrong.
    //
    // Resolved here rather than in each renderer, for the reason this module
    // exists: four surfaces deciding it separately is how they drift. A
    // renderer emits `min` and re-reads it when the named field changes.
    var byKey = {};
    for (var bk = 0; bk < fields.length; bk++) byKey[fields[bk].key] = fields[bk];
    // Names here are deliberately unmistakable. `src` is this function's snippet
    // BODY, and a var declared in this loop shares its scope: reusing the name
    // overwrote the body with a field object, the preview stopped being text,
    // and the editor rendered a blank page. Nothing in this loop may be named
    // src, text, keys, vals, def or val.
    for (var mi = 0; mi < fields.length; mi++) {
      var depField = fields[mi];
      if (!depField.notBefore) continue;
      var orderSrc = byKey[depField.notBefore];
      // Pointing at a field that is not there, or not a date, is an authoring
      // slip. No limit beats a limit built on nothing.
      if (!orderSrc || (orderSrc.type !== 'date' && orderSrc.type !== 'datetime')) {
        depField.notBefore = '';
        continue;
      }
      var orderVal = trim(orderSrc.value);
      if (orderVal === '') continue;
      // A datetime picker wants a full datetime as its min, a date picker a
      // date. Mixing them makes the browser ignore the attribute silently.
      depField.min = (depField.type === 'datetime')
        ? (orderSrc.type === 'datetime' ? orderVal : orderVal + 'T00:00')
        : orderVal.slice(0, 10);
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
      preview = E.resolveBody(E.interpolateSnippet(src, eff), eff,
        { lang: o.lang || '', fmtOverride: fmtOverride });
    } catch (e) { preview = src; }

    return {
      fields: fields,
      buttons: E.extractButtons ? (E.extractButtons(src) || []) : [],
      preview: preview,
      // Hand straight to resolveBody alongside the values. A surface that
      // resolves the body itself on insert — the overlay does — must pass this
      // too, or what it inserts prints in a different format from the preview
      // the operator just approved.
      fmtOverride: fmtOverride,
      layout: layout,
      steps: buildSteps(shown, layout)
    };
  }

  /**
   * The earliest value a field may hold, given what the field it must not
   * precede currently holds. Exported because the limit has to be re-applied
   * live: a renderer draws `min` once, then the operator picks a start date and
   * the end picker has to narrow without the form being rebuilt underneath the
   * caret. Four surfaces, one rule.
   *
   * @param {string} dstType  the dependent field's kind
   * @param {string} srcValue what the field it follows currently holds
   * @returns {string} a value for the `min` attribute, or '' for no limit
   */
  function orderedMin(dstType, srcValue) {
    var v = trim(srcValue);
    if (v === '') return '';
    // A datetime picker ignores a date-only min, and a date picker ignores one
    // carrying a clock. Silently, in both directions.
    if (dstType === 'datetime') return v.length > 10 ? v : v + 'T00:00';
    return v.slice(0, 10);
  }

  var API = {
    fillForm: fillForm,
    orderedMin: orderedMin,
    inferType: inferType,
    chooseLayout: chooseLayout,
    dayValue: dayValue,
    clockValue: clockValue,
    fixedShift: fixedShift,
    MINUTE_STEP: MINUTE_STEP,
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
