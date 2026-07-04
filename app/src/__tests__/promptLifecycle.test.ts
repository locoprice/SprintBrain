import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/promptsApi', () => ({
  promptsApi: {
    listPrompts: vi.fn().mockResolvedValue([]),
    createPrompt: vi.fn(),
    updatePrompt: vi.fn(),
    deletePrompt: vi.fn(),
    markUsed: vi.fn(),
    pushToNotion: vi.fn(),
  },
}));

import { usePromptStore } from '@/stores/promptStore';
import { promptsApi } from '@/lib/api/promptsApi';
import type { Prompt } from '@/types/database';

const mockCreate = vi.mocked(promptsApi.createPrompt);
const mockUpdate = vi.mocked(promptsApi.updatePrompt);
const mockDelete = vi.mocked(promptsApi.deletePrompt);
const mockPush = vi.mocked(promptsApi.pushToNotion);

const PROMPT_ID = 'prompt-lifecycle-001';
const NOTION_PAGE_ID = 'notion-page-abc123';

const BASE_PROMPT: Prompt = {
  id: PROMPT_ID,
  user_id: 'user-001',
  name: 'Reservation Confirmation Template',
  content: 'Dear {{guest}}, your reservation for {{date}} is confirmed.',
  shortcut: null,
  type: 'one-shot',
  tags: ['reservations', 'confirmations'],
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
  updated_at: '2026-06-19T00:00:00Z',
  last_used_at: null,
};

const SYNCED_PROMPT: Prompt = { ...BASE_PROMPT, notion_page_id: NOTION_PAGE_ID };

const MODIFIED_PROMPT: Prompt = {
  ...SYNCED_PROMPT,
  name: 'Reservation Confirmation (Revised)',
  updated_at: '2026-06-19T01:00:00Z',
};

const CREATE_PAYLOAD = {
  name: 'Reservation Confirmation Template',
  content: 'Dear {{guest}}, your reservation for {{date}} is confirmed.',
  type: 'one-shot' as const,
  tags: ['reservations', 'confirmations'],
  strategy_type: null,
  thinking_mode: null,
  preferred_model: null,
  complexity_level: null,
  execution_type: null,
  intent_category: null,
  output_type: null,
  blocks: null,
  folder_id: null,
};

describe('Prompt lifecycle — create → sync → modify → delete', () => {
  beforeEach(() => {
    usePromptStore.setState({
      prompts: [],
      loading: false,
      error: null,
      notionPushingIds: new Set(),
    });
    vi.clearAllMocks();
  });

  it('1 — create: prompt appears in store with notion_page_id null', async () => {
    mockCreate.mockResolvedValue(BASE_PROMPT);

    const result = await usePromptStore.getState().addPrompt(CREATE_PAYLOAD);

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(result.id).toBe(PROMPT_ID);
    expect(result.notion_page_id).toBeNull();

    const state = usePromptStore.getState();
    expect(state.prompts).toHaveLength(1);
    expect(state.prompts[0]!.notion_page_id).toBeNull();
    expect(state.error).toBeNull();
  });

  it('2 — sync: pushPromptToNotion writes notion_page_id and clears pushing state', async () => {
    usePromptStore.setState({ prompts: [BASE_PROMPT] });
    mockPush.mockResolvedValue({ notion_page_id: NOTION_PAGE_ID });

    await usePromptStore.getState().pushPromptToNotion(PROMPT_ID);

    expect(mockPush).toHaveBeenCalledOnce();
    expect(mockPush).toHaveBeenCalledWith(PROMPT_ID);

    const state = usePromptStore.getState();
    expect(state.prompts[0]!.notion_page_id).toBe(NOTION_PAGE_ID);
    expect(state.notionPushingIds.has(PROMPT_ID)).toBe(false);
    expect(state.error).toBeNull();
  });

  it('3 — modify: editPrompt updates the prompt name in the store', async () => {
    usePromptStore.setState({ prompts: [SYNCED_PROMPT] });
    mockUpdate.mockResolvedValue(MODIFIED_PROMPT);

    const result = await usePromptStore
      .getState()
      .editPrompt(PROMPT_ID, { name: 'Reservation Confirmation (Revised)' });

    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(result.name).toBe('Reservation Confirmation (Revised)');

    const state = usePromptStore.getState();
    expect(state.prompts[0]!.name).toBe('Reservation Confirmation (Revised)');
    expect(state.error).toBeNull();
  });

  it('4 — delete: removePrompt removes the prompt from the store', async () => {
    usePromptStore.setState({ prompts: [MODIFIED_PROMPT] });
    mockDelete.mockResolvedValue(undefined);

    await usePromptStore.getState().removePrompt(PROMPT_ID);

    expect(mockDelete).toHaveBeenCalledOnce();
    expect(mockDelete).toHaveBeenCalledWith(PROMPT_ID);

    const state = usePromptStore.getState();
    expect(state.prompts).toHaveLength(0);
    expect(state.error).toBeNull();
  });

  it('Full execution trace — sequential create → sync → modify → delete', async () => {
    // Phase A: create
    mockCreate.mockResolvedValue(BASE_PROMPT);
    await usePromptStore.getState().addPrompt(CREATE_PAYLOAD);

    let state = usePromptStore.getState();
    expect(state.prompts).toHaveLength(1);
    expect(state.prompts[0]!.notion_page_id).toBeNull();
    expect(state.error).toBeNull();

    // Phase B: sync with team Notion DB
    mockPush.mockResolvedValue({ notion_page_id: NOTION_PAGE_ID });
    await usePromptStore.getState().pushPromptToNotion(PROMPT_ID);

    state = usePromptStore.getState();
    expect(state.prompts[0]!.notion_page_id).toBe(NOTION_PAGE_ID);
    expect(state.notionPushingIds.size).toBe(0);
    expect(state.error).toBeNull();

    // Phase C: modify
    mockUpdate.mockResolvedValue(MODIFIED_PROMPT);
    await usePromptStore
      .getState()
      .editPrompt(PROMPT_ID, { name: 'Reservation Confirmation (Revised)' });

    state = usePromptStore.getState();
    expect(state.prompts[0]!.name).toBe('Reservation Confirmation (Revised)');
    expect(state.error).toBeNull();

    // Phase D: delete
    mockDelete.mockResolvedValue(undefined);
    await usePromptStore.getState().removePrompt(PROMPT_ID);

    state = usePromptStore.getState();
    expect(state.prompts).toHaveLength(0);
    expect(state.error).toBeNull();
  });

  it('Sync error — pushPromptToNotion surfaces error, notion_page_id unchanged', async () => {
    usePromptStore.setState({ prompts: [BASE_PROMPT] });
    mockPush.mockRejectedValue(new Error('notion-prompt-push returned unexpected response'));

    await expect(
      usePromptStore.getState().pushPromptToNotion(PROMPT_ID),
    ).rejects.toThrow('notion-prompt-push returned unexpected response');

    const state = usePromptStore.getState();
    expect(state.prompts[0]!.notion_page_id).toBeNull();
    expect(state.notionPushingIds.has(PROMPT_ID)).toBe(false);
    expect(state.error).toBe('notion-prompt-push returned unexpected response');
  });
});
