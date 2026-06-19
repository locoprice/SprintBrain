// ── SPRINTBRAIN FORMULA ENGINE v2.62.12 ───────────────────────────
// Standalone module — no Chrome API dependencies.
// Shared by the Chrome extension content script (inlined) and Sprintbrain.html.
//
// Supported syntax:
//   {{VARIABLE_NAME}}          — placeholder (filled by user)
//   {{= EXPRESSION }}          — evaluated math formula
//   {= EXPRESSION}             — legacy single-brace formula
//   {var: NAME = EXPRESSION}   — local variable declaration
//   {time: FORMAT}             — date/time token
//   {formtext: name=VAR; default=X}   — text input field
//   {formdate: name=VAR}              — date input field
//   {formmenu: opt1,opt2; name=VAR}   — dropdown field
//   {if: COND}...{elseif: COND}...{else}...{endif}  — conditional blocks
//
// Math: +, -, *, /, parentheses, round(), floor(), ceil(), abs(), min(), max()
// String comparison in conditions: VAR = "value", VAR != "value"
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
      return (r === null || isNaN(r)) ? null : Math.round(r * 100) / 100;
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
  function resolveBody(body, vals) {
    if (!body) return '';
    var out = '', i = 0;
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
            out += (dval !== undefined && dval !== null) ? String(dval) : '{{' + dtok + '}}';
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
        if (tokLow.slice(0,9) === 'formtext:' || tokLow.slice(0,9) === 'formdate:' || tokLow.slice(0,9) === 'formmenu:') {
          var formRest = tok.slice(9);
          var fNameM = /(?:^|;)\s*name\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/i.exec(formRest);
          var fKey = fNameM ? fNameM[1] : '';
          out += String(fKey && vals[fKey] !== undefined ? vals[fKey] : '');
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
            if (brOk) { out += resolveBody(br.body, vals); break; }
          }
          i = eidx !== -1 ? eidx + ei.length : cl+1; continue;
        }
        if (tok === 'endif' || tok === 'else' || tok.slice(0,7).toLowerCase() === 'elseif:') {
          i = cl+1; continue;
        }
        var fval = vals[tok];
        out += (fval !== undefined && fval !== null) ? String(fval) : '';
        i = cl+1;
      } else {
        out += body[i++];
      }
    }
    return out.replace(/\*\*([^*]+)\*\*/g, '$1')
              .replace(/\[(blue|yellow|red)\]([\s\S]*?)\[\/(?:blue|yellow|red)\]/g, '$2');
  }

  // ── FIELD EXTRACTOR ─────────────────────────────────────────────
  // Returns unique field names for the overlay form.
  function extractFields(body) {
    var vars = [], re = /\{([^}]+)\}/g, m;
    while ((m = re.exec(body)) !== null) {
      var t = m[1].replace(/^\s+|\s+$/g, '');
      if (t.charAt(0) === '=' || t.charAt(0) === '{' ||
          t === 'endif' || t === 'else' ||
          t.slice(0,3) === 'if:' || t.slice(0,4) === 'var:' ||
          t.slice(0,7).toLowerCase() === 'elseif:' ||
          t.slice(0,5).toLowerCase() === 'time:') continue;
      var tokLow = t.toLowerCase();
      var fieldKey = t;
      if (tokLow.slice(0,9) === 'formtext:' || tokLow.slice(0,9) === 'formdate:' || tokLow.slice(0,9) === 'formmenu:') {
        var fNm = /(?:^|;)\s*name\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/i.exec(t.slice(9));
        if (!fNm) continue;
        fieldKey = fNm[1];
      }
      var dup = false;
      for (var ix = 0; ix < vars.length; ix++) { if (vars[ix] === fieldKey) { dup = true; break; } }
      if (!dup) vars.push(fieldKey);
    }
    return vars;
  }

  // ── FORM FIELD CONFIG BUILDER ───────────────────────────────────
  // Derives type/options/default from {formtext/date/menu:} tokens.
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
      var nameM = /(?:^|;)\s*name\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/i.exec(rest);
      if (!nameM) continue;
      var key = nameM[1];
      if (cfg[key]) continue;
      var defM = /(?:^|;)\s*default\s*=\s*([^;]+)/i.exec(rest);
      var defVal = defM ? defM[1].replace(/^\s+|\s+$/g, '') : '';
      if (prefix === 'formdate') {
        cfg[key] = { type: 'date', default: defVal };
      } else if (prefix === 'formmenu') {
        var optStr = rest.split(';')[0].replace(/^\s+|\s+$/g, '');
        cfg[key] = { type: 'dd', opts: optStr.split(',').map(function(o){ return o.replace(/^\s+|\s+$/g, ''); }).join('\n') };
      } else {
        cfg[key] = { type: 'text', default: defVal };
      }
    }
    return cfg;
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

  // ── PUBLIC API ──────────────────────────────────────────────────
  var API = {
    resolveBody:       resolveBody,
    extractFields:     extractFields,
    buildFormFieldCfg: buildFormFieldCfg,
    parsePlaceholders: parsePlaceholders,
    interpolateSnippet: interpolateSnippet,
    evalFormula:       evalFormula,
    evalCondition:     evalCondition,
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
