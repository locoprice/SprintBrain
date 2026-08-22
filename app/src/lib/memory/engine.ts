// Working-memory engine (MEMORY-001). Pure functions over plain objects: no
// store, no React, no Supabase client, and deliberately zero imports.
//
// Zero imports is a constraint, not an accident. The same module runs inside
// the dashboard bundle and inside the standalone MCP server under
// services/mcp-memory, which compiles this file directly rather than depending
// on a published package. An `@/` alias here would break that second consumer,
// so the types below are declared locally instead of pulled from
// @/types/database.
//
// The problem this solves: an agent that loads every fact it might need pays
// for all of them on every turn. Here a step declares which labels it needs,
// the engine attaches only the shards carrying those labels, and it evicts
// least-recently-used shards once a token budget is reached. Working memory
// stays bounded no matter how long a session runs.
//
// Schema and the matching token formula live in
// services/supabase/migrations/20260822000000_working_memory.sql.

/**
 * Characters per token. A deliberately crude heuristic, and it MUST stay in
 * lockstep with the `token_estimate` generated column in the migration.
 *
 * Exactness is not the point. Budgeting needs a number that is stable, cheap,
 * and identical on both sides of the wire. A real tokenizer would be more
 * accurate and would also mean shipping a model file to a Postgres generated
 * column, which is not possible. Four characters per token errs high on prose
 * and low on code, so treat a budget as approximate by design.
 */
export const CHARS_PER_TOKEN = 4;

/** Same arithmetic as the DB: ceil(char_length(body) / 4.0). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** One fact. The unit that gets attached and detached. */
export interface MemoryShard {
  id: string;
  /** Short handle, unique per user. Used for stable ordering and for display. */
  name: string;
  /** One line, cheap enough to list every shard without loading any body. */
  summary: string;
  body: string;
  /** Token cost of `body`, from the DB generated column. */
  tokens: number;
  /** Label ids from the shared `labels` vocabulary. */
  labelIds: readonly string[];
  /** Always attached, never evicted. The always-on core. */
  pinned: boolean;
  /** Tie-break within a step. Higher wins. */
  priority: number;
}

/** A label a step asks for, and how much it counts toward the shard's score. */
export interface StepLabel {
  labelId: string;
  weight: number;
}

/** A named phase of work with its own budget. */
export interface MemoryStep {
  key: string;
  name: string;
  tokenBudget: number;
  labels: readonly StepLabel[];
}

/**
 * Why a shard is attached.
 *
 * `step` shards are the step's own selection and are detached when the step
 * changes. `manual` shards were attached by an explicit call and survive a step
 * change, because something asked for them on purpose and a phase transition is
 * not a reason to throw that away. Both remain evictable under budget pressure.
 */
export type AttachReason = 'step' | 'manual';

export interface AttachedShard {
  shard: MemoryShard;
  reason: AttachReason;
  /**
   * Recency rank from the working memory's own counter, not a clock. Two
   * attaches inside the same millisecond still have to order, and a monotonic
   * counter keeps eviction reproducible in tests.
   */
  touchedAt: number;
}

export interface WorkingMemory {
  stepKey: string | null;
  budget: number;
  attached: AttachedShard[];
  /** Monotonic counter behind `touchedAt`. */
  clock: number;
}

/** Why a shard the caller asked for did not end up attached. */
export type SkipReason = 'budget' | 'not-eligible';

export interface SkippedShard {
  id: string;
  name: string;
  reason: SkipReason;
}

export interface AttachResult {
  attached: boolean;
  /** Ids evicted to make room, least recently used first. */
  evicted: string[];
  skipped: SkippedShard | null;
}

export interface TransitionResult {
  stepKey: string;
  /** Newly attached in this transition. */
  attached: string[];
  /** Dropped because the new step does not want them. */
  detached: string[];
  /** Already attached and still wanted, so never re-read. */
  kept: string[];
  /** Evicted under budget pressure during the transition. */
  evicted: string[];
  /** Eligible but never fit. */
  skipped: SkippedShard[];
  usedTokens: number;
  budget: number;
  /**
   * True when pinned shards alone exceed the budget. They are attached anyway:
   * silently dropping a shard the user marked always-on would be a worse
   * failure than reporting an overrun, so the caller gets told instead.
   */
  overBudget: boolean;
}

export function createWorkingMemory(budget: number): WorkingMemory {
  return { stepKey: null, budget, attached: [], clock: 0 };
}

export function usedTokens(memory: WorkingMemory): number {
  let total = 0;
  for (const entry of memory.attached) total += entry.shard.tokens;
  return total;
}

export function isAttached(memory: WorkingMemory, shardId: string): boolean {
  return memory.attached.some((entry) => entry.shard.id === shardId);
}

/**
 * Relevance of a shard to a step, or null when the step does not want it.
 *
 * A pinned shard is eligible for every step regardless of its labels. Anything
 * else needs at least one label the step asked for, and scores the sum of those
 * labels' weights. Union, not intersection: a step listing three labels wants
 * shards carrying any of them, and the weights decide what gets in first when
 * the budget is tight.
 */
export function scoreShard(shard: MemoryShard, step: MemoryStep): number | null {
  if (shard.pinned) return Number.POSITIVE_INFINITY;

  const wanted = new Map<string, number>();
  for (const label of step.labels) wanted.set(label.labelId, label.weight);

  let score = 0;
  let matched = false;
  for (const labelId of shard.labelIds) {
    const weight = wanted.get(labelId);
    if (weight === undefined) continue;
    matched = true;
    score += weight;
  }

  return matched ? score : null;
}

/**
 * Every shard the step wants, best first.
 *
 * Ordering is fully deterministic (score, then priority, then name, then id) so
 * the same inputs always produce the same pack. That matters more than it
 * sounds: an agent that gets a different context for the same step on a rerun
 * is not debuggable.
 */
export function rankForStep(
  shards: readonly MemoryShard[],
  step: MemoryStep,
): MemoryShard[] {
  const scored: Array<{ shard: MemoryShard; score: number }> = [];
  for (const shard of shards) {
    const score = scoreShard(shard, step);
    if (score !== null) scored.push({ shard, score });
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.shard.priority !== b.shard.priority) return b.shard.priority - a.shard.priority;
    const byName = a.shard.name.localeCompare(b.shard.name);
    if (byName !== 0) return byName;
    return a.shard.id.localeCompare(b.shard.id);
  });

  return scored.map((entry) => entry.shard);
}

/**
 * Least recently touched first. Pinned shards are never candidates, and neither
 * is anything in `protectedIds`.
 *
 * `protectedIds` is what stops a step fill from inverting its own ranking. Rank
 * order attaches the best shard first, so with plain LRU the worst-ranked shard
 * considered last would evict the best one to make room for itself: recency
 * says the best shard is the oldest thing in the pack. Protecting what this
 * fill already placed makes the pack the top N by rank, which is the whole
 * point of ranking it.
 */
function evictionOrder(
  memory: WorkingMemory,
  protectedIds: ReadonlySet<string>,
): AttachedShard[] {
  return memory.attached
    .filter((entry) => !entry.shard.pinned && !protectedIds.has(entry.shard.id))
    .sort((a, b) => a.touchedAt - b.touchedAt);
}

const NOTHING_PROTECTED: ReadonlySet<string> = new Set<string>();

function removeById(memory: WorkingMemory, shardId: string): boolean {
  const index = memory.attached.findIndex((entry) => entry.shard.id === shardId);
  if (index === -1) return false;
  memory.attached.splice(index, 1);
  return true;
}

/**
 * Attach one shard, evicting least-recently-used shards until it fits.
 *
 * Re-attaching something already present is a touch, not a duplicate: it
 * refreshes recency and upgrades a `step` attachment to `manual` if that is
 * what the caller asked for. It never downgrades, because a manual attachment
 * carries an intent that a step selection should not quietly override.
 *
 * A pinned shard skips the budget check entirely. See `overBudget`.
 */
export function attachShard(
  memory: WorkingMemory,
  shard: MemoryShard,
  reason: AttachReason = 'manual',
  protectedIds: ReadonlySet<string> = NOTHING_PROTECTED,
): AttachResult {
  const existing = memory.attached.find((entry) => entry.shard.id === shard.id);
  if (existing) {
    existing.touchedAt = ++memory.clock;
    if (reason === 'manual') existing.reason = 'manual';
    return { attached: true, evicted: [], skipped: null };
  }

  const evicted: string[] = [];

  if (!shard.pinned) {
    let used = usedTokens(memory);
    const candidates = evictionOrder(memory, protectedIds);
    let next = 0;
    while (used + shard.tokens > memory.budget && next < candidates.length) {
      const victim = candidates[next];
      next += 1;
      if (!victim) break;
      removeById(memory, victim.shard.id);
      evicted.push(victim.shard.id);
      used -= victim.shard.tokens;
    }

    // Nothing evictable is left and it still does not fit. Report it rather
    // than dropping a pinned shard or blowing the ceiling.
    if (used + shard.tokens > memory.budget) {
      return {
        attached: false,
        evicted,
        skipped: { id: shard.id, name: shard.name, reason: 'budget' },
      };
    }
  }

  memory.attached.push({ shard, reason, touchedAt: ++memory.clock });
  return { attached: true, evicted, skipped: null };
}

/** Detach by id. Returns false when it was not attached. Pins detach too: an explicit call outranks the flag. */
export function detachShard(memory: WorkingMemory, shardId: string): boolean {
  return removeById(memory, shardId);
}

/** Refresh recency without changing the pack. Use when a shard is actually read. */
export function touchShard(memory: WorkingMemory, shardId: string): boolean {
  const entry = memory.attached.find((item) => item.shard.id === shardId);
  if (!entry) return false;
  entry.touchedAt = ++memory.clock;
  return true;
}

/**
 * Move working memory to a step. This is the orchestrator's whole job.
 *
 * Detach what the new step does not want, keep what it does, then fill the
 * remaining budget in rank order. Shards already attached are kept in place
 * rather than dropped and re-added, so the caller can re-read only the delta
 * instead of the whole pack on every transition. That delta is the entire point
 * of the feature: a step change should cost the tokens the step actually
 * introduces, not the tokens of everything it needs.
 */
export function enterStep(
  memory: WorkingMemory,
  step: MemoryStep,
  shards: readonly MemoryShard[],
): TransitionResult {
  const ranked = rankForStep(shards, step);
  const wanted = new Set(ranked.map((shard) => shard.id));

  memory.budget = step.tokenBudget;

  // Manual attachments survive a step change; the step's own selections do not.
  const detached: string[] = [];
  for (const entry of [...memory.attached]) {
    if (entry.shard.pinned) continue;
    if (entry.reason === 'manual') continue;
    if (wanted.has(entry.shard.id)) continue;
    removeById(memory, entry.shard.id);
    detached.push(entry.shard.id);
  }

  const attached: string[] = [];
  const kept: string[] = [];
  const evicted: string[] = [];
  const skipped: SkippedShard[] = [];

  // Everything this fill has already placed. Protected from eviction by the
  // shards that come after it, which by definition rank lower.
  const placed = new Set<string>();

  for (const shard of ranked) {
    if (isAttached(memory, shard.id)) {
      kept.push(shard.id);
      touchShard(memory, shard.id);
      placed.add(shard.id);
      continue;
    }
    const result = attachShard(memory, shard, 'step', placed);
    for (const id of result.evicted) evicted.push(id);
    if (result.attached) {
      attached.push(shard.id);
      placed.add(shard.id);
    } else if (result.skipped) {
      skipped.push(result.skipped);
    }
  }

  memory.stepKey = step.key;
  const used = usedTokens(memory);

  return {
    stepKey: step.key,
    attached,
    detached,
    kept,
    evicted,
    skipped,
    usedTokens: used,
    budget: memory.budget,
    overBudget: used > memory.budget,
  };
}

/** The pack as the model should see it: bodies in attach order, plus the accounting. */
export interface MemoryPack {
  stepKey: string | null;
  usedTokens: number;
  budget: number;
  shards: Array<{ id: string; name: string; summary: string; body: string; tokens: number; pinned: boolean }>;
}

export function renderPack(memory: WorkingMemory): MemoryPack {
  return {
    stepKey: memory.stepKey,
    usedTokens: usedTokens(memory),
    budget: memory.budget,
    shards: memory.attached.map((entry) => ({
      id: entry.shard.id,
      name: entry.shard.name,
      summary: entry.shard.summary,
      body: entry.shard.body,
      tokens: entry.shard.tokens,
      pinned: entry.shard.pinned,
    })),
  };
}
