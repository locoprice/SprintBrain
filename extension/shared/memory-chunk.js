// MEMORY CHUNKER — splits long text into shard-sized pieces.
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

  var API = {
    MAX_BODY: MAX_BODY,
    chunkBlocks: chunkBlocks,
    chunkText: chunkText
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    root.SBMemoryChunk = API;
  }

}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this));
