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
// • Mobile     — snippets are READ-ONLY on the companion (delete was removed in
//                v2.100.0); a source-level guard asserts no snippet-delete wiring
//                exists so it cannot quietly come back.
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
  notion_page_id: null,
  pinned: false,
  is_active: true,
  enable_urgency_timer: false,
  timer_duration_ms: 0,
  scarcity_count: 0,
  alternative_queries: [],
  updated_at: '2026-01-01T00:00:00Z',
  updated_by: 'user-1',
  folder_name: null,
  usage_count: 0,
};

const SNIPPET_B: SnippetRow = { ...SNIPPET_A, id: 'snip-B', name: 'Snippet B', triggers: ['b'] };

const PROMPT_A: Prompt = {
  id: 'prompt-A',
  user_id: 'user-1',
  name: 'Prompt A',
  content: 'do the thing',
  shortcut: null,
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
  folder_id: null,
  notion_page_id: null,
  updated_at: '2026-01-01T00:00:00Z',
  updated_by: 'user-1',
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
    notionPushingIds: new Set(),
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
  // A successful hard delete returns the deleted row(s); snippet deletes now
  // `.select('id')` and treat an empty result as an RLS denial, so the default
  // must be non-empty for the success-path tests.
  sb.state.result = { data: [{ id: 'snip-A' }], error: null };
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
    // RLS governs ownership now — no `user_id` filter, so shared-folder members
    // can delete. `.select` reads the deleted id back to detect an RLS no-op.
    expect(q?.methods).toContain('select');
    expect(q?.filters).toEqual({ id: 'snip-A' });

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
    expect(q?.methods).toContain('select');
    expect(q?.filters).toEqual({ id: ['snip-A', 'snip-B'] });

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
  it('snippetsApi.deleteSnippet issues a hard delete scoped by id alone (RLS governs ownership)', async () => {
    await snippetsApi.deleteSnippet('snip-A');
    const q = sb.state.lastQuery;
    expect(q?.table).toBe('snippets');
    expect(q?.methods).toContain('delete');
    expect(q?.methods).not.toContain('update'); // never a soft-delete flag write
    expect(q?.methods).toContain('select'); // reads the deleted id back to detect RLS no-ops
    // No `user_id` filter: a shared-folder member must be able to delete via RLS.
    expect(q?.filters).toEqual({ id: 'snip-A' });
  });

  it('snippetsApi.deleteSnippet throws a clear error when RLS deletes no row', async () => {
    // The DELETE matches 0 rows with no DB error — exactly the shared-folder
    // denial the old owner-scoped filter hid as a silent no-op. It must surface
    // as an error, not resolve as if the delete had succeeded.
    sb.state.result = { data: [], error: null };
    await expect(snippetsApi.deleteSnippet('snip-A')).rejects.toThrow(/permission/i);
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
// POP-UP — the extension's delete helper, executed for real.
//
// The Chrome pop-up's delete logic is extracted into
// extension/popup/sync-deletion.js (a plain <script> that also exports via
// CommonJS). We require it directly through Node (bypassing Vite's module
// graph, since it lives outside the app/ root) and run it.
// ─────────────────────────────────────────────────────────────────────────────

interface PopupSync {
  snippetDeleteQuery(id: string): string;
  removeSnippetFromList<T extends { id: string }>(list: T[], id: string): T[];
  performSnippetDelete(
    supaFetch: (table: string, method: string, body: unknown, qs: string) => Promise<unknown>,
    id: string,
    onError?: (e: unknown) => void,
  ): Promise<unknown>;
}

// Load a plain-script CommonJS helper (the surfaces' sync-deletion.js) without
// going through Vite's module graph — Vitest would otherwise transform files
// under its root and mangle the `module.exports` assignment. Evaluating the
// source in a fresh module scope is location-independent and deterministic.
function loadHelper<T>(path: string): T {
  const src = readFileSync(path, 'utf8');
  const mod = { exports: {} as unknown };
  const run = new Function('module', 'exports', src) as (
    m: typeof mod,
    e: unknown,
  ) => void;
  run(mod, mod.exports);
  return mod.exports as T;
}

const popupSync = loadHelper<PopupSync>(
  resolve(process.cwd(), '..', 'extension', 'popup', 'sync-deletion.js'),
);

describe('pop-up · snippet deletion (live helper)', () => {
  it('builds a hard-delete query scoped to one row', () => {
    expect(popupSync.snippetDeleteQuery('snip-A')).toBe('id=eq.snip-A');
  });

  it('removes the deleted snippet from the local cache list', () => {
    const next = popupSync.removeSnippetFromList([{ id: 'snip-A' }, { id: 'snip-B' }], 'snip-A');
    expect(next.map((s) => s.id)).toEqual(['snip-B']);
  });

  it('issues a DELETE on the snippets table via supaFetch', async () => {
    const supaFetch = vi.fn().mockResolvedValue({ ok: true });
    await popupSync.performSnippetDelete(supaFetch, 'snip-A');
    expect(supaFetch).toHaveBeenCalledWith('snippets', 'DELETE', null, 'id=eq.snip-A');
  });

  it('reports backend failure through onError instead of throwing', async () => {
    const supaFetch = vi.fn().mockRejectedValue(new Error('offline'));
    const onError = vi.fn();
    await popupSync.performSnippetDelete(supaFetch, 'snip-A', onError);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// WIRING GUARD — the executed helpers above are only meaningful if production
// actually calls them. Assert each surface delegates to its sync helper (and
// loads it), so no surface can quietly re-inline a divergent delete path.
// ─────────────────────────────────────────────────────────────────────────────

describe('cross-surface wiring guard', () => {
  const popupJs = readFileSync(
    resolve(process.cwd(), '..', 'extension', 'popup', 'popup.js'),
    'utf8',
  );
  const popupHtml = readFileSync(
    resolve(process.cwd(), '..', 'extension', 'popup', 'popup.html'),
    'utf8',
  );
  const mobileHtml = readFileSync(resolve(process.cwd(), 'public', 'mobile', 'index.html'), 'utf8');

  it('pop-up delegates deletion to SBPopupSync and loads the helper', () => {
    expect(popupJs).toMatch(/SBPopupSync\.performSnippetDelete/);
    expect(popupJs).toMatch(/SBPopupSync\.removeSnippetFromList/);
    expect(popupHtml).toMatch(/<script src="sync-deletion\.js">/);
  });

  it('mobile stays read-only: no snippet-delete wiring exists', () => {
    // Snippet deletion was removed from the companion in v2.100.0 (read-only
    // surface). Guard the absence so a delete path cannot quietly return.
    expect(mobileHtml).not.toMatch(/SBMobileSync/);
    expect(mobileHtml).not.toMatch(/<script src="sync-deletion\.js">/);
    expect(mobileHtml).not.toMatch(/data-action="delete"/);
  });
});
