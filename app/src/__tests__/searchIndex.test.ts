import { describe, expect, it } from 'vitest';
import {
  normalizeQuery,
  sectionForPath,
  spaceForPath,
  scoreMemoryItem,
  scorePrompt,
  scoreSnippet,
  scoreSpace,
  searchAll,
  type SearchLibrary,
} from '@/lib/searchIndex';
import type {
  MemoryItem,
  MemorySpace,
  Prompt,
  SnippetLanguage,
  SnippetRow,
} from '@/types/database';

function snippet(
  id: string,
  name: string,
  overrides: Partial<SnippetRow> = {},
): SnippetRow {
  return {
    id,
    user_id: 'u1',
    name,
    content: '',
    bodies: {},
    triggers: [`::${id}`],
    is_formula: false,
    formula: null,
    variables: {},
    folder_id: null,
    language: 'EN' as SnippetLanguage,
    lang_group_id: null,
    notion_page_id: null,
    pinned: false,
    is_active: true,
    alternative_queries: [],
    updated_at: '2026-09-01T00:00:00Z',
    updated_by: 'u1',
    folder_name: null,
    usage_count: 0,
    is_malformed: false,
    created_at: '2026-09-01T00:00:00Z',
    last_used_at: null,
    ...overrides,
  };
}

function prompt(id: string, name: string, overrides: Partial<Prompt> = {}): Prompt {
  return {
    id,
    user_id: 'u1',
    name,
    content: '',
    shortcut: null,
    type: 'one-shot',
    strategy_type: null,
    thinking_mode: null,
    preferred_model: null,
    complexity_level: null,
    intent_category: null,
    output_type: null,
    blocks: null,
    ask_user_questions: false,
    folder_id: null,
    notion_page_id: null,
    pinned: false,
    updated_at: '2026-09-01T00:00:00Z',
    updated_by: 'u1',
    last_used_at: null,
    created_at: '2026-09-01T00:00:00Z',
    usage_count: 0,
    is_malformed: false,
    ...overrides,
  };
}

function space(id: string, name: string, overrides: Partial<MemorySpace> = {}): MemorySpace {
  return {
    id,
    user_id: 'u1',
    name,
    description: '',
    ico: 'brain',
    is_default: false,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    deleted_at: null,
    ...overrides,
  };
}

function item(id: string, name: string, overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id,
    user_id: 'u1',
    space_id: 'space-1',
    name,
    summary: '',
    body: '',
    kind: 'fact',
    metadata: {},
    token_estimate: 1,
    pinned: false,
    priority: 0,
    content_hash: 'hash',
    source_id: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    deleted_at: null,
    ...overrides,
  };
}

function library(overrides: Partial<SearchLibrary> = {}): SearchLibrary {
  return {
    snippets: [],
    prompts: [],
    spaces: [],
    items: [],
    snippetLabels: () => [],
    promptLabels: () => [],
    ...overrides,
  };
}

describe('normalizeQuery', () => {
  it('trims and lowercases what was typed', () => {
    expect(normalizeQuery('  Invoice  ')).toBe('invoice');
  });

  it('collapses a whitespace-only query to empty', () => {
    expect(normalizeQuery('   ')).toBe('');
  });
});

describe('scoreSnippet', () => {
  it('matches the name', () => {
    expect(scoreSnippet(snippet('s1', 'Invoice reminder'), 'invoice')).toBeGreaterThan(0);
  });

  it('matches a trigger', () => {
    expect(scoreSnippet(snippet('s1', 'Reminder'), '::s1')).toBeGreaterThan(0);
  });

  it('matches a keyword synonym', () => {
    const row = snippet('s1', 'Reminder', { alternative_queries: ['chase payment'] });
    expect(scoreSnippet(row, 'chase')).toBeGreaterThan(0);
  });

  it('matches a label name', () => {
    expect(scoreSnippet(snippet('s1', 'Reminder'), 'urgent', ['Urgent'])).toBeGreaterThan(0);
  });

  // The behaviour change that came with the one search bar: a snippet used to be
  // unfindable by the words inside it, while a prompt already was.
  it('matches body text', () => {
    const row = snippet('s1', 'Reminder', { content: 'Your payment is overdue' });
    expect(scoreSnippet(row, 'overdue')).toBeGreaterThan(0);
  });

  it('matches a non-master language body', () => {
    const row = snippet('s1', 'Reminder', { bodies: { ES: 'pago vencido' } });
    expect(scoreSnippet(row, 'vencido')).toBeGreaterThan(0);
  });

  it('scores nothing for a miss or an empty query', () => {
    expect(scoreSnippet(snippet('s1', 'Reminder'), 'invoice')).toBe(0);
    expect(scoreSnippet(snippet('s1', 'Reminder'), '')).toBe(0);
  });

  it('ranks a name above body text', () => {
    const named = snippet('s1', 'Invoice');
    const mentioned = snippet('s2', 'Reminder', { content: 'send the invoice' });
    expect(scoreSnippet(named, 'invoice')).toBeGreaterThan(scoreSnippet(mentioned, 'invoice'));
  });

  it('ranks a name that starts with the query above one that merely contains it', () => {
    const starts = snippet('s1', 'Invoice reminder');
    const contains = snippet('s2', 'Late invoice');
    expect(scoreSnippet(starts, 'invoice')).toBeGreaterThan(scoreSnippet(contains, 'invoice'));
  });
});

describe('scorePrompt', () => {
  it('matches the name and the content', () => {
    expect(scorePrompt(prompt('p1', 'Summarise'), 'summ')).toBeGreaterThan(0);
    expect(scorePrompt(prompt('p1', 'X', { content: 'rewrite this' }), 'rewrite')).toBeGreaterThan(0);
  });

  it('matches a shortcut', () => {
    expect(scorePrompt(prompt('p1', 'X', { shortcut: 'sumup' }), 'sumup')).toBeGreaterThan(0);
  });

  it('matches a label name', () => {
    expect(scorePrompt(prompt('p1', 'X'), 'drafting', ['Drafting'])).toBeGreaterThan(0);
  });

  it('survives a null shortcut and a null intent', () => {
    expect(scorePrompt(prompt('p1', 'X'), 'anything')).toBe(0);
  });
});

describe('scoreMemoryItem and scoreSpace', () => {
  it('matches an item by name, summary and body', () => {
    expect(scoreMemoryItem(item('i1', 'Tone of voice'), 'tone')).toBeGreaterThan(0);
    expect(scoreMemoryItem(item('i1', 'X', { summary: 'how we write' }), 'write')).toBeGreaterThan(0);
    expect(scoreMemoryItem(item('i1', 'X', { body: 'never use jargon' }), 'jargon')).toBeGreaterThan(0);
  });

  it('matches an item by the name of the space holding it', () => {
    expect(scoreMemoryItem(item('i1', 'X'), 'clients', 'Clients')).toBeGreaterThan(0);
  });

  it('matches a space by name and description', () => {
    expect(scoreSpace(space('sp1', 'Clients'), 'clients')).toBeGreaterThan(0);
    expect(scoreSpace(space('sp1', 'X', { description: 'billing facts' }), 'billing')).toBeGreaterThan(0);
  });
});

describe('searchAll', () => {
  it('returns nothing for an empty query', () => {
    const results = searchAll(library({ snippets: [snippet('s1', 'Invoice')] }), '   ');
    expect(results.total).toBe(0);
  });

  it('groups results by type', () => {
    const results = searchAll(
      library({
        snippets: [snippet('s1', 'Invoice reminder')],
        prompts: [prompt('p1', 'Invoice summary')],
        spaces: [space('sp1', 'Invoices')],
      }),
      'invoice',
    );
    expect(results.snippets).toHaveLength(1);
    expect(results.prompts).toHaveLength(1);
    expect(results.memory).toHaveLength(1);
    expect(results.total).toBe(3);
  });

  // The table shows one row per language group, so the panel must agree with it.
  it('collapses language variants into one hit', () => {
    const results = searchAll(
      library({
        snippets: [
          snippet('s1', 'Invoice EN', { lang_group_id: 'inv', language: 'EN' }),
          snippet('s2', 'Invoice ES', { lang_group_id: 'inv', language: 'ES' }),
        ],
      }),
      'invoice',
    );
    expect(results.snippets).toHaveLength(1);
  });

  it('finds a group through a variant that is not the master', () => {
    const results = searchAll(
      library({
        snippets: [
          snippet('s1', 'Reminder', { lang_group_id: 'inv', language: 'EN' }),
          snippet('s2', 'Reminder', {
            lang_group_id: 'inv',
            language: 'ES',
            content: 'factura vencida',
          }),
        ],
      }),
      'factura',
    );
    expect(results.snippets).toHaveLength(1);
  });

  it('leaves trashed memory items out', () => {
    const results = searchAll(
      library({
        spaces: [space('space-1', 'Clients')],
        items: [
          item('i1', 'Live note', { body: 'invoice terms' }),
          item('i2', 'Trashed note', {
            body: 'invoice terms',
            deleted_at: '2026-09-02T00:00:00Z',
          }),
        ],
      }),
      'invoice terms',
    );
    expect(results.memory.map((hit) => hit.name)).toEqual(['Live note']);
  });

  it('names the space an item was found in', () => {
    const results = searchAll(
      library({
        spaces: [space('space-1', 'Clients')],
        items: [item('i1', 'Tone of voice')],
      }),
      'tone',
    );
    expect(results.memory[0]?.detail).toBe('Clients');
    expect(results.memory[0]?.spaceId).toBe('space-1');
  });

  it('puts the better match first within a type', () => {
    const results = searchAll(
      library({
        snippets: [
          snippet('s1', 'Late fee', { content: 'invoice attached' }),
          snippet('s2', 'Invoice reminder'),
        ],
      }),
      'invoice',
    );
    expect(results.snippets.map((hit) => hit.name)).toEqual(['Invoice reminder', 'Late fee']);
  });
});

describe('sectionForPath', () => {
  it('maps each section route to its type', () => {
    expect(sectionForPath('/')).toBe('snippet');
    expect(sectionForPath('/prompts')).toBe('prompt');
    expect(sectionForPath('/memory')).toBe('memory');
    expect(sectionForPath('/memory/space-1')).toBe('memory');
  });

  it('returns null on a page that holds none of the three', () => {
    expect(sectionForPath('/analytics')).toBeNull();
    expect(sectionForPath('/settings')).toBeNull();
    expect(sectionForPath('/team')).toBeNull();
  });
});

describe('spaceForPath', () => {
  it('picks out the space being viewed', () => {
    expect(spaceForPath('/memory/space-1')).toBe('space-1');
  });

  it('is null on the index and off the memory route', () => {
    expect(spaceForPath('/memory')).toBeNull();
    expect(spaceForPath('/prompts')).toBeNull();
  });
});
