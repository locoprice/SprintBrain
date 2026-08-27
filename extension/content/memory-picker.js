// WORKING-MEMORY COMPOSER PICKER (MEMORY-001).
//
// Mounts a "Context" pill next to the prompt box on AI chat sites. Pick a step,
// and the shards that step wants are prepended to whatever you have typed,
// inside the step's token budget.
//
// Two decisions worth knowing before changing anything here.
//
// 1. The context is INSERTED AS VISIBLE TEXT, above what you typed. It is not
//    held aside and merged at send time. Send-time merging looks tidier and is
//    how the competitor does it, but it means hooking every platform's send
//    button, which breaks on every redesign, and it means the user cannot see
//    what was actually sent. Visible text is editable, deletable and honest.
//
// 2. The pill FLOATS, anchored to the composer's bounding box, rather than
//    being injected into each site's own toolbar. Toolbars are the fastest
//    changing part of these apps. A floating anchor survives a redesign that
//    only moves things around, and degrades to a slightly odd position rather
//    than to nothing.
//
// Bodies are never fetched to draw the menu. The index carries name, summary
// and token cost, which is everything the ranking needs, so opening the picker
// costs one small request and picking a step fetches only the bodies that fit
// the budget. That split is the point of the feature.
//
// Ranking and budget live in extension/shared/memory-pack.js, kept in step with
// the TypeScript engine by scripts/check-memory-parity.js.
(function (root) {
  'use strict';

  var PACK = root.SBMemoryPack;

  // Composer selectors, best first. These WILL rot: every one of these apps
  // rewrites its editor periodically. That is why findComposer falls through to
  // a generic scan rather than giving up when the list misses.
  var HOSTS = [
    { match: /(^|\.)chatgpt\.com$/,        sel: ['#prompt-textarea', 'div[contenteditable="true"]', 'textarea'] },
    { match: /(^|\.)chat\.openai\.com$/,   sel: ['#prompt-textarea', 'div[contenteditable="true"]', 'textarea'] },
    { match: /(^|\.)claude\.ai$/,          sel: ['div[contenteditable="true"].ProseMirror', 'div[contenteditable="true"]'] },
    { match: /(^|\.)gemini\.google\.com$/, sel: ['div.ql-editor[contenteditable="true"]', 'div[contenteditable="true"]'] },
    { match: /(^|\.)grok\.com$/,           sel: ['textarea', 'div[contenteditable="true"]'] },
    { match: /(^|\.)perplexity\.ai$/,      sel: ['textarea', 'div[contenteditable="true"]'] },
    { match: /(^|\.)chat\.deepseek\.com$/, sel: ['#chat-input', 'textarea'] },
    { match: /(^|\.)copilot\.microsoft\.com$/, sel: ['textarea#userInput', 'textarea'] }
  ];

  function hostConfig(hostname) {
    for (var i = 0; i < HOSTS.length; i++) {
      if (HOSTS[i].match.test(hostname)) return HOSTS[i];
    }
    return null;
  }

  function isVisible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 80 || r.height < 16) return false;
    var cs = root.getComputedStyle ? root.getComputedStyle(el) : null;
    if (cs && (cs.visibility === 'hidden' || cs.display === 'none')) return false;
    return true;
  }

  /**
   * The prompt box on this page, or null.
   *
   * Tries the host's known selectors, then falls back to the largest visible
   * editable sitting in the lower half of the viewport, which is where a chat
   * composer lives on every one of these apps. The fallback is what keeps this
   * working the week after a redesign.
   */
  function findComposer(doc, hostname) {
    doc = doc || root.document;
    hostname = hostname || (root.location && root.location.hostname) || '';

    var cfg = hostConfig(hostname);
    if (cfg) {
      for (var i = 0; i < cfg.sel.length; i++) {
        var found = doc.querySelectorAll(cfg.sel[i]);
        for (var j = 0; j < found.length; j++) {
          if (isVisible(found[j])) return found[j];
        }
      }
    }

    // Two passes. Prefer the lower half of the viewport, which is where a chat
    // composer lives, then widen to the whole page rather than returning
    // nothing. A short page can put the composer above the midpoint, and one
    // slightly odd anchor position beats no picker at all.
    var candidates = doc.querySelectorAll('textarea, div[contenteditable="true"], p[contenteditable="true"]');
    var midpoint = (root.innerHeight || 800) / 2;

    function largest(requireLowerHalf) {
      var best = null;
      var bestArea = 0;
      for (var k = 0; k < candidates.length; k++) {
        var el = candidates[k];
        if (!isVisible(el)) continue;
        var rect = el.getBoundingClientRect();
        if (requireLowerHalf && rect.top < midpoint) continue;
        var area = rect.width * rect.height;
        if (area > bestArea) { bestArea = area; best = el; }
      }
      return best;
    }

    return largest(true) || largest(false);
  }

  function readComposer(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value || '';
    return el.textContent || '';
  }

  // ── UI ─────────────────────────────────────────────────────────────────────
  // Shadow DOM, because this renders inside someone else's stylesheet. Colors
  // are the literal design tokens (docs/DESIGN_SYSTEM.md); the extension's
  // token stylesheet is not loaded on a third-party page.
  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}',
    '.pill{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;background:#FFFFFF;',
    'border:1px solid #BED0FF;border-radius:999px;font-size:12px;font-weight:600;color:#1B4FD8;',
    'cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.06),0 4px 14px rgba(0,0,0,.04);line-height:1.2}',
    '.pill:hover{background:#EEF2FF}',
    '.pill[data-active="1"]{background:#EEF2FF;border-color:#1B4FD8}',
    '.dot{width:7px;height:7px;border-radius:50%;background:#1B4FD8;flex:0 0 auto}',
    '.menu{position:absolute;bottom:calc(100% + 8px);left:0;width:300px;max-height:340px;overflow-y:auto;',
    'background:#FFFFFF;border:1px solid #E5E5EA;border-radius:12px;padding:6px;',
    'box-shadow:0 4px 20px rgba(27,79,216,.12),0 1px 3px rgba(0,0,0,.06)}',
    '.hd{padding:8px 10px 6px;font-size:10px;font-weight:700;letter-spacing:.08em;',
    'text-transform:uppercase;color:#6B6B70}',
    '.row{display:block;width:100%;text-align:left;padding:8px 10px;border:0;background:transparent;',
    'border-radius:8px;cursor:pointer;font-size:13px;color:#1C1C1E}',
    '.row:hover{background:#EEF2FF}',
    '.row .nm{font-weight:600;display:block}',
    '.row .sub{display:block;font-size:11px;color:#6E6E73;margin-top:2px}',
    '.empty{padding:10px;font-size:12px;color:#6E6E73;line-height:1.5}',
    '.toast{display:flex;align-items:center;gap:10px;padding:8px 10px;background:#FFFFFF;',
    'border:1px solid #BED0FF;border-radius:10px;font-size:12px;color:#1C1C1E;',
    'box-shadow:0 4px 20px rgba(27,79,216,.12)}',
    '.undo{padding:4px 10px;background:transparent;border:1.5px solid #BED0FF;border-radius:7px;',
    'font-size:11px;font-weight:600;color:#1B4FD8;cursor:pointer}'
  ].join('');

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /**
   * @param {object} deps
   *   getIndex(cb)          cb(err, {steps:[], shards:[]}) — shards carry no bodies
   *   getBodies(ids, cb)    cb(err, [{id, body}])
   *   insertText(el, text)  writes into the composer; the surface's own inserter
   *   doc, win              overridable for the test harness
   */
  function create(deps) {
    var doc = deps.doc || root.document;
    var win = deps.win || root;

    var host = doc.createElement('div');
    host.setAttribute('data-sb-memory', '1');
    host.style.cssText = 'position:fixed;z-index:2147483646;display:none';
    var shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var style = doc.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    var wrap = doc.createElement('div');
    wrap.style.cssText = 'position:relative';
    shadow.appendChild(wrap);

    var pill = doc.createElement('button');
    pill.type = 'button';
    pill.className = 'pill';
    pill.innerHTML = '<span class="dot"></span><span>Context</span>';
    wrap.appendChild(pill);

    var menu = null;
    var composer = null;
    var cache = null;
    var lastUndo = null;

    function position() {
      if (!composer) { host.style.display = 'none'; return; }
      var r = composer.getBoundingClientRect();
      if (r.width < 80) { host.style.display = 'none'; return; }
      host.style.display = 'block';
      host.style.left = Math.round(r.left) + 'px';
      host.style.top = Math.round(r.top - 34) + 'px';
    }

    function closeMenu() {
      if (menu) { menu.remove(); menu = null; }
      pill.setAttribute('data-active', '0');
    }

    function eligibleCount(step) {
      if (!cache) return 0;
      return PACK.rankForStep(cache.shards, step).length;
    }

    function renderMenu() {
      closeMenu();
      menu = doc.createElement('div');
      menu.className = 'menu';

      var html = '';
      if (!cache || !cache.steps.length) {
        html += '<div class="empty">No steps configured yet.<br>Create a step and tag some memory shards, then they show up here.</div>';
      } else {
        html += '<div class="hd">Add context to this prompt</div>';
        html += '<button class="row" data-step=""><span class="nm">No context</span>' +
                '<span class="sub">Send the prompt as written</span></button>';
        html += '<div class="hd">Steps</div>';
        for (var i = 0; i < cache.steps.length; i++) {
          var st = cache.steps[i];
          var n = eligibleCount(st);
          var packed = PACK.packForStep(cache.shards, st);
          html += '<button class="row" data-step="' + esc(st.key) + '">' +
                  '<span class="nm">' + esc(st.name) + '</span>' +
                  '<span class="sub">' + packed.shards.length + ' of ' + n + ' items · ' +
                  packed.usedTokens + '/' + st.tokenBudget + ' tokens</span></button>';
        }
      }
      menu.innerHTML = html;
      wrap.appendChild(menu);
      pill.setAttribute('data-active', '1');

      // Opens upward, because the composer is normally at the bottom of the
      // page. Flip down when there is not room, so a composer near the top of
      // the viewport does not get a menu clipped off the screen.
      var mr = menu.getBoundingClientRect();
      if (mr.top < 8) {
        menu.style.bottom = 'auto';
        menu.style.top = 'calc(100% + 8px)';
      }

      var rows = menu.querySelectorAll('.row');
      for (var k = 0; k < rows.length; k++) {
        rows[k].addEventListener('click', onPick);
      }
    }

    function onPick(e) {
      var key = e.currentTarget.getAttribute('data-step');
      closeMenu();
      if (!key) return;
      applyStep(key);
    }

    function applyStep(key) {
      if (!cache) return;
      var step = null;
      for (var i = 0; i < cache.steps.length; i++) {
        if (cache.steps[i].key === key) step = cache.steps[i];
      }
      if (!step || !composer) return;

      var packed = PACK.packForStep(cache.shards, step);
      if (!packed.shards.length) { toast('Nothing tagged for ' + step.name + '.', null); return; }

      var ids = packed.shards.map(function (s) { return s.id; });
      deps.getBodies(ids, function (err, rows) {
        if (err) { toast('Could not load context.', null); return; }

        var byId = {};
        for (var j = 0; j < rows.length; j++) byId[rows[j].id] = rows[j].body;
        var hydrated = [];
        for (var k = 0; k < packed.shards.length; k++) {
          var s = packed.shards[k];
          hydrated.push({ name: s.name, body: byId[s.id] || '' });
        }

        var before = readComposer(composer);
        var block = PACK.formatContextBlock({ shards: hydrated }, step.name);

        // Prepend: the context goes above whatever is already typed, so the
        // question stays last and the model reads it after the background.
        deps.insertText(composer, block + before, before);

        lastUndo = { el: composer, text: before };
        var note = packed.shards.length + ' item(s), ~' + packed.usedTokens + ' tokens';
        if (packed.skipped.length) note += ' · ' + packed.skipped.length + ' skipped for budget';
        toast(note, undo);
      });
    }

    function undo() {
      if (!lastUndo) return;
      deps.insertText(lastUndo.el, lastUndo.text, null);
      lastUndo = null;
    }

    function toast(message, onUndo) {
      closeMenu();
      var t = doc.createElement('div');
      t.className = 'menu';
      t.style.padding = '0';
      t.style.border = '0';
      t.style.boxShadow = 'none';
      t.style.width = 'auto';
      t.innerHTML = '<div class="toast"><span>' + esc(message) + '</span>' +
                    (onUndo ? '<button class="undo" type="button">Undo</button>' : '') + '</div>';
      wrap.appendChild(t);
      menu = t;
      if (onUndo) {
        var b = t.querySelector('.undo');
        if (b) b.addEventListener('click', function () { onUndo(); closeMenu(); });
      }
      win.setTimeout(function () { if (menu === t) closeMenu(); }, 6000);
    }

    pill.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (menu) { closeMenu(); return; }
      if (cache) { renderMenu(); return; }
      deps.getIndex(function (err, data) {
        cache = err ? { steps: [], shards: [] } : data;
        renderMenu();
      });
    });

    doc.addEventListener('click', function (e) {
      if (menu && e.target !== host) closeMenu();
    }, true);

    function refresh() {
      var found = findComposer(doc, (win.location && win.location.hostname) || '');
      if (found !== composer) { composer = found; closeMenu(); }
      position();
    }

    return {
      host: host,
      shadow: shadow,
      mount: function (into) {
        (into || doc.body).appendChild(host);
        refresh();
        win.addEventListener('scroll', position, true);
        win.addEventListener('resize', position);
        // Composers get re-created on navigation inside these single-page apps,
        // so a one-time lookup goes stale within a click or two.
        win.setInterval(refresh, 1500);
      },
      refresh: refresh,
      position: position,
      applyStep: applyStep,
      setCache: function (c) { cache = c; },
      getComposer: function () { return composer; }
    };
  }

  var API = {
    findComposer: findComposer,
    hostConfig: hostConfig,
    readComposer: readComposer,
    create: create
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    root.SBMemoryPicker = API;
  }

}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this));
