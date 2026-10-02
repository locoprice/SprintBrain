// MEMORY CHUNKER — splits long text into shard-sized pieces, names the pieces a
// capture saves (captureName, captureSummary) and suggests the Brain a capture
// belongs in (suggestBrain), at the end of the file.
//
// The database caps memory_shards.body at 20,000 characters, and the cap is
// deliberate: anything larger is a document, not a fact, and no token budget
// survives attaching one. Capturing a chat transcript is the first thing that
// routinely exceeds it, so this is where the splitting rule lives.
//
// SHARED ON PURPOSE. Document upload (MEMORY-002 S3) has the identical problem
// and must reuse this rather than write a second splitter, or the two will
// disagree about where a boundary falls and the same file will chunk
// differently depending on how it arrived.
//
// The rule, in order of preference:
//   1. Never split inside a turn. A half-sentence attributed to the wrong
//      speaker is worse than an extra chunk.
//   2. A turn that is itself over the cap is split on paragraph, then line,
//      then hard character count. That last case is a genuine loss of
//      structure, so it is reported rather than done silently.
//   3. Pack greedily up to the cap. Fewer, fuller chunks beat many small ones,
//      because every chunk costs a name, a summary and an index entry.
(function (root) {
  'use strict';

  // Must stay at or below the memory_shards_body_length CHECK in
  // services/supabase/migrations/20260822000000_working_memory.sql. Held a
  // little under so a joining separator can never push a chunk over.
  var MAX_BODY = 19800;

  var SEPARATOR = '\n\n';

  /** Split one oversized string on the largest boundary that fits. */
  function splitOversized(text, limit, forced) {
    var out = [];
    var rest = String(text == null ? '' : text);

    while (rest.length > limit) {
      // Prefer a paragraph break, then a line break, then give up and cut.
      var cut = rest.lastIndexOf('\n\n', limit);
      if (cut < limit * 0.5) cut = rest.lastIndexOf('\n', limit);
      if (cut < limit * 0.5) {
        cut = limit;
        forced.count += 1;
      }
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^\n+/, '');
    }
    if (rest.length) out.push(rest);
    return out;
  }

  /**
   * Pack an array of blocks into chunks no larger than `limit`.
   *
   * Returns { chunks: string[], forced: number } where `forced` counts the
   * times a block had to be cut mid-paragraph because no boundary existed.
   * A caller that cares about fidelity can surface that.
   */
  function chunkBlocks(blocks, limit) {
    var max = typeof limit === 'number' && limit > 0 ? limit : MAX_BODY;
    var forced = { count: 0 };
    var chunks = [];
    var current = '';

    function flush() {
      if (current.length) chunks.push(current);
      current = '';
    }

    for (var i = 0; i < blocks.length; i++) {
      var block = String(blocks[i] == null ? '' : blocks[i]).trim();
      if (!block) continue;

      if (block.length > max) {
        // This single block does not fit on its own. Emit what is buffered,
        // then break the block down before continuing.
        flush();
        var pieces = splitOversized(block, max, forced);
        for (var p = 0; p < pieces.length; p++) chunks.push(pieces[p]);
        continue;
      }

      var candidate = current ? current + SEPARATOR + block : block;
      if (candidate.length > max) {
        flush();
        current = block;
      } else {
        current = candidate;
      }
    }
    flush();

    return { chunks: chunks, forced: forced.count };
  }

  /** Convenience for plain text with no turn structure (S3 documents). */
  function chunkText(text, limit) {
    var max = typeof limit === 'number' && limit > 0 ? limit : MAX_BODY;
    var body = String(text == null ? '' : text);
    if (body.length <= max) return { chunks: body.trim() ? [body.trim()] : [], forced: 0 };
    return chunkBlocks(body.split(/\n{2,}/), max);
  }

  // ── What a capture is called ────────────────────────────────────────────
  // Three paths save captured text into a Brain: the extension's Save to Brain
  // (a highlighted selection), its chat capture (a whole conversation) and the
  // phone's Save to Brain (text shared from another app, or pasted). They name
  // what they save the same way, here, so a Brain reads the same whichever one
  // filled it. Uploaded files are named by the dashboard instead
  // (app/src/lib/documentImport.ts): a file has a name of its own, a capture
  // only has a source and a moment.

  // The memory_shards name and summary CHECKs.
  var NAME_MAX = 64;
  var SUMMARY_MAX = 280;
  // The most of a name the source's title may take. The rest is the moment of
  // the save, which is what tells two saves from the same page apart.
  var TITLE_MAX = 40;

  /** One line of plain text. */
  function flatten(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  }

  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /**
   * "Pasta at home · 2026-10-02 14:30:05", then " (2/3)" when the text was
   * split. Names are unique per account among live rows, so the moment, to the
   * second and on the saver's own clock, is what makes saving from the same
   * page twice an addition rather than an error. The moment and the part are
   * never what gets cut: the title is shortened to make room for them.
   */
  function captureName(title, when, part, parts) {
    var d = when instanceof Date && !isNaN(when.getTime()) ? when : new Date();
    var tail = ' · ' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
      (parts > 1 ? ' (' + part + '/' + parts + ')' : '');
    var head = flatten(title).slice(0, Math.min(TITLE_MAX, NAME_MAX - tail.length)).trim();
    return (head || 'Untitled') + tail;
  }

  /**
   * An excerpt, not a description of one. The summary column is what the
   * picker lists and what knowledge_search ranks on, so the clipping's own
   * words find it again; "saved from example.com" would not.
   */
  function captureSummary(text) {
    return flatten(text).slice(0, SUMMARY_MAX);
  }

  // ── Where a capture goes ────────────────────────────────────────────────
  // Before a capture is saved, the Brain it most likely belongs in is offered
  // first. Words only, worked out on the device: nothing is sent anywhere and
  // nothing is learned. A Brain is known by its name, its description and the
  // names and summaries of what it already holds, and a capture is offered the
  // Brain whose words it shares most, each shared word counting for more the
  // fewer Brains use it. Bodies are left out on purpose: the extension would
  // have to download every one of them, and every app has to reach the same
  // answer from the same words.
  //
  // What it cannot do: tell that an Italian recipe belongs in an empty Brain
  // called Cooking, because the two share no word. A description, or a few
  // items, give it the words.

  // Words that say nothing about what a text is about, in the four languages
  // SprintBrain writes in, folded (lower case, no accents). Words shorter than
  // WORD_MIN are dropped before this list is read.
  var STOPWORDS = (function () {
    var set = {};
    (
      // English
      'the and for are but not you your yours our ours his her hers its they them their theirs this ' +
      'that these those with from into onto over under about above after before again then than there ' +
      'here when where which who whom whose what why how all any both each few more most other some ' +
      'such only own same very can will just should would could have has had having was were been ' +
      'being does did doing done get got also out off per via yet may might must shall let like need ' +
      'use used using make made want way well much many every still even back down upon while because ' +
      'until within without through between during against among across along around etc dont cant ' +
      'wont ive youre theyre thats anywhere else elsewhere somewhere everywhere ' +
      // Italian
      'che chi cui del della delle dei degli dello dal dalla dalle dai dagli dallo nel nella nelle nei ' +
      'negli nello sul sulla sulle sui sugli sullo alla alle agli allo con per tra fra una uno gli non ' +
      'come anche piu sono sei siamo siete era erano essere avere hanno abbiamo questo questa questi ' +
      'queste quello quella quelli quelle molto poco tutto tutti tutte ogni dove quando perche cosa ' +
      'mio mia miei mie tuo tua tuoi tue suo sua suoi sue nostro nostra nostri nostre vostro vostra ' +
      'loro stato stata fare fatto puoi puo ancora gia solo ecco poi quindi oppure cioe lei lui noi ' +
      'voi ciao grazie ' +
      // Spanish
      'que los las por para unos unas pero mas este estos estas ese esa esos esas eso esto aquel sus ' +
      'son fue ser estar han hay muy todo todos toda todas cuando donde porque sin sobre entre tambien ' +
      'nos les mis tus nuestro nuestra vuestro ella ellos ellas usted ustedes desde hasta cada otro ' +
      'otra otros otras puede pueden tiene tienen hacer hace hola gracias ' +
      // French
      'les des une pour avec qui dans sur par est sont pas plus mais ces cet cette ses son leur leurs ' +
      'nous vous ils elle elles aux tout tous toute toutes comme sans sous aussi bien fait faire etre ' +
      'avoir ont etait peut notre votre nos vos mes tes quand dont donc alors encore deja tres merci ' +
      'bonjour ' +
      // Numbers, greetings, small talk and time, in all four: they say when and
      // to whom, never what about.
      'one two three four five six seven eight nine ten uno due tre quattro cinque sette otto nove ' +
      'dieci dos tres cuatro cinco seis siete ocho nueve diez deux trois quatre cinq six sept huit ' +
      'neuf dix hello dear thanks thank please regards best kind hey message messages email mail see ' +
      'next last first new good great sure okay yes yeah thing things something anything nothing ' +
      'everything messaggio messaggi prossimo prossima ultimo ultima primo prima nuovo nuova buono ' +
      'bene cose mensaje mensajes correo proximo proxima primero primera nuevo nueva bueno bien cosas ' +
      'courriel prochain prochaine dernier derniere premier premiere nouveau nouvelle bon bonne chose ' +
      'choses today tomorrow yesterday day days week weeks month months year years time oggi domani ' +
      'ieri giorno giorni settimana mese anno anni volta hoy manana ayer dia dias semana mes ano anos ' +
      'vez jour jours semaine mois annee fois aujourdhui demain hier ' +
      // The parts of a link that every link has.
      'http https www com org net html htm php amp utm ref'
    ).split(' ').forEach(function (word) { if (word) set[word] = true; });
    return set;
  }());

  var WORD_MIN = 3;            // letters a word needs to count
  var WORD_MAX = 30;           // longer runs are ids, codes and links, not words
  var READ_MAX = 20000;        // how much of a capture is read
  var NAME_WEIGHT = 3;         // a word of the Brain's own name counts this much,
  var DESCRIPTION_WEIGHT = 2;  // one of its description this much, an item 1
  var MARGIN = 1.5;            // how far ahead of the next Brain the best must be
  var SHOWN = 3;               // words the note names

  // Built at run time, as letter classes are: an engine without them keeps the
  // Latin split below instead of failing to load the whole module.
  var WORD_SPLIT = (function () {
    try {
      return new RegExp('[^\\p{L}\\p{N}]+', 'u');
    } catch (e) {
      return /[^0-9a-zÀ-ɏ]+/;
    }
  }());

  /** Lower case without accents: "Ricétta" and "ricetta" are one word. */
  function fold(word) {
    return word.normalize ? word.normalize('NFD').replace(/[̀-ͯ]/g, '') : word;
  }

  /**
   * One form for a word's family, crude on purpose: a plural s, then -ing or
   * -ed, then the vowels Italian, Spanish and French end words on. So recipe
   * and recipes, ricetta and ricette, receta and recetas, cook, cooked and
   * cooking each meet on one form. It joins some words it should not (pasta
   * and past); the rarity weighting keeps that from mattering.
   */
  function stem(word) {
    var w = word;
    if (w.length > 3 && w.charAt(w.length - 1) === 's' && w.charAt(w.length - 2) !== 's') w = w.slice(0, -1);
    if (w.length > 5 && w.slice(-3) === 'ing') w = w.slice(0, -3);
    else if (w.length > 4 && w.slice(-2) === 'ed') w = w.slice(0, -2);
    while (w.length > 4 && /[aeiou]$/.test(w)) w = w.slice(0, -1);
    return w;
  }

  /**
   * The words of a text, by stem: how often each appears, the first way it
   * was written (for the note), and the order they first appear in.
   */
  function wordsOf(text, max) {
    var out = { count: {}, shown: {}, order: [] };
    var parts = String(text == null ? '' : text).slice(0, max).toLowerCase().split(WORD_SPLIT);
    for (var i = 0; i < parts.length; i++) {
      var raw = parts[i];
      if (raw.length < WORD_MIN || raw.length > WORD_MAX || /^\d+$/.test(raw)) continue;
      var folded = fold(raw);
      if (STOPWORDS[folded]) continue;
      var key = stem(folded);
      if (key.length < WORD_MIN) continue;
      if (!out.count[key]) {
        out.count[key] = 0;
        out.shown[key] = raw;
        out.order.push(key);
      }
      out.count[key] += 1;
    }
    return out;
  }

  /**
   * The Brain a capture most likely belongs in.
   *
   *   text    all that is known of the capture: its title, then its text
   *   brains  [{id, name, description}], in the order the Brain list shows
   *           them, which also breaks ties
   *   items   [{space_id, name, summary}]; items of Brains not in the list
   *           are ignored
   *
   * Returns {id, words, note}. id is the Brain to offer, or null; words are
   * what it was judged on, as they are written in the text; note is the line
   * shown under the Brain list: why this Brain, that two fit equally, or that
   * none fits. With fewer than two Brains, or too few words to judge, note is
   * empty: there is nothing to say.
   *
   * A Brain qualifies on two shared words, or on one that is part of its
   * name, its description or an item's name. One word from a summary is too
   * thin: "message" or "price" would send texts to whichever Brain happened to
   * use it once.
   */
  function suggestBrain(text, brains, items) {
    var list = Array.isArray(brains) ? brains : [];
    var none = { id: null, words: [], note: '' };
    if (list.length < 2) return none;
    var said = wordsOf(text, READ_MAX);
    if (said.order.length < 2) return none;

    var profiles = [];
    var byId = {};
    list.forEach(function (brain) {
      var profile = { id: brain.id, name: String(brain.name || ''), weight: {}, strong: {} };
      [[brain.name, NAME_WEIGHT], [brain.description, DESCRIPTION_WEIGHT]].forEach(function (pair) {
        wordsOf(pair[0], READ_MAX).order.forEach(function (key) {
          profile.weight[key] = (profile.weight[key] || 0) + pair[1];
          profile.strong[key] = true;
        });
      });
      profiles.push(profile);
      byId[brain.id] = profile;
    });
    (Array.isArray(items) ? items : []).forEach(function (item) {
      var profile = byId[item.space_id];
      if (!profile) return;
      // Each item is one vote per word, however often it repeats the word.
      var named = wordsOf(item.name, READ_MAX).order;
      var seen = {};
      named.forEach(function (key) { profile.strong[key] = true; });
      named.concat(wordsOf(item.summary, READ_MAX).order).forEach(function (key) {
        if (seen[key]) return;
        seen[key] = true;
        profile.weight[key] = (profile.weight[key] || 0) + 1;
      });
    });

    // How many Brains use each word: the fewer, the more it says.
    var used = {};
    profiles.forEach(function (profile) {
      Object.keys(profile.weight).forEach(function (key) { used[key] = (used[key] || 0) + 1; });
    });

    var scored = profiles.map(function (profile, index) {
      var score = 0;
      var hits = [];
      said.order.forEach(function (key) {
        var weight = profile.weight[key];
        // A word every Brain uses cannot tell them apart.
        if (!weight || used[key] === profiles.length) return;
        var part = Math.log(1 + profiles.length / used[key]) *
          (1 + Math.log(weight)) * (1 + Math.log(said.count[key]));
        score += part;
        hits.push({ key: key, part: part });
      });
      var qualifies = hits.length >= 2 || (hits.length === 1 && profile.strong[hits[0].key] === true);
      return { profile: profile, score: qualifies ? score : 0, hits: hits, index: index };
    }).sort(function (a, b) {
      return b.score - a.score || a.index - b.index;
    });

    var best = scored[0];
    var next = scored[1];
    if (!(best.score > 0)) return { id: null, words: [], note: 'No Brain fits this yet.' };
    if (next.score > 0 && best.score < next.score * MARGIN) {
      return { id: null, words: [], note: 'Could fit ' + best.profile.name + ' or ' + next.profile.name + '.' };
    }
    var words = best.hits.slice().sort(function (a, b) {
      return b.part - a.part;
    }).slice(0, SHOWN).map(function (hit) {
      return said.shown[hit.key];
    });
    var listed = words.length > 1 ? words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1] : words[0];
    return { id: best.profile.id, words: words, note: 'Suggested because it mentions ' + listed + '.' };
  }

  // The last Brain a capture went to belongs to the device, not the account.
  // The extension keeps it in chrome.storage.local (never sync: nothing the
  // extension stores roams), the phone in localStorage, under one key, the
  // way Interactive Steps keeps its setting.
  var LAST_BRAIN_KEY = 'sb_capture_brain';

  // The extension's own storage, or null on a web page. A page on the
  // dashboard's site sees chrome.runtime (the extension talks to it) but never
  // chrome.storage.
  function extensionStorage() {
    var c = root.chrome;
    if (!c || !c.storage || !c.storage.local || !c.runtime) return null;
    return c.storage.local;
  }

  /** cb(id or null) once the last Brain used is known. */
  function loadLastBrain(cb) {
    var store = extensionStorage();
    if (store) {
      try {
        store.get(LAST_BRAIN_KEY, function (d) {
          var id = !root.chrome.runtime.lastError && d ? d[LAST_BRAIN_KEY] : null;
          cb(typeof id === 'string' && id ? id : null);
        });
      } catch (e) {
        // A page left open across an extension reload has lost its context.
        // The capture opens on the default Brain instead.
        cb(null);
      }
      return;
    }
    var id = null;
    try {
      id = root.localStorage.getItem(LAST_BRAIN_KEY);
    } catch (e) {
      console.error('Save to Brain: could not read the last Brain used on this device:', e);
    }
    cb(id || null);
  }

  /** Keeps the Brain a capture just went to. */
  function saveLastBrain(id) {
    var store = extensionStorage();
    if (store) {
      var patch = {};
      patch[LAST_BRAIN_KEY] = id;
      try {
        store.set(patch, function () {
          if (root.chrome.runtime.lastError) {
            console.error('Save to Brain: could not keep the last Brain used:', root.chrome.runtime.lastError.message);
          }
        });
      } catch (e) {
        console.error('Save to Brain: could not keep the last Brain used:', e && e.message);
      }
      return;
    }
    try {
      root.localStorage.setItem(LAST_BRAIN_KEY, id);
    } catch (e) {
      console.error('Save to Brain: could not keep the last Brain used on this device:', e);
    }
  }

  /**
   * The Brain selected when a capture opens: the one suggestBrain offered,
   * else the last one a capture went to, else the first in the list, which
   * every list shows to be the default Brain. An id no longer in the list (a
   * Brain trashed since) is passed over.
   */
  function pickBrain(suggestion, lastId, brains) {
    var list = Array.isArray(brains) ? brains : [];
    function listed(id) {
      if (!id) return false;
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) return true;
      }
      return false;
    }
    if (suggestion && listed(suggestion.id)) return suggestion.id;
    if (listed(lastId)) return lastId;
    return list.length ? list[0].id : null;
  }

  var API = {
    MAX_BODY: MAX_BODY,
    chunkBlocks: chunkBlocks,
    chunkText: chunkText,
    captureName: captureName,
    captureSummary: captureSummary,
    suggestBrain: suggestBrain,
    pickBrain: pickBrain,
    loadLastBrain: loadLastBrain,
    saveLastBrain: saveLastBrain,
    LAST_BRAIN_KEY: LAST_BRAIN_KEY
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    root.SBMemoryChunk = API;
  }

}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this));
