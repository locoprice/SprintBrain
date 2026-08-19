import { describe, it, expect } from 'vitest';
import {
  baseTrigger,
  baseSnippetName,
  groupSnippetsByLanguage,
  resolveActiveLanguage,
  resolveActiveVariant,
  snippetGroupKey,
} from '@/lib/snippetGrouping';
import type { SnippetLanguage, SnippetRow } from '@/types/database';

function snippet(
  id: string,
  trigger: string,
  language: SnippetLanguage,
  name: string,
  langGroupId: string | null = null,
): SnippetRow {
  return {
    id,
    user_id: 'u1',
    name,
    content: '',
    bodies: {},
    triggers: [trigger],
    is_formula: false,
    formula: null,
    variables: {},
    folder_id: null,
    language,
    lang_group_id: langGroupId,
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
    is_malformed: false,
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
    expect(baseTrigger(snippet('x','::quoteEN','EN','Q'))).toBe('quote');
    expect(baseTrigger(snippet('x','::airEN','EN','A'))).toBe('air');
  });
  it('leaves triggers without a language suffix untouched', () => {
    expect(baseTrigger(snippet('x','::budgetstay','EN','B'))).toBe('budgetstay');
    expect(baseTrigger(snippet('x','::time','EN','T'))).toBe('time');
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
    const bg = groups.find((g) => g.key === 'u:u1|b:budgetstay');
    expect(bg?.variants).toHaveLength(7);
    expect(bg?.languages).toEqual(['EN', 'ES', 'IT', 'FR', 'MULTI']);
  });

  it('merges suffixed-trigger pairs (quoteEN + quoteES → ::quote)', () => {
    const groups = groupSnippetsByLanguage(liveLikeRows());
    const qg = groups.find((g) => g.key === 'u:u1|b:quote');
    expect(qg?.variants).toHaveLength(2);
    expect(qg?.languages).toEqual(['EN', 'ES']);
  });

  it('merges a base trigger with its suffixed sibling (air + airEN → air)', () => {
    const groups = groupSnippetsByLanguage(liveLikeRows());
    const ag = groups.find((g) => g.key === 'u:u1|b:air');
    expect(ag?.variants).toHaveLength(4);
    expect(ag?.languages).toEqual(['EN', 'ES', 'FR']);
  });

  it('leaves a row whose trigger code contradicts its language on its own', () => {
    // a5 is triggered "::airEN" but its language column says ES. Trigger codes
    // are not trustworthy on their own (production held an "::airEN" holding
    // Spanish and an "airFR" holding English), so the suffix is only stripped
    // when it agrees with the row's language. The cost is that a mislabelled
    // row splits off; the alternative merged unrelated snippets together.
    const groups = groupSnippetsByLanguage(liveLikeRows());
    const stray = groups.find((g) => g.key === 'u:u1|b:airen');
    expect(stray?.variants).toHaveLength(1);
    expect(stray?.master.id).toBe('a5');
  });

  it('keeps an unrelated single-language snippet as its own group', () => {
    const groups = groupSnippetsByLanguage(liveLikeRows());
    const sg = groups.find((g) => g.key === 'u:u1|b:salb2b');
    expect(sg?.variants).toHaveLength(1);
    expect(sg?.languages).toEqual(['ES']);
  });

  it('collapses 15 rows into 5 logical groups in first-appearance order', () => {
    const groups = groupSnippetsByLanguage(liveLikeRows());
    expect(groups.map((g) => g.key)).toEqual([
      'u:u1|b:budgetstay',
      'u:u1|b:quote',
      'u:u1|b:air',
      'u:u1|b:airen',
      'u:u1|b:salb2b',
    ]);
  });

  it('falls back to the row id when a trigger is missing', () => {
    const orphan: SnippetRow = { ...snippet('o1', '', 'EN', 'No trigger'), triggers: [] };
    const groups = groupSnippetsByLanguage([orphan]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe('u:u1|r:o1');
  });
});

// The rows below mirror live Supabase data (pulled via SQL) where the base
// trigger and lang_group_id disagree — the two shapes the trigger heuristic
// alone got wrong on 43 of 140 production snippets.
describe('groupSnippetsByLanguage — lang_group_id', () => {
  it('keeps distinct lang_group_ids apart when their triggers share a base', () => {
    // ::quoteEN/ES/FR/IT are one snippet (group "quoteEN"); a separate
    // ::quoteES snippet carries its own group. Both base to ::quote, so
    // grouping on the trigger alone collapsed all of them into one row — and
    // because two rows claim ES, `byLang` kept only the first and the second
    // ES snippet became unreachable from the language switcher.
    const groups = groupSnippetsByLanguage([
      snippet('q1', '::quoteEN', 'EN', 'ESTIMATE B2C', 'quoteEN'),
      snippet('q2', '::quoteES', 'ES', 'ESTIMATE B2C ES', 'quoteEN'),
      snippet('q3', '::quoteES', 'ES', 'PRESUPUESTO B2C', 'quoteES'),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['u:u1|g:quoteen', 'u:u1|g:quotees']);
    expect(groups[0]!.variants).toHaveLength(2);
    expect(groups[1]!.variants).toHaveLength(1);
    // The shadowed snippet is now reachable as its own group's ES variant.
    expect(groups[1]!.byLang.get('ES')?.name).toBe('PRESUPUESTO B2C');
  });

  it('collapses one lang_group_id whose triggers disagree on the :: prefix', () => {
    const groups = groupSnippetsByLanguage([
      snippet('a1', '::altern', 'EN', 'ALTERNATIVA', 'altern'),
      snippet('a2', '::altern', 'IT', 'ALTERNATIVA', 'altern'),
      snippet('a3', 'altern', 'MULTI', 'ALTERNATIVA', 'altern'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe('u:u1|g:altern');
    expect(groups[0]!.variants).toHaveLength(3);
    expect(groups[0]!.languages).toEqual(['EN', 'IT', 'MULTI']);
  });

  it('uses the trigger heuristic only for rows without a group id', () => {
    const groups = groupSnippetsByLanguage([
      snippet('g1', '::alpha', 'EN', 'Grouped', 'gid-1'),
      snippet('n1', '::betaEN', 'EN', 'Ungrouped'),
      snippet('n2', '::betaES', 'ES', 'Ungrouped'),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['u:u1|g:gid-1', 'u:u1|b:beta']);
    expect(groups[1]!.variants).toHaveLength(2);
  });
});

describe('snippetGroupKey', () => {
  it('prefers the lang_group_id, namespaced and lowercased', () => {
    expect(snippetGroupKey(snippet('s1', '::quoteEN', 'EN', 'Q', 'quoteEN'))).toBe('u:u1|g:quoteen');
  });
  it('ignores a blank lang_group_id', () => {
    expect(snippetGroupKey(snippet('s1', '::quoteEN', 'EN', 'Q', '   '))).toBe('u:u1|b:quote');
  });
  it('falls back to the base trigger, then to the row id', () => {
    expect(snippetGroupKey(snippet('s1', '::quoteEN', 'EN', 'Q'))).toBe('u:u1|b:quote');
    expect(snippetGroupKey({ ...snippet('s1', '', 'EN', 'Q'), triggers: [] })).toBe('u:u1|r:s1');
  });
});

describe('resolveActiveVariant', () => {
  const bg = groupSnippetsByLanguage(liveLikeRows()).find((g) => g.key === 'u:u1|b:budgetstay')!;

  it('defaults to the English variant', () => {
    expect(resolveActiveVariant(bg, undefined).id).toBe('b1');
  });
  it('honors an explicit language', () => {
    expect(resolveActiveVariant(bg, 'ES').id).toBe('b2');
  });
  it('falls back to English when the language is absent from the group', () => {
    const noFr = groupSnippetsByLanguage([
      snippet('n1', '::nofr', 'EN', 'NO FR'),
      snippet('n2', '::nofr', 'IT', 'NO FR'),
    ]);
    expect(resolveActiveVariant(noFr[0]!, 'FR').id).toBe('n1');
  });
  it('falls back to the master when no English variant exists', () => {
    const noEn = groupSnippetsByLanguage([
      snippet('w1', '::withdraw', 'ES', 'RITIRARE'),
      snippet('w2', '::withdraw', 'IT', 'RITIRARE'),
    ]);
    expect(resolveActiveVariant(noEn[0]!, undefined).id).toBe('w1');
  });
});

// The dashboard writes ONE row per snippet and keeps every translation in that
// row's `bodies` map. Reading `language` alone reported those snippets as
// monolingual: TIME held EN/ES/FR/IT and showed two pills, BUDGET STAY held
// EN/ES/IT and showed none at all (live data, 2026-08-19 — 25 of 70 groups).
describe('groupSnippetsByLanguage — languages stored in bodies', () => {
  function withBodies(row: SnippetRow, bodies: Record<string, string>): SnippetRow {
    return { ...row, bodies };
  }

  it('surfaces languages that exist only in the bodies map', () => {
    const [group] = groupSnippetsByLanguage([
      withBodies(snippet('t1', '::time', 'ES', 'TIME'), {
        EN: 'english', ES: 'spanish', FR: 'french', IT: 'italian',
      }),
    ]);
    expect(group!.languages).toEqual(['EN', 'ES', 'IT', 'FR']);
  });

  it('maps a bodies-only language to the row that holds the text', () => {
    const [group] = groupSnippetsByLanguage([
      withBodies(snippet('t1', '::time', 'ES', 'TIME'), { ES: 'spanish', FR: 'french' }),
    ]);
    expect(group!.byLang.get('FR')!.id).toBe('t1');
    expect(resolveActiveVariant(group!, 'FR').id).toBe('t1');
  });

  it('lets a real sibling row win over another row bodies slot', () => {
    const [group] = groupSnippetsByLanguage([
      withBodies(snippet('t1', '::time', 'ES', 'TIME'), { ES: 'spanish', IT: 'from bodies' }),
      snippet('t2', '::time', 'IT', 'TIME'),
    ]);
    expect(group!.byLang.get('IT')!.id).toBe('t2');
  });

  it('ignores empty and whitespace-only bodies slots', () => {
    const [group] = groupSnippetsByLanguage([
      withBodies(snippet('t1', '::time', 'EN', 'TIME'), { EN: 'english', FR: '', IT: '   ' }),
    ]);
    expect(group!.languages).toEqual(['EN']);
  });
});

describe('resolveActiveLanguage', () => {
  it('keeps a requested language the group actually has', () => {
    const [group] = groupSnippetsByLanguage([
      { ...snippet('t1', '::time', 'ES', 'TIME'), bodies: { ES: 'es', FR: 'fr' } },
    ]);
    expect(resolveActiveLanguage(group!, 'FR')).toBe('FR');
  });
  it('drops a requested language the group does not have', () => {
    const [group] = groupSnippetsByLanguage([snippet('t1', '::time', 'EN', 'TIME')]);
    expect(resolveActiveLanguage(group!, 'FR')).toBe('EN');
  });
  it('falls back to the master language when there is no English', () => {
    const [group] = groupSnippetsByLanguage([snippet('t1', '::time', 'IT', 'TIME')]);
    expect(resolveActiveLanguage(group!, undefined)).toBe('IT');
  });
});

// Regressions from the 2026-08-19 P0 report. Each case is a real pair of rows
// pulled from production, not an invented one.
describe('groupSnippetsByLanguage — cross-snippet collisions', () => {
  it('does not strip a language code that is not the row\'s own language', () => {
    // "wait" is a French snippet. Stripping its trailing "IT" bases it to "wa"
    // and merges it with the unrelated "WA", so the folder list rendered
    // ATTESA RISPOSTA's name and shortcut on CLASS RENT A CAR's WHATSAPP row.
    const groups = groupSnippetsByLanguage([
      snippet('05cb46e5', 'WA', 'ES', 'WHATSAPP'),
      snippet('62e46f54', 'wait', 'FR', "ATTESA RISPOSTA PROPRIETA'"),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.master.name)).toEqual(['WHATSAPP', "ATTESA RISPOSTA PROPRIETA'"]);
  });

  it('still strips a language code that IS the row\'s own language', () => {
    const groups = groupSnippetsByLanguage([
      snippet('a1', '::air', 'ES', 'AEROPORTO'),
      snippet('a2', '::airIT', 'IT', 'AEROPORTO IT'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.languages).toEqual(['ES', 'IT']);
  });

  it('never merges rows owned by different people', () => {
    // Both admins of the same org own a snippet triggered "discount". A shared
    // folder does not move ownership, so these stay two snippets.
    const mine = snippet('d1', '::discount', 'EN', 'DISCOUNT');
    const theirs = { ...snippet('d2', '::discount', 'EN', 'DISCOUNT'), user_id: 'u2' };
    const groups = groupSnippetsByLanguage([mine, theirs]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.key)).toEqual(['u:u1|b:discount', 'u:u2|b:discount']);
  });

  it('keeps a lang_group_id apart from a base trigger spelled the same way', () => {
    // Live data: one row carries lang_group_id "budgetstay" while two unrelated
    // rows are simply triggered "budgetstay". Sharing one namespace collapsed
    // three snippets across three folders into a single card, which then showed
    // one snippet's English next to another snippet's Spanish.
    const groups = groupSnippetsByLanguage([
      snippet('s1778187494836c1g', 'budgetstay', 'ES', 'BUDGET STAY - NO A/C', 'budgetstay'),
      snippet('9a723b3c', 'budgetstay', 'FR', 'BUDGET STAY - NO A/C (OK 15/08)'),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.key)).toEqual(['u:u1|g:budgetstay', 'u:u1|b:budgetstay']);
  });
});
