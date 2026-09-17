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

// buildContext fixtures. Chosen for the seams: the floor's browse exemption,
// each dedupe pass, compression, and pinned overrunning the budget.
function cand(id, opts) {
  const o = opts || {};
  // `=== undefined`, not `||`: a fixture has to be able to ask for an EMPTY
  // body, which is the whole subject of the no-body cases below.
  const body = o.body === undefined ? 'body of ' + id : o.body;
  return {
    id,
    kind: o.kind || 'memory',
    name: o.name || id,
    summary: o.summary === undefined ? 'summary of ' + id : o.summary,
    body,
    tokens: typeof o.tokens === 'number' ? o.tokens : Math.ceil(body.length / 4),
    pinned: !!o.pinned,
    rank: typeof o.rank === 'number' ? o.rank : 0,
    contentHash: o.contentHash === undefined ? 'hash-' + id : o.contentHash,
  };
}

const CONTEXT_CASES = [
  {
    name: 'context: everything fits, ordered by rank',
    request: { budget: 1000, candidates: [cand('low', { rank: 0.02 }), cand('high', { rank: 0.9 })] },
  },
  {
    name: 'context: a browse (all ranks zero) is not emptied by the floor',
    request: { budget: 1000, candidates: [cand('a'), cand('b'), cand('c')] },
  },
  {
    name: 'context: the floor drops an incidental match once a query ran',
    request: {
      budget: 1000,
      candidates: [cand('strong', { rank: 0.5 }), cand('weak', { rank: 0.001 })],
    },
  },
  {
    name: 'context: pinned survives the floor',
    request: {
      budget: 1000,
      candidates: [cand('strong', { rank: 0.5 }), cand('pin', { rank: 0.0001, pinned: true })],
    },
  },
  {
    name: 'context: identical hashes collapse, best rank survives',
    request: {
      budget: 1000,
      candidates: [
        cand('dupe', { rank: 0.1, contentHash: 'same', body: 'identical text here' }),
        cand('orig', { rank: 0.9, contentHash: 'same', body: 'identical text here' }),
      ],
    },
  },
  {
    name: 'context: near-identical bodies collapse on trigram overlap',
    request: {
      budget: 1000,
      candidates: [
        cand('v1', { rank: 0.9, contentHash: 'h1', body: 'Short sentences. No filler. Specifics over adjectives.' }),
        cand('v2', { rank: 0.5, contentHash: 'h2', body: 'Short sentences. No filler. Specifics over adjectives!' }),
      ],
    },
  },
  {
    name: 'context: distinct bodies are not collapsed',
    request: {
      budget: 1000,
      candidates: [
        cand('x', { rank: 0.9, contentHash: 'h1', body: 'Card payments carry a three percent surcharge.' }),
        cand('y', { rank: 0.5, contentHash: 'h2', body: 'Reply in short sentences without filler words.' }),
      ],
    },
  },
  {
    name: 'context: dedupe off keeps both',
    request: {
      budget: 1000,
      dedupe: false,
      candidates: [
        cand('dupe', { rank: 0.1, contentHash: 'same' }),
        cand('orig', { rank: 0.9, contentHash: 'same' }),
      ],
    },
  },
  {
    name: 'context: body does not fit so the summary goes in instead',
    request: {
      budget: 30,
      candidates: [
        cand('big', { rank: 0.9, tokens: 200, summary: 'the short version' }),
      ],
    },
  },
  {
    name: 'context: neither body nor summary fits, so it is dropped',
    request: {
      budget: 2,
      candidates: [cand('huge', { rank: 0.9, tokens: 500, summary: 'still far too long to fit in two' })],
    },
  },
  {
    name: 'context: a small item ranked below a large one still gets in',
    request: {
      budget: 60,
      candidates: [
        cand('large', { rank: 0.9, tokens: 500, summary: '' }),
        cand('small', { rank: 0.2, tokens: 40, summary: '' }),
      ],
    },
  },
  {
    name: 'context: pinned bypasses the budget and flags the overrun',
    request: {
      budget: 50,
      candidates: [cand('pin', { pinned: true, tokens: 400, rank: 0.5 }), cand('a', { rank: 0.4, tokens: 10 })],
    },
  },
  {
    name: 'context: mixed kinds are counted per source',
    request: {
      budget: 1000,
      candidates: [
        cand('m1', { kind: 'memory', rank: 0.9 }),
        cand('s1', { kind: 'snippet', rank: 0.8 }),
        cand('s2', { kind: 'snippet', rank: 0.7 }),
      ],
    },
  },
  {
    name: 'context: equal ranks fall back to name then id',
    request: {
      budget: 1000,
      candidates: [
        cand('i2', { rank: 0.5, name: 'zulu' }),
        cand('i1', { rank: 0.5, name: 'alpha' }),
        cand('i0', { rank: 0.5, name: 'alpha' }),
      ],
    },
  },
  {
    name: 'context: no candidates at all',
    request: { budget: 1000, candidates: [] },
  },
  {
    name: 'context: a body that never arrived is dropped, not inserted blank',
    request: {
      budget: 1000,
      candidates: [cand('present', { rank: 0.5 }), cand('missing', { rank: 0.4, body: '' })],
    },
  },
  {
    name: 'context: bodies that never arrived are not duplicates of each other',
    request: {
      budget: 1000,
      candidates: [
        cand('gone-a', { rank: 0.5, body: '', contentHash: '' }),
        cand('gone-b', { rank: 0.4, body: '', contentHash: '' }),
        cand('gone-c', { rank: 0.3, body: '', contentHash: '' }),
      ],
    },
  },
  {
    name: 'context: a pinned item with no body is dropped like any other',
    request: {
      budget: 1000,
      candidates: [cand('kept', { rank: 0.5 }), cand('pin', { rank: 0, pinned: true, body: '' })],
    },
  },
  {
    name: 'context: a whitespace-only body counts as no body',
    request: {
      budget: 1000,
      candidates: [cand('real', { rank: 0.5 }), cand('blankish', { rank: 0.4, body: '   \n  ' })],
    },
  },
];

// clusterCandidates fixtures. A translated snippet arrives as one search row per
// language; these pin how a group picks the member that stands for the fact,
// where the fact sits in the list, and what never merges.
function member(id, groupKey, lang, rank, opts) {
  const c = cand(id, Object.assign({ rank: rank }, opts || {}));
  if (groupKey !== null) c.groupKey = groupKey;
  if (lang !== null) c.lang = lang;
  return c;
}

const PREFS = ['IT', 'EN', 'ES', 'FR'];

const CLUSTER_CASES = [
  {
    name: 'cluster: four translations become one fact, in the preferred language',
    prefs: PREFS,
    candidates: [
      member('fr', 'air', 'FR', 0.032), member('en', 'air', 'EN', 0.031),
      member('it', 'air', 'IT', 0.030), member('es', 'air', 'ES', 0.029),
    ],
  },
  {
    name: 'cluster: with no preference the best-ranked member stands for the fact',
    prefs: [],
    candidates: [member('fr', 'air', 'FR', 0.032), member('it', 'air', 'IT', 0.030)],
  },
  {
    name: 'cluster: a candidate with no group key is a fact on its own',
    prefs: PREFS,
    candidates: [member('m1', null, null, 0.3), member('m2', null, null, 0.2), member('m3', null, null, 0.1)],
  },
  {
    name: 'cluster: facts keep the position of their first member',
    prefs: PREFS,
    candidates: [
      member('s1', 'a', 'EN', 0.9, { kind: 'snippet' }), member('m1', null, null, 0.8),
      member('s2', 'b', 'EN', 0.7, { kind: 'snippet' }), member('s3', 'a', 'IT', 0.6, { kind: 'snippet' }),
    ],
  },
  {
    name: 'cluster: two rows in the same language go to the better-ranked one',
    prefs: PREFS,
    candidates: [member('x1', 'g', 'IT', 0.2), member('x2', 'g', 'IT', 0.5)],
  },
  {
    name: 'cluster: a language outside the preference list loses to one inside it',
    prefs: ['IT', 'EN'],
    candidates: [member('multi', 'g', 'MULTI', 0.9), member('en', 'g', 'EN', 0.1)],
  },
  {
    name: 'cluster: a browse keeps its order and every rank stays zero',
    prefs: PREFS,
    candidates: [
      member('b1', 'g1', 'FR', 0), member('b2', null, null, 0),
      member('b3', 'g1', 'IT', 0), member('b4', 'g2', 'EN', 0),
    ],
  },
  {
    name: 'cluster: equal rank and equal preference fall back to name then id',
    prefs: PREFS,
    candidates: [
      member('i2', 'g', 'IT', 0.5, { name: 'zulu' }),
      member('i1', 'g', 'IT', 0.5, { name: 'alpha' }),
      member('i0', 'g', 'IT', 0.5, { name: 'alpha' }),
    ],
  },
  {
    name: 'cluster: a group key never merges with a bare row that spells the same key',
    prefs: PREFS,
    candidates: [
      member('x', 'row:snippet:y', 'EN', 0.5, { kind: 'snippet' }),
      member('y', null, null, 0.4, { kind: 'snippet' }),
    ],
  },
  {
    name: 'cluster: the same id under two kinds is two facts',
    prefs: PREFS,
    candidates: [member('1', null, null, 0.5, { kind: 'memory' }), member('1', null, null, 0.4, { kind: 'snippet' })],
  },
  {
    name: 'cluster: no candidates at all',
    prefs: PREFS,
    candidates: [],
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

  // ── buildContext (MEMORY-002 P3) ──────────────────────────────────────────
  //
  // The second selection path, and the one the injection panel calls. Same
  // discipline as above: run both implementations over identical candidates and
  // compare the whole package, not just the ids, because a compressed item or a
  // merge reason differing between surfaces is the same class of bug.
  for (const testCase of CONTEXT_CASES) {
    const tsPack = engine.buildContext(testCase.request);
    const jsPack = pack.buildContext(testCase.request);

    // Compared as a whole so a new field cannot quietly escape the gate.
    const shape = (p) => ({
      items: p.items.map((i) => ({ id: i.id, kind: i.kind, tokens: i.tokens, compressed: i.compressed, text: i.text })),
      usedTokens: p.usedTokens,
      budget: p.budget,
      dropped: p.dropped.map((d) => ({ id: d.id, reason: d.reason })).sort((a, b) => a.id.localeCompare(b.id)),
      deduped: p.deduped.map((d) => ({ id: d.id, mergedInto: d.mergedInto, reason: d.reason })).sort((a, b) => a.id.localeCompare(b.id)),
      sources: p.sources,
      overBudget: p.overBudget,
    });

    // An absolute invariant, checked on every case rather than a chosen one.
    // Parity proves the two agree; it cannot prove they agree on the right
    // answer, and both once emitted a heading over a blank body in perfect
    // agreement. Nothing in a package may ever have empty text.
    for (const [label, p] of [['engine', tsPack], ['pack', jsPack]]) {
      for (const item of p.items) {
        if (!String(item.text).trim()) {
          failures++;
          console.error(
            'X ' + testCase.name + ': ' + label + ' emitted "' + item.id +
            '" with empty text. A package never carries a heading over a blank.'
          );
        }
      }
    }

    try {
      assert.deepStrictEqual(shape(jsPack), shape(tsPack), 'context packages differ');
    } catch (err) {
      failures++;
      console.error('X ' + testCase.name);
      console.error('   ' + err.message);
      console.error('   ts: ' + JSON.stringify(shape(tsPack)));
      console.error('   js: ' + JSON.stringify(shape(jsPack)));
    }
  }

  // ── clusterCandidates (MEMORY-002 injection step A) ──────────────────────
  //
  // Compared whole, as the packages are. Then held to invariants that parity
  // cannot see, because two copies can agree on dropping a candidate or on
  // carrying the wrong rank just as easily as they agreed on 1.0 for two empty
  // bodies.
  const clusterShape = (clusters) =>
    clusters.map((c) => ({
      id: c.candidate.id,
      kind: c.candidate.kind,
      lang: c.candidate.lang === undefined ? null : c.candidate.lang,
      rank: c.candidate.rank,
      members: c.members.map((m) => m.kind + ':' + m.id),
    }));

  for (const testCase of CLUSTER_CASES) {
    const before = JSON.stringify(testCase.candidates);
    const tsClusters = engine.clusterCandidates(testCase.candidates, testCase.prefs);
    const jsClusters = pack.clusterCandidates(testCase.candidates, testCase.prefs);

    try {
      assert.deepStrictEqual(clusterShape(jsClusters), clusterShape(tsClusters), 'clusters differ');
    } catch (err) {
      failures++;
      console.error('X ' + testCase.name);
      console.error('   ' + err.message);
      console.error('   ts: ' + JSON.stringify(clusterShape(tsClusters)));
      console.error('   js: ' + JSON.stringify(clusterShape(jsClusters)));
    }

    if (JSON.stringify(testCase.candidates) !== before) {
      failures++;
      console.error('X ' + testCase.name + ': the input candidates were mutated.');
    }

    for (const [label, clusters] of [['engine', tsClusters], ['pack', jsClusters]]) {
      let seen = 0;
      for (const c of clusters) {
        seen += c.members.length;
        const top = Math.max(...c.members.map((m) => m.rank));
        if (c.candidate.rank !== top) {
          failures++;
          console.error('X ' + testCase.name + ': ' + label + ' carried rank ' + c.candidate.rank +
            ' for a fact whose best member ranked ' + top + '.');
        }
        const isMember = c.members.some((m) =>
          m.kind === c.candidate.kind && m.id === c.candidate.id && m.lang === c.candidate.lang);
        if (!isMember) {
          failures++;
          console.error('X ' + testCase.name + ': ' + label + ' chose "' + c.candidate.id +
            '", which is not one of the fact\'s own members.');
        }
      }
      if (seen !== testCase.candidates.length) {
        failures++;
        console.error('X ' + testCase.name + ': ' + label + ' placed ' + seen + ' of ' +
          testCase.candidates.length + ' candidates. Clustering may merge, never drop.');
      }
    }
  }

  // Similarity drives near-duplicate collapsing, so the two must agree to the
  // digit. A threshold crossed on one surface and not the other means one of
  // them silently keeps a duplicate.
  const SIMILARITY_PAIRS = [
    ['', ''],
    ['abc', ''],
    ['same text', 'same text'],
    ['Short sentences. No filler.', 'Short sentences, no filler!'],
    ['Totals round to the nearest unit', 'Totals round to the nearest whole unit'],
    ['pricing rules', 'house style'],
    ['ACCENTS Café', 'accents cafe'],
    ['a', 'b'],
  ];
  for (const [a, b] of SIMILARITY_PAIRS) {
    const tsSim = engine.textSimilarity(a, b);
    const jsSim = pack.textSimilarity(a, b);
    if (tsSim !== jsSim) {
      failures++;
      console.error('X textSimilarity disagrees on ' + JSON.stringify([a, b]) + ': ts ' + tsSim + ', js ' + jsSim);
    }
  }

  // Parity alone cannot catch this one: both sides returned 1.0 for a pair of
  // empty bodies, agreed with each other perfectly, and collapsed every
  // body-less candidate in a package into whichever ranked first. An absolute
  // assertion is the only thing that holds a value the gate cannot infer.
  for (const [label, impl] of [['engine', engine], ['pack', pack]]) {
    const blank = impl.textSimilarity('', '');
    if (blank !== 0) {
      failures++;
      console.error(
        'X ' + label + '.textSimilarity("", "") is ' + blank + ', expected 0. ' +
        'Two bodies that failed to load are not the same fact.'
      );
    }
  }

  for (const constant of ['DEFAULT_MIN_RANK', 'NEAR_DUPLICATE_THRESHOLD']) {
    if (pack[constant] !== engine[constant]) {
      failures++;
      console.error('X ' + constant + ' differs: js ' + pack[constant] + ', ts ' + engine[constant]);
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

  console.log(
    'OK Memory parity passed ' + CASES.length + ' step cases + ' +
    CONTEXT_CASES.length + ' context cases + ' + CLUSTER_CASES.length +
    ' cluster cases (+ similarity, constants, token estimator)',
  );
}

main().catch(function (err) {
  console.error('X Memory parity could not run: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
