// ── SPRINTBRAIN CONTENT SCRIPT v2.56.0 ────────────────────────────
// Configurable dual triggers + confetti celebration + analytics event log
// v2.29.0: lang-modal expansion fix — defer trigger deletion until after
//          language pick (modal focus was wiping the CE selection set by
//          deleteChars, leaving the literal ::shortcut in the field)
// v2.56.0: selection-triggered suggestions — selecting text in any editable
//          field surfaces keyword-mapped snippets in a floating, selection-
//          anchored menu; picking one replaces the selection via the existing
//          expansion pipeline. Toggle: triggerCfg.selectionSuggestions.

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
var FUNS = {round:1,floor:1,ceil:1,abs:1,min:1,max:1,datetimediff:1};

// ── DATE/TIME HELPERS ─────────────────────────────────────────────
function _sbPad(n){ return (n < 10 ? '0' : '') + n; }

function sbFormatDate(d, fmt){
  if (!d || isNaN(d.getTime())) return '';
  var M = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var W = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var hr12 = d.getHours() % 12; if (hr12 === 0) hr12 = 12;
  var tok = {
    YYYY: String(d.getFullYear()),
    YY:   String(d.getFullYear()).slice(-2),
    MMMM: M[d.getMonth()],
    MMM:  M[d.getMonth()].slice(0,3),
    MM:   _sbPad(d.getMonth()+1),
    DD:   _sbPad(d.getDate()),
    D:    String(d.getDate()),
    dddd: W[d.getDay()],
    ddd:  W[d.getDay()].slice(0,3),
    HH:   _sbPad(d.getHours()),
    H:    String(d.getHours()),
    hh:   _sbPad(hr12),
    h:    String(hr12),
    mm:   _sbPad(d.getMinutes()),
    m:    String(d.getMinutes()),
    ss:   _sbPad(d.getSeconds()),
    s:    String(d.getSeconds()),
    A:    d.getHours() < 12 ? 'AM' : 'PM',
    a:    d.getHours() < 12 ? 'am' : 'pm'
  };
  // Order: longer tokens first to prevent partial matches
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

function sbApplyShift(d, shift){
  if (!shift) return d;
  var m = /^([+-])\s*(\d+)\s*(Mo|M|H|D|W|Y)$/.exec(String(shift).replace(/\s+/g,''));
  if (!m) return d;
  var sign = m[1] === '-' ? -1 : 1;
  var n = parseInt(m[2], 10) * sign;
  var u = m[3];
  var out = new Date(d.getTime());
  if (u === 'M')  out.setMinutes(out.getMinutes() + n);
  else if (u === 'H')  out.setHours(out.getHours() + n);
  else if (u === 'D')  out.setDate(out.getDate() + n);
  else if (u === 'W')  out.setDate(out.getDate() + n * 7);
  else if (u === 'Mo') out.setMonth(out.getMonth() + n);
  else if (u === 'Y')  out.setFullYear(out.getFullYear() + n);
  return out;
}

function sbParseUserDate(s){
  if (s == null || s === '') return null;
  var str = String(s).replace(/^\s+|\s+$/g, '');
  // HH:mm — today at that time
  var mt = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(str);
  if (mt) { var d = new Date(); d.setHours(+mt[1], +mt[2], +(mt[3]||0), 0); return d; }
  // YYYY-MM-DD
  var md = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (md) return new Date(+md[1], +md[2]-1, +md[3]);
  // YYYY-MM-DDTHH:mm
  var mdt = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(str);
  if (mdt) return new Date(+mdt[1], +mdt[2]-1, +mdt[3], +mdt[4], +mdt[5], +(mdt[6]||0));
  var dd = new Date(str);
  return isNaN(dd.getTime()) ? null : dd;
}

function sbParseTimeToken(rest, vals){
  // "FORMAT[; shift=+1D][; from=FIELD]"
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

function sbDatetimeDiffUnitMs(unit){
  var u = String(unit || '').toLowerCase();
  if (u === 'second' || u === 'seconds' || u === 's' || u === 'sec') return 1000;
  if (u === 'minute' || u === 'minutes' || u === 'min')              return 60000;
  if (u === 'hour'   || u === 'hours'   || u === 'h')                return 3600000;
  if (u === 'day'    || u === 'days'    || u === 'd')                return 86400000;
  return 60000;
}

// Preprocess datetimediff(A, B, "unit") calls: identifiers resolve from vals
// (so date/time strings like "2026-04-20" become numeric diffs before safeEval).
function sbResolveDatetimeDiff(expr, vals){
  var re = /datetimediff\s*\(\s*([A-Za-z_]\w*|"[^"]*"|'[^']*')\s*,\s*([A-Za-z_]\w*|"[^"]*"|'[^']*')\s*,\s*["']([^"']+)["']\s*\)/g;
  return String(expr).replace(re, function(_, a, b, unit){
    function resolve(arg) {
      if (arg.charAt(0) === '"' || arg.charAt(0) === "'") return arg.slice(1, -1);
      return (vals && vals[arg] !== undefined) ? String(vals[arg]) : '';
    }
    var da = sbParseUserDate(resolve(a));
    var db = sbParseUserDate(resolve(b));
    if (!da || !db) return '0';
    var ms = db.getTime() - da.getTime();
    return String(ms / sbDatetimeDiffUnitMs(unit));
  });
}

function evalFormula(expr, vals) {
  try {
    // Resolve datetimediff(A,B,"unit") to a literal number first, so string
    // date fields (CHECKIN, CHECKOUT, etc.) don't get clobbered to 0 below.
    var s = sbResolveDatetimeDiff(expr, vals);
    // Substitute remaining variable names with their numeric values
    s = s.replace(/[A-Za-z_][A-Za-z0-9_]*/g, function(n) {
      if (FUNS[n]) return n;
      var v = parseFloat(vals[n]);
      return isNaN(v) ? '0' : String(v);
    });
    var r = safeEval(s);
    return (r === null || isNaN(r)) ? null : Math.round(r * 100) / 100;
  } catch(e) { return null; }
}

/**
 * CSP-safe recursive descent parser for math expressions.
 * Supports: +, -, *, /, parentheses, decimals, negation,
 * and whitelisted functions: round, floor, ceil, abs, min, max.
 * No eval() or Function() — works under strict CSP policies.
 */
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
    // Unary minus
    if (str[pos] === '-') { pos++; return -parseFactor(); }
    // Unary plus
    if (str[pos] === '+') { pos++; return parseFactor(); }

    // Check for function names
    var fnMatch = str.slice(pos).match(/^(round|floor|ceil|abs|min|max)\(/);
    if (fnMatch) {
      var fn = fnMatch[1];
      pos += fn.length + 1; // skip "fn("
      var args = parseArgs();
      if (str[pos] === ')') pos++;
      if (fn === 'round') return Math.round(args[0]);
      if (fn === 'floor') return Math.floor(args[0]);
      if (fn === 'ceil')  return Math.ceil(args[0]);
      if (fn === 'abs')   return Math.abs(args[0]);
      if (fn === 'min')   return Math.min.apply(null, args);
      if (fn === 'max')   return Math.max.apply(null, args);
    }

    // Parenthesized expression
    if (str[pos] === '(') {
      pos++;
      var val = parseExpr();
      if (str[pos] === ')') pos++;
      return val;
    }

    // Number literal
    var numStr = '';
    while (pos < str.length && (str[pos] >= '0' && str[pos] <= '9' || str[pos] === '.')) {
      numStr += str[pos++];
    }
    if (numStr === '') return NaN;
    return parseFloat(numStr);
  }

  function parseArgs() {
    var args = [parseExpr()];
    while (str[pos] === ',') {
      pos++;
      args.push(parseExpr());
    }
    return args;
  }

  var result = parseExpr();
  return pos === str.length ? result : NaN;
}

function resolveBody(body, vals) {
  if (!body) return '';
  var out = '', i = 0;
  while (i < body.length) {
    if (body[i] === '{') {
      var cl = body.indexOf('}', i);
      if (cl === -1) { out += body[i++]; continue; }
      var tok = body.slice(i+1, cl).replace(/^\s+|\s+$/g, '');
      if (tok.slice(0, 4) === 'var:') {
        var vdecl = tok.slice(4).replace(/^\s+|\s+$/g, '');
        var veq = vdecl.indexOf('=');
        if (veq > -1) {
          var vname = vdecl.slice(0, veq).replace(/^\s+|\s+$/g, '');
          var vexpr = vdecl.slice(veq + 1).replace(/^\s+|\s+$/g, '');
          try {
            var vres = evalFormula(vexpr, vals);
            vals[vname] = (vres !== null && typeof vres === 'number' && !isNaN(vres))
              ? vres : 0;
          } catch(e) {
            vals[vname] = 0;
            console.error('[SprintBrain] {var:} eval error:', vname, vexpr, e.message);
          }
        }
        i = cl + 1; continue;
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
      if (tok.slice(0,3) === 'if:') {
        var cond = tok.slice(3).replace(/^\s+|\s+$/g, '');
        var ei = '{endif}', eidx = body.indexOf(ei, cl+1);
        var inner = eidx !== -1 ? body.slice(cl+1, eidx) : '';
        var cr = false;
        try {
          var condResult = evalFormula(cond, vals);
          cr = condResult !== null && condResult !== 0;
        } catch(e) {}
        if (cr) out += resolveBody(inner, vals);
        i = eidx !== -1 ? eidx + ei.length : cl+1; continue;
      }
      if (tok === 'endif') { i = cl+1; continue; }
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

function extractFields(body) {
  var vars = [], re = /\{([^}]+)\}/g, m;
  while ((m = re.exec(body)) !== null) {
    var t = m[1].replace(/^\s+|\s+$/g, '');
    if (t.charAt(0) !== '=' && t !== 'endif' &&
        t.slice(0,3) !== 'if:' && t.slice(0,4) !== 'var:' &&
        t.slice(0,5).toLowerCase() !== 'time:') {
      var dup = false;
      for (var i = 0; i < vars.length; i++) { if (vars[i] === t) { dup = true; break; } }
      if (!dup) vars.push(t);
    }
  }
  return vars;
}

// ── DOUBLE-BRACE PLACEHOLDER ENGINE ──────────────────────────────
/**
 * Extracts unique {{variable}} placeholders from a snippet body.
 * @param {string} body
 * @returns {string[]} array of unique variable names, empty if none found
 */
function parsePlaceholders(body) {
  var regex = /\{\{([a-zA-Z0-9_]+)\}\}/g;
  var found = {};
  var result = [];
  var match;
  while ((match = regex.exec(body)) !== null) {
    if (!found[match[1]]) {
      found[match[1]] = true;
      result.push(match[1]);
    }
  }
  return result;
}

/**
 * Replaces {{var}} tokens in body using values from varMap.
 * Unresolved placeholders are preserved as-is.
 * @param {string} body
 * @param {Object} varMap  e.g. { name: "Giulia", time_of_day: "morning" }
 * @returns {string}
 */
function interpolateSnippet(body, varMap) {
  return body.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, function(match, key) {
    return Object.prototype.hasOwnProperty.call(varMap, key)
      ? varMap[key]
      : match;
  });
}

// ── DEFAULT SNIPPETS ───────────────────────────────────────────────
// Sprintbrain Snippets — imported from Text Blaze
// Groups: PRESUPUESTOS (5) + RESERVATION MGMT (15)
// Total: 20 snippets
var DEFAULT_SNIPPETS = [
  // ── PRESUPUESTOS ──────────────────────────────────────────────────
  {id:'quoteEN', shortcut:'/quoteEN', title:'💰 ESTIMATE B2C ver. 3.6', lang:'EN', cat:'PRESUPUESTOS',
   body:'📋 QUOTATION SENT h.[TIME_HH:MM] · [DATE_DD/MM/YYYY]\nValid for 3 hours.\n\nYour request: [ENQUIRE_FORM]\n🔗Property: https://www.leibtour.com/stays/\n\nCheck-in: [CHECKIN DD/MM/YYYY]\nCheck-out: [CHECKOUT DD/MM/YYYY]\n\nRoom: Studio (no terrace)\nCala Llonga area\nRate Plan: NOT Refundable - always cheaper\nPayment methods: Credit / Debit card +3%\n\n★ Your Price: [YOUR_PRICE]€ (extra savings when you choose how to pay)\n\n- Bank Transfer: [YOUR_PRICE - 25]€ ❤️ Loved by our guests\n- Card: [YOUR_PRICE × 1.03]€\n\nOriginal Accommodation Price: [OTA_PRICE]€\n✓ You save: [OTA_PRICE - YOUR_PRICE]€\n✓ You also save: OTA service fees (typically 12-18%)\n✓ Discount codes: Not valid\n✓ Payment terms: Full payment upon confirmation\n\nCANCELLATION POLICY\n⚠️ NON-REFUNDABLE — Generally offer a lower price compared to refundable fares, but they come with stricter cancellation policies.\n\n📎 Full cancellation terms → leibtour.com/policy\n❓ FAQ & booking process → leibtour.com/faqs/booking-process\n\nNote:\n1. Only 1 unit(s) left at this rate. The price will increase.\n2. COMBO DEALS: book the accommodation and save on Car Hire: zero excess, zero deposit, full insurance.'},
  {id:'quoteES', shortcut:'/quoteES', title:'💰 PRESUPUESTO B2C', lang:'ES', cat:'PRESUPUESTOS',
   body:'📋 PRESUPUESTO ENVIADO h.[HH:mm] · [DD/MM/YYYY]\nVálido por 3 horas.\n\nTu solicitud: [ENQUIRE_FORM]\n🔗Alojamiento: https://www.leibtour.com/stays/\n\nCheck-in: [CHECKIN]\nCheck-out: [CHECKOUT]\n\nHabitación: Estudio (sin terraza) zona Cala Llonga\nTarifa: NO Reembolsable - siempre más barata\nMétodos de pago: Tarjeta de crédito / débito +3%\n\nPrecio original del alojamiento: [OTA_PRICE]€\n★ Tu precio: [YOUR_PRICE]€\n✓ Ahorras: [OTA_PRICE - YOUR_PRICE]€\n✓ También ahorras: comisiones de servicio OTA (normalmente 12-18%)\n✓ Códigos de descuento: No válidos\n✓ Condiciones de pago: Pago completo a la confirmación\n\nOPCIONES DE PAGO\n- Transferencia bancaria: [YOUR_PRICE - 25]€ ❤️ La preferida por nuestros huéspedes\n- Tarjeta: [YOUR_PRICE × 1.03]€\n\nPOLÍTICA DE CANCELACIÓN\n⚠️ NO REEMBOLSABLE — Precio más bajo. Pago inmediato. Sin cancelación.\n\n📎 Condiciones completas de cancelación → leibtour.com/policy\n❓ Preguntas frecuentes → leibtour.com/faqs/booking-process\n\nNota:\n1. Solo queda 1 unidad a esta tarifa. Tarifas dinámicas, el precio subirá.\n2. COMBO DEALS: reserva el alojamiento y ahorra en también en alquiler de Coche: sin franquicia, sin depósito, seguro a todo riesgo incluido.'},
  {id:'quoteIT', shortcut:'/quoteIT', title:'💰 PREVENTIVO B2C', lang:'IT', cat:'PRESUPUESTOS',
   body:'📋 PREVENTIVO INVIATO 🕑 [HH:mm] · [DD/MM/YYYY]\nValido per 3 ore.\n\nLa tua richiesta: [ENQUIRE_FORM]\n🔗Alloggio: https://www.leibtour.com/stays/\n\nCheck-in: [CHECKIN]\nCheck-out: [CHECKOUT]\n\nCamera: Monolocale (senza terrazza) zona Cala Llonga\nTariffa: NON Rimborsabile - sempre più conveniente\nMetodi di pagamento: Carta di credito / debito +3%\n\nPrezzo originale: [OTA_PRICE]€\n★ La tua tariffa: [YOUR_PRICE]€\n✓ Risparmi: [OTA_PRICE - YOUR_PRICE]€\n✓ Risparmi anche: commissioni di servizio OTA (solitamente 12-18%)\n✓ Codici sconto: Non validi\n✓ Condizioni di pagamento: Pagamento completo alla conferma\n\nOPZIONI DI PAGAMENTO\n- Bonifico: [YOUR_PRICE - 25]€ ❤️ Preferito dai nostri ospiti\n- Carta: [YOUR_PRICE × 1.03]€\n\nPOLITICA DI CANCELLAZIONE\n⚠️ NON RIMBORSABILE — Prezzo più basso, cancellazione non consentita.\n\n📎 Condizioni complete di cancellazione → leibtour.com/policy\n❓ FAQ → leibtour.com/faqs/booking-process\n\nNote:\n- Ultima unità disponibile. Tariffa dinamica, il prezzo salirà.\n- COMBO DEALS prenota l\'alloggio e risparmia anche su noleggio auto: nessuna franchigia, zero deposito, assicurazione casco inclusa.'},
  {id:'neob', shortcut:'/neob', title:'💻 NEO BOOKING', lang:'ES', cat:'PRESUPUESTOS',
   body:'Buenos días [NOMBRE_PROVEEDOR]:\n\nSoy Valentina y paso otra reserva LeibTour 🎉\n\nSi necesitais cualquier cosa estoy a completa disposición :)\n\nSi el cliente rellena el formulario Real Decreto os envio su DNI/Pasaporte para hacer un pre-checkin.\n\nNecesitaríamos factura por favor.\n\nEl cliente debe ecotasa y sabe que tiene que abonarla a su llegada.\n\nPosiblemente darles a los huespedes una buena habitacion en la planta mas alta disponible :)\n\nEn cuanto a la configuración de las camas, son amigos, por lo tanto necesitan camas individuales 🛏️🛏️\n\nHasta la próxima reserva ♡'},
  {id:'locoprice', shortcut:'/locoprice', title:'CLIENTE CERCA ACCOMMODATION', lang:'MULTI', cat:'PRESUPUESTOS',
   body:'I suggest you find something online and share the link with us. We can offer you a B2B quotation on any accommodation worldwide: https://www.locoprice.com/better-price/.\n\nShare any offer you might find online, and we will provide you with a better B2B quotation for any accommodation worldwide.\n\n---\n\nTi suggerisco di cercare qualcosa online e di mandarmi il link. Possiamo offrirti un preventivo B2B per qualsiasi tipo di alloggio in tutto il mondo: https://www.locoprice.com/better-price/.\n\n---\n\nTe aconsejo que busque algo por internet y nos comparta el enlace. Podemos ofrecerte una cotización B2B en cualquier alojamiento a nivel mundial: https://www.locoprice.com/better-price/'},
  // ── RESERVATION MGMT ──────────────────────────────────────────────
  {id:'followup', shortcut:'/followup', title:'FOLLOW UP', lang:'MULTI', cat:'RESERVATION MGMT',
   body:'Hey there! Any update for me? Did you finally book your accommodation in Ibiza? Please let me know since I have several properties around the island :D\n\nI will be more than happy to assist you.\n\nRegards\n\n---\n\n¡Hola! ¿Tienes alguna novedad para mí? ¿Finalmente reservaste tu alojamiento en Ibiza? Por favor, avísame ya que tengo varias propiedades en la isla :D\n\nEstaré más que encantado de ayudarte.\n\nSaludos\n\n---\n\nCiao! Hai qualche novità per me? Hai finalmente prenotato il tuo alloggio a Ibiza? Fammi sapere :D\n\nCerca sul web Leibtour (pagina Contatti) e sarò più che felice di aiutarti...\n\nUn saluto'},
  {id:'cal', shortcut:'/cal', title:'CALENDAR AND PRICE NO UPDATE', lang:'MULTI', cat:'RESERVATION MGMT',
   body:'Hola :)\nPara evitar cualquier malentendido y asegurar que tengas la mejor experiencia, te explicamos en detalle cómo funciona nuestro proceso de reserva...\n\n### VERY IMPORTANT – PLEASE READ!\n\n☎ Before sending your booking request ALWAYS CONTACT US to check availability\n🛏️ The look of the apartment can be slightly different from the images\n⛔ Do NOT pay for the reservation before confirming with us\n📅 Our calendars are almost always open because we have alternative properties available\n☀ During high summer season many accommodations have a variable minimum stay\n\n---> Por estos motivos LeibTour NO TRABAJA con reservas inmediata sino solo bajo petición!\n---> 100% normal: Mira porfa los terminos y condiciones\n---> Te aconsejo que vuelvas a buscar activando el filtro solo de las propiedades con "reservas inmediatas" en 2 clicks te ahorras mucho tiempo ;)'},
  {id:'notavail', shortcut:'/notavail', title:'NO DISPONIBILITÀ', lang:'MULTI', cat:'RESERVATION MGMT',
   body:'Hi. Unfortunately, the accommodation you selected is not available. However, I can suggest an alternative option.\n\n---\n\nHola. Lamentablemente, no tenemos disponibilidad para las fechas seleccionadas. Sin embargo, puedo ofrecerte una opción alternativa. Estaba mirando ahora la disponibilidad y en tus fechas este apartamento esta vendido :(. Si quieres, te miro la disponibilidad por otro apartamento pero no lo tenemos publicado en airbnb (solo Leibtour).\n\nHazme saber\n\nEspero noticias\n\nLeibtour Team\n\n---\n\nCiao. Purtroppo non abbiamo disponibilità per le date selezionate. Tuttavia, posso proporti un\'opzione alternativa.'},
  {id:'price', shortcut:'/price', title:'PREZZO NON AGGIORNATO', lang:'MULTI', cat:'RESERVATION MGMT',
   body:'Dear (___) the price displayed is not up to date.\nIf you wish to proceed, please withdraw your current booking request.\n[I will then update the price and you\'ll be able to resubmit your booking request with the correct amount.] / [Then I will send you the offer with the updated price.]\n\n---\n\nQuerido (___) el precio mostrado no está actualizado. Si deseas proceder con la reserva, por favor retira primero la solicitud.\n[Luego podrás volver a enviar la solicitud de reserva con el importe correcto.] / [Luego te enviaré la oferta con el precio actualizado.]\n\n---\n\nCaro (___) il prezzo non è aggiornato. Se desideri procedere con la prenotazione, ti prego di ritirare prima la richiesta. [Dopo aver corretto il prezzo, potrai inviare nuovamente la richiesta.] / [Successivamente ti invierò l\'offerta con il prezzo aggiornato.]'},
  {id:'time', shortcut:'/time', title:'TIME', lang:'MULTI', cat:'RESERVATION MGMT',
   body:'Dear ### I\'ll get back to you shortly, I still need to check the quotation and availability... Now I\'m busy with another guest on LeibTour who is booking for tomorrow. Ok? thanks for your patience ☺️\n\n---\n\nQuerido ###, enseguida te respondo, todavía tengo que averiguar el precio y la disponibilidad... Ahora estoy ocupada con otro huésped en LeibTour que está reservando para mañana. ¿De acuerdo? Gracias por tu paciencia ☺️\n\n---\n\nCaro ###, ti rispondo a breve, devo ancora verificare se il prezzo e la disponibilità sono corretti... Adesso sono impegnata con un altro ospite su LeibTour che sta prenotando per domani. Va bene? Grazie per la tua pazienza ☺️'},
  {id:'withdraw', shortcut:'/withdraw', title:'RITIRARE LA RICHIESTA', lang:'MULTI', cat:'RESERVATION MGMT',
   body:'Kindly withdraw your current booking request so Airbnb can release the pending balance pre-authorized on your account. I can\'t do it because I don\'t have the permissions and my boss is not in the office now.\n\nThe refund is instant. For any questions regarding the payment contact Airbnb guest support since we didn\'t accept the reservation and we don\'t handle payments.\n\nYou can withdraw your booking request directly from your Airbnb account. Simply go to the reservation settings and you will find the option to cancel your pending request.\n\n---\n\nDe todos modos, puedes retirar la solicitud pendiente en cualquier momento para que Airbnb te desbloquee el importe. No puedo hacerlo yo porque no tengo los permisos y mi jefe no se encuentra en la ofi ahora.\n\nLa devolucion es instantánea. Para cualquier pregunta relacionada con el pago contacta directamente con la asistencia de Airbnb.\n\n---\n\nIn ogni caso puoi ritirare la richiesta di prenotazione in qualsiasi momento, Airbnb ti restituirà subito l\'importo pre-autorizzato. Il rimborso è istantaneo.'},
  {id:'altern', shortcut:'/altern', title:'ALTERNATIVA', lang:'MULTI', cat:'RESERVATION MGMT',
   body:'1) Alternativa 2 unità:\n\nBefore we proceed, may I ask if you would be open to considering the option of splitting your group into two separate units?\n---\n¿Estarías disponible para valorar la opción de dividirse en dos unidades?\n---\nSaresti disponibile a valutare la possibilità di dividervi in due unità?\n\n2) Alternativa stessa zona o altra zona:\n\nMay I ask if you are looking for something in the same area or if you would also consider another zone?\n---\n¿Puedo preguntarte si estás buscando algo en la misma zona o si también considerarías otra área?\n---\nPosso chiederti se stai cercando qualcosa nella stessa zona o se prenderesti in considerazione anche un\'altra area?'},
  {id:'budgetstay', shortcut:'/budgetstay', title:'BUDGET STAY - NO A/C', lang:'MULTI', cat:'RESERVATION MGMT',
   body:'Before we proceed with your booking, could you please confirm that you\'ve read and understood this is a budget studio/one (1) bedroom apartment without air conditioning?\n\n☝ VERY IMPORTANT ☝\nThis is a budget accommodation so be prepared to find a modest but comfortable place. The average price per night in this area is more than double. You are saving a lot of money :)\n\n---\n\nPrima di procedere con la tua prenotazione, puoi confermare che si tratta di uno studio economico senza aria condizionata?\n\n☝ IMPORTANTE ☝\nEssendo un alloggio modesto, preparati a trovare un luogo semplice ma confortevole. Stai risparmiando un botto di soldi :)\n\n---\n\nAntes de continuar con tu reserva, ¿puedes confirmar que se trata de un estudio económico sin aire acondicionado?\n\n☝MUY IMPORTANTE ☝\nSe trata de un alojamiento modesto. El precio medio por noche en esta zona es más del doble. Estás ahorrando un paston :)'},
  {id:'minstay', shortcut:'/minstay', title:'MINIMUM STAY', lang:'MULTI', cat:'RESERVATION MGMT',
   body:'For the selected property, there is a minimum stay requirement of several nights. If your dates are flexible or if you\'re interested, I\'d be happy to suggest some alternative options.\n\n---\n\nPara el alojamiento que has elegido, hay un requisito de estancia mínima de varias noches. Si tus fechas no cumplen con este requisito, puedo proponerte alternativas similares. ¿Te gustaría que te envíe otras opciones?\n\n---\n\nPer la struttura che hai scelto è previsto un soggiorno minimo di più notti. Se le tue date non rispettano questo requisito, posso comunque proporti alternative simili. Vuoi che ti invii altre opzioni?'},
  {id:'discount', shortcut:'/discount', title:'DISCOUNT', lang:'MULTI', cat:'RESERVATION MGMT',
   body:'Hello! Thank you very much for your request! I have availability and I can accept you.\nBefore doing so, I just wanted to ask if you are interested in getting a small discount on your Airbnb booking. In that case, please look me up online as Leibtour (Contact Us) as soon as possible. Otherwise, I will go ahead and accept the pending request.\n\nSince we are a company based in Ibiza, I can also offer my guests exclusive rates on car, motorbike, and bicycle rentals, as well as ferry tickets to Formentera and all other excursions, activities, and entrances to Ibiza\'s clubs.\n\nP.S. Simply add my listing to your Airbnb favorites by clicking on the little heart in the upper right corner of the ad ;) Best regards.\n\n---\n\nHola! Muchas gracias por tu solicitud! Tengo disponibilidad y puedo aceptarte.\nAntes de hacerlo, ¿estás interesado en conseguir un descuentillo en la reserva de Airbnb? Búscame en la web como Leibtour (Contact Us) lo antes posible. De lo contrario, aceptaré la solicitud pendiente.\n\n---\n\nCiao! Grazie mille per la tua richiesta! Ho disponibilità e posso accettarti.\nPrima di farlo, sei interessato ad ottenere un piccolo sconto sulla prenotazione di Airbnb? Cercami sul web come Leibtour (Contact Us) il prima possibile.'},
  {id:'forms', shortcut:'/forms', title:'JOT FORM', lang:'ES', cat:'RESERVATION MGMT',
   body:'Porfa rellena el siguiente formulario https://www.leibtour.com/car-rental/car-quotations/ y en la mayor brevedad te enviaremos un par de presupuestos.'},
  {id:'salb2b', shortcut:'/salb2b', title:'SALUDOS B2B', lang:'ES', cat:'RESERVATION MGMT',
   body:'★ Muchas gracias y hasta pronto.\n\n★★ Gracias por tu ayuda y colaboracion, espero verte pronto. Un fuerte abrazo.\n\n★★★ Con todo mi corazon mil gracias ♥ Es un verdadero placer trabajar con gente como tu. Te mando un fuerte abrazo!!!\n\n1. Quedo a vuestra disposición para cualquier consulta. ¡Muchas gracias por vuestra colaboración!\n2. Como siempre, agradecemos vuestra profesionalidad.\n3. Gracias por la atención. Quedamos a la espera de vuestra confirmación.\n4. Os agradecemos la colaboración de siempre.\n5. Muchas gracias por gestionar esta reserva con la eficiencia de siempre. ¡Un saludo cordial!\n6. Agradecemos vuestra rápida gestión.\n7. Como siempre, es un placer trabajar con vosotros.\n8. Gracias por vuestra disponibilidad y profesionalidad.\n9. Os enviamos un cordial saludo y agradecemos vuestra excelente colaboración. ¡Hasta la próxima!\n10. Muchas gracias por todo. ¡Un abrazo del equipo LeibTour!'},
  {id:'salb2c', shortcut:'/salb2c', title:'SALUDOS B2C', lang:'MULTI', cat:'RESERVATION MGMT',
   body:'1) Cliente ospite con noi:\nHello, how are you? Thank you for choosing us, it\'s truly a pleasure to have you as our guest. ❤️🎉\nHola, ¿cómo estás? Gracias por elegirnos, es realmente un placer tenerte como nuestro huésped. ❤️🎉\nCiao, come stai? Grazie per averci scelto, per noi è davvero un piacere averti come ospite. ❤️🎉\n\n2) Cliente non presente ma aperti ad ospitarlo altrove:\nHello, how are you? We would have been happy to have you as our guest, and we\'re always glad to welcome you. 😉❤️\nHola, ¿cómo estás? Nos habría encantado tenerte como huésped. 😉❤️\nCiao, come stai? Ci avrebbe fatto piacere averti come ospite. 😉❤️\n\n3) Cliente impossibilitato ad essere ospitato:\nHello, how are you? We\'re sorry we couldn\'t welcome you this time, but you will always be very welcome in the future. 😉❤️\nHola, ¿cómo estás? Lamentamos no haber podido recibirte esta vez, pero siempre serás muy bienvenido. 😉❤️\nCiao, come stai? Ci dispiace non averti potuto accogliere questa volta. 😉❤️'},
  {id:'address', shortcut:'/address', title:'INDIRIZZO', lang:'MULTI', cat:'RESERVATION MGMT',
   body:'You\'ll receive an automatic e-mail with GPS coordinates and full address 2 days before your arrival. For privacy and security reasons the address will be shown only after the booking.\n\nRead our FAQ: https://www.leibtour.com/faqs/booking-process/\n\n---\n\nRecibirás un correo electrónico con las coordenadas GPS y la dirección completa 2 días antes de tu llegada. Por razones de privacidad y seguridad, la dirección se mostrará solo después de la reserva.\n\nAqui tienes las preguntas frecuentes: https://www.leibtour.com/faqs/booking-process/\n\n---\n\nRiceverai un\'e-mail automatica con le coordinate GPS e l\'indirizzo completo 2 giorni prima del tuo arrivo. Per motivi di privacy e sicurezza, l\'indirizzo sarà mostrato solo dopo la prenotazione.\n\nLeggi le FAQ: https://www.leibtour.com/faqs/booking-process/'},
  {id:'firm', shortcut:'/firm', title:'Valenx (firma)', lang:'ES', cat:'RESERVATION MGMT',
   body:'Valentina P.\n[Reservations department LeibTour]'}
];

// ── STATE ──────────────────────────────────────────────────────────
var snippets = DEFAULT_SNIPPETS.slice();
var trigger  = '::';
var triggerCfg = { snippetTrigger: '::', promptTrigger: '"""', snippetActivationKey: 'Tab', promptActivationKey: 'Tab', selectionSuggestions: true };
var lastInputTime = 0; // debounce: prevents keydown + input event double-fire on desktop
var isPasting = false; // guards against paste events feeding the trigger buffer

// ── PROMPT TEMPLATES ──────────────────────────────────────────────
var PROMPT_TEMPLATES = [
  { id: 'formal', title: 'Formal tone', body: 'Please rewrite in a formal, professional tone:\n' },
  { id: 'casual', title: 'Casual tone', body: 'Rewrite this in a friendly, casual tone:\n' },
  { id: 'translate', title: 'Translate', body: 'Translate the following text to {language}:\n' },
  { id: 'summarize', title: 'Summarize', body: 'Summarize the following in 2-3 sentences:\n' },
  { id: 'expand', title: 'Expand / elaborate', body: 'Expand on the following with more detail:\n' },
  { id: 'bullet', title: 'Convert to bullets', body: '\u2022 ' }
];

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
      if (data && data.snippets && data.snippets.length > 0) {
        snippets = data.snippets;
      } else {
        // Migration: check if sync has a stale snippets copy from pre-v2.15.0
        chrome.storage.sync.get('snippets', function(sd) {
          if (sd && sd.snippets && sd.snippets.length > 0) {
            snippets = sd.snippets;
            chrome.storage.local.set({snippets: snippets}, function() {
              chrome.storage.sync.remove('snippets');
            });
          } else {
            snippets = DEFAULT_SNIPPETS.slice();
            chrome.storage.local.set({snippets: snippets});
          }
        });
      }
    } catch(e) {}
  });

  chrome.storage.onChanged.addListener(function(changes, areaName) {
    try {
      // Snippets only fire from local (areaName === 'local'); small settings from sync.
      if (changes.snippets && changes.snippets.newValue) snippets = changes.snippets.newValue;
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

function addKey(k) {
  if (k.length !== 1) return;
  buf += k;
  if (buf.length > MAX_BUF) buf = buf.slice(buf.length - MAX_BUF);
}

function checkBuf() {
  if (processing || !snippets.length) return;

  // Strip invisible artifacts that Gmail's rich-text contenteditable can
  // splice into the keystroke stream (smart-compose, autocorrect, paste
  // normalization). ZWSP/ZWNJ/ZWJ/BOM/soft-hyphen are removed; NBSP is folded
  // to a regular space so the trigger sequence isn't broken by an invisible
  // char between the two colons. \uXXXX escapes — invisible literal chars in
  // regex are fragile across editors and diffs.
  var sanitized = buf.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '').replace(/\u00A0/g, ' ');
  if (sanitized !== buf) buf = sanitized;

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
      buf = '';
      triggerPending = false; triggerPendingMode = null; triggerAffix = '';
      if (triggerDebounceTimer) { clearTimeout(triggerDebounceTimer); triggerDebounceTimer = null; }
      var matched = snippets[i];
      var variantsMap = _findLangVariants(matched);
      if (Object.keys(variantsMap).length > 1) {
        // Do NOT pre-delete the trigger here. For contenteditable hosts,
        // deleteChars only SETS a non-collapsed selection (it relies on the
        // immediate next insertText to consume it). Opening the modal steals
        // focus and destroys that selection — so the trigger text survives.
        // Instead, defer deletion to handleMatch (called when the user picks
        // a language) where deleteChars + insertText fire atomically.
        processing = true;
        injectLangModal(variantsMap, activeEl, expected.length);
      } else {
        handleMatch(activeEl, matched, expected.length);
      }
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
        buf = '';
        triggerPending = false; triggerPendingMode = null; triggerAffix = '';
        if (triggerDebounceTimer) { clearTimeout(triggerDebounceTimer); triggerDebounceTimer = null; }
        var aqMatched = snippets[i];
        var aqVariantsMap = _findLangVariants(aqMatched);
        if (Object.keys(aqVariantsMap).length > 1) {
          processing = true;
          injectLangModal(aqVariantsMap, activeEl, aqExpected.length);
        } else {
          handleMatch(activeEl, aqMatched, aqExpected.length);
        }
        return;
      }
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
    // Check configurable prompt trigger (e.g. """) — same debounced pattern
    var promptSeq = triggerCfg.promptTrigger || '"""';
    if (buf.length >= promptSeq.length && buf.slice(-promptSeq.length) === promptSeq) {
      if (buf.length > promptSeq.length && buf[buf.length - promptSeq.length - 1] === promptSeq[0]) return;
      triggerPending = true;
      triggerPendingMode = 'prompt';
      triggerAffix = '';
      if (triggerDebounceTimer) clearTimeout(triggerDebounceTimer);
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

// ── LANGUAGE VARIANT DETECTION ───────────────────────────────────────
var LANG_FLAGS = { EN: '🇬🇧', IT: '🇮🇹', ES: '🇪🇸', FR: '🇫🇷', MULTI: '🌐' };
var LANG_NAMES = { EN: 'English', IT: 'Italiano', ES: 'Español', FR: 'Français', MULTI: 'Multi' };
var LANG_SUFFIX_RE = /(?:EN|ES|IT|FR|MULTI)$/i;

function _findLangVariants(item) {
  var map = {};
  if (item.lang_group_id) {
    var rawGid = item.lang_group_id;
    for (var i = 0; i < snippets.length; i++) {
      if (snippets[i].lang_group_id === rawGid &&
          snippets[i].body && snippets[i].body.trim()) {
        map[snippets[i].lang] = snippets[i];
      }
    }
  }
  if (Object.keys(map).length <= 1) {
    map = {};
    var base = (item.shortcut || '').replace(LANG_SUFFIX_RE, '');
    for (var j = 0; j < snippets.length; j++) {
      var cb = (snippets[j].shortcut || '').replace(LANG_SUFFIX_RE, '');
      if (cb === base && snippets[j].body && snippets[j].body.trim()) {
        map[snippets[j].lang] = snippets[j];
      }
    }
  }
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
function handleMatch(el, snip, scLen) {
  if (processing) return;
  processing = true;
  var fieldSnapshot = captureFieldState(el, scLen);
  deleteChars(el, scLen, function() {
    var vars = parsePlaceholders(snip.body);
    if (vars.length > 0) {
      injectDynamicModal(vars, function(varMap) {
        var newBody = interpolateSnippet(snip.body, varMap);
        var modSnip = {};
        for (var k in snip) modSnip[k] = snip[k];
        modSnip.body = newBody;
        _proceedInsert(el, modSnip, fieldSnapshot);
      }, function() {
        processing = false;
      });
    } else {
      _proceedInsert(el, snip, fieldSnapshot);
    }
  });
}

function _proceedInsert(el, snip, fieldSnapshot) {
  var fields = extractFields(snip.body);
  if (!fields.length) {
    if (isUrgExpired(snip)) { processing = false; return; }
    var text = resolveBody(snip.body, {});
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
      fieldSnapshot.visibleLen = String(text).replace(/\n/g, '').length;
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
    showOverlay(el, snip, fields, function() { processing = false; });
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
function insertText(el, text) {
  if (!el) return;
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
      var lines = String(text).split('\n');
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

function showOverlay(targetEl, snip, fields, done) {
  triggerPending = false;
  triggerPendingMode = null;
  triggerAffix = '';
  if (triggerDebounceTimer) { clearTimeout(triggerDebounceTimer); triggerDebounceTimer = null; }
  removeOverlay();
  overlayDone = done;
  var cfgs  = snip.fieldCfg || {};
  var _now  = new Date();
  var today = sbFormatDate(_now, 'YYYY-MM-DD');
  var nowTime = sbFormatDate(_now, 'HH:mm');
  var nowDT = sbFormatDate(_now, 'YYYY-MM-DD') + 'T' + sbFormatDate(_now, 'HH:mm');

  var fhtml = '';
  for (var i = 0; i < fields.length; i++) {
    var key = fields[i];
    var rawCfg = cfgs[key] || {};
    var cfg = { type: rawCfg.type, opts: rawCfg.opts, default: rawCfg.default };
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
    if (cfg.type === 'dd' && opts.length) {
      inp = '<select class="sb-inp" data-key="'+key+'">' +
        '<option value="">— select —</option>' +
        opts.map(function(o){ return '<option value="'+xesc(o)+'">'+xesc(o)+'</option>'; }).join('') +
        '</select>';
    } else if (cfg.type === 'date') {
      inp = '<input type="date" class="sb-inp" data-key="'+key+'" value="'+xesc(cfg.default||today)+'">';
    } else if (cfg.type === 'time') {
      inp = '<input type="time" class="sb-inp" data-key="'+key+'" value="'+xesc(cfg.default||nowTime)+'">';
    } else if (cfg.type === 'datetime' || cfg.type === 'datetime-local') {
      inp = '<input type="datetime-local" class="sb-inp" data-key="'+key+'" value="'+xesc(cfg.default||nowDT)+'">';
    } else {
      inp = '<input type="'+(cfg.type==='number'?'number':'text')+'" class="sb-inp" data-key="'+key+'" placeholder="'+key.replace(/_/g,' ')+'" value="'+xesc(cfg.default||'')+'">';
    }
    fhtml += '<div class="sb-field"><label class="sb-lbl">{'+key+'}</label>'+inp+'</div>';
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
      var tag = document.activeElement ? document.activeElement.tagName : '';
      if (tag !== 'TEXTAREA' && tag !== 'SELECT') {
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
  var v = {};
  var inps = overlayEl.querySelectorAll('.sb-inp[data-key]');
  for (var i = 0; i < inps.length; i++) v[inps[i].dataset.key] = inps[i].value;
  return v;
}

function updatePrev(snip) {
  var box = document.getElementById('sb-prev');
  if (!box) return;
  var lines = resolveBody(snip.body, getVals()).split('\n').slice(0, 5);
  box.textContent = lines.join('\n') + (resolveBody(snip.body, getVals()).split('\n').length > 5 ? '\n\u2026' : '');
}

function doInsert(targetEl, snip) {
  if (isUrgExpired(snip)) return;
  var vals = getVals();
  var text = resolveBody(snip.body, vals);
  var fillCount = Object.keys(vals).length;
  closeOverlay();
  if (targetEl) {
    targetEl.focus();
    setTimeout(function() {
      insertText(targetEl, text);
      showCelebration(text);
      logEvent(snip, fillCount);
    }, 50);
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
  {e:'🚀',h:'Message launched!',s:'LeibTour efficiency at its best.'},
  {e:'🏆',h:'Champion move!',s:'TextBlaze who? You don\'t need them.'},
  {e:'✨',h:'Perfectly crafted!',s:'Copy, switch, paste. Done.'},
  {e:'🌴',h:'Ibiza speed!',s:'More time for the beach.'},
  {e:'💪',h:'Like a pro!',s:'Your guests will love this.'},
  {e:'🎯',h:'Bullseye!',s:'Right message, right guest, right now.'}
];

var totalSecs = 0;
var totalSnips = 0;

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
    totalSecs += secs; totalSnips++;
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
                                  // (trigger sequence + every char typed while picker open)

// Get pixel coords of the text cursor — used to position the picker.
// IMPORTANT: must not mutate the DOM or the live Selection, otherwise the
// cursor shifts (typically to the previous line) before the picker appears
// and subsequent insertions land at the wrong position.
function _getCaretCoords(el) {
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
  var allItems = triggerPickerMode === 'snippet' ? snippets : PROMPT_TEMPLATES;
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
    var sc = triggerPickerMode === 'snippet' && item.shortcut
      ? _scTag(item.shortcut)
      : '';
    h += '<div class="sb-tp-item" data-idx="' + i + '" style="display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:pointer;font-size:14px;font-weight:500;color:#18181B;line-height:1.3;'
      + (i === 0 ? 'background:#EEF2FF;' : '') + '">'
      + '<span style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + xesc(item.title) + '</span>' + sc
      + '</div>';
  }
  if (!triggerPickerFiltered.length) {
    h = '<div style="padding:16px 12px;font-size:13px;color:#A1A1AA;text-align:center">No matches</div>';
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
  header += '<span>' + (mode === 'snippet' ? '\u26a1 Insert snippet' : '\ud83e\udd16 Prompt mode') + '</span>';
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
        var text = resolveBody(item.body, {});
        var _isCE2 = el && (el.isContentEditable || (el.getAttribute &&
          (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '')));
        if (_isCE2) {
          // Same sync-insert fix as _proceedInsert: insert while selection is live.
          insertText(el, text);
          fieldSnapshot.syncInserted = true;
          fieldSnapshot.endCharOffset = _ceCaretCharOffset(_ceHost(el));
          fieldSnapshot.visibleLen = String(text).replace(/\n/g, '').length;
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
        showOverlay(el, item, fields, function() { processing = false; });
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
  triggerPending = false;
  triggerPendingMode = null;
  triggerAffix = '';
  if (triggerDebounceTimer) { clearTimeout(triggerDebounceTimer); triggerDebounceTimer = null; }
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
    // Return true to short-circuit the main keydown handler so the keystroke
    // isn't accidentally appended to the shortcut buffer (which could match
    // a different snippet while the picker is open).
    return true;
  }
  // Backspace — shrink query, shrink delete span, let backspace go into field
  if (e.key === 'Backspace') {
    if (triggerPickerQuery.length > 0) {
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
    '#sb-overlay .sb-inp{background:#F4F4F5;border:1px solid #E4E4E7;border-radius:8px;padding:7px 10px;font-size:16px;color:#18181B;font-family:inherit;outline:none;width:100%;box-sizing:border-box;touch-action:manipulation;transition:border-color .15s,box-shadow .15s;}' +
    '#sb-overlay .sb-inp:focus{border-color:#1B4FD8;background:#fff;box-shadow:0 0 0 3px rgba(27,79,216,.14);}' +
    '#sb-overlay .sb-inp[type=date],#sb-overlay .sb-inp[type=time],#sb-overlay .sb-inp[type=datetime-local]{color:#1B4FD8;border-color:#BED0FF;background:#EEF2FF;}' +
    '#sb-overlay select.sb-inp{-webkit-appearance:none;background-image:url(\'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="6"><path d="M0 0l5 6 5-6z" fill="%231B4FD8"/></svg>\');background-repeat:no-repeat;background-position:right 8px center;padding-right:26px;cursor:pointer;}' +
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
    var text = resolveBody(snip.body, {});
    if (el) insertText(el, text);
    showCelebration(text);
    logEvent(snip, 0);
    processing = false;
  } else {
    processing = true;
    showOverlay(el, snip, fields, function() { processing = false; });
  }
}

