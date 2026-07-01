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

vi.mock('@/lib/api/foldersApi', () => ({
  foldersApi: {
    listFolders: vi.fn().mockResolvedValue([]),
    createFolder: vi.fn(),
    updateFolder: vi.fn(),
    deleteFolder: vi.fn(),
  },
}));

import { usePromptStore } from '@/stores/promptStore';
import { foldersApi } from '@/lib/api/foldersApi';
import type { Folder, Prompt } from '@/types/database';

const mockCreateFolder = vi.mocked(foldersApi.createFolder);
const mockUpdateFolder = vi.mocked(foldersApi.updateFolder);
const mockDeleteFolder = vi.mocked(foldersApi.deleteFolder);

const FOLDER: Folder = {
  id: 'folder-1',
  user_id: 'user-1',
  name: 'Reservations',
  icon: '📋',
  sort_order: 1,
  updated_at: '2026-06-19T00:00:00Z',
};

const PROMPT_IN_FOLDER: Prompt = {
  id: 'prompt-1',
  user_id: 'user-1',
  name: 'Confirmation',
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
  folder_id: 'folder-1',
  notion_page_id: null,
  updated_at: '2026-06-19T00:00:00Z',
  last_used_at: null,
};

describe('promptStore — folder actions', () => {
  beforeEach(() => {
    usePromptStore.setState({
      prompts: [],
      folders: [],
      folderShares: new Map(),
      selectedFolderId: null,
      error: null,
    });
    vi.clearAllMocks();
  });

  it('addFolder appends the folder to the store', async () => {
    mockCreateFolder.mockResolvedValue(FOLDER);

    const result = await usePromptStore.getState().addFolder({ name: 'Reservations', icon: '📋' });

    expect(mockCreateFolder).toHaveBeenCalledOnce();
    expect(result.id).toBe('folder-1');
    expect(usePromptStore.getState().folders).toHaveLength(1);
    expect(usePromptStore.getState().error).toBeNull();
  });

  it('editFolder replaces the folder in the store', async () => {
    usePromptStore.setState({ folders: [FOLDER] });
    const renamed: Folder = { ...FOLDER, name: 'Bookings' };
    mockUpdateFolder.mockResolvedValue(renamed);

    await usePromptStore.getState().editFolder('folder-1', { name: 'Bookings' });

    expect(mockUpdateFolder).toHaveBeenCalledOnce();
    expect(usePromptStore.getState().folders[0]!.name).toBe('Bookings');
  });

  it('removeFolder drops the folder, nulls its prompts, and clears selection', async () => {
    usePromptStore.setState({
      folders: [FOLDER],
      prompts: [PROMPT_IN_FOLDER],
      selectedFolderId: 'folder-1',
    });
    mockDeleteFolder.mockResolvedValue(undefined);

    await usePromptStore.getState().removeFolder('folder-1');

    expect(mockDeleteFolder).toHaveBeenCalledWith('folder-1');
    const state = usePromptStore.getState();
    expect(state.folders).toHaveLength(0);
    expect(state.prompts[0]!.folder_id).toBeNull();
    expect(state.selectedFolderId).toBeNull();
    expect(state.error).toBeNull();
  });

  it('removeFolder keeps an unrelated folder selection intact', async () => {
    usePromptStore.setState({
      folders: [FOLDER],
      prompts: [PROMPT_IN_FOLDER],
      selectedFolderId: 'folder-2',
    });
    mockDeleteFolder.mockResolvedValue(undefined);

    await usePromptStore.getState().removeFolder('folder-1');

    expect(usePromptStore.getState().selectedFolderId).toBe('folder-2');
  });

  it('folder action surfaces an error without throwing the store into a bad state', async () => {
    mockCreateFolder.mockRejectedValue(new Error('Failed to create folder'));

    await expect(
      usePromptStore.getState().addFolder({ name: 'x', icon: '📋' }),
    ).rejects.toThrow('Failed to create folder');

    expect(usePromptStore.getState().folders).toHaveLength(0);
    expect(usePromptStore.getState().error).toBe('Failed to create folder');
  });
});
