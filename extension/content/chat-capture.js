// CHAT CAPTURE — reads the conversation off a supported AI chat page.
//
// The counterpart to memory-picker.js. That file finds the COMPOSER so context
// can be pushed into a chat; this one finds the THREAD so a chat can be pulled
// out of the page and saved as memory.
//
// ⚠ THIS IS THE MOST FRAGILE FILE IN THE EXTENSION, and knowingly so. A
// composer is one editable box and has a reliable structural fallback: the
// largest editable in the lower half of the viewport. A message thread has no
// such shape. It is a deeply nested list whose only stable handles are the
// data attributes each vendor happens to ship, and those change without notice.
//
// Two consequences drive the design:
//
//   1. ONLY TWO SITES. ChatGPT and Claude, because those are the two whose
//      markup has been read directly. Adding a host here without checking its
//      DOM produces silent, plausible-looking garbage, which is worse than
//      saying "not supported" and is the whole reason the list is short.
//
//   2. NO STRUCTURAL FALLBACK. When the selectors miss, this returns null and
//      the popup says so. It does not guess at "the biggest block of text on
//      the page", because on these apps that is as likely to be the sidebar,
//      a settings panel or an onboarding modal as it is the conversation.
//      Saving the wrong thing into someone's memory is the failure worth
//      avoiding; refusing is cheap and recoverable.
(function (root) {
  'use strict';

  var doc = root.document;

  // Per-host reading instructions.
  //
  // `turns` selects one element per message. `role` maps an element to
  // 'user' | 'assistant'; returning null drops the turn, which is what keeps
  // toolbars and system notices out of the transcript.
  var HOSTS = [
    {
      name: 'ChatGPT',
      match: /(^|\.)(chatgpt\.com|chat\.openai\.com)$/,
      // data-message-author-role has survived every ChatGPT redesign so far and
      // is the only attribute that states the speaker outright.
      turns: '[data-message-author-role]',
      role: function (el) {
        var raw = el.getAttribute('data-message-author-role');
        if (raw === 'user') return 'user';
        if (raw === 'assistant') return 'assistant';
        return null;
      }
    },
    {
      name: 'Claude',
      match: /(^|\.)claude\.ai$/,
      turns: '[data-testid="user-message"], .font-claude-message, .font-claude-response',
      role: function (el) {
        if (el.getAttribute('data-testid') === 'user-message') return 'user';
        return 'assistant';
      }
    }
  ];

  function hostConfig(hostname) {
    for (var i = 0; i < HOSTS.length; i++) {
      if (HOSTS[i].match.test(hostname)) return HOSTS[i];
    }
    return null;
  }

  /** Visible text of one turn, with code blocks and list structure preserved. */
  function turnText(el) {
    if (!el) return '';
    // innerText rather than textContent: it respects display, so hidden
    // scaffolding and screen-reader-only labels stay out, and it inserts the
    // line breaks that make a code block readable once saved.
    var text = el.innerText != null ? el.innerText : el.textContent;
    return String(text == null ? '' : text).replace(/ /g, ' ').trim();
  }

  /**
   * A readable title for the conversation.
   *
   * The document title is what the user sees in their own history, so it is the
   * name they will look for. Both apps suffix it with the product name, which
   * is noise once the item already records where it came from.
   */
  function conversationTitle(cfg) {
    var raw = String(doc.title || '').trim();
    raw = raw.replace(/\s*[|\-–]\s*(ChatGPT|Claude)\s*$/i, '').trim();
    if (!raw || /^(chatgpt|claude)$/i.test(raw)) return cfg.name + ' conversation';
    return raw;
  }

  /**
   * Read the conversation, or null when this page is not a supported thread.
   *
   * Shape: { host, title, url, turns: [{ role, text }], chars }
   */
  function capture() {
    var cfg = hostConfig(root.location ? root.location.hostname : '');
    if (!cfg) return null;

    var nodes = doc.querySelectorAll(cfg.turns);
    if (!nodes || !nodes.length) return null;

    var turns = [];
    var chars = 0;
    for (var i = 0; i < nodes.length; i++) {
      var role = cfg.role(nodes[i]);
      if (!role) continue;
      var text = turnText(nodes[i]);
      if (!text) continue;
      turns.push({ role: role, text: text });
      chars += text.length;
    }

    // One turn is a page that happens to contain a message, not a
    // conversation worth saving. Usually a half-loaded thread.
    if (turns.length < 2) return null;

    return {
      host: cfg.name,
      title: conversationTitle(cfg),
      url: root.location ? root.location.href.split('#')[0] : '',
      turns: turns,
      chars: chars
    };
  }

  /** The transcript as blocks, one per turn, ready for the chunker. */
  function toBlocks(captured) {
    if (!captured || !captured.turns) return [];
    var blocks = [];
    for (var i = 0; i < captured.turns.length; i++) {
      var turn = captured.turns[i];
      var speaker = turn.role === 'user' ? 'You' : captured.host;
      blocks.push('### ' + speaker + '\n' + turn.text);
    }
    return blocks;
  }

  var API = {
    hostConfig: hostConfig,
    capture: capture,
    toBlocks: toBlocks
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    root.SBChatCapture = API;
  }

}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this));
