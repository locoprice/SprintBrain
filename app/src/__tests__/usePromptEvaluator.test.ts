import { describe, expect, it } from 'vitest';
import {
  evaluatePrompt,
  computeEvalKey,
  type EvaluatorInput,
} from '../lib/usePromptEvaluator';
import type { PromptBlock, PromptBlockType } from '../types/database';

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
      reasoning: 'Think step by step, then produce the final copy.',
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

  it('always produces exactly 10 criteria', () => {
    expect(evaluatePrompt(input()).criteria).toHaveLength(10);
    expect(evaluatePrompt(strongInput()).criteria).toHaveLength(10);
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
