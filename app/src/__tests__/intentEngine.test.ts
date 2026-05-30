import { describe, expect, it } from 'vitest';
import { classifyPromptText, classifyPrompt, stem } from '../lib/intentEngine';

describe('stem', () => {
  it('leaves short words untouched', () => {
    expect(stem('api')).toBe('api');
    expect(stem('seo')).toBe('seo');
  });

  it('unifies plurals with their singular', () => {
    expect(stem('functions')).toBe(stem('function'));
    expect(stem('keywords')).toBe(stem('keyword'));
    expect(stem('sources')).toBe(stem('source'));
  });

  it('unifies gerunds and past tense with the base form', () => {
    expect(stem('debugging')).toBe(stem('debug'));
    expect(stem('planning')).toBe(stem('plan'));
    expect(stem('planned')).toBe(stem('plan'));
    expect(stem('coding')).toBe(stem('code'));
    expect(stem('analyzing')).toBe(stem('analyze'));
  });

  it('stems a word consistently with its plural', () => {
    // The exact root is an implementation detail; what matters is that a
    // word and its inflections collapse to the same stem so they match.
    expect(stem('class')).toBe(stem('classes'));
    expect(stem('report')).toBe(stem('reports'));
  });
});

describe('classifyPromptText — no false positives from substrings', () => {
  it('does not classify "therapist" as Coding via "api"', () => {
    // "api" is a Coding keyword; substring matching would have fired here.
    const result = classifyPromptText('Write a calming note to a therapist');
    expect(result?.intent).not.toBe('Coding');
  });

  it('does not classify "the latest newsletter" as Coding via "test"', () => {
    const result = classifyPromptText('Draft the latest newsletter article');
    expect(result?.intent).toBe('Writing');
  });

  it('does not classify "explanation" as Planning via "plan"', () => {
    const result = classifyPromptText('Give a clear explanation of this concept to a beginner');
    expect(result?.intent).toBe('Teaching');
  });

  it('returns null when no keyword is present', () => {
    expect(classifyPromptText('the quick brown fox jumped over')).toBeNull();
  });

  it('returns null for empty or whitespace input', () => {
    expect(classifyPromptText('')).toBeNull();
    expect(classifyPromptText('   \n  ')).toBeNull();
  });
});

describe('classifyPromptText — morphology', () => {
  it('matches inflected forms (functions, debugging)', () => {
    const result = classifyPromptText('Review these functions and help with debugging');
    expect(result?.intent).toBe('Coding');
  });

  it('matches "planning" against the Planning intent', () => {
    const result = classifyPromptText('We are planning the next sprint and the roadmap');
    expect(result?.intent).toBe('Planning');
  });
});

describe('classifyPromptText — intent coverage', () => {
  const cases: { text: string; intent: string }[] = [
    { text: 'Refactor this typescript function and fix the bug', intent: 'Coding' },
    { text: 'Write a blog article with a warm casual tone', intent: 'Writing' },
    { text: 'Improve the meta description and keyword ranking for SEO', intent: 'SEO' },
    { text: 'Respond to this angry customer support ticket asking for a refund', intent: 'Support' },
    { text: 'Analyze the dataset and benchmark the performance metrics', intent: 'Analysis' },
    { text: 'Build a roadmap with milestones for the sprint backlog', intent: 'Planning' },
    { text: 'Research the literature and gather sources on this hypothesis', intent: 'Research' },
    { text: 'Explain this lesson step by step for beginners', intent: 'Teaching' },
  ];

  for (const c of cases) {
    it(`classifies "${c.text.slice(0, 32)}..." as ${c.intent}`, () => {
      expect(classifyPromptText(c.text)?.intent).toBe(c.intent);
    });
  }
});

describe('classifyPromptText — weighting and phrases', () => {
  it('weights a specific phrase above a single generic keyword', () => {
    // "search" alone is a generic SEO secondary; the Coding phrase should win.
    const result = classifyPromptText('Add a unit test for the search box');
    expect(result?.intent).toBe('Coding');
  });

  it('lets a primary keyword outrank a secondary keyword of another intent', () => {
    // "typescript" (Coding primary) vs "post" (Writing secondary).
    const result = classifyPromptText('Post the typescript snippet');
    expect(result?.intent).toBe('Coding');
  });
});

describe('classifyPromptText — confidence', () => {
  it('reports higher confidence for a dominant single-intent match', () => {
    const dominant = classifyPromptText(
      'Refactor the typescript function, fix the runtime exception and debug the api',
    );
    const ambiguous = classifyPromptText('write a plan');
    expect(dominant).not.toBeNull();
    expect(ambiguous).not.toBeNull();
    expect(dominant!.confidence).toBeGreaterThan(ambiguous!.confidence);
  });

  it('keeps confidence within the [0.3, 0.98] envelope', () => {
    const result = classifyPromptText(
      'code debug function refactor api algorithm typescript javascript python compile',
    );
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeGreaterThanOrEqual(0.3);
    expect(result!.confidence).toBeLessThanOrEqual(0.98);
  });

  it('lowers confidence when two intents are near-tied', () => {
    // Balanced Coding vs Writing signals -> small margin -> lower confidence.
    const tied = classifyPromptText('write code');
    expect(tied).not.toBeNull();
    expect(tied!.confidence).toBeLessThan(0.75);
  });
});

describe('classifyPrompt (two-layer)', () => {
  it('returns null when Layer 1 finds nothing', async () => {
    await expect(classifyPrompt('lorem ipsum dolor sit')).resolves.toBeNull();
  });

  it('returns a high-confidence Layer 1 result directly', async () => {
    const result = await classifyPrompt(
      'Refactor the typescript function and debug the runtime exception',
    );
    expect(result?.intent).toBe('Coding');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('boosts low-confidence results via the Layer 2 stub', async () => {
    const layer1 = classifyPromptText('write a plan');
    const result = await classifyPrompt('write a plan');
    expect(layer1).not.toBeNull();
    expect(result).not.toBeNull();
    if (layer1!.confidence < 0.6) {
      expect(result!.confidence).toBeGreaterThanOrEqual(0.72);
    }
  });
});
