import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// Snippet / prompt DELETION SYNCHRONIZATION across the three surfaces.
//
// All three surfaces — the React dashboard, the Chrome extension pop-up, and the
// mobile companion — share ONE backend: the Supabase `snippets` / `prompts`
// tables. A delete on any surface is a HARD delete on the shared table, so the
// row disappears for every other surface on its next load. That shared hard
// delete IS the synchronization mechanism; these tests pin the contract.
//
// • Dashboard  — exercised end-to-end: real Zustand stores → real API layer →
//                a mocked Supabase client, asserting both the network operation
//                and the local-cache sync (store array + selection pruning,
//                with rollback on failure).
// • Pop-up     — extension/popup/popup.js (global-scope vanilla JS, not
//                importable into Vitest) is covered by a source-level parity
//                guard asserting it performs the same hard DELETE on `snippets`.
// • Mobile     — app/public/mobile/index.html (inline <script>, not importable)
//                is covered by the same parity guard.
// ─────────────────────────────────────────────────────────────────────────────

// Shared, reconfigurable Supabase mock. `vi.hoisted` so the factory below can
// reference it (vi.mock is hoisted above imports).
const sb = vi.hoisted(() => {
  interface RecordedQuery {
    table: string;
    methods: string[];
    filters: Record<string, unknown>;
  }
  const state = {
    // Result every awaited query resolves to. Set `{ error }` to simulate a
    // backend failure for rollback tests.
    result: { data: null as unknown, error: null as unknown },
    getUser: {
      data: { user: { id: 'user-1' } as { id: string } | null },
      error: null as unknown,
    },
    lastQuery: null as RecordedQuery | null,
  };

  function builder(table: string) {
    const q: RecordedQuery = { table, methods: [], filters: {} };
    state.lastQuery = q;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    const record =
      (name: string) =>
      (...args: unknown[]) => {
        q.methods.push(name);
        if ((name === 'eq' || name === 'in') && typeof args[0] === 'string') {
          q.filters[args[0]] = args[1];
        }
        return b;
      };
    for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'order', 'limit']) {
      b[m] = record(m);
    }
    b.single = () => Promise.resolve(state.result);
    b.maybeSingle = () => Promise.resolve(state.result);
    // Thenable: `await supabase.from(...).delete().eq(...)` resolves `result`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    b.then = (onFulfilled: any, onRejected: any) =>
      Promise.resolve(state.result).then(onFulfilled, onRejected);
    return b;
  }

  return { state, builder };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn(() => Promise.resolve(sb.state.getUser)) },
    from: vi.fn((table: string) => sb.builder(table)),
  },
}));

import { useSnippetStore } from '@/stores/snippetStore';
import { usePromptStore } from '@/stores/promptStore';
import { snippetsApi } from '@/lib/api/snippetsApi';
import { promptsApi } from '@/lib/api/promptsApi';
import type { Prompt, SnippetRow } from '@/types/database';

const SNIPPET_A: SnippetRow = {
  id: 'snip-A',
  user_id: 'user-1',
  name: 'Snippet A',
  content: 'aaa',
  bodies: { EN: 'aaa' },
  triggers: ['a'],
  tags: [],
  is_formula: false,
  formula: null,
  variables: {},
  folder_id: null,
  language: 'EN',
  is_shared: false,
  notion_page_id: null,
  pinned: false,
  is_active: true,
  enable_urgency_timer: false,
  timer_duration_ms: 0,
  scarcity_count: 0,
  alternative_queries: [],
  updated_at: '2026-01-01T00:00:00Z',
  folder_name: null,
  usage_count: 0,
};

const SNIPPET_B: SnippetRow = { ...SNIPPET_A, id: 'snip-B', name: 'Snippet B', triggers: ['b'] };

const PROMPT_A: Prompt = {
  id: 'prompt-A',
  user_id: 'user-1',
  name: 'Prompt A',
  content: 'do the thing',
  type: 'one-shot',
  tags: [],
  strategy_type: null,
  thinking_mode: null,
  preferred_model: null,
  complexity_level: null,
  execution_type: null,
  intent_category: null,
  output_type: null,
  blocks: null,
  updated_at: '2026-01-01T00:00:00Z',
  last_used_at: null,
};

const PROMPT_B: Prompt = { ...PROMPT_A, id: 'prompt-B', name: 'Prompt B' };

function resetSnippetStore(): void {
  useSnippetStore.setState({
    snippets: [SNIPPET_A, SNIPPET_B],
    folders: [],
    revisions: [],
    revisionsSnippetId: null,
    revisionsLoading: false,
    loading: false,
    error: null,
    selectedFolderId: null,
    searchQuery: '',
    sharingIds: new Set(),
    selectedIds: new Set(['snip-A', 'snip-B']),
    sortBy: 'updated_at',
    sortDir: 'desc',
    languageFilter: null,
    bulkMoving: false,
    bulkDeleting: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sb.state.result = { data: null, error: null };
  sb.state.getUser = { data: { user: { id: 'user-1' } }, error: null };
  sb.state.lastQuery = null;
  resetSnippetStore();
  usePromptStore.setState({ prompts: [PROMPT_A, PROMPT_B], error: null });
});

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD — store → API → backend, plus local-cache sync.
// ─────────────────────────────────────────────────────────────────────────────

describe('dashboard · snippet deletion sync', () => {
  it('hard-deletes the row from the backend and prunes it from store + selection', async () => {
    await useSnippetStore.getState().removeSnippet('snip-A');

    const q = sb.state.lastQuery;
    expect(q?.table).toBe('snippets');
    expect(q?.methods).toContain('delete');
    expect(q?.filters).toMatchObject({ id: 'snip-A', user_id: 'user-1' });

    const state = useSnippetStore.getState();
    expect(state.snippets.map((s) => s.id)).toEqual(['snip-B']);
    expect(state.selectedIds.has('snip-A')).toBe(false);
    expect(state.error).toBeNull();
  });

  it('keeps the row locally and surfaces an error when the backend delete fails', async () => {
    sb.state.result = { data: null, error: new Error('Network error') };

    await expect(useSnippetStore.getState().removeSnippet('snip-A')).rejects.toThrow(
      'Network error',
    );

    const state = useSnippetStore.getState();
    // No optimistic removal — the row must remain so the surface stays consistent
    // with the still-present backend row.
    expect(state.snippets.map((s) => s.id)).toEqual(['snip-A', 'snip-B']);
    expect(state.error).toBe('Network error');
  });
});

describe('dashboard · bulk snippet deletion sync', () => {
  it('hard-deletes every id in one request and clears the selection', async () => {
    await useSnippetStore.getState().bulkDeleteSnippets(['snip-A', 'snip-B']);

    const q = sb.state.lastQuery;
    expect(q?.table).toBe('snippets');
    expect(q?.methods).toContain('delete');
    expect(q?.filters).toMatchObject({ id: ['snip-A', 'snip-B'], user_id: 'user-1' });

    const state = useSnippetStore.getState();
    expect(state.snippets).toEqual([]);
    expect(state.selectedIds.size).toBe(0);
    expect(state.bulkDeleting).toBe(false);
  });

  it('rolls the optimistic removal back when the backend rejects', async () => {
    sb.state.result = { data: null, error: new Error('boom') };

    await expect(
      useSnippetStore.getState().bulkDeleteSnippets(['snip-A', 'snip-B']),
    ).rejects.toThrow('boom');

    const state = useSnippetStore.getState();
    expect(state.snippets.map((s) => s.id)).toEqual(['snip-A', 'snip-B']);
    expect(state.bulkDeleting).toBe(false);
    expect(state.error).toBe('boom');
  });
});

describe('dashboard · prompt deletion sync', () => {
  it('hard-deletes the prompt from the backend and prunes it from the store', async () => {
    await usePromptStore.getState().removePrompt('prompt-A');

    const q = sb.state.lastQuery;
    expect(q?.table).toBe('prompts');
    expect(q?.methods).toContain('delete');
    expect(q?.filters).toMatchObject({ id: 'prompt-A', user_id: 'user-1' });

    const state = usePromptStore.getState();
    expect(state.prompts.map((p) => p.id)).toEqual(['prompt-B']);
    expect(state.error).toBeNull();
  });

  it('keeps the prompt locally and surfaces an error when the backend delete fails', async () => {
    sb.state.result = { data: null, error: new Error('offline') };

    await expect(usePromptStore.getState().removePrompt('prompt-A')).rejects.toThrow('offline');

    const state = usePromptStore.getState();
    expect(state.prompts.map((p) => p.id)).toEqual(['prompt-A', 'prompt-B']);
    expect(state.error).toBe('offline');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SHARED CONTRACT — the canonical API operation every surface relies on.
// ─────────────────────────────────────────────────────────────────────────────

describe('shared backend contract', () => {
  it('snippetsApi.deleteSnippet issues a hard delete scoped by id + user_id', async () => {
    await snippetsApi.deleteSnippet('snip-A');
    const q = sb.state.lastQuery;
    expect(q?.table).toBe('snippets');
    expect(q?.methods).toContain('delete');
    expect(q?.methods).not.toContain('update'); // never a soft-delete flag write
    expect(q?.filters).toEqual({ id: 'snip-A', user_id: 'user-1' });
  });

  it('promptsApi.deletePrompt issues a hard delete scoped by id + user_id', async () => {
    await promptsApi.deletePrompt('prompt-A');
    const q = sb.state.lastQuery;
    expect(q?.table).toBe('prompts');
    expect(q?.methods).toContain('delete');
    expect(q?.methods).not.toContain('update');
    expect(q?.filters).toEqual({ id: 'prompt-A', user_id: 'user-1' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CROSS-SURFACE PARITY GUARD — pop-up and mobile share the same hard-delete
// contract. They are global-scope vanilla JS (not importable into Vitest), so
// we assert their delete path at the source level. This catches any surface
// drifting to a soft-delete (e.g. a `deleted_at` flag), which would silently
// break synchronization with the hard-deleting dashboard.
// ─────────────────────────────────────────────────────────────────────────────

describe('cross-surface parity · pop-up + mobile hard-delete snippets', () => {
  const popupSrc = readFileSync(
    resolve(process.cwd(), '..', 'extension', 'popup', 'popup.js'),
    'utf8',
  );
  const mobileSrc = readFileSync(
    resolve(process.cwd(), 'public', 'mobile', 'index.html'),
    'utf8',
  );

  it('pop-up deletes via a DELETE on the snippets table scoped by id', () => {
    expect(popupSrc).toMatch(/supaFetch\(\s*['"]snippets['"]\s*,\s*['"]DELETE['"]/);
    expect(popupSrc).toMatch(/['"]id=eq\.['"]\s*\+\s*id/);
  });

  it('mobile deletes via a DELETE on the snippets table scoped by id', () => {
    expect(mobileSrc).toMatch(/\/rest\/v1\/snippets\?id=eq\./);
    expect(mobileSrc).toMatch(/method\s*:\s*['"]DELETE['"]/);
  });
});
