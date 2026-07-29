import { describe, it, expect } from 'vitest';
import {
  PROMPT_WEAK_SCORE,
  TOP_MIN_USES,
  isTopByUsage,
  maxPromptUsage,
  maxUsage,
  promptStatus,
  snippetStatus,
  validateSnippet,
  validateTemplate,
} from '@/lib/statusSignals';
import type { SnippetRow } from '@/types/database';

/**
 * Shared parity matrix. `scripts/check-snippets.js` asserts the SAME inputs
 * against the extension's formula-engine implementation, so the two mirrored
 * validators cannot drift without a gate failing. Keep both lists in step.
 */
const PARITY_CASES: Array<{ body: string; code: string | null }> = [
  // Sound
  { body: 'Hi {NAME}', code: null },
  { body: 'Total {= PRICE * QTY}', code: null },
  { body: '{{= round(PRICE * 1.03) }}', code: null },
  { body: '{if: OTA > 0}save{endif}', code: null },
  { body: '{if: N >= 5}big{else}small{endif}', code: null },
  { body: '{if: A}a{elseif: B}b{else}c{endif}', code: null },
  { body: '{if: A}{if: B}both{endif}{endif}', code: null },
  { body: 'plain text with no tokens at all', code: null },
  // Prose and code shapes that must NOT be flagged — the validator is narrow
  // on purpose, and a false positive costs more than a missed edge case.
  { body: 'JSON example: {"sentiment":"positive"}', code: null },
  { body: 'function f() { return 1; }', code: null },
  // Faults
  { body: 'Dear {name, welcome', code: 'unterminated-token' },
  { body: '{{NAME}', code: 'unterminated-token' },
  { body: '{if: A}no closer', code: 'unclosed-if' },
  { body: '{if: A}{if: B}only one closer{endif}', code: 'unclosed-if' },
  { body: 'nothing opened it{endif}', code: 'orphan-branch' },
  { body: 'stray {else} branch', code: 'orphan-branch' },
];

describe('validateTemplate', () => {
  for (const { body, code } of PARITY_CASES) {
    it(`${code ?? 'accepts'}: ${JSON.stringify(body).slice(0, 46)}`, () => {
      const result = validateTemplate(body);
      expect(result.code).toBe(code);
      expect(result.ok).toBe(code === null);
      // A fault always explains itself; a pass never carries stray copy.
      expect(result.message.length > 0).toBe(code !== null);
    });
  }

  it('treats null and empty bodies as sound', () => {
    expect(validateTemplate(null).ok).toBe(true);
    expect(validateTemplate(undefined).ok).toBe(true);
    expect(validateTemplate('').ok).toBe(true);
  });
});

describe('validateSnippet', () => {
  it('flags a fault that only exists in a non-active language body', () => {
    const result = validateSnippet({
      content: 'Dear {guest}, welcome.',
      bodies: { EN: 'Dear {guest}, welcome.', IT: '{if: X}ciao' },
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('unclosed-if');
  });

  it('passes when every language body is sound', () => {
    expect(
      validateSnippet({
        content: 'Hi {guest}',
        bodies: { EN: 'Hi {guest}', ES: 'Hola {guest}' },
      }).ok,
    ).toBe(true);
  });
});

describe('isTopByUsage', () => {
  it('refuses to badge below the absolute floor, however small the library', () => {
    // Most-used snippet in a brand-new account: still under the floor.
    expect(isTopByUsage(TOP_MIN_USES - 1, TOP_MIN_USES - 1)).toBe(false);
  });

  it('badges the library leader once it clears the floor', () => {
    expect(isTopByUsage(TOP_MIN_USES, TOP_MIN_USES)).toBe(true);
  });

  it('drops a snippet that clears the floor but trails the leader', () => {
    // Share is 0.25, so 5 of 100 is well behind the pack.
    expect(isTopByUsage(5, 100)).toBe(false);
    expect(isTopByUsage(25, 100)).toBe(true);
  });
});

function row(over: Partial<SnippetRow> = {}): SnippetRow {
  return {
    id: 's1',
    user_id: 'u1',
    name: 'Quote',
    content: 'Hi {guest}',
    bodies: { EN: 'Hi {guest}' },
    triggers: ['quote'],
    tags: [],
    is_formula: false,
    formula: null,
    variables: {},
    folder_id: null,
    language: 'EN',
    notion_page_id: null,
    pinned: false,
    is_active: true,
    is_malformed: false,
    alternative_queries: [],
    enable_urgency_timer: false,
    timer_duration_ms: 0,
    scarcity_count: 0,
    updated_at: '2026-01-01T00:00:00.000Z',
    updated_by: null,
    folder_name: null,
    usage_count: 0,
    ...over,
  };
}

describe('snippetStatus', () => {
  it('ranks broken above top — a popular snippet that renders wrong is the worst case', () => {
    expect(snippetStatus(row({ content: '{if: A}oops', usage_count: 999 }), 999)).toBe('broken');
  });

  it('badges a sound, heavily-used snippet', () => {
    expect(snippetStatus(row({ usage_count: 20 }), 20)).toBe('top');
  });

  it('leaves an ordinary snippet unbadged', () => {
    expect(snippetStatus(row({ usage_count: 1 }), 20)).toBeNull();
  });

  it('validates live rather than trusting a stale is_malformed flag', () => {
    // Flag says broken, body is sound: the live check wins.
    expect(snippetStatus(row({ is_malformed: true, usage_count: 0 }), 20)).toBeNull();
  });
});

describe('maxUsage / maxPromptUsage', () => {
  it('returns 0 for an empty library rather than -Infinity', () => {
    expect(maxUsage([])).toBe(0);
    expect(maxPromptUsage([])).toBe(0);
  });

  it('finds the leader', () => {
    expect(maxUsage([row({ usage_count: 3 }), row({ usage_count: 11 })])).toBe(11);
    expect(maxPromptUsage([{ usage_count: 2 }, { usage_count: 9 }])).toBe(9);
  });
});

describe('promptStatus', () => {
  it('puts malformed ahead of everything', () => {
    expect(
      promptStatus({ usage_count: 500, is_malformed: true, score: 10 }, 500),
    ).toBe('broken');
  });

  it('awards the trophy on usage', () => {
    expect(
      promptStatus({ usage_count: 20, is_malformed: false, score: 1 }, 20),
    ).toBe('top');
  });

  it('never lets a high score alone mint a trophy', () => {
    // Perfect score, never used: usage is the gate, so no badge.
    expect(
      promptStatus({ usage_count: 0, is_malformed: false, score: 10 }, 40),
    ).toBeNull();
  });

  it('falls back to the score only for "needs work"', () => {
    expect(
      promptStatus({ usage_count: 0, is_malformed: false, score: PROMPT_WEAK_SCORE }, 40),
    ).toBe('weak');
  });

  it('lets real usage outrank a weak score', () => {
    expect(
      promptStatus({ usage_count: 40, is_malformed: false, score: 0 }, 40),
    ).toBe('top');
  });
});
