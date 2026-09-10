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
  // `budget` is the default token ceiling for context on that host. It is not
  // about what the model can take: it is about what a wall of text above the
  // prompt does to a message you are still writing. Claude handles a longer
  // preamble comfortably; on the others a shorter one reads better. Overridable
  // per host from the panel.
  var DEFAULT_BUDGET = 1500;
  var HOSTS = [
    { match: /(^|\.)chatgpt\.com$/,        budget: 2000, sel: ['#prompt-textarea', 'div[contenteditable="true"]', 'textarea'] },
    { match: /(^|\.)chat\.openai\.com$/,   budget: 2000, sel: ['#prompt-textarea', 'div[contenteditable="true"]', 'textarea'] },
    { match: /(^|\.)claude\.ai$/,          budget: 4000, sel: ['div[contenteditable="true"].ProseMirror', 'div[contenteditable="true"]'] },
    { match: /(^|\.)gemini\.google\.com$/, budget: 2000, sel: ['div.ql-editor[contenteditable="true"]', 'div[contenteditable="true"]'] },
    { match: /(^|\.)grok\.com$/,           budget: 2000, sel: ['textarea', 'div[contenteditable="true"]'] },
    { match: /(^|\.)perplexity\.ai$/,      budget: 2000, sel: ['textarea', 'div[contenteditable="true"]'] },
    { match: /(^|\.)chat\.deepseek\.com$/, budget: 2000, sel: ['#chat-input', 'textarea'] },
    { match: /(^|\.)copilot\.microsoft\.com$/, budget: 2000, sel: ['textarea#userInput', 'textarea'] }
  ];

  /** The default budget for a hostname, or the conservative fallback. */
  function hostBudget(hostname) {
    var cfg = hostConfig(hostname);
    return (cfg && cfg.budget) || DEFAULT_BUDGET;
  }

  // Only the tail of the draft is used as the query. A long message is several
  // thoughts, and the one being written now is the one that needs context; the
  // opening paragraph would otherwise dominate every search.
  var QUERY_TAIL_CHARS = 600;

  function draftQuery(text) {
    var s = String(text == null ? '' : text);
    // Never search on our own injected block: it would match itself and rank
    // everything the user already has above everything they do not.
    if (PACK.stripInjectedBlock) s = PACK.stripInjectedBlock(s);
    s = s.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    return s.length > QUERY_TAIL_CHARS ? s.slice(s.length - QUERY_TAIL_CHARS) : s;
  }

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
    'font-size:11px;font-weight:600;color:#1B4FD8;cursor:pointer}',
    // ── Injection panel (MEMORY-002 I1) ──
    // The panel is a flex column with its own scroll region, so clamping its
    // height shortens the LIST and never pushes the footer out of reach. The
    // outer .menu scroll is turned off here for the same reason.
    '.panel{width:380px;padding:0;overflow:hidden;display:flex;flex-direction:column}',
    '.plist{overflow-y:auto;min-height:0;padding:0 6px 2px}',
    '.ptop{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:8px 10px 4px}',
    '.ptitle{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6B6B70}',
    '.pcount{font-size:11px;color:#6E6E73;font-variant-numeric:tabular-nums}',
    '.pcount.over{color:#D70015;font-weight:600}',
    '.item{display:flex;align-items:flex-start;gap:8px;padding:7px 10px;border-radius:8px;cursor:pointer}',
    '.item:hover{background:#EEF2FF}',
    '.item input{margin:2px 0 0;width:14px;height:14px;flex:0 0 auto;accent-color:#1B4FD8;cursor:pointer}',
    '.item .txt{min-width:0;flex:1}',
    '.item .nm{display:block;font-size:13px;font-weight:600;color:#1C1C1E;',
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.item .sub{display:block;font-size:11px;color:#6E6E73;margin-top:1px;',
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.kind{display:inline-block;padding:0 5px;border-radius:999px;background:#F2F2F7;',
    'font-size:9px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#6B6B70;margin-right:5px}',
    '.pfoot{display:flex;align-items:center;gap:6px;padding:6px 10px 8px;border-top:1px solid #E5E5EA;flex:0 0 auto}',
    '.btn{padding:6px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid #1B4FD8;',
    'background:#1B4FD8;color:#fff}',
    '.btn:hover{background:#1440B0;border-color:#1440B0}',
    '.btn:disabled{opacity:.5;cursor:default}',
    '.btn.ghost{background:transparent;color:#1B4FD8;border-color:#BED0FF}',
    '.btn.ghost:hover{background:#EEF2FF}',
    '.spacer{flex:1}',
    '.bsel{padding:4px 6px;border:1px solid #E5E5EA;border-radius:7px;background:#fff;',
    'font-size:11px;color:#1C1C1E;cursor:pointer}',
    '.loading{padding:14px 10px;font-size:12px;color:#6E6E73}'
  ].join('');

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /**
   * @param {object} deps
   *   search(query, cb)         cb(err, rows) — knowledge_search rows, no bodies
   *   getBodies(ids, cb)        cb(err, [{id, body}]) — only for accepted ids
   *   insertText(el, text, prev) writes into the composer; the surface's own inserter
   *   loadBudget(host, cb)      cb(tokens|null) — the user's override for this site
   *   saveBudget(host, tokens)  persists that override
   *   doc, win                  overridable for the test harness
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

    // ── Injection panel (MEMORY-002 I1) ────────────────────────────────────
    //
    // Replaces the step menu. The draft in the composer is the query: nothing
    // to configure, nothing to pick from a list of phases someone had to create
    // in SQL first. The panel is a chooser, not a decider; buildContext in
    // memory-pack.js stays the single selection authority and runs at insert,
    // on real bodies.

    var results = [];      // ContextCandidates from the last search, ranked
    var checked = {};      // id -> true, the user's choices
    var budget = 0;        // token ceiling for this host
    var searching = false;

    function checkedCandidates() {
      var out = [];
      for (var i = 0; i < results.length; i++) {
        if (checked[results[i].id]) out.push(results[i]);
      }
      return out;
    }

    function checkedTokens() {
      var picked = checkedCandidates();
      var total = 0;
      for (var i = 0; i < picked.length; i++) total += picked[i].tokens;
      return total;
    }

    function renderPanel() {
      closeMenu();
      menu = doc.createElement('div');
      menu.className = 'menu panel';

      if (searching) {
        menu.innerHTML = '<div class="loading">Looking through your memory…</div>';
        wrap.appendChild(menu);
        pill.setAttribute('data-active', '1');
        placeMenu();
        return;
      }

      var used = checkedTokens();
      var over = used > budget;
      var html = '<div class="ptop"><span class="ptitle">Add context</span>' +
                 '<span class="pcount' + (over ? ' over' : '') + '">' +
                 used + ' / ' + budget + ' tokens</span></div>';

      // Only this list scrolls. The header and footer stay put, so Insert is
      // reachable however short the panel has been clamped.
      html += '<div class="plist">';
      if (!results.length) {
        html += '<div class="empty">Nothing in your memory matches what you are writing.' +
                '<br>Save something first, or keep typing and refresh.</div>';
      } else {
        for (var i = 0; i < results.length; i++) {
          var c = results[i];
          var on = checked[c.id] ? ' checked' : '';
          html += '<label class="item"><input type="checkbox" data-id="' + esc(c.id) + '"' + on + '>' +
                  '<span class="txt"><span class="nm">' + esc(c.name) + '</span>' +
                  '<span class="sub"><span class="kind">' + esc(c.kind) + '</span>' +
                  c.tokens + 't · ' + esc(c.summary || 'No summary') + '</span></span></label>';
        }
      }
      html += '</div>';

      html += '<div class="pfoot">' +
              '<select class="bsel" title="Token budget for this site">' +
              budgetOptions(budget) + '</select>' +
              '<button class="btn ghost" data-act="refresh" type="button">Refresh</button>' +
              '<span class="spacer"></span>';
      if (PACK.hasInjectedBlock(readComposer(composer))) {
        html += '<button class="btn ghost" data-act="remove" type="button">Remove</button>';
      }
      html += '<button class="btn" data-act="insert" type="button"' +
              (checkedCandidates().length ? '' : ' disabled') + '>Insert ' +
              checkedCandidates().length + '</button></div>';

      menu.innerHTML = html;
      wrap.appendChild(menu);
      pill.setAttribute('data-active', '1');
      placeMenu();
      wirePanel();
    }

    function budgetOptions(current) {
      var choices = [1000, 1500, 2000, 3000, 4000, 8000];
      var html = '';
      var seen = false;
      for (var i = 0; i < choices.length; i++) {
        if (choices[i] === current) seen = true;
        html += '<option value="' + choices[i] + '"' +
                (choices[i] === current ? ' selected' : '') + '>' + choices[i] + ' tokens</option>';
      }
      if (!seen) {
        html = '<option value="' + current + '" selected>' + current + ' tokens</option>' + html;
      }
      return html;
    }

    /**
     * Put the panel on the side with more room, and never let it exceed that
     * room.
     *
     * The previous rule flipped downward whenever the upward panel did not fit,
     * without asking whether downward fitted either. On these sites the
     * composer sits at the bottom of the window, so downward is almost always
     * the worse side: the panel flipped into the space under the composer and
     * ran straight off the bottom of the screen.
     *
     * Measuring both sides fixes that, and clamping the height to whatever was
     * measured is what makes the fix hold. Without the clamp the panel would
     * still overflow the side it chose, just less often.
     */
    function placeMenu() {
      if (!menu) return;

      var GAP = 8;
      var MAX = 340;
      // Below this a panel is not usable, and a page short enough to trigger it
      // is not a chat composer. Clamping to the floor and accepting a little
      // overflow beats rendering something nobody can read.
      var MIN = 140;

      var anchor = host.getBoundingClientRect();
      var viewportHeight = win.innerHeight || doc.documentElement.clientHeight || 0;

      var roomAbove = anchor.top - GAP;
      var roomBelow = viewportHeight - anchor.bottom - GAP;

      // Ties go upward: it is where the room usually is, and a panel that stays
      // put between openings is less disorienting than one that hops sides.
      var openUpward = roomAbove >= roomBelow;
      var room = openUpward ? roomAbove : roomBelow;

      if (openUpward) {
        menu.style.top = 'auto';
        menu.style.bottom = 'calc(100% + ' + GAP + 'px)';
      } else {
        menu.style.bottom = 'auto';
        menu.style.top = 'calc(100% + ' + GAP + 'px)';
      }

      menu.style.maxHeight = Math.round(Math.max(MIN, Math.min(room, MAX))) + 'px';
    }

    function wirePanel() {
      var boxes = menu.querySelectorAll('input[type="checkbox"]');
      for (var i = 0; i < boxes.length; i++) {
        boxes[i].addEventListener('change', function (e) {
          var id = e.currentTarget.getAttribute('data-id');
          if (e.currentTarget.checked) checked[id] = true;
          else delete checked[id];
          renderPanel();
        });
      }

      var sel = menu.querySelector('.bsel');
      if (sel) {
        sel.addEventListener('change', function (e) {
          budget = parseInt(e.currentTarget.value, 10) || budget;
          deps.saveBudget(hostname(), budget);
          autoCheck();
          renderPanel();
        });
      }

      var buttons = menu.querySelectorAll('button[data-act]');
      for (var k = 0; k < buttons.length; k++) {
        buttons[k].addEventListener('click', function (e) {
          var act = e.currentTarget.getAttribute('data-act');
          if (act === 'refresh') search();
          else if (act === 'insert') insertChecked();
          else if (act === 'remove') removeBlock();
        });
      }
    }

    function hostname() {
      return (win.location && win.location.hostname) || '';
    }

    /**
     * Pre-check from the top down until the budget is full.
     *
     * The common case is accepting what was suggested, so the panel opens with
     * a usable selection rather than an empty one. A candidate that does not
     * fit is skipped rather than ending the loop, so a short item ranked below
     * a long one still gets in, which is the same rule the engine applies.
     */
    function autoCheck() {
      checked = {};
      var used = 0;
      for (var i = 0; i < results.length; i++) {
        if (used + results[i].tokens <= budget) {
          checked[results[i].id] = true;
          used += results[i].tokens;
        }
      }
    }

    function search() {
      if (!composer) return;
      searching = true;
      renderPanel();

      deps.search(draftQuery(readComposer(composer)), function (err, rows) {
        searching = false;
        results = [];
        if (!err && rows) {
          for (var i = 0; i < rows.length; i++) {
            results.push(PACK.candidateFromSearchRow(rows[i]));
          }
        }
        autoCheck();
        renderPanel();
      });
    }

    function openPanel() {
      if (!composer) return;
      if (!budget) budget = hostBudget(hostname());
      deps.loadBudget(hostname(), function (saved) {
        if (saved) budget = saved;
        search();
      });
    }

    function insertChecked() {
      var picked = checkedCandidates();
      if (!picked.length || !composer) return;

      var ids = [];
      for (var i = 0; i < picked.length; i++) ids.push(picked[i].id);

      deps.getBodies(ids, function (err, rows) {
        if (err) { toast('Could not load that context.', null); return; }

        var byId = {};
        for (var j = 0; j < rows.length; j++) byId[rows[j].id] = rows[j].body;

        // Bodies are in hand, so the engine can do the real work: floor,
        // deduplicate on actual text, budget, and compress to a summary when a
        // body will not fit.
        var candidates = [];
        for (var k = 0; k < picked.length; k++) {
          var c = picked[k];
          candidates.push({
            id: c.id, kind: c.kind, name: c.name, summary: c.summary,
            body: byId[c.id] || '', tokens: c.tokens,
            pinned: false, rank: c.rank, contentHash: ''
          });
        }

        var pack = PACK.buildContext({ candidates: candidates, budget: budget });
        if (!pack.items.length) { toast('Nothing fitted in the budget.', null); return; }

        var current = readComposer(composer);
        // Replacing rather than stacking: inserting twice should refresh the
        // context, not leave two blocks arguing with each other.
        var draft = PACK.stripInjectedBlock(current);
        var block = PACK.formatInjectedBlock(pack);

        deps.insertText(composer, block + draft, current);
        lastUndo = { el: composer, text: current };

        var note = pack.items.length + ' item' + (pack.items.length === 1 ? '' : 's') +
                   ', ' + pack.usedTokens + ' tokens';
        var compressed = 0;
        for (var m = 0; m < pack.items.length; m++) if (pack.items[m].compressed) compressed++;
        if (compressed) note += ' · ' + compressed + ' shortened to fit';
        if (pack.deduped.length) note += ' · ' + pack.deduped.length + ' duplicate removed';
        if (pack.dropped.length) note += ' · ' + pack.dropped.length + ' did not fit';
        toast(note, undo);
      });
    }

    function removeBlock() {
      if (!composer) return;
      var current = readComposer(composer);
      var stripped = PACK.stripInjectedBlock(current);
      if (stripped === current) { toast('No context to remove.', null); return; }
      deps.insertText(composer, stripped, current);
      lastUndo = { el: composer, text: current };
      toast('Context removed.', undo);
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
      // Same anchoring as the panel: a toast under a bottom-anchored composer
      // would run off screen for exactly the same reason.
      placeMenu();
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
      openPanel();
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
      /** The keyboard shortcut's entry point, and the pill's. */
      open: openPanel,
      close: closeMenu,
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
