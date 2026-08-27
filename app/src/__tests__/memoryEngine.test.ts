import { describe, it, expect } from 'vitest';
import {
  CHARS_PER_TOKEN,
  attachShard,
  createWorkingMemory,
  detachShard,
  enterStep,
  estimateTokens,
  isAttached,
  rankForStep,
  renderPack,
  scoreShard,
  touchShard,
  usedTokens,
  type MemoryShard,
  type MemoryStep,
} from '@/lib/memory/engine';

function shard(
  id: string,
  labelIds: string[],
  tokens: number,
  overrides: Partial<MemoryShard> = {},
): MemoryShard {
  return {
    id,
    name: id,
    summary: `summary of ${id}`,
    body: 'x'.repeat(tokens * CHARS_PER_TOKEN),
    tokens,
    labelIds,
    pinned: false,
    priority: 0,
    ...overrides,
  };
}

function step(
  key: string,
  labels: Array<[string, number]>,
  tokenBudget = 100,
): MemoryStep {
  return {
    key,
    name: key,
    tokenBudget,
    labels: labels.map(([labelId, weight]) => ({ labelId, weight })),
  };
}

describe('estimateTokens', () => {
  it('matches the DB formula: ceil(chars / 4)', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('never returns a fraction', () => {
    for (let length = 0; length < 40; length += 1) {
      expect(Number.isInteger(estimateTokens('x'.repeat(length)))).toBe(true);
    }
  });
});

describe('scoreShard', () => {
  it('returns null when no label matches', () => {
    expect(scoreShard(shard('a', ['red'], 10), step('s', [['blue', 1]]))).toBeNull();
  });

  it('sums the weights of every matching label', () => {
    const result = scoreShard(shard('a', ['red', 'blue'], 10), step('s', [['red', 2], ['blue', 3]]));
    expect(result).toBe(5);
  });

  it('ignores labels the step never asked for', () => {
    const result = scoreShard(shard('a', ['red', 'green'], 10), step('s', [['red', 2]]));
    expect(result).toBe(2);
  });

  it('makes a pinned shard eligible for every step regardless of labels', () => {
    const pinned = shard('a', [], 10, { pinned: true });
    expect(scoreShard(pinned, step('s', [['blue', 1]]))).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('rankForStep', () => {
  it('orders by score, then priority, then name', () => {
    const shards = [
      shard('low', ['red'], 5, { name: 'low' }),
      shard('high', ['red', 'blue'], 5, { name: 'high' }),
      shard('mid', ['blue'], 5, { name: 'mid', priority: 9 }),
      shard('mid2', ['blue'], 5, { name: 'aaa' }),
    ];
    const ranked = rankForStep(shards, step('s', [['red', 1], ['blue', 2]]));
    // high = 3, mid = 2 (priority 9), mid2 = 2 (priority 0), low = 1
    expect(ranked.map((s) => s.id)).toEqual(['high', 'mid', 'mid2', 'low']);
  });

  it('drops ineligible shards entirely', () => {
    const ranked = rankForStep([shard('a', ['red'], 5), shard('b', ['grey'], 5)], step('s', [['red', 1]]));
    expect(ranked.map((s) => s.id)).toEqual(['a']);
  });

  it('is deterministic across repeated calls', () => {
    const shards = [shard('a', ['red'], 5), shard('b', ['red'], 5), shard('c', ['red'], 5)];
    const once = rankForStep(shards, step('s', [['red', 1]])).map((s) => s.id);
    const twice = rankForStep([...shards].reverse(), step('s', [['red', 1]])).map((s) => s.id);
    expect(once).toEqual(twice);
  });
});

describe('attachShard', () => {
  it('attaches within budget and reports no eviction', () => {
    const memory = createWorkingMemory(100);
    const result = attachShard(memory, shard('a', ['red'], 40));
    expect(result.attached).toBe(true);
    expect(result.evicted).toEqual([]);
    expect(usedTokens(memory)).toBe(40);
  });

  it('re-attaching touches instead of duplicating', () => {
    const memory = createWorkingMemory(100);
    const target = shard('a', ['red'], 40);
    attachShard(memory, target);
    attachShard(memory, target);
    expect(memory.attached).toHaveLength(1);
    expect(usedTokens(memory)).toBe(40);
  });

  it('upgrades a step attachment to manual but never downgrades', () => {
    const memory = createWorkingMemory(100);
    const target = shard('a', ['red'], 10);
    attachShard(memory, target, 'step');
    attachShard(memory, target, 'manual');
    expect(memory.attached[0]?.reason).toBe('manual');
    attachShard(memory, target, 'step');
    expect(memory.attached[0]?.reason).toBe('manual');
  });

  it('evicts least recently used first', () => {
    const memory = createWorkingMemory(100);
    attachShard(memory, shard('a', ['red'], 40));
    attachShard(memory, shard('b', ['red'], 40));
    // Touch a, so b is now the least recently used.
    touchShard(memory, 'a');

    const result = attachShard(memory, shard('c', ['red'], 40));
    expect(result.attached).toBe(true);
    expect(result.evicted).toEqual(['b']);
    expect(isAttached(memory, 'a')).toBe(true);
    expect(isAttached(memory, 'c')).toBe(true);
    expect(usedTokens(memory)).toBe(80);
  });

  it('evicts as many as needed, no more', () => {
    const memory = createWorkingMemory(100);
    attachShard(memory, shard('a', ['red'], 20));
    attachShard(memory, shard('b', ['red'], 20));
    attachShard(memory, shard('c', ['red'], 20));

    const result = attachShard(memory, shard('big', ['red'], 70));
    expect(result.evicted).toEqual(['a', 'b']);
    expect(isAttached(memory, 'c')).toBe(true);
    expect(usedTokens(memory)).toBe(90);
  });

  it('never evicts a pinned shard', () => {
    const memory = createWorkingMemory(100);
    attachShard(memory, shard('pin', [], 60, { pinned: true }));
    attachShard(memory, shard('a', ['red'], 30));

    const result = attachShard(memory, shard('b', ['red'], 30));
    expect(result.evicted).toEqual(['a']);
    expect(isAttached(memory, 'pin')).toBe(true);
  });

  it('skips a shard that cannot fit even after evicting everything', () => {
    const memory = createWorkingMemory(100);
    attachShard(memory, shard('pin', [], 80, { pinned: true }));

    const result = attachShard(memory, shard('huge', ['red'], 50));
    expect(result.attached).toBe(false);
    expect(result.skipped).toEqual({ id: 'huge', name: 'huge', reason: 'budget' });
    expect(usedTokens(memory)).toBe(80);
  });

  it('lets a pinned shard through even when it blows the budget', () => {
    const memory = createWorkingMemory(50);
    const result = attachShard(memory, shard('pin', [], 90, { pinned: true }));
    expect(result.attached).toBe(true);
    expect(usedTokens(memory)).toBe(90);
  });
});

describe('detachShard', () => {
  it('removes an attached shard and frees its tokens', () => {
    const memory = createWorkingMemory(100);
    attachShard(memory, shard('a', ['red'], 40));
    expect(detachShard(memory, 'a')).toBe(true);
    expect(usedTokens(memory)).toBe(0);
  });

  it('returns false for a shard that was never attached', () => {
    const memory = createWorkingMemory(100);
    expect(detachShard(memory, 'ghost')).toBe(false);
  });

  it('detaches a pinned shard when asked explicitly', () => {
    const memory = createWorkingMemory(100);
    attachShard(memory, shard('pin', [], 10, { pinned: true }));
    expect(detachShard(memory, 'pin')).toBe(true);
    expect(usedTokens(memory)).toBe(0);
  });
});

describe('enterStep', () => {
  const shards = [
    shard('explore-1', ['explore'], 20),
    shard('explore-2', ['explore'], 20),
    shard('build-1', ['build'], 20),
    shard('shared', ['explore', 'build'], 20),
    shard('always', [], 10, { pinned: true }),
  ];

  it('attaches only what the step asks for, plus pins', () => {
    const memory = createWorkingMemory(100);
    const result = enterStep(memory, step('explore', [['explore', 1]], 100), shards);

    expect(result.attached.sort()).toEqual(['always', 'explore-1', 'explore-2', 'shared']);
    expect(isAttached(memory, 'build-1')).toBe(false);
    expect(result.usedTokens).toBe(70);
  });

  it('keeps overlapping shards across a transition instead of re-adding them', () => {
    const memory = createWorkingMemory(100);
    enterStep(memory, step('explore', [['explore', 1]], 100), shards);
    const result = enterStep(memory, step('build', [['build', 1]], 100), shards);

    expect(result.kept.sort()).toEqual(['always', 'shared']);
    expect(result.attached).toEqual(['build-1']);
    expect(result.detached.sort()).toEqual(['explore-1', 'explore-2']);
  });

  it('never detaches a pinned shard on a step change', () => {
    const memory = createWorkingMemory(100);
    enterStep(memory, step('explore', [['explore', 1]], 100), shards);
    enterStep(memory, step('build', [['build', 1]], 100), shards);
    expect(isAttached(memory, 'always')).toBe(true);
  });

  it('keeps a manual attachment across a step change', () => {
    const memory = createWorkingMemory(100);
    enterStep(memory, step('explore', [['explore', 1]], 100), shards);

    const manual = shard('build-1', ['build'], 20);
    attachShard(memory, manual, 'manual');

    const result = enterStep(memory, step('explore', [['explore', 1]], 100), shards);
    expect(result.detached).not.toContain('build-1');
    expect(isAttached(memory, 'build-1')).toBe(true);
  });

  it('adopts the step budget', () => {
    const memory = createWorkingMemory(1000);
    const result = enterStep(memory, step('explore', [['explore', 1]], 45), shards);
    expect(result.budget).toBe(45);
    expect(memory.budget).toBe(45);
  });

  it('fills a tight budget in rank order and reports what was skipped', () => {
    const tight = [
      shard('best', ['explore'], 30, { name: 'best', priority: 5 }),
      shard('worst', ['explore'], 30, { name: 'worst' }),
    ];
    const memory = createWorkingMemory(1000);
    const result = enterStep(memory, step('explore', [['explore', 1]], 30), tight);

    expect(result.attached).toEqual(['best']);
    expect(result.skipped).toEqual([{ id: 'worst', name: 'worst', reason: 'budget' }]);
    expect(result.usedTokens).toBe(30);
  });

  it('flags an overrun when pins alone exceed the budget', () => {
    const heavyPin = [shard('always', [], 90, { pinned: true })];
    const memory = createWorkingMemory(1000);
    const result = enterStep(memory, step('explore', [['explore', 1]], 50), heavyPin);

    expect(result.overBudget).toBe(true);
    expect(result.usedTokens).toBe(90);
    expect(isAttached(memory, 'always')).toBe(true);
  });

  it('does not report a shard as both kept and evicted', () => {
    const crowded = [
      shard('a', ['explore'], 40, { name: 'a', priority: 1 }),
      shard('b', ['explore'], 40, { name: 'b', priority: 2 }),
      shard('c', ['explore'], 40, { name: 'c', priority: 3 }),
    ];
    const memory = createWorkingMemory(1000);
    const result = enterStep(memory, step('explore', [['explore', 1]], 80), crowded);

    for (const id of result.evicted) {
      expect(result.kept).not.toContain(id);
      expect(result.attached).not.toContain(id);
    }
    expect(result.usedTokens).toBeLessThanOrEqual(80);
  });

  it('is idempotent: entering the same step twice changes nothing', () => {
    const memory = createWorkingMemory(100);
    enterStep(memory, step('explore', [['explore', 1]], 100), shards);
    const before = renderPack(memory).shards.map((s) => s.id).sort();

    const second = enterStep(memory, step('explore', [['explore', 1]], 100), shards);
    expect(second.attached).toEqual([]);
    expect(second.detached).toEqual([]);
    expect(renderPack(memory).shards.map((s) => s.id).sort()).toEqual(before);
  });
});

describe('renderPack', () => {
  it('reports the accounting alongside the bodies', () => {
    const memory = createWorkingMemory(100);
    attachShard(memory, shard('a', ['red'], 25));
    const pack = renderPack(memory);

    expect(pack.budget).toBe(100);
    expect(pack.usedTokens).toBe(25);
    expect(pack.shards).toHaveLength(1);
    expect(pack.shards[0]?.body).toHaveLength(100);
  });

  it('carries the current step key', () => {
    const memory = createWorkingMemory(100);
    enterStep(memory, step('explore', [['explore', 1]], 100), [shard('a', ['explore'], 10)]);
    expect(renderPack(memory).stepKey).toBe('explore');
  });
});
