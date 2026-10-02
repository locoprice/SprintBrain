// MEMORY CHUNKER — splits long text into shard-sized pieces, and names the
// pieces a capture saves (captureName, captureSummary, at the end of the file).
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

  var API = {
    MAX_BODY: MAX_BODY,
    chunkBlocks: chunkBlocks,
    chunkText: chunkText,
    captureName: captureName,
    captureSummary: captureSummary
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    root.SBMemoryChunk = API;
  }

}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this));
