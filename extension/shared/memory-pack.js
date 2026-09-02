// WORKING-MEMORY PACK — the extension's copy of the shard selection rule.
//
// ⚠ SECOND IMPLEMENTATION, ON PURPOSE. The authority is
// app/src/lib/memory/engine.ts. The extension has no build step and cannot
// import TypeScript, so the ranking and budget rule is written twice: once
// there for the dashboard and the MCP server, once here for content.js. This is
// the same trade already accepted for the formula engine and the mobile
// resolver.
//
// What stops the two drifting is `node scripts/check-memory-parity.js`, a
// commit gate that runs BOTH implementations over the same fixtures and fails
// if a single pack differs. Change the rule in one file and that gate tells you
// about the other. Never change one without the other.
//
// This file implements a strict SUBSET. The engine is stateful because an agent
// session attaches and detaches over many turns, with LRU eviction and manual
// pins that survive a step change. The extension is one-shot: the user picks a
// step, gets a pack, and the picker closes. So there is no eviction here, and
// none is needed — filling an empty budget top-down never evicts anything.
(function (root) {
  'use strict';

  // Must equal CHARS_PER_TOKEN in app/src/lib/memory/engine.ts AND the
  // token_estimate generated column in the MEMORY-001 migration.
  var CHARS_PER_TOKEN = 4;

  function estimateTokens(text) {
    return Math.ceil(String(text == null ? '' : text).length / CHARS_PER_TOKEN);
  }

  // Relevance of a shard to a step, or null when the step does not want it.
  // Pinned shards are eligible everywhere. Everything else needs at least one
  // of the step's labels, and scores the sum of those labels' weights.
  function scoreShard(shard, step) {
    if (shard.pinned) return Infinity;

    var wanted = {};
    var labels = (step && step.labels) || [];
    for (var i = 0; i < labels.length; i++) {
      wanted[labels[i].labelId] = labels[i].weight;
    }

    var score = 0;
    var matched = false;
    var ids = shard.labelIds || [];
    for (var j = 0; j < ids.length; j++) {
      var w = wanted[ids[j]];
      if (w === undefined) continue;
      matched = true;
      score += w;
    }

    return matched ? score : null;
  }

  // Best first. Deterministic all the way down (score, priority, name, id) so
  // the same library and step always produce the same pack.
  function rankForStep(shards, step) {
    var scored = [];
    for (var i = 0; i < shards.length; i++) {
      var s = scoreShard(shards[i], step);
      if (s !== null) scored.push({ shard: shards[i], score: s });
    }

    scored.sort(function (a, b) {
      if (a.score !== b.score) return b.score - a.score;
      if (a.shard.priority !== b.shard.priority) return b.shard.priority - a.shard.priority;
      var byName = String(a.shard.name).localeCompare(String(b.shard.name));
      if (byName !== 0) return byName;
      return String(a.shard.id).localeCompare(String(b.shard.id));
    });

    var out = [];
    for (var k = 0; k < scored.length; k++) out.push(scored[k].shard);
    return out;
  }

  // Walk the ranking and take what fits. A shard that does not fit is skipped
  // rather than ending the loop, so a small one ranked below a large one still
  // gets in. Pinned shards bypass the check entirely: dropping a fact the user
  // marked always-on would be a worse failure than reporting the overrun, which
  // is what `overBudget` is for.
  function fillBudget(ranked, budget) {
    var taken = [];
    var skipped = [];
    var used = 0;

    for (var i = 0; i < ranked.length; i++) {
      var shard = ranked[i];
      if (shard.pinned) {
        taken.push(shard);
        used += shard.tokens;
        continue;
      }
      if (used + shard.tokens <= budget) {
        taken.push(shard);
        used += shard.tokens;
      } else {
        skipped.push(shard);
      }
    }

    return { shards: taken, skipped: skipped, usedTokens: used, budget: budget, overBudget: used > budget };
  }

  /** Rank then fill. The whole selection, in one call. */
  function packForStep(shards, step) {
    return fillBudget(rankForStep(shards, step), step.tokenBudget);
  }

  // The text that actually goes into the composer. Plain and visible on
  // purpose: the user can read exactly what is being sent, edit it, and delete
  // it. Nothing is hidden and nothing is rewritten at send time.
  function formatContextBlock(pack, stepName) {
    if (!pack || !pack.shards.length) return '';
    var lines = ['Context (' + stepName + '):', ''];
    for (var i = 0; i < pack.shards.length; i++) {
      lines.push('## ' + pack.shards[i].name);
      lines.push(pack.shards[i].body);
      lines.push('');
    }
    lines.push('---');
    lines.push('');
    return lines.join('\n');
  }

  // Rows as PostgREST returns them, folded into the shape the rule expects.
  function shardFromRow(row) {
    var ids = [];
    var links = row.memory_shard_labels || [];
    for (var i = 0; i < links.length; i++) {
      if (links[i] && links[i].label_id) ids.push(links[i].label_id);
    }
    return {
      id: row.id,
      name: row.name,
      summary: row.summary || '',
      body: row.body || '',
      tokens: typeof row.token_estimate === 'number' ? row.token_estimate : estimateTokens(row.body),
      labelIds: ids,
      pinned: !!row.pinned,
      priority: typeof row.priority === 'number' ? row.priority : 0
    };
  }

  function stepFromRow(row) {
    var labels = [];
    var links = row.memory_step_labels || [];
    for (var i = 0; i < links.length; i++) {
      if (links[i] && links[i].label_id) {
        labels.push({ labelId: links[i].label_id, weight: typeof links[i].weight === 'number' ? links[i].weight : 1 });
      }
    }
    return {
      key: row.key,
      name: row.name,
      tokenBudget: typeof row.token_budget === 'number' ? row.token_budget : 4000,
      labels: labels
    };
  }

  var API = {
    CHARS_PER_TOKEN: CHARS_PER_TOKEN,
    estimateTokens: estimateTokens,
    scoreShard: scoreShard,
    rankForStep: rankForStep,
    fillBudget: fillBudget,
    packForStep: packForStep,
    formatContextBlock: formatContextBlock,
    shardFromRow: shardFromRow,
    stepFromRow: stepFromRow
  };

  // UMD: browser globals, CommonJS (the node gate), AMD.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else if (typeof define === 'function' && define.amd) {
    define(function () { return API; });
  } else {
    root.SBMemoryPack = API;
  }

}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this));
