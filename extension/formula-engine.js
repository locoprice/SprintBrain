// ── SPRINTBRAIN FORMULA ENGINE v2.62.12 ───────────────────────────
// Standalone module — no Chrome API dependencies.
// Shared by the Chrome extension content script (loaded via the manifest) and Sprintbrain.html.
//
// Supported syntax:
//   {{VARIABLE_NAME}}          — placeholder (filled by user)
//   {{= EXPRESSION }}          — evaluated math formula
//   {= EXPRESSION}             — legacy single-brace formula
//   {var: NAME = EXPRESSION}   — local variable declaration
//   {time: FORMAT}             — date/time token
//   {formtext: name=VAR; default=X}   — text input field
//   {formdate: name=VAR}              — date input field
//   {formmenu: opt1,opt2; name=VAR[; default=opt1][; multiple=yes][; cols=N]}  — dropdown field
//   {if: COND}...{elseif: COND}...{else}...{endif}  — conditional blocks
//   {gender: FIELD; m=Querido; f=Querida[; u=Hola][; lang=IT]}  — gendered word
//   {button label="Text" [trim=yes|no|left|right]}CODE{/button}  — action button
//
// {button} renders in the fill form, never in the output. CODE is one or more
// `FIELD = expression` assignments, separated by newlines or ';', evaluated in
// order against the current field values when the button is clicked.
// `trim` drops horizontal whitespace plus at most one line break on the chosen
// side, so a button sitting on its own line leaves no blank line behind.
//
// Gendered greetings also inflect on their own: a word from the built-in
// dictionary (Querido, Estimado, Caro, Cher…) written directly before a name
// field agrees with that name — "Querido {NOMBRE}" prints "Querida Lucía".
//
// Math: +, -, *, /, parentheses, round(), floor(), ceil(), abs(), min(), max()
// Comparisons in conditions: VAR = "value" / VAR != "value" (string);
//   >, <, >=, <=, ==, != (numeric, operands evaluated as formulas)
// No eval() or Function() — CSP-safe recursive descent parser throughout.
// ─────────────────────────────────────────────────────────────────

(function(root) {
  'use strict';

  // ── WHITELISTED FUNCTION NAMES ──────────────────────────────────
  var FUNS = { round:1, floor:1, ceil:1, abs:1, min:1, max:1, datetimediff:1 };

  // ── DATE/TIME HELPERS ───────────────────────────────────────────
  function _pad(n) { return (n < 10 ? '0' : '') + n; }

  function sbFormatDate(d, fmt) {
    if (!d || isNaN(d.getTime())) return '';
    var M = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    var W = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var hr12 = d.getHours() % 12; if (hr12 === 0) hr12 = 12;
    var tok = {
      YYYY: String(d.getFullYear()),
      YY:   String(d.getFullYear()).slice(-2),
      MMMM: M[d.getMonth()],
      MMM:  M[d.getMonth()].slice(0,3),
      MM:   _pad(d.getMonth()+1),
      DD:   _pad(d.getDate()),
      D:    String(d.getDate()),
      dddd: W[d.getDay()],
      ddd:  W[d.getDay()].slice(0,3),
      HH:   _pad(d.getHours()),
      H:    String(d.getHours()),
      hh:   _pad(hr12),
      h:    String(hr12),
      mm:   _pad(d.getMinutes()),
      m:    String(d.getMinutes()),
      ss:   _pad(d.getSeconds()),
      s:    String(d.getSeconds()),
      A:    d.getHours() < 12 ? 'AM' : 'PM',
      a:    d.getHours() < 12 ? 'am' : 'pm'
    };
    var order = ['YYYY','YY','MMMM','MMM','MM','DD','D','dddd','ddd','HH','hh','H','mm','m','ss','s','h','A','a'];
    var placeholders = {}, out = fmt;
    for (var i = 0; i < order.length; i++) {
      var p = '\x00' + i + '\x00';
      placeholders[p] = tok[order[i]];
      out = out.split(order[i]).join(p);
    }
    for (var k in placeholders) out = out.split(k).join(placeholders[k]);
    return out;
  }

  function sbApplyShift(d, shift) {
    if (!shift) return d;
    var m = /^([+-])\s*(\d+)\s*(Mo|M|H|D|W|Y)$/.exec(String(shift).replace(/\s+/g,''));
    if (!m) return d;
    var sign = m[1] === '-' ? -1 : 1, n = parseInt(m[2], 10) * sign, u = m[3];
    var out = new Date(d.getTime());
    if (u === 'M')  out.setMinutes(out.getMinutes() + n);
    else if (u === 'H')  out.setHours(out.getHours() + n);
    else if (u === 'D')  out.setDate(out.getDate() + n);
    else if (u === 'W')  out.setDate(out.getDate() + n * 7);
    else if (u === 'Mo') out.setMonth(out.getMonth() + n);
    else if (u === 'Y')  out.setFullYear(out.getFullYear() + n);
    return out;
  }

  function sbParseUserDate(s) {
    if (s == null || s === '') return null;
    var str = String(s).replace(/^\s+|\s+$/g, '');
    var mt = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(str);
    if (mt) { var d = new Date(); d.setHours(+mt[1], +mt[2], +(mt[3]||0), 0); return d; }
    var md = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
    if (md) return new Date(+md[1], +md[2]-1, +md[3]);
    var mdt = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(str);
    if (mdt) return new Date(+mdt[1], +mdt[2]-1, +mdt[3], +mdt[4], +mdt[5], +(mdt[6]||0));
    var dd = new Date(str);
    return isNaN(dd.getTime()) ? null : dd;
  }

  function sbParseTimeToken(rest, vals) {
    var parts = String(rest).split(';');
    var fmt = (parts[0] || '').replace(/^\s+|\s+$/g, '');
    var opts = {};
    for (var i = 1; i < parts.length; i++) {
      var eq = parts[i].indexOf('=');
      if (eq > -1) {
        var k = parts[i].slice(0, eq).replace(/^\s+|\s+$/g, '');
        var v = parts[i].slice(eq + 1).replace(/^\s+|\s+$/g, '');
        opts[k] = v;
      }
    }
    var base = null;
    if (opts.from && vals && vals[opts.from] !== undefined && vals[opts.from] !== '') {
      base = sbParseUserDate(vals[opts.from]);
    }
    if (!base || isNaN(base.getTime())) base = new Date();
    if (opts.shift) base = sbApplyShift(base, opts.shift);
    return sbFormatDate(base, fmt || 'YYYY-MM-DD HH:mm');
  }

  function sbDatetimeDiffUnitMs(unit) {
    var u = String(unit || '').toLowerCase();
    if (u === 'second' || u === 'seconds' || u === 's' || u === 'sec') return 1000;
    if (u === 'minute' || u === 'minutes' || u === 'min') return 60000;
    if (u === 'hour'   || u === 'hours'   || u === 'h')  return 3600000;
    if (u === 'day'    || u === 'days'    || u === 'd')   return 86400000;
    return 60000;
  }

  function sbResolveDatetimeDiff(expr, vals) {
    var re = /datetimediff\s*\(\s*([A-Za-z_]\w*|"[^"]*"|'[^']*')\s*,\s*([A-Za-z_]\w*|"[^"]*"|'[^']*')\s*,\s*["']([^"']+)["']\s*\)/g;
    return String(expr).replace(re, function(_, a, b, unit) {
      function resolve(arg) {
        if (arg.charAt(0) === '"' || arg.charAt(0) === "'") return arg.slice(1, -1);
        return (vals && vals[arg] !== undefined) ? String(vals[arg]) : '';
      }
      var da = sbParseUserDate(resolve(a)), db = sbParseUserDate(resolve(b));
      if (!da || !db) return '0';
      return String((db.getTime() - da.getTime()) / sbDatetimeDiffUnitMs(unit));
    });
  }

  // ── GENDER-AWARE GREETINGS ──────────────────────────────────────
  // Romance-language greetings agree with the reader: "Querido" for Marco,
  // "Querida" for Lucía. Gender resolves in three tiers:
  //   1. per-language override — ANDREA is masculine in IT, feminine in ES
  //   2. explicit name list    — CARMEN, VICENTE: no suffix rule reaches them
  //   3. suffix rule           — trailing -a feminine, -o masculine
  // An unresolved name returns '' and every caller then leaves the text alone.
  // Guessing wrong is worse than printing the wording the author already chose.

  function _sbNames(list, g, into) {
    var a = list.split(' ');
    for (var i = 0; i < a.length; i++) if (a[i]) into[a[i]] = g;
    return into;
  }

  var GENDER_BY_NAME = {};
  // Feminine — only names the suffix rule gets wrong or cannot judge.
  _sbNames('carmen isabel raquel beatriz ines dolores mercedes pilar esther ruth judith ' +
           'soledad caridad libertad milagros remedios lourdes nieves flor luz mar iris ' +
           'noemi rocio consuelo amparo socorro cleo margo ' +
           'irene beatrice alice adele agnese matilde penelope dafne cloe ester ' +
           'sophie marie julie claire elodie chloe zoe denise elise louise michelle ' +
           'danielle gabrielle isabelle estelle helene charlotte margot margaux renee ' +
           'mary jennifer elizabeth susan sarah karen nancy betty margaret ashley ' +
           'kimberly emily carol dorothy stephanie sharon kathleen amy shirley kathryn ' +
           'janet heather joyce kelly lauren evelyn megan cheryl hannah jacqueline ' +
           'frances ann anne teresa janice madison doris abigail grace amber marilyn ' +
           'beverly brittany rose kayla lily freya isla poppy daisy holly jade faith ' +
           'hope ingrid astrid kirsten karin miriam myriam jazmin yasmin gwen eileen ' +
           'maureen colleen noor nour hind lucy judy wendy tracy ivy molly sally ' +
           'leah beth meredith savannah norah rachel muriel mabel hazel april gail jill ' +
           'crystal agnes phyllis harriet violet bridget scarlett juliet colette ' +
           'eleanor ginger piper heidi naomi suri kristen imogen shannon alison allison ' +
           'catherine christine caroline adeline jasmine josephine geraldine madeline',
           'f', GENDER_BY_NAME);
  // Masculine — same principle, plus the -a endings the suffix rule would flip.
  _sbNames('jose felipe enrique vicente jaime dante cesare davide giuseppe salvatore ' +
           'ettore ercole rene herve clement maxime daniele gabriele emanuele ' +
           'luca mattia elia tobia battista geremia isaia zaccaria joshua elisha ezra ' +
           'mustafa hamza zakaria yahya musa issa borja aleksa kosta ilya misha dima ' +
           'kolya vanya nikola jonah ' +
           'james john robert michael william david richard joseph thomas charles ' +
           'christopher daniel matthew anthony mark donald steven paul andrew kenneth ' +
           'kevin brian george timothy ronald jason edward jeffrey ryan jacob gary ' +
           'nicholas eric jonathan stephen larry justin scott brandon benjamin samuel ' +
           'gregory alexander patrick frank raymond jack dennis jerry tyler aaron adam ' +
           'henry nathan douglas zachary peter kyle ethan walter jeremy christian keith ' +
           'roger terry gerald harold sean austin carl arthur lawrence dylan bryan ' +
           'billy joe bruce gabriel logan albert willie alan juan wayne elijah randy ' +
           'roy vincent ralph eugene russell bobby mason philip louis liam oliver harry ' +
           'oscar archie theo freddie alfie leo max tom ben luke finn felix hugo rory ' +
           'seth ivan igor oleg dmitri sergei viktor pavel andrei mikhail yuri boris ' +
           'ahmed mohamed mohammed muhammad ali omar hassan hussein khaled tarek amir ' +
           'samir karim rachid youssef ismail yusuf noah tony andy shawn',
           'm', GENDER_BY_NAME);
  // Genuinely unisex — 'x' forces "unknown" so nothing gets rewritten.
  _sbNames('alex sam chris jordan robin taylor morgan charlie jamie casey riley avery ' +
           'dana jesse kim lee pat sasha sacha nikita ariel marion camille dominique ' +
           'claude noel cruz alexis dani gabi yael eden quinn skyler rowan harper ' +
           'ale toni nico santi',
           'x', GENDER_BY_NAME);

  // Names whose gender flips with the language being written.
  var GENDER_BY_LANG = {
    andrea:  { IT:'m', ES:'f', PT:'f', FR:'f', EN:'f' },
    nicola:  { IT:'m', EN:'f' },
    simone:  { IT:'m', FR:'f', EN:'f' },
    michele: { IT:'m', EN:'f', FR:'f' },
    rosario: { IT:'m', ES:'f' },
    jean:    { FR:'m', EN:'f' }
  };

  function sbStripAccents(s) {
    return String(s)
      .replace(/[àáâãäå]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i')
      .replace(/[òóôõö]/g, 'o').replace(/[ùúûü]/g, 'u')
      .replace(/ç/g, 'c').replace(/ñ/g, 'n');
  }

  // First token only, lowercased and stripped to bare letters: "Lucía Pérez" → "lucia".
  function sbNameKey(name) {
    var s = String(name == null ? '' : name).replace(/^\s+|\s+$/g, '');
    if (!s) return '';
    s = sbStripAccents(s.split(/[\s,;.]+/)[0].toLowerCase());
    return s.replace(/[^a-z]/g, '');
  }

  function sbNameGender(name, lang) {
    var key = sbNameKey(name);
    if (key.length < 2) return '';
    var byLang = GENDER_BY_LANG[key];
    if (byLang) return byLang[String(lang || '').toUpperCase()] || '';
    var known = GENDER_BY_NAME[key];
    if (known) return known === 'x' ? '' : known;
    var last = key.charAt(key.length - 1);
    if (last === 'a') return 'f';
    if (last === 'o') return 'm';
    return '';
  }

  // ── GENDERED WORD DICTIONARY ────────────────────────────────────
  // Closed list of address terms only — never general prose. Keys are
  // accent-stripped and lowercase; both forms map to the same pair so a body
  // written either way lands on the right one. `lang` disambiguates the name.
  var GENDER_WORDS = {};
  function _sbPair(m, f, lang) {
    var pair = { m: m, f: f, lang: lang };
    GENDER_WORDS[sbStripAccents(m.toLowerCase())] = pair;
    GENDER_WORDS[sbStripAccents(f.toLowerCase())] = pair;
  }
  _sbPair('querido', 'querida', 'ES');
  _sbPair('estimado', 'estimada', 'ES');
  _sbPair('apreciado', 'apreciada', 'ES');
  _sbPair('distinguido', 'distinguida', 'ES');
  _sbPair('bienvenido', 'bienvenida', 'ES');
  _sbPair('encantado', 'encantada', 'ES');
  _sbPair('amigo', 'amiga', 'ES');
  _sbPair('prezado', 'prezada', 'PT');
  _sbPair('caro', 'cara', 'IT');
  _sbPair('carissimo', 'carissima', 'IT');
  _sbPair('gentilissimo', 'gentilissima', 'IT');
  _sbPair('benvenuto', 'benvenuta', 'IT');
  _sbPair('stimato', 'stimata', 'IT');
  _sbPair('amico', 'amica', 'IT');
  _sbPair('cher', 'chère', 'FR');
  _sbPair('bienvenu', 'bienvenue', 'FR');

  var _SB_LETTER = 'A-Za-zÀ-ÖØ-öø-ÿ';
  var _SB_TAIL_RE = new RegExp('([' + _SB_LETTER + ']+)([^' + _SB_LETTER + ']{0,3})$');

  function sbMatchCase(src, target) {
    if (src === src.toUpperCase() && src !== src.toLowerCase()) return target.toUpperCase();
    if (src.charAt(0) === src.charAt(0).toUpperCase()) return target.charAt(0).toUpperCase() + target.slice(1);
    return target;
  }

  // Re-inflects the greeting word already emitted at the tail of `out` to agree
  // with `value`, the field about to be appended. No-ops unless the tail word is
  // in the dictionary AND the value resolves to a known gender — so a date, an
  // amount, or an unrecognised name all leave the authored wording intact.
  // `lock` is the offset of text a {gender:} token wrote. Anything at or past it
  // was chosen explicitly by the author, so auto-inflection keeps its hands off.
  function sbInflectGreeting(out, value, lock) {
    if (!out) return out;
    var m = _SB_TAIL_RE.exec(out);
    if (!m || !/^[\s,:;]*$/.test(m[2])) return out;
    var start = out.length - m[0].length;
    if (lock >= 0 && start >= lock) return out;
    var pair = GENDER_WORDS[sbStripAccents(m[1].toLowerCase())];
    if (!pair) return out;
    var g = sbNameGender(value, pair.lang);
    if (!g) return out;
    return out.slice(0, start) + sbMatchCase(m[1], g === 'f' ? pair.f : pair.m) + m[2];
  }

  // Appends a resolved field value, inflecting any greeting word ahead of it.
  function sbEmitValue(out, value, lock) {
    var s = String(value);
    return sbInflectGreeting(out, s, lock) + s;
  }

  // {gender: FIELD; m=Querido; f=Querida[; u=Hola][; lang=IT]}
  // `u` is the fallback when the name is unknown or unisex; it defaults to the
  // masculine form, which is the unmarked one in every language here.
  function sbResolveGenderToken(rest, vals, opts) {
    var parts = String(rest).split(';');
    var field = parts[0].replace(/^\s+|\s+$/g, '');
    var cfg = { m: '', f: '', u: null, lang: '' };
    for (var i = 1; i < parts.length; i++) {
      var eq = parts[i].indexOf('=');
      if (eq === -1) continue;
      var k = parts[i].slice(0, eq).replace(/^\s+|\s+$/g, '').toLowerCase();
      if (k !== 'm' && k !== 'f' && k !== 'u' && k !== 'lang') continue;
      cfg[k] = parts[i].slice(eq + 1).replace(/^\s+|\s+$/g, '');
    }
    var val = (vals && vals[field] !== undefined && vals[field] !== null) ? String(vals[field]) : '';
    var g = sbNameGender(val, cfg.lang || (opts && opts.lang) || '');
    if (g === 'f') return cfg.f;
    if (g === 'm') return cfg.m;
    return cfg.u !== null ? cfg.u : cfg.m;
  }

  // Field name a {gender:} token reads, so the overlay still prompts for it.
  function sbGenderTokenField(rest) {
    var f = String(rest).split(';')[0].replace(/^\s+|\s+$/g, '');
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(f) ? f : '';
  }

  // ── SAFE MATH EVALUATOR ─────────────────────────────────────────
  // Recursive descent — no eval(), no Function(). CSP-safe.
  function safeEval(expr) {
    var pos = 0;
    var str = expr.replace(/\s+/g, '');

    function parseExpr() {
      var left = parseTerm();
      while (pos < str.length && (str[pos] === '+' || str[pos] === '-')) {
        var op = str[pos++];
        var right = parseTerm();
        left = op === '+' ? left + right : left - right;
      }
      return left;
    }

    function parseTerm() {
      var left = parseFactor();
      while (pos < str.length && (str[pos] === '*' || str[pos] === '/')) {
        var op = str[pos++];
        var right = parseFactor();
        left = op === '*' ? left * right : left / right;
      }
      return left;
    }

    function parseFactor() {
      if (str[pos] === '-') { pos++; return -parseFactor(); }
      if (str[pos] === '+') { pos++; return parseFactor(); }
      var fnMatch = str.slice(pos).match(/^(round|floor|ceil|abs|min|max)\(/);
      if (fnMatch) {
        var fn = fnMatch[1];
        pos += fn.length + 1;
        var args = parseArgs();
        if (str[pos] === ')') pos++;
        if (fn === 'round') return Math.round(args[0]);
        if (fn === 'floor') return Math.floor(args[0]);
        if (fn === 'ceil')  return Math.ceil(args[0]);
        if (fn === 'abs')   return Math.abs(args[0]);
        if (fn === 'min')   return Math.min.apply(null, args);
        if (fn === 'max')   return Math.max.apply(null, args);
      }
      if (str[pos] === '(') {
        pos++;
        var val = parseExpr();
        if (str[pos] === ')') pos++;
        return val;
      }
      var numStr = '';
      while (pos < str.length && (str[pos] >= '0' && str[pos] <= '9' || str[pos] === '.')) {
        numStr += str[pos++];
      }
      if (numStr === '') return NaN;
      return parseFloat(numStr);
    }

    function parseArgs() {
      var args = [parseExpr()];
      while (str[pos] === ',') { pos++; args.push(parseExpr()); }
      return args;
    }

    var result = parseExpr();
    return pos === str.length ? result : NaN;
  }

  // ── FORMULA EVALUATOR ───────────────────────────────────────────
  function evalFormula(expr, vals) {
    try {
      var s = sbResolveDatetimeDiff(expr, vals);
      s = s.replace(/[A-Za-z_][A-Za-z0-9_]*/g, function(n) {
        if (FUNS[n]) return n;
        var v = parseFloat(vals[n]);
        return isNaN(v) ? '0' : String(v);
      });
      var r = safeEval(s);
      // !isFinite catches NaN AND ±Infinity (e.g. divide-by-zero like {{= 1/0 }}),
      // so a bad formula resolves to '' instead of leaking the literal "Infinity".
      return (r === null || !isFinite(r)) ? null : Math.round(r * 100) / 100;
    } catch(e) { return null; }
  }

  // ── CONDITION EVALUATOR ─────────────────────────────────────────
  // Extends evalFormula with string comparison:
  //   VAR = "value"   VAR == "value"   VAR != "value"   VAR <> "value"
  function evalCondition(expr, vals) {
    var e = String(expr).replace(/^\s+|\s+$/g, '');
    var sm = /^([A-Za-z_][A-Za-z0-9_]*)\s*(==|!=|<>|=)\s*["']([^"']*)["']$/.exec(e);
    if (sm) {
      var lhs = String(vals[sm[1]] !== undefined && vals[sm[1]] !== null ? vals[sm[1]] : '');
      var op = sm[2], rhs = sm[3];
      var eq = lhs.toLowerCase() === rhs.toLowerCase();
      return (op === '=' || op === '==') ? (eq ? 1 : 0) : (eq ? 0 : 1);
    }
    sm = /^["']([^'"]*)['"]\s*(==|!=|<>|=)\s*([A-Za-z_][A-Za-z0-9_]*)$/.exec(e);
    if (sm) {
      var rhs2 = sm[1], op2 = sm[2];
      var lhs2 = String(vals[sm[3]] !== undefined && vals[sm[3]] !== null ? vals[sm[3]] : '');
      var eq2 = lhs2.toLowerCase() === rhs2.toLowerCase();
      return (op2 === '=' || op2 === '==') ? (eq2 ? 1 : 0) : (eq2 ? 0 : 1);
    }
    // Numeric comparison: LHS (>|<|>=|<=|==|!=) RHS, operands evaluated numerically.
    // Quoted string-equality is handled above; this fires for unquoted comparisons
    // that previously fell through to safeEval and returned NaN (e.g. {if: PRICE > 0}).
    var cm = /^(.+?)\s*(>=|<=|==|!=|>|<)\s*(.+)$/.exec(e);
    if (cm) {
      var lv = evalFormula(cm[1], vals), rv = evalFormula(cm[3], vals);
      if (lv === null || rv === null) return 0;
      switch (cm[2]) {
        case '>=': return lv >= rv ? 1 : 0;
        case '<=': return lv <= rv ? 1 : 0;
        case '>':  return lv >  rv ? 1 : 0;
        case '<':  return lv <  rv ? 1 : 0;
        case '==': return lv === rv ? 1 : 0;
        case '!=': return lv !== rv ? 1 : 0;
      }
    }
    return evalFormula(e, vals);
  }

  // ── IF/ELSEIF/ELSE BRANCH SPLITTER ──────────────────────────────
  function _splitIfBranches(firstCond, inner) {
    var branches = [], currentCond = firstCond, lastIdx = 0;
    var re = /\{(else(?:if:[^}]*)?)\}/g, m;
    while ((m = re.exec(inner)) !== null) {
      branches.push({ cond: currentCond, body: inner.slice(lastIdx, m.index) });
      var tag = m[1].replace(/^\s+|\s+$/g, '');
      currentCond = (tag === 'else') ? null : tag.slice(7).replace(/^\s+|\s+$/g, '');
      lastIdx = m.index + m[0].length;
    }
    branches.push({ cond: currentCond, body: inner.slice(lastIdx) });
    return branches;
  }

  // ── BODY RESOLVER ───────────────────────────────────────────────
  // `opts.lang` — the snippet's language, used only to gender ambiguous names
  // in a {gender:} token that omits its own `lang=`.
  function resolveBody(body, vals, opts) {
    if (!body) return '';
    var out = '', i = 0, gLock = -1;
    while (i < body.length) {
      if (body[i] === '{') {
        // Double-brace: {{= EXPR}} or {{VARNAME}}
        if (body[i+1] === '{') {
          var cll = body.indexOf('}}', i+2);
          if (cll === -1) { out += body[i++]; continue; }
          var dtok = body.slice(i+2, cll).replace(/^\s+|\s+$/g, '');
          if (dtok.charAt(0) === '=') {
            var dfv = evalFormula(dtok.slice(1).replace(/^\s+|\s+$/g, ''), vals);
            out += dfv !== null ? String(dfv) : '';
          } else {
            var dval = vals[dtok];
            if (dval !== undefined && dval !== null) out = sbEmitValue(out, dval, gLock);
            else out += '{{' + dtok + '}}';
          }
          i = cll + 2; continue;
        }
        // Single-brace token
        var cl = body.indexOf('}', i);
        if (cl === -1) { out += body[i++]; continue; }
        var tok = body.slice(i+1, cl).replace(/^\s+|\s+$/g, '');
        if (tok.slice(0,4) === 'var:') {
          var vdecl = tok.slice(4).replace(/^\s+|\s+$/g, '');
          var veq = vdecl.indexOf('=');
          if (veq > -1) {
            var vname = vdecl.slice(0, veq).replace(/^\s+|\s+$/g, '');
            var vexpr = vdecl.slice(veq+1).replace(/^\s+|\s+$/g, '');
            try {
              var vres = evalFormula(vexpr, vals);
              vals[vname] = (vres !== null && typeof vres === 'number' && !isNaN(vres)) ? vres : 0;
            } catch(e) { vals[vname] = 0; }
          }
          i = cl+1; continue;
        }
        if (tok.charAt(0) === '=') {
          var fv = evalFormula(tok.slice(1), vals);
          out += fv !== null ? String(fv) : '';
          i = cl+1; continue;
        }
        if (tok.slice(0,5).toLowerCase() === 'time:') {
          out += sbParseTimeToken(tok.slice(5), vals);
          i = cl+1; continue;
        }
        var tokLow = tok.toLowerCase();
        // {button …}code{/button} — an interface control, never text. The whole
        // region drops out, then `trim` removes the whitespace it left behind.
        if (_isButtonHead(tokLow)) {
          var bClose = body.indexOf(BUTTON_CLOSE, cl + 1);
          // Unclosed: drop only the head so the rest still renders. The template
          // validator flags this shape as 'unclosed-button'.
          if (bClose === -1) { i = cl + 1; continue; }
          var bTrim = String(_parseButtonAttrs(tok.slice(6)).trim || '').toLowerCase();
          if (bTrim === 'left' || bTrim === 'yes') out = out.replace(/[ \t]*\r?\n?[ \t]*$/, '');
          i = bClose + BUTTON_CLOSE.length;
          if (bTrim === 'right' || bTrim === 'yes') {
            var after = /^[ \t]*\r?\n?[ \t]*/.exec(body.slice(i));
            if (after) i += after[0].length;
          }
          continue;
        }
        if (tokLow.slice(0,9) === 'formtext:' || tokLow.slice(0,9) === 'formdate:' || tokLow.slice(0,9) === 'formmenu:') {
          var fKey = _formFieldName(tokLow, tok.slice(9));
          out = sbEmitValue(out, fKey && vals[fKey] !== undefined ? vals[fKey] : '', gLock);
          i = cl+1; continue;
        }
        if (tokLow.slice(0,7) === 'gender:') {
          gLock = out.length;
          out += sbResolveGenderToken(tok.slice(7), vals, opts);
          i = cl+1; continue;
        }
        if (tok.slice(0,3) === 'if:') {
          var cond = tok.slice(3).replace(/^\s+|\s+$/g, '');
          var ei = '{endif}', eidx = body.indexOf(ei, cl+1);
          var fullInner = eidx !== -1 ? body.slice(cl+1, eidx) : '';
          var branches = _splitIfBranches(cond, fullInner);
          for (var bi = 0; bi < branches.length; bi++) {
            var br = branches[bi];
            var brOk = false;
            if (br.cond === null) { brOk = true; }
            else { try { var cr = evalCondition(br.cond, vals); brOk = cr !== null && cr !== 0; } catch(e) {} }
            if (brOk) { out += resolveBody(br.body, vals, opts); break; }
          }
          i = eidx !== -1 ? eidx + ei.length : cl+1; continue;
        }
        if (tok === 'endif' || tok === 'else' || tok.slice(0,7).toLowerCase() === 'elseif:') {
          i = cl+1; continue;
        }
        var fval = vals[tok];
        if (fval !== undefined && fval !== null) out = sbEmitValue(out, fval, gLock);
        i = cl+1;
      } else {
        out += body[i++];
      }
    }
    return out.replace(/\*\*([^*]+)\*\*/g, '$1')
              .replace(/\[(blue|yellow|red)\]([\s\S]*?)\[\/(?:blue|yellow|red)\]/g, '$2');
  }

  // ── FORM TOKEN FIELD NAME ───────────────────────────────────────
  // formtext/formdate have no options segment: their attributes start at 0.
  function _formAttrSrc(tokLow, rest) {
    if (tokLow.slice(0, 9) !== 'formmenu:') return rest;
    return _parseMenuSettings(rest).attrs;
  }

  function _formFieldName(tokLow, rest) {
    if (tokLow.slice(0, 9) === 'formmenu:') return _parseMenuSettings(rest).name;
    var m = /(?:^|;)\s*name\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/i.exec(rest);
    return m ? m[1] : '';
  }

  // ── FORM MENU SETTINGS ──────────────────────────────────────────
  // Text Blaze separates a menu's options with ';' and lets them sit in any
  // order among the named settings:
  //
  //   {formmenu: 1980; 1985; name=year; default=1985}
  //   {formmenu: name=year; 1980; 1985}
  //
  // SprintBrain's own writer emits them comma-separated in one segment
  // ({formmenu: a,b,c; name=X}). Both are accepted: a ';' segment is a named
  // setting only when it opens with one of the four keys below, otherwise it is
  // positional and its commas split further. That keeps every snippet already
  // authored here working while importing Text Blaze bodies without dropping
  // options — before this, everything after the first ';' was read as settings
  // and silently discarded.
  var MENU_KEYS = /^\s*(name|default|multiple|cols)\s*=/i;

  function _parseMenuSettings(rest) {
    var segs = String(rest === null || rest === undefined ? '' : rest).split(';');
    var options = [], attrs = '', name = '';
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i];
      if (MENU_KEYS.test(seg)) {
        attrs += ';' + seg;
        var nm = /^\s*name\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/i.exec(seg);
        if (nm && !name) name = nm[1];
        continue;
      }
      var parts = seg.split(',');
      for (var j = 0; j < parts.length; j++) {
        var opt = _sTrim(parts[j]);
        if (opt !== '' && options.indexOf(opt) === -1) options.push(opt);
      }
    }
    // An unnamed menu is legal in Text Blaze, so give it a key derived from the
    // token itself: stable wherever it is read from (extractFields, the config
    // builder, resolveBody's {if:} recursion) without depending on walk order.
    if (!name) name = options.length ? 'MENU_' + _menuKeyHash(rest) : '';
    return { options: options, attrs: attrs, name: name };
  }

  function _menuKeyHash(src) {
    var h = 5381, s = String(src);
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  // ── BUTTON COMMAND ──────────────────────────────────────────────
  // {button label="Text" trim=left}FIELD = expr{/button}
  //
  // Unlike every other token, a button is an *interface* element: it renders in
  // the fill form and contributes nothing to the resolved text. Its code block
  // assigns to fields, evaluated through evalFormula — the same recursive-descent
  // evaluator as {= }, so no user string ever reaches eval()/Function().
  var BUTTON_CLOSE = '{/button}';
  var BUTTON_TRIMS = { yes: 1, no: 1, left: 1, right: 1 };

  // Attributes are space-separated key=value; values may be quoted to carry
  // spaces. Deliberately not the ';'-separated form of the other commands — the
  // {button} spec is written this way.
  function _parseButtonAttrs(head) {
    var re = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
    var attrs = {}, m;
    while ((m = re.exec(head)) !== null) {
      var val = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4]);
      attrs[m[1].toLowerCase()] = val;
    }
    return attrs;
  }

  // True when the token opens a button, so a field called "buttonish" doesn't.
  function _isButtonHead(tokLow) {
    if (tokLow.slice(0, 6) !== 'button') return false;
    return tokLow.length === 6 || /\s/.test(tokLow.charAt(6));
  }

  /**
   * Splits a code block into `FIELD = expression` statements. Statements are
   * separated by newlines or ';'. A line the parser cannot read is reported
   * rather than dropped, so a typo never silently does nothing.
   */
  function parseButtonCode(code) {
    var lines = String(code === null || code === undefined ? '' : code).split(/[\n;]+/);
    var statements = [], errors = [];
    for (var i = 0; i < lines.length; i++) {
      var line = _sTrim(lines[i]);
      if (!line) continue;
      var eq = line.indexOf('=');
      var name = eq > -1 ? _sTrim(line.slice(0, eq)) : '';
      if (eq === -1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        errors.push('"' + line + '" is not a FIELD = value line');
        continue;
      }
      var expr = _sTrim(line.slice(eq + 1));
      if (!expr) { errors.push('"' + name + '" has nothing to assign'); continue; }
      statements.push({ name: name, expr: expr });
    }
    return { statements: statements, errors: errors };
  }

  /**
   * Every button in a body, in document order, for the fill form to render.
   * `id` is the occurrence index — stable for a given body, which is all the UI
   * needs to map a click back to its code.
   */
  function extractButtons(body) {
    var src = (body === null || body === undefined) ? '' : String(body);
    var out = [], i = 0;
    while (i < src.length) {
      var open = src.indexOf('{', i);
      if (open === -1) break;
      var cl = src.indexOf('}', open);
      if (cl === -1) break;
      var tok = _sTrim(src.slice(open + 1, cl));
      if (!_isButtonHead(tok.toLowerCase())) { i = open + 1; continue; }
      var close = src.indexOf(BUTTON_CLOSE, cl + 1);
      if (close === -1) break;
      var attrs = _parseButtonAttrs(tok.slice(6));
      var code = src.slice(cl + 1, close);
      var parsed = parseButtonCode(code);
      out.push({
        id: 'btn' + out.length,
        label: attrs.label || 'Run',
        trim: BUTTON_TRIMS[String(attrs.trim || '').toLowerCase()] ? attrs.trim.toLowerCase() : 'no',
        code: code,
        statements: parsed.statements,
        errors: parsed.errors
      });
      i = close + BUTTON_CLOSE.length;
    }
    return out;
  }

  /**
   * Runs a button's statements against the current field values.
   * Assignments apply in order, so a later line sees an earlier line's result.
   * @returns {{ values: Object, errors: string[] }} values to write back
   */
  function applyButtonCode(statements, vals) {
    var scope = {}, values = {}, errors = [];
    for (var k in vals) { if (Object.prototype.hasOwnProperty.call(vals, k)) scope[k] = vals[k]; }
    var list = statements || [];
    for (var i = 0; i < list.length; i++) {
      var st = list[i], res = null;
      try { res = evalFormula(st.expr, scope); } catch (e) { res = null; }
      if (res === null || typeof res !== 'number' || isNaN(res)) {
        errors.push('Could not work out "' + st.expr + '"');
        continue;
      }
      scope[st.name] = res;
      values[st.name] = res;
    }
    return { values: values, errors: errors };
  }

  // ── FIELD EXTRACTOR ─────────────────────────────────────────────
  // Returns unique field names for the overlay form.
  function extractFields(body) {
    var vars = [], re = /\{([^}]+)\}/g, m;
    while ((m = re.exec(body)) !== null) {
      var t = m[1].replace(/^\s+|\s+$/g, '');
      if (t.charAt(0) === '=' || t.charAt(0) === '{' ||
          t === 'endif' || t === 'else' || t === '/button' ||
          t.slice(0,3) === 'if:' || t.slice(0,4) === 'var:' ||
          t.slice(0,7).toLowerCase() === 'elseif:' ||
          t.slice(0,5).toLowerCase() === 'time:' ||
          _isButtonHead(t.toLowerCase())) continue;
      var tokLow = t.toLowerCase();
      var fieldKey = t;
      // A {gender:} token is not a field itself — it reads one, so surface that
      // field instead. It is usually declared elsewhere too; the dup check below
      // keeps the overlay to one input either way.
      if (tokLow.slice(0,7) === 'gender:') {
        fieldKey = sbGenderTokenField(t.slice(7));
        if (!fieldKey) continue;
      } else if (tokLow.slice(0,9) === 'formtext:' || tokLow.slice(0,9) === 'formdate:' || tokLow.slice(0,9) === 'formmenu:') {
        fieldKey = _formFieldName(tokLow, t.slice(9));
        if (!fieldKey) continue;
      }
      var dup = false;
      for (var ix = 0; ix < vars.length; ix++) { if (vars[ix] === fieldKey) { dup = true; break; } }
      if (!dup) vars.push(fieldKey);
    }
    return vars;
  }

  // ── FORM FIELD CONFIG BUILDER ───────────────────────────────────
  function _sTrim(s) { return String(s).replace(/^\s+|\s+$/g, ''); }

  // Derives type/options/default from {formtext/date/menu:} tokens.
  //
  // {formmenu:} carries three optional attributes beyond `name`:
  //   default=X[,Y]  — preselected option(s); silently dropped when not declared
  //   multiple=yes   — the field accepts several picks, joined with ", " on output
  //   cols=N         — field width in characters (presentation only)
  function buildFormFieldCfg(body) {
    var cfg = {}, re = /\{([^}]+)\}/g, m;
    while ((m = re.exec(body)) !== null) {
      var t = m[1].replace(/^\s+|\s+$/g, '');
      var tokLow = t.toLowerCase();
      var prefix = null;
      if (tokLow.slice(0,9) === 'formtext:') prefix = 'formtext';
      else if (tokLow.slice(0,9) === 'formdate:') prefix = 'formdate';
      else if (tokLow.slice(0,9) === 'formmenu:') prefix = 'formmenu';
      if (!prefix) continue;
      var rest = t.slice(9);
      var key = _formFieldName(tokLow, rest);
      if (!key) continue;
      if (cfg[key]) continue;
      var defM = /(?:^|;)\s*default\s*=\s*([^;]+)/i.exec(_formAttrSrc(tokLow, rest));
      var defVal = defM ? defM[1].replace(/^\s+|\s+$/g, '') : '';
      if (prefix === 'formdate') {
        cfg[key] = { type: 'date', default: defVal };
      } else if (prefix === 'formmenu') {
        var menuSet = _parseMenuSettings(rest);
        var attrs = menuSet.attrs;
        var opts = menuSet.options;
        var multi = /(?:^|;)\s*multiple\s*=\s*(?:yes|true|1)\s*(?:;|$)/i.test(attrs);
        var colsM = /(?:^|;)\s*cols\s*=\s*(\d+)/i.exec(attrs);
        // Only declared options can be preselected — a default naming an option
        // that no longer exists must not become an unpickable value.
        var picks = defVal
          ? defVal.split(',').map(_sTrim).filter(function(d){ return opts.indexOf(d) !== -1; })
          : [];
        if (!multi) picks = picks.slice(0, 1);
        var menu = { type: 'dd', opts: opts.join('\n'), default: picks.join(', ') };
        if (multi) menu.multiple = true;
        if (colsM) {
          var cols = parseInt(colsM[1], 10);
          if (cols > 0) menu.cols = cols;
        }
        cfg[key] = menu;
      } else {
        cfg[key] = { type: 'text', default: defVal };
      }
    }
    return cfg;
  }

  // ── FORM MENU TOKEN WRITER ──────────────────────────────────────
  // Serializes a {formmenu:} token from an insert-dialog config — the exact
  // inverse of the formmenu branch above, so every token this writes parses
  // back to the same options / default / multiple / cols.
  //
  // `,` `;` `{` `}` are the token grammar's own delimiters, so they collapse to
  // a space inside an option label rather than breaking the snippet.
  //
  // MIRRORED in app/src/lib/formMenuToken.ts — the React dashboard cannot import
  // extension source (see app/CLAUDE.md §6). Change both together.
  function _menuSafe(s) {
    return _sTrim(String(s).replace(/[,;{}]/g, ' ').replace(/\s+/g, ' '));
  }

  // Reads a formmenu cfg `default` ("A, B") back into the picked options. Every
  // renderer preselects from this, so the separator is defined in one place.
  function formMenuPicks(defaultStr) {
    if (defaultStr === null || defaultStr === undefined) return [];
    return String(defaultStr).split(',').map(_sTrim).filter(function(v){ return v !== ''; });
  }

  function buildFormMenuToken(cfg) {
    var c = cfg || {};
    var opts = [], seen = {};
    var raw = c.options || [];
    for (var i = 0; i < raw.length; i++) {
      var o = _menuSafe(raw[i]);
      if (o !== '' && !seen[o]) { seen[o] = 1; opts.push(o); }
    }

    // A blank name is written as no `name=` at all, matching Text Blaze — the
    // parser then keys the menu from the token itself. A name that was typed
    // but is not a usable identifier is repaired rather than emitted broken.
    var name = String(c.name || '').replace(/[^A-Za-z0-9_]/g, '');
    if (name !== '' && !/^[A-Za-z_]/.test(name)) name = 'MENU_' + name;

    var picks = [];
    var sel = c.selected || [];
    for (var j = 0; j < sel.length; j++) {
      var p = _menuSafe(sel[j]);
      if (opts.indexOf(p) !== -1 && picks.indexOf(p) === -1) picks.push(p);
    }
    if (!c.multiple) picks = picks.slice(0, 1);

    var out = '{formmenu: ' + opts.join(',') + (name === '' ? '' : '; name=' + name);
    if (picks.length) out += '; default=' + picks.join(',');
    if (c.multiple) out += '; multiple=yes';
    var cols = parseInt(c.cols, 10);
    if (cols > 0) out += '; cols=' + cols;
    return out + '}';
  }

  // ── FORM MENU TOKEN READER ──────────────────────────────────────
  // The inverse of buildFormMenuToken: turns a token already sitting in a body
  // back into the config a builder can load, so changing a menu's options is an
  // edit in the builder rather than hand-surgery on the raw token text.
  //
  // Options and settings come from _parseMenuSettings — the same parser the
  // fill form uses — so what a builder shows can never disagree with what
  // actually expands. The one thing NOT taken from it is the name: an unnamed
  // menu must stay unnamed here, or re-saving would bake its derived hash in.
  //
  // MIRRORED in app/src/lib/formMenuToken.ts (the dashboard cannot import
  // extension source — app/CLAUDE.md §6). Change both together.
  var MENU_HEAD_RE = /^\{\s*formmenu\s*:/i;

  function parseFormMenuToken(raw) {
    var src = _sTrim(String(raw === null || raw === undefined ? '' : raw));
    var head = MENU_HEAD_RE.exec(src);
    if (!head || src.charAt(src.length - 1) !== '}') return null;

    var set = _parseMenuSettings(src.slice(head[0].length, src.length - 1));
    var multiple = /(?:^|;)\s*multiple\s*=\s*(?:yes|true|1)\s*(?:;|$)/i.test(set.attrs);
    var nameM = /(?:^|;)\s*name\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/i.exec(set.attrs);
    var colsM = /(?:^|;)\s*cols\s*=\s*(\d+)/i.exec(set.attrs);
    var defM = /(?:^|;)\s*default\s*=\s*([^;]+)/i.exec(set.attrs);

    // Only declared options can be preselected, and a single-choice menu holds
    // one — the same rules buildFormFieldCfg applies, so the builder opens on
    // exactly the selection the fill form would show.
    var picks = defM ? formMenuPicks(defM[1]).filter(function(d){
      return set.options.indexOf(d) !== -1;
    }) : [];
    if (!multiple) picks = picks.slice(0, 1);

    var cols = colsM ? parseInt(colsM[1], 10) : 0;
    return {
      options:  set.options,
      selected: picks,
      name:     nameM ? nameM[1] : '',
      multiple: multiple,
      cols:     cols > 0 ? cols : null
    };
  }

  /**
   * The {formmenu:} token containing `caret`, or null. A caret on either brace
   * counts as inside, so clicking at the very end of a token still finds it.
   * Between two touching menus the earlier one wins — deterministic, and the
   * caret is visually at its closing brace.
   * @returns {{start:number, end:number, raw:string}|null} end is exclusive.
   */
  function findMenuTokenAt(body, caret) {
    var src = (body === null || body === undefined) ? '' : String(body);
    var pos = typeof caret === 'number' && isFinite(caret) ? caret : 0;
    if (pos < 0) pos = 0;
    if (pos > src.length) pos = src.length;

    var i = 0;
    while (i < src.length) {
      var open = src.indexOf('{', i);
      if (open === -1) break;
      var close = src.indexOf('}', open + 1);
      if (close === -1) break;
      var raw = src.slice(open, close + 1);
      if (!MENU_HEAD_RE.test(raw)) { i = open + 1; continue; }
      if (pos >= open && pos <= close + 1) return { start: open, end: close + 1, raw: raw };
      i = close + 1;
    }
    return null;
  }

  // ── BUTTON TOKEN WRITER ─────────────────────────────────────────
  // Serializes a {button …}code{/button} token from an insert-dialog config —
  // the inverse of extractButtons(), so every token this writes parses back.
  //
  // MIRRORED in app/src/lib/formButtonToken.ts — the React dashboard cannot
  // import extension source (app/CLAUDE.md §6). Change both together.
  function _btnLabelSafe(s) {
    // `"` would close the attribute; braces would end the token early.
    return _sTrim(String(s).replace(/["{}]/g, '').replace(/\s+/g, ' '));
  }

  function _btnExprSafe(s) {
    // ';' and newlines separate statements; braces end the token.
    return _sTrim(String(s).replace(/[;{}\r\n]/g, ' ').replace(/\s+/g, ' '));
  }

  function buildFormButtonToken(cfg) {
    var c = cfg || {};
    var lines = [], raw = c.lines || [];
    for (var i = 0; i < raw.length; i++) {
      var field = String(raw[i].field || '').replace(/[^A-Za-z0-9_]/g, '');
      var expr = _btnExprSafe(raw[i].expr || '');
      if (!field || !expr) continue;
      if (!/^[A-Za-z_]/.test(field)) field = 'F' + field;
      lines.push(field + ' = ' + expr);
    }

    var head = '{button';
    var label = _btnLabelSafe(c.label || '');
    if (label) head += ' label="' + label + '"';
    var trim = String(c.trim || '').toLowerCase();
    if (BUTTON_TRIMS[trim] && trim !== 'no') head += ' trim=' + trim;
    return head + '}' + lines.join('; ') + BUTTON_CLOSE;
  }

  // ── PLACEHOLDER ENGINE (double-brace only) ──────────────────────
  function parsePlaceholders(body) {
    var regex = /\{\{([a-zA-Z0-9_]+)\}\}/g, found = {}, result = [], match;
    while ((match = regex.exec(body)) !== null) {
      if (!found[match[1]]) { found[match[1]] = true; result.push(match[1]); }
    }
    return result;
  }

  function interpolateSnippet(body, varMap) {
    return body.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, function(match, key) {
      return Object.prototype.hasOwnProperty.call(varMap, key) ? varMap[key] : match;
    });
  }

  // ── TEMPLATE VALIDATOR ──────────────────────────────────────────
  // Structural faults that make resolveBody() emit visibly wrong output while
  // failing silently — the user only finds out after pasting to a guest.
  // Walks the same tokenizer as resolveBody so a verdict here matches what the
  // engine actually does with the body.
  //
  // Deliberately narrow: only faults with no legitimate authoring reason. A
  // stray "{" around prose or code still resolves to an unknown field (and is
  // dropped), but that shape is common enough in real bodies that flagging it
  // would be noise, not a signal.
  //
  // MIRRORED in app/src/lib/statusSignals.ts (the dashboard cannot import
  // extension source — see app/CLAUDE.md §6). Change both together.
  function validateTemplate(body) {
    var src = (body === null || body === undefined) ? '' : String(body);
    var i = 0, depth = 0;
    while (i < src.length) {
      if (src.charAt(i) !== '{') { i++; continue; }
      if (src.charAt(i + 1) === '{') {
        var dcl = src.indexOf('}}', i + 2);
        if (dcl === -1) return _invalid('unterminated-token');
        i = dcl + 2; continue;
      }
      var cl = src.indexOf('}', i);
      if (cl === -1) return _invalid('unterminated-token');
      var tok = src.slice(i + 1, cl).replace(/^\s+|\s+$/g, '');
      if (tok.slice(0, 3) === 'if:') {
        depth++;
      } else if (tok === 'endif') {
        if (depth === 0) return _invalid('orphan-branch');
        depth--;
      } else if (tok === 'else' || tok.slice(0, 7).toLowerCase() === 'elseif:') {
        if (depth === 0) return _invalid('orphan-branch');
      } else if (_isButtonHead(tok.toLowerCase())) {
        // An unclosed button prints its own code block at the guest. A closed one
        // is skipped whole — the block is code, not text to be validated.
        var bClose = src.indexOf(BUTTON_CLOSE, cl + 1);
        if (bClose === -1) return _invalid('unclosed-button');
        i = bClose + BUTTON_CLOSE.length;
        continue;
      } else if (tok === '/button') {
        return _invalid('orphan-branch');
      }
      i = cl + 1;
    }
    if (depth > 0) return _invalid('unclosed-if');
    return { ok: true, code: null, message: '' };
  }

  var VALIDATION_MESSAGES = {
    'unterminated-token': 'A { is never closed — it prints literally instead of filling in.',
    'orphan-branch': 'A branch tag has no matching {if:} — the condition is ignored.',
    'unclosed-if': 'An {if:} is never closed with {endif} — its content is dropped.',
    'unclosed-button': 'A {button} is never closed with {/button} — its code prints as text.'
  };

  function _invalid(code) {
    return { ok: false, code: code, message: VALIDATION_MESSAGES[code] };
  }

  // ── PUBLIC API ──────────────────────────────────────────────────
  var API = {
    resolveBody:       resolveBody,
    extractFields:     extractFields,
    validateTemplate:  validateTemplate,
    buildFormFieldCfg: buildFormFieldCfg,
    buildFormMenuToken: buildFormMenuToken,
    parseFormMenuToken: parseFormMenuToken,
    findMenuTokenAt:   findMenuTokenAt,
    formMenuPicks:     formMenuPicks,
    buildFormButtonToken: buildFormButtonToken,
    extractButtons:    extractButtons,
    parseButtonCode:   parseButtonCode,
    applyButtonCode:   applyButtonCode,
    parsePlaceholders: parsePlaceholders,
    interpolateSnippet: interpolateSnippet,
    evalFormula:       evalFormula,
    evalCondition:     evalCondition,
    sbNameGender:      sbNameGender,
    sbFormatDate:      sbFormatDate,
    sbParseTimeToken:  sbParseTimeToken
  };

  // UMD: supports browser globals, CommonJS (Node), and AMD.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else if (typeof define === 'function' && define.amd) {
    define(function() { return API; });
  } else {
    root.SBFormulaEngine = API;
  }

}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this));
