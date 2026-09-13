import { describe, expect, it } from 'vitest';
import { assembleBlocks, foldReasoningIntoConstraints, type StoredPromptBlock } from '@/lib/promptUtils';

// Reasoning was retired as a prompt block. A prompt saved before that, or by an
// older dashboard, can still carry one. Its text moves into Constraints so
// nothing is hidden or lost, and the assembled prompt keeps the same words in
// the same order: only the heading above them changes.

const OBJECTIVE: StoredPromptBlock = { type: 'objective', content: 'Tighten this paragraph.', enabled: true };

describe('foldReasoningIntoConstraints', () => {
  it('returns the same blocks when there is no Reasoning block', () => {
    const blocks: StoredPromptBlock[] = [OBJECTIVE, { type: 'constraints', content: 'Be brief.', enabled: true }];
    expect(foldReasoningIntoConstraints(blocks)).toBe(blocks);
  });

  it('drops an empty Reasoning block', () => {
    expect(
      foldReasoningIntoConstraints([OBJECTIVE, { type: 'reasoning', content: '  ', enabled: true }]),
    ).toEqual([OBJECTIVE]);
  });

  it('moves Reasoning text into an empty Constraints block with its on/off state', () => {
    expect(
      foldReasoningIntoConstraints([
        OBJECTIVE,
        { type: 'reasoning', content: 'Never guess.', enabled: true },
        { type: 'constraints', content: '', enabled: false },
      ]),
    ).toEqual([OBJECTIVE, { type: 'constraints', content: 'Never guess.', enabled: true }]);
  });

  it('puts Reasoning text before the existing Constraints text', () => {
    expect(
      foldReasoningIntoConstraints([
        { type: 'reasoning', content: 'Never guess.', enabled: true },
        { type: 'constraints', content: 'Be brief.', enabled: true },
      ]),
    ).toEqual([{ type: 'constraints', content: 'Never guess.\n\nBe brief.', enabled: true }]);
  });

  it("gives the text Reasoning's place when there is no Constraints block", () => {
    const examples: StoredPromptBlock = { type: 'examples', content: 'Input: a', enabled: true };
    expect(
      foldReasoningIntoConstraints([OBJECTIVE, { type: 'reasoning', content: 'Never guess.', enabled: true }, examples]),
    ).toEqual([OBJECTIVE, { type: 'constraints', content: 'Never guess.', enabled: true }, examples]);
  });

  it('keeps the text visible when only one of the two blocks was on', () => {
    expect(
      foldReasoningIntoConstraints([
        { type: 'reasoning', content: 'Never guess.', enabled: true },
        { type: 'constraints', content: 'Old rule.', enabled: false },
      ]),
    ).toEqual([{ type: 'constraints', content: 'Never guess.\n\nOld rule.', enabled: true }]);
  });

  it('keeps the pasted words and their order, and only the heading changes', () => {
    const stored: StoredPromptBlock[] = [
      OBJECTIVE,
      { type: 'reasoning', content: 'Key rules: never guess.', enabled: true },
      { type: 'constraints', content: 'Keep it under 150 words.', enabled: true },
    ];
    expect(assembleBlocks(stored)).toBe(
      '## Objective\nTighten this paragraph.\n\n## Reasoning\nKey rules: never guess.\n\n## Constraints\nKeep it under 150 words.',
    );
    expect(assembleBlocks(foldReasoningIntoConstraints(stored))).toBe(
      '## Objective\nTighten this paragraph.\n\n## Constraints\nKey rules: never guess.\n\nKeep it under 150 words.',
    );
  });
});
