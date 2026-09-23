// SAVE SELECTION — turns highlighted text on any page into a memory item.
//
// The third capture path, beside chat-capture.js (a whole AI conversation, via
// the popup) and the dashboard's own editor. This one is the cheapest of the
// three and the one that has to work everywhere, so it assumes nothing about
// the page: no adapter list, no per-host selectors, just whatever the user
// highlighted.
//
// WHY THE PAGE READS ITS OWN SELECTION. The background worker could pass
// info.selectionText from the click, and that is what the obvious version of
// this does. Chrome truncates that string. The result is a clipping that looks
// complete, is not, and gives the user no signal that the tail went missing —
// so the worker sends the click and this reads window.getSelection() in full,
// keeping its own text only as a fallback for the case where the selection is
// already gone.
//
// WHY THE WORKER DOES THE WRITING. A content script shares the page's world.
// Handing it the user's session would put a memory-write credential on every
// site they visit. Everything that touches Supabase goes through a message.
(function (root) {
  'use strict';

  var doc = root.document;

  var CARD_ID = 'sb-save-sel';
  var BD_ID   = 'sb-save-sel-bd';
  var CSS_ID  = 'sb-save-sel-css';

  var BRAND = '#1B4FD8';

  function ask(type, payload, cb) {
    try {
      chrome.runtime.sendMessage(Object.assign({ type: type }, payload || {}), function (res) {
        if (chrome.runtime.lastError || !res || !res.ok) { cb(new Error('unavailable')); return; }
        cb(null, res);
      });
    } catch (e) { cb(e); }
  }

  function injectCss() {
    if (doc.getElementById(CSS_ID)) return;
    var s = doc.createElement('style');
    s.id = CSS_ID;
    // Self-contained on purpose. content.js injects a keyframe of its own, but
    // borrowing it would make this file break the day that block is renamed.
    s.textContent =
      '@keyframes sbSaveSelIn{0%{opacity:0;transform:translate(-50%,-50%) scale(.75)}' +
      '100%{opacity:1;transform:translate(-50%,-50%) scale(1)}}';
    doc.head.appendChild(s);
  }

  function close() {
    [CARD_ID, BD_ID].forEach(function (id) {
      var el = doc.getElementById(id);
      if (el) el.remove();
    });
    doc.removeEventListener('keydown', onKey, true);
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  }

  /** One line of plain text, for the summary and the preview. */
  function flatten(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  }

  function el(tag, style, text) {
    var node = doc.createElement(tag);
    if (style) node.style.cssText = style;
    // textContent throughout: every string here comes off the page, and this is
    // the only file in the extension that puts page text into its own DOM.
    if (text != null) node.textContent = text;
    return node;
  }

  function button(label, primary) {
    return el('button',
      'flex:1;padding:9px 14px;border-radius:9px;font-size:13px;font-weight:700;' +
      'cursor:pointer;font-family:inherit;border:' +
      (primary ? 'none;background:' + BRAND + ';color:#fff' : '1.5px solid #E4E4E7;background:#fff;color:#52525B'),
      label);
  }

  function show(text) {
    close();
    injectCss();

    // A page served from a file, a data: URL or a sandboxed frame has no
    // hostname, so neither the label nor the metadata can assume one.
    var host  = location.hostname || '';
    var title = flatten(doc.title) || host || 'Untitled page';
    var flat  = flatten(text);
    var words = flat ? flat.split(' ').length : 0;

    var bd = el('div', 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2147483646;');
    bd.id = BD_ID;
    bd.addEventListener('click', close);

    var card = el('div',
      'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
      'z-index:2147483647;width:380px;max-width:92vw;' +
      'background:#fff;border-radius:20px;padding:22px;' +
      'box-shadow:0 24px 80px rgba(0,0,0,.22);' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
      'animation:sbSaveSelIn .3s cubic-bezier(.34,1.56,.64,1) forwards;');
    card.id = CARD_ID;

    card.appendChild(el('div',
      'font-size:17px;font-weight:700;color:#18181B;margin-bottom:3px', 'Save to Brain'));
    card.appendChild(el('div',
      'font-size:11px;color:#A1A1AA;margin-bottom:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
      [host, words + ' words'].filter(Boolean).join(' · ')));

    card.appendChild(el('div',
      'font-size:12px;line-height:1.5;color:#52525B;background:#F4F4F5;border-radius:10px;' +
      'padding:10px 12px;max-height:120px;overflow:auto;margin-bottom:14px;white-space:pre-wrap',
      text));

    var select = el('select',
      'width:100%;padding:9px 10px;border:1.5px solid #E4E4E7;border-radius:9px;' +
      'font-size:13px;font-family:inherit;color:#18181B;background:#fff;margin-bottom:12px');

    var note = el('div', 'font-size:11px;color:#A1A1AA;margin-top:10px;min-height:14px');

    function setNote(message, isError) {
      note.textContent = message || '';
      note.style.color = isError ? '#DC2626' : '#A1A1AA';
    }

    var row     = el('div', 'display:flex;gap:8px');
    var cancel  = button('Cancel', false);
    var save    = button('Save', true);
    cancel.addEventListener('click', close);
    row.appendChild(cancel);
    row.appendChild(save);

    card.appendChild(select);
    card.appendChild(row);
    card.appendChild(note);

    doc.body.appendChild(bd);
    doc.body.appendChild(card);
    doc.addEventListener('keydown', onKey, true);

    save.disabled = true;
    ask('memory_spaces', null, function (err, res) {
      var spaces = (res && res.rows) || [];
      if (err || !spaces.length) {
        select.style.display = 'none';
        // Covers both causes: supaFetch answers [] for a failed request as well
        // as for an account with no spaces yet.
        setNote('No Brains available. Open the dashboard and check you are signed in.', true);
        return;
      }
      spaces.forEach(function (s) {
        var opt = doc.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name;
        select.appendChild(opt);
      });
      save.disabled = false;
    });

    save.addEventListener('click', function () {
      if (save.disabled) return;
      var spaceId = select.value;
      if (!spaceId) return;

      var chunker = root.SBMemoryChunk;
      if (!chunker) { setNote('Cannot prepare this text to save.', true); return; }

      var packed = chunker.chunkText(text);
      var parts  = packed.chunks;
      if (!parts.length) { setNote('Nothing to save.', true); return; }

      // Same naming rule as the chat capture: names are unique per user among
      // live rows, so the timestamp is what makes saving the same page twice an
      // addition rather than an error.
      var stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
      var base  = title.slice(0, 40);
      // A data: URL carries the whole document in location.href. Provenance is
      // worth keeping; a megabyte of it inside a jsonb column is not.
      var source = location.href.slice(0, 2048);

      var payloads = parts.map(function (body, i) {
        var suffix = parts.length > 1 ? ' (' + (i + 1) + '/' + parts.length + ')' : '';
        return {
          p_shard_id: null,
          p_name: (base + ' · ' + stamp + suffix).slice(0, 64),
          // An excerpt, not a description of one. This column is what the
          // picker lists and what knowledge_search ranks on, so the clipping's
          // own words find it again; "saved from example.com" would not.
          p_summary: flatten(body).slice(0, 280),
          p_body: body,
          p_editor_display: 'Extension',
          p_space_id: spaceId,
          p_kind: 'note',
          p_metadata: { source_url: source, host: host, part: i + 1, parts: parts.length },
          p_pinned: false,
          p_priority: 0,
          p_edit_note: null,
          p_surface: 'extension'
        };
      });

      save.disabled = true;
      save.textContent = 'Saving…';
      setNote('');

      // One at a time. Each call writes a row, a version and an audit entry, and
      // a partial result has to be reportable as one.
      (function next(i) {
        if (i >= payloads.length) {
          save.textContent = 'Saved';
          setNote('Saved to Brain' + (payloads.length > 1 ? ' as ' + payloads.length + ' items' : '') +
                  (packed.forced ? '. Long text was split mid-paragraph.' : '.'));
          setTimeout(close, 1400);
          return;
        }
        ask('memory_save', { payload: payloads[i] }, function (err) {
          if (err) {
            save.disabled = false;
            save.textContent = 'Save';
            setNote(i > 0 ? 'Saved ' + i + ' of ' + payloads.length + ', then failed.'
                          : 'Could not save this selection.', true);
            return;
          }
          next(i + 1);
        });
      }(0));
    });
  }

  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg || msg.type !== 'SB_SAVE_SELECTION') return;
    var sel = '';
    try {
      var s = root.getSelection();
      if (s) sel = String(s);
    } catch (e) { /* cross-origin frame, or a page that traps getSelection */ }
    if (!sel.trim()) sel = String(msg.fallbackText || '');
    if (!sel.trim()) return;
    try {
      show(sel);
    } catch (e) {
      // A page that breaks DOM building mid-card would otherwise leave its
      // backdrop covering the site with no way to dismiss it.
      close();
      console.warn('[Sprintbrain] save selection:', e && e.message);
    }
  });

}(typeof window !== 'undefined' ? window : this));
