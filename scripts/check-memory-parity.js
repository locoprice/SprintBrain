// MEMORY-001 parity gate.
//
// The shard selection rule exists twice: app/src/lib/memory/engine.ts is the
// authority, extension/shared/memory-pack.js is the extension's copy, because
// the extension has no build step and cannot import TypeScript. This script is
// what makes that safe. It runs BOTH implementations over the same fixtures and
// fails if a single pack differs, so the two cannot drift into production.
//
// The TS engine is imported directly. Node strips the types (22.18+), which is
// the same mechanism services/mcp-memory relies on, so there is nothing to
// build here either.
//
// Run: node scripts/check-memory-parity.js

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const pack = require('../extension/shared/memory-pack.js');

const ENGINE = path.resolve(__dirname, '../app/src/lib/memory/engine.ts');

function shard(id, labelIds, tokens, opts) {
  const o = opts || {};
  return {
    id,
    name: o.name || id,
    summary: o.summary || '',
    body: 'x'.repeat(tokens * 4),
    tokens,
    labelIds,
    pinned: !!o.pinned,
    priority: typeof o.priority === 'number' ? o.priority : 0,
  };
}

function step(key, labels, tokenBudget) {
  return {
    key,
    name: key,
    tokenBudget,
    labels: labels.map(([labelId, weight]) => ({ labelId, weight })),
  };
}

// Cases chosen for where the two could plausibly disagree: tie-breaks, a shard
// that must be skipped without ending the fill, pins that blow the budget, and
// an empty selection.
const CASES = [
  {
    name: 'plain fill, everything fits',
    shards: [shard('a', ['x'], 10), shard('b', ['x'], 10)],
    step: step('s', [['x', 1]], 100),
  },
  {
    name: 'weights decide the order',
    shards: [shard('low', ['x'], 10), shard('high', ['x', 'y'], 10)],
    step: step('s', [['x', 1], ['y', 5]], 100),
  },
  {
    name: 'priority breaks a score tie',
    shards: [shard('p0', ['x'], 10, { priority: 0 }), shard('p9', ['x'], 10, { priority: 9 })],
    step: step('s', [['x', 1]], 100),
  },
  {
    name: 'name breaks a score and priority tie',
    shards: [shard('i2', ['x'], 10, { name: 'zulu' }), shard('i1', ['x'], 10, { name: 'alpha' })],
    step: step('s', [['x', 1]], 100),
  },
  {
    name: 'a shard that does not fit is skipped, not terminal',
    shards: [
      shard('big', ['x'], 90, { name: 'a-big', priority: 9 }),
      shard('huge', ['x'], 80, { name: 'b-huge', priority: 5 }),
      shard('tiny', ['x'], 5, { name: 'c-tiny', priority: 1 }),
    ],
    step: step('s', [['x', 1]], 100),
  },
  {
    name: 'pinned is eligible without a matching label',
    shards: [shard('pin', [], 10, { pinned: true }), shard('a', ['x'], 10)],
    step: step('s', [['x', 1]], 100),
  },
  {
    name: 'pinned bypasses the budget and flags the overrun',
    shards: [shard('pin', [], 150, { pinned: true }), shard('a', ['x'], 10)],
    step: step('s', [['x', 1]], 100),
  },
  {
    name: 'no eligible shards',
    shards: [shard('a', ['other'], 10)],
    step: step('s', [['x', 1]], 100),
  },
  {
    name: 'a shard carrying several of the step labels sums them',
    shards: [shard('multi', ['x', 'y', 'z'], 10), shard('single', ['z'], 10)],
    step: step('s', [['x', 2], ['y', 2], ['z', 1]], 100),
  },
  {
    name: 'budget of exactly one shard',
    shards: [shard('a', ['x'], 50, { name: 'a', priority: 2 }), shard('b', ['x'], 50, { name: 'b', priority: 1 })],
    step: step('s', [['x', 1]], 50),
  },
];

async function main() {
  // pathToFileURL: on Windows a bare absolute path reads as the 'c:' protocol.
  const engine = await import(pathToFileURL(ENGINE).href);
  let failures = 0;

  for (const testCase of CASES) {
    // TS side: a fresh working memory entering the step is the one-shot case.
    const memory = engine.createWorkingMemory(testCase.step.tokenBudget);
    const result = engine.enterStep(memory, testCase.step, testCase.shards);
    const tsIds = engine.renderPack(memory).shards.map((s) => s.id);
    const tsSkipped = result.skipped.map((s) => s.id).sort();

    // Extension side.
    const jsPack = pack.packForStep(testCase.shards, testCase.step);
    const jsIds = jsPack.shards.map((s) => s.id);
    const jsSkipped = jsPack.skipped.map((s) => s.id).sort();

    try {
      assert.deepStrictEqual(jsIds, tsIds, 'selected shards differ');
      assert.deepStrictEqual(jsSkipped, tsSkipped, 'skipped shards differ');
      assert.strictEqual(jsPack.usedTokens, result.usedTokens, 'token totals differ');
      assert.strictEqual(jsPack.overBudget, result.overBudget, 'overBudget differs');
    } catch (err) {
      failures++;
      console.error('X ' + testCase.name);
      console.error('   ' + err.message);
      console.error('   ts: ' + JSON.stringify(tsIds) + '  skipped ' + JSON.stringify(tsSkipped));
      console.error('   js: ' + JSON.stringify(jsIds) + '  skipped ' + JSON.stringify(jsSkipped));
    }
  }

  // The token estimator has to agree too, or budgets mean different things on
  // the two surfaces even when the ranking matches.
  for (const length of [0, 1, 3, 4, 5, 99, 1000, 4001]) {
    const text = 'x'.repeat(length);
    if (pack.estimateTokens(text) !== engine.estimateTokens(text)) {
      failures++;
      console.error('X estimateTokens disagrees at length ' + length);
    }
  }

  if (pack.CHARS_PER_TOKEN !== engine.CHARS_PER_TOKEN) {
    failures++;
    console.error('X CHARS_PER_TOKEN differs: js ' + pack.CHARS_PER_TOKEN + ', ts ' + engine.CHARS_PER_TOKEN);
  }

  if (failures > 0) {
    console.error('\nX Memory parity FAILED: ' + failures + ' mismatch(es).');
    console.error('  extension/shared/memory-pack.js and app/src/lib/memory/engine.ts');
    console.error('  must implement the same rule. Fix both, not one.');
    process.exit(1);
  }

  console.log('OK Memory parity passed all ' + CASES.length + ' cases (+ token estimator)');
}

main().catch(function (err) {
  console.error('X Memory parity could not run: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
