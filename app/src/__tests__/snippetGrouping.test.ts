import { describe, it, expect } from 'vitest';
import {
  baseTrigger,
  baseSnippetName,
  groupSnippetsByLanguage,
  resolveActiveVariant,
} from '@/lib/snippetGrouping';
import type { SnippetLanguage, SnippetRow } from '@/types/database';

function snippet(
  id: string,
  trigger: string,
  language: SnippetLanguage,
  name: string,
): SnippetRow {
  return {
    id,
    user_id: 'u1',
    name,
    content: '',
    bodies: {},
    triggers: [trigger],
    tags: [],
    is_formula: false,
    formula: null,
    variables: {},
    folder_id: null,
    language,
    notion_page_id: null,
    pinned: false,
    is_active: true,
    alternative_queries: [],
    enable_urgency_timer: false,
    timer_duration_ms: 0,
    scarcity_count: 0,
    updated_at: '2026-06-10T00:00:00Z',
    updated_by: 'u1',
    folder_name: 'TEAM SHARED',
    usage_count: 0,
  };
}

// Fixtures mirror the live Supabase data shapes (pulled via SQL): identical
// triggers across languages, suffixed-trigger pairs, and same-language dupes.
function liveLikeRows(): SnippetRow[] {
  return [
    snippet('b1', '::budgetstay', 'EN', 'BUDGET STAY - NO A/C'),
    snippet('b2', '::budgetstay', 'ES', 'BUDGET STAY - NO A/C'),
    snippet('b3', '::budgetstay', 'IT', 'BUDGET STAY - NO A/C'),
    snippet('b4', '::budgetstay', 'FR', 'BUDGET STAY - NO A/C'),
    snippet('b5', '::budgetstay', 'MULTI', 'BUDGET STAY - NO A/C'),
    snippet('b6', '::budgetstay', 'EN', 'BUDGET STAY - NO A/C'), // same-lang dup
    snippet('b7', '::budgetstay', 'ES', 'BUDGET STAY - NO A/C'), // same-lang dup
    snippet('q1', '::quoteEN', 'EN', 'ESTIMATE B2C'),
    snippet('q2', '::quoteES', 'ES', 'PRESUPUESTO B2C'),
    snippet('a1', '::air', 'EN', 'AEROPORTO'),
    snippet('a2', '::air', 'ES', 'AEROPORTO'),
    snippet('a3', '::air', 'FR', 'AEROPORTO'),
    snippet('a4', '::airEN', 'EN', 'AEROPORTO EN'),
    snippet('a5', '::airEN', 'ES', 'AEROPORTO EN'),
    snippet('s1', '::salb2b', 'ES', 'SALUDOS B2B'),
  ];
}

describe('baseTrigger', () => {
  it('strips a trailing language code', () => {
    expect(baseTrigger('::quoteEN')).toBe('::quote');
    expect(baseTrigger('::airEN')).toBe('::air');
  });
  it('leaves triggers without a language suffix untouched', () => {
    expect(baseTrigger('::budgetstay')).toBe('::budgetstay');
    expect(baseTrigger('::time')).toBe('::time');
  });
});

describe('baseSnippetName', () => {
  it('strips a trailing language code', () => {
    expect(baseSnippetName('Valenx (firma) EN')).toBe('Valenx (firma)');
  });
  it('leaves a plain title untouched', () => {
    expect(baseSnippetName('BUDGET STAY - NO A/C')).toBe('BUDGET STAY - NO A/C');
  });
});

describe('groupSnippetsByLanguage', () => {
  it('collapses identical-trigger variants (incl. same-language dupes) into one group', () => {
    const groups = groupSnippetsByLanguage(liveLikeRows());
    const bg = groups.find((g) => g.key === '::budgetstay');
    expect(bg?.variants).toHaveLength(7);
    expect(bg?.languages).toEqual(['EN', 'ES', 'IT', 'FR', 'MULTI']);
  });

  it('merges suffixed-trigger pairs (quoteEN + quoteES → ::quote)', () => {
    const groups = groupSnippetsByLanguage(liveLikeRows());
    const qg = groups.find((g) => g.key === '::quote');
    expect(qg?.variants).toHaveLength(2);
    expect(qg?.languages).toEqual(['EN', 'ES']);
  });

  it('merges a base trigger with its suffixed sibling (air + airEN → ::air)', () => {
    const groups = groupSnippetsByLanguage(liveLikeRows());
    const ag = groups.find((g) => g.key === '::air');
    expect(ag?.variants).toHaveLength(5);
    expect(ag?.languages).toEqual(['EN', 'ES', 'FR']);
  });

  it('keeps an unrelated single-language snippet as its own group', () => {
    const groups = groupSnippetsByLanguage(liveLikeRows());
    const sg = groups.find((g) => g.key === '::salb2b');
    expect(sg?.variants).toHaveLength(1);
    expect(sg?.languages).toEqual(['ES']);
  });

  it('collapses 15 rows into 4 logical groups in first-appearance order', () => {
    const groups = groupSnippetsByLanguage(liveLikeRows());
    expect(groups.map((g) => g.key)).toEqual([
      '::budgetstay',
      '::quote',
      '::air',
      '::salb2b',
    ]);
  });

  it('falls back to the row id when a trigger is missing', () => {
    const orphan: SnippetRow = { ...snippet('o1', '', 'EN', 'No trigger'), triggers: [] };
    const groups = groupSnippetsByLanguage([orphan]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe('o1');
  });
});

describe('resolveActiveVariant', () => {
  const bg = groupSnippetsByLanguage(liveLikeRows()).find((g) => g.key === '::budgetstay')!;

  it('defaults to the English variant', () => {
    expect(resolveActiveVariant(bg, undefined).id).toBe('b1');
  });
  it('honors an explicit variant id', () => {
    expect(resolveActiveVariant(bg, 'b2').id).toBe('b2');
  });
  it('falls back to English when the active id is stale', () => {
    expect(resolveActiveVariant(bg, 'gone').id).toBe('b1');
  });
  it('falls back to the master when no English variant exists', () => {
    const noEn = groupSnippetsByLanguage([
      snippet('w1', '::withdraw', 'ES', 'RITIRARE'),
      snippet('w2', '::withdraw', 'IT', 'RITIRARE'),
    ]);
    expect(resolveActiveVariant(noEn[0]!, undefined).id).toBe('w1');
  });
});
