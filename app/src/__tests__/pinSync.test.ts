import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks are hoisted above the store imports by vitest.
vi.mock('@/lib/api/promptsApi', () => ({
  promptsApi: {
    listPrompts: vi.fn().mockResolvedValue([]),
    createPrompt: vi.fn(),
    updatePrompt: vi.fn(),
    deletePrompt: vi.fn(),
    setPinned: vi.fn(),
    markUsed: vi.fn(),
    pushToNotion: vi.fn(),
  },
}));

vi.mock('@/lib/api/revisionsApi', () => ({
  revisionsApi: { listRevisions: vi.fn(), saveWithRevision: vi.fn() },
}));

vi.mock('@/lib/api/snippetsApi', () => ({
  snippetsApi: {
    listFolders: vi.fn().mockResolvedValue([]),
    listSnippets: vi.fn().mockResolvedValue([]),
    createSnippet: vi.fn(),
    updateSnippet: vi.fn(),
    deleteSnippet: vi.fn(),
    setPinned: vi.fn(),
    setActive: vi.fn(),
    duplicateSnippet: vi.fn(),
    createFolder: vi.fn(),
    updateFolder: vi.fn(),
    deleteFolder: vi.fn(),
    pushToNotion: vi.fn(),
    bulkMoveSnippets: vi.fn(),
    bulkDeleteSnippets: vi.fn(),
  },
}));

import { usePromptStore } from '@/stores/promptStore';
import { useSnippetStore } from '@/stores/snippetStore';
import { promptsApi } from '@/lib/api/promptsApi';
import { snippetsApi } from '@/lib/api/snippetsApi';
import type { Prompt, SnippetRow } from '@/types/database';

const mockPromptSetPinned = vi.mocked(promptsApi.setPinned);
const mockSnippetSetPinned = vi.mocked(snippetsApi.setPinned);

const PROMPT: Prompt = {
  id: 'p1',
  user_id: 'u1',
  name: 'Reply draft',
  content: 'hello',
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
  pinned: false,
  updated_at: '2026-01-01T00:00:00Z',
  updated_by: 'u1',
  last_used_at: null,
  usage_count: 0,
  is_malformed: false,
};

function snippetRow(id: string, lang: SnippetRow['language']): SnippetRow {
  return {
    id,
    user_id: 'u1',
    name: `Greeting ${lang}`,
    content: 'hi',
    bodies: { [lang]: 'hi' },
    triggers: ['greet'],
    is_formula: false,
    formula: null,
    variables: {},
    folder_id: null,
    language: lang,
    lang_group_id: 'grp1',
    notion_page_id: null,
    pinned: false,
    is_active: true,
    enable_urgency_timer: false,
    timer_duration_ms: 0,
    scarcity_count: 0,
    alternative_queries: [],
    updated_at: '2026-01-01T00:00:00Z',
    updated_by: 'u1',
    folder_name: null,
    usage_count: 0,
    is_malformed: false,
  };
}

describe('prompt pin — cross-surface sync via prompts.pinned', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptStore.setState({ prompts: [{ ...PROMPT }], error: null });
  });

  it('persists the pin through promptsApi.setPinned and reflects the returned row', async () => {
    mockPromptSetPinned.mockResolvedValue({ ...PROMPT, pinned: true });

    await usePromptStore.getState().togglePin('p1');

    expect(mockPromptSetPinned).toHaveBeenCalledWith('p1', true);
    expect(usePromptStore.getState().prompts[0]!.pinned).toBe(true);
    expect(usePromptStore.getState().error).toBeNull();
  });

  it('rolls the optimistic flag back when the save fails', async () => {
    mockPromptSetPinned.mockRejectedValue(new Error('offline'));

    await expect(usePromptStore.getState().togglePin('p1')).rejects.toThrow('offline');

    expect(usePromptStore.getState().prompts[0]!.pinned).toBe(false);
    expect(usePromptStore.getState().error).toBe('offline');
  });
});

describe('snippet pin — whole language group pins as a unit', () => {
  const rowEN = snippetRow('s-en', 'EN');
  const rowES = snippetRow('s-es', 'ES');

  beforeEach(() => {
    vi.clearAllMocks();
    useSnippetStore.setState({ snippets: [{ ...rowEN }, { ...rowES }], folders: [], error: null });
  });

  it('sends every variant id to setPinned and pins them all in the store', async () => {
    mockSnippetSetPinned.mockResolvedValue([
      { ...rowEN, pinned: true },
      { ...rowES, pinned: true },
    ]);

    await useSnippetStore.getState().togglePin('s-en');

    expect(mockSnippetSetPinned).toHaveBeenCalledTimes(1);
    const [ids, pinned] = mockSnippetSetPinned.mock.calls[0]!;
    expect(pinned).toBe(true);
    expect([...(ids as string[])].sort()).toEqual(['s-en', 's-es']);
    expect(useSnippetStore.getState().snippets.every((s) => s.pinned)).toBe(true);
  });

  it('rolls the whole group back when the save fails', async () => {
    mockSnippetSetPinned.mockRejectedValue(new Error('rls'));

    await expect(useSnippetStore.getState().togglePin('s-es')).rejects.toThrow('rls');

    expect(useSnippetStore.getState().snippets.every((s) => s.pinned === false)).toBe(true);
    expect(useSnippetStore.getState().error).toBe('rls');
  });
});
