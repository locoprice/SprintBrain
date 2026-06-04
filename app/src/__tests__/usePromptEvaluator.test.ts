import { describe, expect, it } from 'vitest';
import {
  evaluatePrompt,
  computeEvalKey,
  percentRank,
  promptToEvaluatorInput,
  selectBenchmarkCohort,
  MIN_BENCHMARK_CORPUS,
  type EvaluatorInput,
} from '../lib/usePromptEvaluator';
import type { IntentCategory, Prompt, PromptBlock, PromptBlockType } from '../types/database';

// ── Builders ────────────────────────────────────────────────────────────────────

const ALL_TYPES: PromptBlockType[] = [
  'role', 'objective', 'context', 'examples', 'reasoning', 'constraints',
];

/** Build a block set, overriding specific blocks; the rest are off + empty. */
function buildBlocks(overrides: Partial<Record<PromptBlockType, string>>): PromptBlock[] {
  return ALL_TYPES.map((type) => {
    const content = overrides[type];
    return {
      type,
      content: content ?? '',
      enabled: content !== undefined,
    };
  });
}

function input(over: Partial<EvaluatorInput> = {}): EvaluatorInput {
  return {
    blocks: over.blocks ?? buildBlocks({}),
    strategyType: over.strategyType ?? null,
    preferredModel: over.preferredModel ?? null,
    outputType: over.outputType ?? null,
  };
}

/** A prompt that satisfies every criterion strongly. */
function strongInput(): EvaluatorInput {
  return {
    blocks: buildBlocks({
      role: 'You are a senior B2B copywriter with deep SaaS experience.',
      objective: 'Write a 150-word product announcement email for the new analytics feature.',
      context: 'The audience is existing Pro-plan customers; the tone is friendly but concise.',
      reasoning: 'Think step by step, then double-check the result before producing the final copy.',
      constraints: 'Keep it under 150 words. Do not use jargon. Avoid emojis.',
      examples: 'Input: "new dashboard" → Output: "Meet your new dashboard…"',
    }),
    strategyType: 'One-shot',
    preferredModel: 'claude-sonnet-4-6',
    outputType: 'Markdown',
  };
}

// ── Score range / edge cases ─────────────────────────────────────────────────────

describe('evaluatePrompt — score range', () => {
  it('scores an empty prompt at 0 with every criterion failing', () => {
    const r = evaluatePrompt(input());
    expect(r.score).toBe(0);
    expect(r.pct).toBe(0);
    expect(r.criteria.every((c) => c.status === 'fail')).toBe(true);
  });

  it('scores a fully-loaded strong prompt above 80%', () => {
    const r = evaluatePrompt(strongInput());
    expect(r.pct).toBeGreaterThanOrEqual(80);
    expect(r.score).toBeGreaterThanOrEqual(8);
    expect(r.criteria.every((c) => c.status === 'pass')).toBe(true);
  });

  it('keeps score within the 0–10 envelope and pct within 0–100', () => {
    for (const r of [evaluatePrompt(input()), evaluatePrompt(strongInput())]) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(10);
      expect(r.pct).toBeGreaterThanOrEqual(0);
      expect(r.pct).toBeLessThanOrEqual(100);
    }
  });

  it('always produces exactly 12 criteria', () => {
    expect(evaluatePrompt(input()).criteria).toHaveLength(12);
    expect(evaluatePrompt(strongInput()).criteria).toHaveLength(12);
  });

  it('derives score as one-decimal of pct/10', () => {
    const r = evaluatePrompt(strongInput());
    expect(r.score).toBeCloseTo(r.pct / 10, 5);
  });
});

// ── Graded / partial credit ──────────────────────────────────────────────────────

describe('evaluatePrompt — partial credit', () => {
  it('marks an enabled but weak block as partial, not pass or fail', () => {
    // Objective present but too short and no action verb.
    const r = evaluatePrompt(input({ blocks: buildBlocks({ objective: 'stuff' }) }));
    const objective = r.criteria.find((c) => c.id === 'objective')!;
    expect(objective.status).toBe('partial');
    expect(objective.value).toBeGreaterThan(0);
    expect(objective.value).toBeLessThan(1);
  });

  it('gives full credit to a strong, signal-bearing block', () => {
    const r = evaluatePrompt(input({
      blocks: buildBlocks({ objective: 'Write a detailed onboarding email for new users.' }),
    }));
    const objective = r.criteria.find((c) => c.id === 'objective')!;
    expect(objective.status).toBe('pass');
    expect(objective.value).toBe(1);
  });

  it('treats a disabled block as fail (zero value)', () => {
    const r = evaluatePrompt(input()); // all blocks off
    const role = r.criteria.find((c) => c.id === 'role')!;
    expect(role.status).toBe('fail');
    expect(role.value).toBe(0);
  });
});

// ── Weighting ────────────────────────────────────────────────────────────────────

describe('evaluatePrompt — weighting', () => {
  it('rewards a high-weight criterion (objective) more than a low-weight one (model)', () => {
    const onlyObjective = evaluatePrompt(input({
      blocks: buildBlocks({ objective: 'Write a detailed onboarding email for new users.' }),
    }));
    const onlyModel = evaluatePrompt(input({ preferredModel: 'claude-opus-4-7' }));
    expect(onlyObjective.pct).toBeGreaterThan(onlyModel.pct);
  });

  it('weights objective (2.0) above role (1.5)', () => {
    const obj = r1(evaluatePrompt(input({
      blocks: buildBlocks({ objective: 'Write a detailed onboarding email for new users.' }),
    })), 'objective');
    const role = r1(evaluatePrompt(input({
      blocks: buildBlocks({ role: 'You are a senior B2B copywriter with SaaS experience.' }),
    })), 'role');
    expect(obj.weight).toBeGreaterThan(role.weight);
  });
});

function r1(result: ReturnType<typeof evaluatePrompt>, id: string) {
  return result.criteria.find((c) => c.id === id)!;
}

// ── Suggestions (one-click auto-fix) ─────────────────────────────────────────────

describe('evaluatePrompt — suggestion labels', () => {
  it('offers an "Enable … block" suggestion for a disabled block', () => {
    const role = r1(evaluatePrompt(input()), 'role');
    expect(role.suggestionLabel).toBe('Enable role block');
  });

  it('does NOT offer an enable-suggestion for an enabled-but-weak block', () => {
    const r = evaluatePrompt(input({ blocks: buildBlocks({ role: 'a' }) }));
    const role = r1(r, 'role');
    expect(role.status).toBe('partial');
    expect(role.suggestionLabel).toBeUndefined();
  });

  it('offers metadata defaults when strategy/model/output are unset', () => {
    const r = evaluatePrompt(input());
    expect(r1(r, 'strategy').suggestionLabel).toBe('Apply One-shot');
    expect(r1(r, 'model').suggestionLabel).toBe('Use Sonnet 4');
    expect(r1(r, 'output_format').suggestionLabel).toBe('Set to Plain text');
  });

  it('drops the suggestion once the metadata field is set', () => {
    const r = evaluatePrompt(input({ strategyType: 'CoT', preferredModel: 'claude-opus-4-7', outputType: 'JSON' }));
    expect(r1(r, 'strategy').suggestionLabel).toBeUndefined();
    expect(r1(r, 'model').suggestionLabel).toBeUndefined();
    expect(r1(r, 'output_format').suggestionLabel).toBeUndefined();
    expect(r1(r, 'strategy').status).toBe('pass');
  });
});

// ── Rationale / examples ─────────────────────────────────────────────────────────

describe('evaluatePrompt — rationale and examples', () => {
  it('always provides a rationale for every criterion', () => {
    for (const c of evaluatePrompt(input()).criteria) {
      expect(c.rationale.length).toBeGreaterThan(0);
    }
  });

  it('attaches a concrete example to failing/partial criteria but not to passes', () => {
    const fail = r1(evaluatePrompt(input()), 'role');
    expect(fail.example).toBeTruthy();

    const pass = r1(evaluatePrompt(input({
      blocks: buildBlocks({ role: 'You are a senior B2B copywriter with SaaS experience.' }),
    })), 'role');
    expect(pass.status).toBe('pass');
    expect(pass.example).toBeUndefined();
  });
});

// ── Depth criterion ──────────────────────────────────────────────────────────────

describe('evaluatePrompt — depth', () => {
  it('fails depth on a near-empty prompt', () => {
    expect(r1(evaluatePrompt(input()), 'depth').status).toBe('fail');
  });

  it('passes depth on a long assembled prompt', () => {
    expect(r1(evaluatePrompt(strongInput()), 'depth').status).toBe('pass');
  });
});

// ── Signal criteria (audience + refinement) ──────────────────────────────────────

describe('evaluatePrompt — audience criterion', () => {
  it('fails when no audience is named', () => {
    const r = r1(evaluatePrompt(input({ blocks: buildBlocks({ objective: 'Write a launch email.' }) })), 'audience');
    expect(r.status).toBe('fail');
    expect(r.suggestionLabel).toBe('Name the audience');
  });

  it('passes when an audience is named in any block', () => {
    const r = r1(evaluatePrompt(input({
      blocks: buildBlocks({ context: 'The audience is non-technical hospitality managers.' }),
    })), 'audience');
    expect(r.status).toBe('pass');
    expect(r.value).toBe(1);
    expect(r.suggestionLabel).toBeUndefined();
  });
});

describe('evaluatePrompt — refinement criterion', () => {
  it('fails when no self-check step is requested', () => {
    const r = r1(evaluatePrompt(input({ blocks: buildBlocks({ reasoning: 'Think step by step.' }) })), 'refinement');
    expect(r.status).toBe('fail');
    expect(r.suggestionLabel).toBe('Add self-check');
  });

  it('passes when the prompt asks the model to verify its work', () => {
    const r = r1(evaluatePrompt(input({
      blocks: buildBlocks({ reasoning: 'Reason it out, then double-check the answer.' }),
    })), 'refinement');
    expect(r.status).toBe('pass');
    expect(r.value).toBe(1);
  });

  it('passes on an "if unsure" uncertainty cue', () => {
    const r = r1(evaluatePrompt(input({
      blocks: buildBlocks({ constraints: 'If unsure, say so rather than guessing.' }),
    })), 'refinement');
    expect(r.status).toBe('pass');
  });
});

// ── Memoisation key ──────────────────────────────────────────────────────────────

describe('computeEvalKey — memoisation', () => {
  it('produces identical keys for identical inputs', () => {
    expect(computeEvalKey(strongInput())).toBe(computeEvalKey(strongInput()));
  });

  it('changes when block content changes', () => {
    const a = computeEvalKey(input({ blocks: buildBlocks({ role: 'a' }) }));
    const b = computeEvalKey(input({ blocks: buildBlocks({ role: 'b' }) }));
    expect(a).not.toBe(b);
  });

  it('changes when a block is toggled on/off', () => {
    const off = computeEvalKey(input({ blocks: buildBlocks({}) }));
    const on = computeEvalKey(input({ blocks: buildBlocks({ role: '' }) }));
    expect(off).not.toBe(on);
  });

  it('changes when metadata changes', () => {
    const a = computeEvalKey(input({ strategyType: null }));
    const b = computeEvalKey(input({ strategyType: 'CoT' }));
    expect(a).not.toBe(b);
  });
});

// ── Corpus benchmark ─────────────────────────────────────────────────────────────

describe('percentRank', () => {
  it('returns 0 for an empty corpus', () => {
    expect(percentRank([], 7)).toBe(0);
  });

  it('ranks a top score near 100', () => {
    expect(percentRank([1, 2, 3, 4], 9)).toBe(100);
  });

  it('ranks a bottom score near 0', () => {
    expect(percentRank([5, 6, 7, 8], 1)).toBe(0);
  });

  it('counts ties as half (whole corpus tied → 50)', () => {
    expect(percentRank([5, 5, 5, 5], 5)).toBe(50);
  });

  it('computes the standard mid-rank for a mixed corpus', () => {
    // below: 2 (1,2) · equal: 1 (5) · n: 4 → (2 + 0.5)/4 = 62.5 → 63
    expect(percentRank([1, 2, 5, 9], 5)).toBe(63);
  });
});

describe('promptToEvaluatorInput', () => {
  const baseRow: Prompt = {
    id: 'p1',
    user_id: 'u1',
    name: 'Test',
    content: '',
    type: 'one-shot',
    tags: [],
    blocks: null,
    strategy_type: null,
    thinking_mode: null,
    preferred_model: null,
    complexity_level: null,
    execution_type: null,
    intent_category: null,
    output_type: null,
    updated_at: '2026-01-01T00:00:00.000Z',
    last_used_at: null,
  };

  it('uses structured blocks when present', () => {
    const blocks: PromptBlock[] = [{ type: 'role', content: 'You are an expert.', enabled: true }];
    const result = promptToEvaluatorInput({ ...baseRow, blocks });
    expect(result.blocks).toBe(blocks);
  });

  it('falls back to flat content as a single objective block', () => {
    const result = promptToEvaluatorInput({ ...baseRow, content: 'Write something useful.', blocks: null });
    expect(result.blocks).toHaveLength(1);
    const block = result.blocks[0]!;
    expect(block.type).toBe('objective');
    expect(block.enabled).toBe(true);
    expect(block.content).toBe('Write something useful.');
  });

  it('disables the fallback block when content is empty', () => {
    const result = promptToEvaluatorInput({ ...baseRow, content: '   ', blocks: null });
    expect(result.blocks[0]!.enabled).toBe(false);
  });

  it('carries metadata through for scoring', () => {
    const result = promptToEvaluatorInput({
      ...baseRow,
      strategy_type: 'CoT',
      preferred_model: 'claude-opus-4-7',
      output_type: 'JSON',
    });
    expect(result.strategyType).toBe('CoT');
    expect(result.preferredModel).toBe('claude-opus-4-7');
    expect(result.outputType).toBe('JSON');
  });

  it('produces input that scores deterministically via evaluatePrompt', () => {
    const strong = promptToEvaluatorInput({
      ...baseRow,
      content: 'Write a detailed onboarding email for new Pro-plan users with a friendly tone.',
    });
    const r = evaluatePrompt(strong);
    expect(r.pct).toBeGreaterThan(0);
  });
});

describe('selectBenchmarkCohort', () => {
  const row = (id: string, intent: IntentCategory | null): Prompt => ({
    id,
    user_id: 'u1',
    name: id,
    content: 'x',
    type: 'one-shot',
    tags: [],
    blocks: null,
    strategy_type: null,
    thinking_mode: null,
    preferred_model: null,
    complexity_level: null,
    execution_type: null,
    intent_category: intent,
    output_type: null,
    updated_at: '2026-01-01T00:00:00.000Z',
    last_used_at: null,
  });

  function many(n: number, intent: IntentCategory | null, prefix = 'p'): Prompt[] {
    return Array.from({ length: n }, (_, i) => row(`${prefix}${i}`, intent));
  }

  it('returns null below the minimum corpus size', () => {
    expect(selectBenchmarkCohort(many(MIN_BENCHMARK_CORPUS - 1, null), null, null)).toBeNull();
  });

  it('excludes the current prompt from the cohort', () => {
    const prompts = [row('self', null), ...many(MIN_BENCHMARK_CORPUS, null)];
    const cohort = selectBenchmarkCohort(prompts, 'self', null);
    expect(cohort).not.toBeNull();
    expect(cohort!.prompts.some((p) => p.id === 'self')).toBe(false);
  });

  it('falls back to the whole library (no scope) when no intent is given', () => {
    const cohort = selectBenchmarkCohort(many(MIN_BENCHMARK_CORPUS, 'Coding'), null, null);
    expect(cohort).not.toBeNull();
    expect(cohort!.scopeLabel).toBeUndefined();
  });

  it('uses a same-intent cohort when it is large enough', () => {
    const prompts = [...many(MIN_BENCHMARK_CORPUS, 'Coding', 'c'), ...many(3, 'Writing', 'w')];
    const cohort = selectBenchmarkCohort(prompts, null, 'Coding');
    expect(cohort!.scopeLabel).toBe('Coding');
    expect(cohort!.prompts).toHaveLength(MIN_BENCHMARK_CORPUS);
    expect(cohort!.prompts.every((p) => p.intent_category === 'Coding')).toBe(true);
  });

  it('falls back to the whole library when the same-intent cohort is too small', () => {
    // Only 2 Coding prompts, but plenty overall.
    const prompts = [...many(2, 'Coding', 'c'), ...many(MIN_BENCHMARK_CORPUS, 'Writing', 'w')];
    const cohort = selectBenchmarkCohort(prompts, null, 'Coding');
    expect(cohort).not.toBeNull();
    expect(cohort!.scopeLabel).toBeUndefined();
    expect(cohort!.prompts.length).toBeGreaterThan(MIN_BENCHMARK_CORPUS);
  });
});
