// ── SPRINTBRAIN CONTENT SCRIPT v2.6 ───────────────────────────────
// Clean rewrite — keystroke buffer + confetti celebration

// ── FORMULA ENGINE ────────────────────────────────────────────────
var FUNS = {round:1,floor:1,ceil:1,abs:1,min:1,max:1};

function evalFormula(expr, vals) {
  try {
    var s = expr.replace(/[A-Za-z_][A-Za-z0-9_]*/g, function(n) {
      if (FUNS[n]) return n;
      var v = parseFloat(vals[n]);
      return isNaN(v) ? '0' : String(v);
    });
    var stripped = s.replace(/round|floor|ceil|abs|min|max/g, '');
    if (!/^[0-9+\-*/().\s,]+$/.test(stripped)) return null;
    s = s.replace(/round\(/g,'Math.round(').replace(/floor\(/g,'Math.floor(')
         .replace(/ceil\(/g,'Math.ceil(').replace(/abs\(/g,'Math.abs(')
         .replace(/min\(/g,'Math.min(').replace(/max\(/g,'Math.max(');
    var r = Function('"use strict";return(' + s + ')')();
    return isNaN(r) ? null : Math.round(r * 100) / 100;
  } catch(e) { return null; }
}

function resolveBody(body, vals) {
  if (!body) return '';
  var out = '', i = 0;
  while (i < body.length) {
    if (body[i] === '{') {
      var cl = body.indexOf('}', i);
      if (cl === -1) { out += body[i++]; continue; }
      var tok = body.slice(i+1, cl).replace(/^\s+|\s+$/g, '');
      if (tok.charAt(0) === '=') {
        var fv = evalFormula(tok.slice(1), vals);
        out += fv !== null ? String(fv) : '';
        i = cl+1; continue;
      }
      if (tok.slice(0,3) === 'if:') {
        var cond = tok.slice(3).replace(/^\s+|\s+$/g, '');
        var ei = '{endif}', eidx = body.indexOf(ei, cl+1);
        var inner = eidx !== -1 ? body.slice(cl+1, eidx) : '';
        var cr = false;
        try {
          var sc2 = cond.replace(/[A-Za-z_][A-Za-z0-9_]*/g, function(n) {
            if (FUNS[n]) return n;
            var v2 = parseFloat(vals[n]); return isNaN(v2) ? '0' : String(v2);
          });
          cr = !!Function('"use strict";return(' + sc2 + ')')();
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
    if (t.charAt(0) !== '=' && t !== 'endif' && t.slice(0,3) !== 'if:') {
      var dup = false;
      for (var i = 0; i < vars.length; i++) { if (vars[i] === t) { dup = true; break; } }
      if (!dup) vars.push(t);
    }
  }
  return vars;
}

// ── DEFAULT SNIPPETS ───────────────────────────────────────────────
var DEFAULT_SNIPPETS = [
  {id:'s1', shortcut:';;quoteEN', title:'BOOKING QUOTE EN', lang:'EN', cat:'booking',
   fieldCfg:{
     OTA_PRICE:{type:'number',default:'0'},
     YOUR_PRICE:{type:'number',default:'0'},
     PAYMENT_TERMS:{type:'dd',opts:'Full payment upon confirmation\n50% deposit + balance 40 days before check-in'}
   },
   body:'Original Accommodation Price: {OTA_PRICE} \u20ac\n\u2605 Your Price: {YOUR_PRICE} \u20ac\n{if:OTA_PRICE > 0}\u2713 You save: {=OTA_PRICE - YOUR_PRICE} \u20ac (-{=round((OTA_PRICE - YOUR_PRICE) / OTA_PRICE * 100)}%)\n\u2713 OTA fees saved (12-18%){endif}\n\u2713 Payment terms: {PAYMENT_TERMS}\n\nPAYMENT OPTIONS\n- Bank Transfer: {=YOUR_PRICE - 25} \u20ac \u2764\ufe0f\n- Card: {=round(YOUR_PRICE * 1.03)} \u20ac\n\n\ud83d\udd17 leibtour.com/faqs/booking-process'},
  {id:'s2', shortcut:';;quoteES', title:'PRESUPUESTO B2C', lang:'ES', cat:'booking',
   fieldCfg:{
     OTA_PRICE:{type:'number',default:'0'},
     YOUR_PRICE:{type:'number',default:'0'},
     PAYMENT_TERMS:{type:'dd',opts:'Pago completo a la confirmaci\u00f3n\n50% dep\u00f3sito + saldo 40 d\u00edas antes'}
   },
   body:'Precio OTA: {OTA_PRICE} \u20ac\n\u2605 Tu Precio: {YOUR_PRICE} \u20ac\n{if:OTA_PRICE > 0}\u2713 Ahorras: {=OTA_PRICE - YOUR_PRICE} \u20ac (-{=round((OTA_PRICE - YOUR_PRICE) / OTA_PRICE * 100)}%){endif}\n\u2713 T\u00e9rminos: {PAYMENT_TERMS}\n\nPAGO\n- Transferencia: {=YOUR_PRICE - 25} \u20ac \u2764\ufe0f\n- Tarjeta: {=round(YOUR_PRICE * 1.03)} \u20ac'},
  {id:'s3', shortcut:';;quoteIT', title:'PREVENTIVO B2C', lang:'IT', cat:'booking',
   fieldCfg:{
     OTA_PRICE:{type:'number',default:'0'},
     YOUR_PRICE:{type:'number',default:'0'},
     PAYMENT_TERMS:{type:'dd',opts:'Pagamento completo alla conferma\n50% deposito + saldo 40 giorni prima'}
   },
   body:'Prezzo OTA: {OTA_PRICE} \u20ac\n\u2605 Il Tuo Prezzo: {YOUR_PRICE} \u20ac\n{if:OTA_PRICE > 0}\u2713 Risparmi: {=OTA_PRICE - YOUR_PRICE} \u20ac (-{=round((OTA_PRICE - YOUR_PRICE) / OTA_PRICE * 100)}%){endif}\n\u2713 Termini: {PAYMENT_TERMS}\n\nPAGAMENTO\n- Bonifico: {=YOUR_PRICE - 25} \u20ac \u2764\ufe0f\n- Carta: {=round(YOUR_PRICE * 1.03)} \u20ac'},
  {id:'s4', shortcut:';;checkin', title:'CHECK-IN EN', lang:'EN', cat:'guest',
   fieldCfg:{
     property_name:{type:'dd',opts:'Casa Duquesa\nVilla Santa Eulalia\nApartment San Antonio'},
     CHECKIN:{type:'date'}, CHECKOUT:{type:'date'}
   },
   body:'Dear {guest_name},\n\nWelcome to {property_name}! \ud83c\udf05\n\n\ud83d\udd11 Check-in: {CHECKIN} at 16:00\n\ud83d\udd11 Check-out: {CHECKOUT} at 11:00\nKeys: {key_location}\n\n\ud83d\udccd {property_address}\n\ud83d\udcf1 Emergency: +34 {phone_number}\n\nEnjoy Ibiza!\nLeibTour Team'},
  {id:'s5', shortcut:';;review', title:'REVIEW REQUEST EN', lang:'EN', cat:'guest',
   fieldCfg:{
     property_name:{type:'dd',opts:'Casa Duquesa\nVilla Santa Eulalia\nApartment San Antonio'}
   },
   body:'Dear {guest_name},\n\nThank you for staying at {property_name}! \ud83c\udf1f\n\nJust 2 minutes on Airbnb means the world to us.\n\n\ud83d\udc49 {review_link}\n\nWarm regards,\nLeibTour Team'}
];

// ── STATE ──────────────────────────────────────────────────────────
var snippets = DEFAULT_SNIPPETS.slice();
var trigger  = ';;';

// ── LOAD FROM STORAGE ──────────────────────────────────────────────
try {
  chrome.storage.sync.get(['snippets','trigger'], function(data) {
    try {
      if (data && data.trigger) trigger = data.trigger;
      if (data && data.snippets && data.snippets.length > 0) {
        snippets = data.snippets;
      } else {
        chrome.storage.sync.set({snippets: DEFAULT_SNIPPETS, trigger: trigger});
      }
      console.log('[Sprintbrain v2.6] \u26a1 trigger:"' + trigger + '" snippets:' + snippets.length);
    } catch(e) {}
  });
  chrome.storage.onChanged.addListener(function(changes) {
    try {
      if (changes.snippets && changes.snippets.newValue) snippets = changes.snippets.newValue;
      if (changes.trigger  && changes.trigger.newValue)  trigger  = changes.trigger.newValue;
    } catch(e) {}
  });
} catch(e) {
  console.warn('[Sprintbrain] Storage unavailable, using defaults');
}

// ── KEYSTROKE BUFFER ───────────────────────────────────────────────
var buf     = '';
var MAX_BUF = 40;
var activeEl = null;
var processing = false;

function addKey(k) {
  if (k.length !== 1) return;
  buf += k;
  if (buf.length > MAX_BUF) buf = buf.slice(buf.length - MAX_BUF);
}

function checkBuf() {
  if (processing || !snippets.length) return;
  for (var i = 0; i < snippets.length; i++) {
    var sc = snippets[i].shortcut || '';
    if (sc && buf.slice(-sc.length) === sc) {
      var snip = snippets[i];
      buf = '';
      handleMatch(activeEl, snip, sc.length);
      return;
    }
  }
}

// ── MATCH HANDLER ──────────────────────────────────────────────────
function handleMatch(el, snip, scLen) {
  if (processing) return;
  processing = true;
  var fields = extractFields(snip.body);
  deleteChars(el, scLen, function() {
    if (!fields.length) {
      if (isUrgExpired(snip)) { processing = false; return; }
      var text = resolveBody(snip.body, {});
      insertText(el, text);
      showCelebration(text);
      processing = false;
    } else {
      showOverlay(el, snip, fields, function() { processing = false; });
    }
  });
}

// ── DELETE N CHARS ─────────────────────────────────────────────────
function deleteChars(el, n, cb) {
  if (!el) { if (cb) cb(); return; }
  try {
    el.focus();
    for (var i = 0; i < n; i++) document.execCommand('delete', false, null);
  } catch(e) {
    try {
      var s = el.selectionStart || 0;
      el.value = el.value.substring(0, Math.max(0, s - n)) + el.value.substring(s);
      var np = Math.max(0, s - n);
      el.setSelectionRange(np, np);
      el.dispatchEvent(new Event('input', {bubbles:true}));
    } catch(e2) {}
  }
  setTimeout(function() { if (cb) cb(); }, 20);
}

// ── INSERT TEXT ────────────────────────────────────────────────────
function insertText(el, text) {
  if (!el) return;
  try {
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
  removeOverlay();
  overlayDone = done;
  var cfgs  = snip.fieldCfg || {};
  var today = new Date().toISOString().split('T')[0];

  var fhtml = '';
  for (var i = 0; i < fields.length; i++) {
    var key = fields[i];
    var cfg = cfgs[key] || {type:'text'};
    var opts = cfg.opts ? cfg.opts.split('\n').filter(function(o){ return o.trim(); }) : [];
    var inp;
    if (cfg.type === 'dd' && opts.length) {
      inp = '<select class="sb-inp" data-key="'+key+'">' +
        '<option value="">— select —</option>' +
        opts.map(function(o){ return '<option value="'+xesc(o)+'">'+xesc(o)+'</option>'; }).join('') +
        '</select>';
    } else if (cfg.type === 'date') {
      inp = '<input type="date" class="sb-inp" data-key="'+key+'" value="'+today+'">';
    } else {
      inp = '<input type="'+(cfg.type==='number'?'number':'text')+'" class="sb-inp" data-key="'+key+'" placeholder="'+key.replace(/_/g,' ')+'" value="'+(cfg.default||'')+'">';
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
    })(inps[j]);
  }

  el.querySelector('.sb-close').addEventListener('click', function(e) {
    e.stopPropagation(); closeOverlay();
  });
  el.querySelector('.sb-insert').addEventListener('click', function(e) {
    e.stopPropagation(); doInsert(targetEl, snip);
  });
  bd.addEventListener('click', closeOverlay);
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
  var text = resolveBody(snip.body, getVals());
  closeOverlay();
  if (targetEl) {
    targetEl.focus();
    setTimeout(function() {
      insertText(targetEl, text);
      showCelebration(text);
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

function showCelebration(text) {
  ['sb-celebrate','sb-cel-bd'].forEach(function(id){ var e=document.getElementById(id); if(e)e.remove(); });

  var secs     = Math.max(2, Math.round((text||'').trim().length / 3.3));
  var words    = (text||'').trim().split(/\s+/).length;
  var humanW   = Math.max(1, Math.round(words * 0.15));
  var machineW = words - humanW;
  var machPct  = Math.round(machineW / Math.max(words,1) * 100);
  var humPct   = 100 - machPct;
  totalSecs += secs; totalSnips++;

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

  card.innerHTML =
    '<div style="font-size:46px;line-height:1;margin-bottom:9px">'+msg.e+'</div>'+
    '<div style="font-size:19px;font-weight:700;color:#1c1c1a;margin-bottom:5px">'+msg.h+'</div>'+
    '<div style="font-size:12px;color:#6e6c67;margin-bottom:14px">'+msg.s+'</div>'+
    '<div style="display:inline-flex;align-items:center;gap:10px;background:linear-gradient(135deg,#fdf6e8,#fef9c3);border:2px solid #e8c97a;border-radius:14px;padding:10px 20px;margin-bottom:14px">'+
      '<span style="font-size:30px;font-weight:800;color:#BA7517">'+secs+'</span>'+
      '<span><span style="font-size:12px;font-weight:700;color:#BA7517;display:block">seconds saved</span>'+
      '<span style="font-size:10px;color:#a8a59f;display:block">vs typing from scratch</span></span>'+
    '</div>'+
    '<div style="display:flex;gap:8px;margin-bottom:10px">'+
      '<div style="flex:1;background:#eef4fb;border:1.5px solid #9bc4e4;border-radius:12px;padding:9px 6px;text-align:center">'+
        '<div style="font-size:16px">🧑</div>'+
        '<div style="font-size:8px;font-weight:700;color:#3a8fc4;text-transform:uppercase;letter-spacing:.08em;margin:2px 0">Human</div>'+
        '<div style="font-size:22px;font-weight:800;color:#3a8fc4">'+humanW+'</div>'+
        '<div style="font-size:9px;color:#a8a59f">words</div>'+
      '</div>'+
      '<div style="flex:1;background:#f5f3ff;border:1.5px solid #c4b5fd;border-radius:12px;padding:9px 6px;text-align:center">'+
        '<div style="font-size:16px">🤖</div>'+
        '<div style="font-size:8px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.08em;margin:2px 0">Machine</div>'+
        '<div style="font-size:22px;font-weight:800;color:#7c3aed">'+machineW+'</div>'+
        '<div style="font-size:9px;color:#a8a59f">words</div>'+
      '</div>'+
    '</div>'+
    '<div style="width:100%;height:6px;background:#f5f4f0;border-radius:20px;overflow:hidden;display:flex;margin-bottom:4px">'+
      '<div style="width:'+humPct+'%;background:#4a9eca;border-radius:20px 0 0 20px"></div>'+
      '<div style="width:'+machPct+'%;background:#7c3aed"></div>'+
    '</div>'+
    '<div style="display:flex;justify-content:space-between;font-size:10px;color:#a8a59f;margin-bottom:14px">'+
      '<span>'+humPct+'% you</span><span>'+machPct+'% Sprintbrain \ud83e\udd16</span>'+
    '</div>'+
    '<button id="sb-cel-ok" style="padding:9px 20px;background:#BA7517;border:none;border-radius:9px;font-size:13px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit;width:100%">Paste it now! \ud83d\udccb</button>'+
    '<div id="sb-cel-skip" style="margin-top:8px;font-size:11px;color:#a8a59f;cursor:pointer">dismiss</div>';

  document.body.appendChild(bd);
  document.body.appendChild(card);

  function close() {
    var c=document.getElementById('sb-celebrate'); if(c)c.remove();
    var b=document.getElementById('sb-cel-bd');    if(b)b.remove();
  }

  var okBtn   = document.getElementById('sb-cel-ok');
  var skipBtn = document.getElementById('sb-cel-skip');
  if (okBtn)   okBtn.addEventListener('click',   close);
  if (skipBtn) skipBtn.addEventListener('click',  close);
  bd.addEventListener('click', close);
  setTimeout(close, 5000);

  launchConfetti();
}

// ── KEYBOARD LISTENER ──────────────────────────────────────────────
document.addEventListener('keydown', function(e) {
  // Skip if overlay open
  if (overlayEl) return;

  var t = e.target;

  // Skip our own elements
  if (t && t.closest && t.closest('#sb-overlay')) return;
  if (t && t.closest && t.closest('#sb-celebrate')) return;

  // Handle special keys
  if (e.key === 'Backspace') { buf = buf.slice(0,-1); return; }
  if (e.key === 'Delete')    { buf = ''; return; }
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Enter','Tab'].indexOf(e.key) > -1) {
    buf = ''; return;
  }
  if (e.key.length !== 1) return;

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
  addKey(e.key);
  setTimeout(checkBuf, 10);
}, true);

// ── INJECT STYLES ─────────────────────────────────────────────────
(function() {
  if (document.getElementById('sb-styles')) return;
  var s = document.createElement('style');
  s.id = 'sb-styles';
  s.textContent =
    '#sb-overlay{background:#fff;border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px;color:#1c1c1a;}' +
    '#sb-overlay .sb-hdr{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#fdf6e8;border-bottom:1px solid #e8c97a;}' +
    '#sb-overlay .sb-logo{font-weight:700;font-size:13px;color:#BA7517;}' +
    '#sb-overlay .sb-title{font-size:11px;color:#6e6c67;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
    '#sb-overlay .sb-close{background:transparent;border:none;cursor:pointer;font-size:16px;color:#a8a59f;padding:0;line-height:1;}' +
    '#sb-overlay .sb-close:hover{color:#1c1c1a;}' +
    '#sb-overlay .sb-fields{padding:12px 14px;display:flex;flex-direction:column;gap:8px;max-height:250px;overflow-y:auto;}' +
    '#sb-overlay .sb-field{display:flex;flex-direction:column;gap:3px;}' +
    '#sb-overlay .sb-lbl{font-size:9px;font-weight:700;color:#BA7517;text-transform:uppercase;letter-spacing:.08em;font-family:monospace;}' +
    '#sb-overlay .sb-inp{background:#f5f4f0;border:1px solid #e8e5e0;border-radius:5px;padding:7px 10px;font-size:13px;color:#1c1c1a;font-family:inherit;outline:none;width:100%;box-sizing:border-box;}' +
    '#sb-overlay .sb-inp:focus{border-color:#e8c97a;background:#fffbf0;}' +
    '#sb-overlay .sb-inp[type=date]{color:#c2410c;border-color:#fed7aa;background:#fff7ed;}' +
    '#sb-overlay select.sb-inp{-webkit-appearance:none;background-image:url(\'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="6"><path d="M0 0l5 6 5-6z" fill="%23BA7517"/></svg>\');background-repeat:no-repeat;background-position:right 8px center;padding-right:26px;cursor:pointer;}' +
    '#sb-overlay .sb-prev{margin:0 14px;padding:8px 10px;background:#f5f4f0;border:1px solid #e8e5e0;border-radius:6px;font-size:11px;color:#6e6c67;line-height:1.6;white-space:pre-wrap;max-height:70px;overflow:hidden;}' +
    '#sb-overlay .sb-foot{padding:10px 14px;border-top:1px solid #e8e5e0;display:flex;align-items:center;gap:8px;background:#fafaf8;}' +
    '#sb-overlay .sb-insert{padding:8px 18px;background:#BA7517;border:none;border-radius:6px;font-size:13px;font-weight:600;color:#fff;cursor:pointer;font-family:inherit;}' +
    '#sb-overlay .sb-insert:hover{background:#d4880f;}' +
    '#sb-overlay .sb-tip{font-size:10px;color:#a8a59f;}' +
    '@keyframes sbCardIn{0%{opacity:0;transform:translate(-50%,-50%) scale(.75)}100%{opacity:1;transform:translate(-50%,-50%) scale(1)}}' +
    '@keyframes sbUrgPulse{0%,100%{box-shadow:0 0 0 0 rgba(217,57,0,.3)}50%{box-shadow:0 0 14px 3px rgba(217,57,0,.15)}}' +
    '@keyframes sbScBlink{0%,100%{opacity:1}50%{opacity:.3}}';
  document.head.appendChild(s);
})();

console.log('[Sprintbrain v2.6] Content script loaded \u26a1');


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

  if (fields.length === 0) {
    // No fill-in fields — insert directly
    if (isUrgExpired(snip)) return;
    var text = resolveBody(snip.body, {});
    if (el) insertText(el, text);
    showCelebration(text);
  } else {
    // Show fill-in overlay
    processing = true;
    showOverlay(el, snip, fields, function() { processing = false; });
  }
});

