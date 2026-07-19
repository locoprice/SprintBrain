import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the API modules before importing the store — vitest hoists these.
vi.mock('@/lib/api/revisionsApi', () => ({
  revisionsApi: {
    listRevisions: vi.fn(),
    saveWithRevision: vi.fn(),
  },
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

import { useSnippetStore } from '@/stores/snippetStore';
import { revisionsApi } from '@/lib/api/revisionsApi';
import type { SnippetRevision, SnippetRow } from '@/types/database';
import type { SnippetFormValues } from '@/types/schemas';

const mockListRevisions = vi.mocked(revisionsApi.listRevisions);
const mockSaveWithRevision = vi.mocked(revisionsApi.saveWithRevision);

const MOCK_SNIPPET: SnippetRow = {
  id: 'snippet-1',
  user_id: 'user-1',
  name: 'Test Snippet',
  content: 'Hello world',
  bodies: { EN: 'Hello world' },
  triggers: ['hw'],
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

const MOCK_REVISION: SnippetRevision = {
  id: 'rev-1',
  snippet_id: 'snippet-1',
  version_number: 1,
  editor_id: 'user-1',
  editor_display: 'valentina@leibtour.com',
  title: 'Test Snippet',
  body: 'Hello world',
  bodies: { EN: 'Hello world' },
  edit_note: null,
  created_at: '2026-01-01T00:00:00Z',
};

const PATCH: SnippetFormValues = {
  name: 'Updated Snippet',
  trigger: 'hw',
  content: 'Hello updated',
  bodies: { EN: 'Hello updated' },
  folder_id: null,
  language: 'EN',
  pinned: false,
  enable_urgency_timer: false,
  timer_duration_ms: 0,
  scarcity_count: 0,
  alternative_queries: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  useSnippetStore.setState({
    snippets: [MOCK_SNIPPET],
    folders: [],
    revisions: [],
    revisionsSnippetId: null,
    revisionsLoading: false,
    loading: false,
    error: null,
    selectedFolderId: null,
    searchQuery: '',
    notionPushingIds: new Set(),
    selectedIds: new Set(),
    sortBy: 'updated_at',
    sortDir: 'desc',
    languageFilter: null,
    bulkMoving: false,
    bulkDeleting: false,
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('loadRevisions', () => {
  it('populates revisions and sets revisionsSnippetId on success', async () => {
    mockListRevisions.mockResolvedValueOnce([MOCK_REVISION]);

    await useSnippetStore.getState().loadRevisions('snippet-1');

    const state = useSnippetStore.getState();
    expect(state.revisions).toEqual([MOCK_REVISION]);
    expect(state.revisionsSnippetId).toBe('snippet-1');
    expect(state.revisionsLoading).toBe(false);
  });

  it('sets error and clears loading flag on failure', async () => {
    mockListRevisions.mockRejectedValueOnce(new Error('Network error'));

    await useSnippetStore.getState().loadRevisions('snippet-1');

    const state = useSnippetStore.getState();
    expect(state.error).toBe('Network error');
    expect(state.revisionsLoading).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('editSnippetWithRevision', () => {
  it('updates the snippet in the store on success', async () => {
    mockSaveWithRevision.mockResolvedValueOnce(2);

    const result = await useSnippetStore
      .getState()
      .editSnippetWithRevision('snippet-1', PATCH, 'Updated wording');

    const state = useSnippetStore.getState();
    expect(state.snippets[0]?.name).toBe('Updated Snippet');
    expect(state.snippets[0]?.content).toBe('Hello updated');
    expect(result.name).toBe('Updated Snippet');
  });

  it('invalidates the revision cache when the cache belongs to the saved snippet', async () => {
    useSnippetStore.setState({ revisionsSnippetId: 'snippet-1', revisions: [MOCK_REVISION] });
    mockSaveWithRevision.mockResolvedValueOnce(2);

    await useSnippetStore.getState().editSnippetWithRevision('snippet-1', PATCH);

    const state = useSnippetStore.getState();
    expect(state.revisionsSnippetId).toBeNull();
    expect(state.revisions).toEqual([]);
  });

  it('does not invalidate the revision cache when it belongs to a different snippet', async () => {
    useSnippetStore.setState({ revisionsSnippetId: 'snippet-2', revisions: [MOCK_REVISION] });
    mockSaveWithRevision.mockResolvedValueOnce(2);

    await useSnippetStore.getState().editSnippetWithRevision('snippet-1', PATCH);

    const state = useSnippetStore.getState();
    expect(state.revisionsSnippetId).toBe('snippet-2');
    expect(state.revisions).toEqual([MOCK_REVISION]);
  });

  it('throws and sets error on API failure', async () => {
    mockSaveWithRevision.mockRejectedValueOnce(new Error('Save failed'));

    await expect(
      useSnippetStore.getState().editSnippetWithRevision('snippet-1', PATCH),
    ).rejects.toThrow('Save failed');

    expect(useSnippetStore.getState().error).toBe('Save failed');
  });

  it('throws when the snippet is not found in the store', async () => {
    useSnippetStore.setState({ snippets: [] });

    await expect(
      useSnippetStore.getState().editSnippetWithRevision('unknown-id', PATCH),
    ).rejects.toThrow('Snippet not found');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('restoreRevision', () => {
  it('calls saveWithRevision with the revision body and a restore edit note', async () => {
    mockSaveWithRevision.mockResolvedValueOnce(3);
    mockListRevisions.mockResolvedValueOnce([MOCK_REVISION]);
    useSnippetStore.setState({ revisionsSnippetId: 'snippet-1' });

    await useSnippetStore.getState().restoreRevision('snippet-1', MOCK_REVISION);

    expect(mockSaveWithRevision).toHaveBeenCalledWith(
      'snippet-1',
      expect.objectContaining({
        body: MOCK_REVISION.body,
        title: MOCK_REVISION.title,
      }),
      'Restored from v1',
    );
  });

  it('updates the snippet name and body in the store', async () => {
    const oldRevision: SnippetRevision = {
      ...MOCK_REVISION,
      version_number: 1,
      title: 'Old Title',
      body: 'Old body content',
      bodies: { EN: 'Old body content' },
    };
    mockSaveWithRevision.mockResolvedValueOnce(3);
    mockListRevisions.mockResolvedValueOnce([oldRevision]);
    useSnippetStore.setState({ revisionsSnippetId: 'snippet-1' });

    await useSnippetStore.getState().restoreRevision('snippet-1', oldRevision);

    const snippet = useSnippetStore.getState().snippets[0];
    expect(snippet?.name).toBe('Old Title');
    expect(snippet?.content).toBe('Old body content');
  });

  it('refreshes revisions list after restoring when history panel is open for this snippet', async () => {
    mockSaveWithRevision.mockResolvedValueOnce(3);
    mockListRevisions.mockResolvedValueOnce([MOCK_REVISION]);
    useSnippetStore.setState({ revisionsSnippetId: 'snippet-1' });

    await useSnippetStore.getState().restoreRevision('snippet-1', MOCK_REVISION);

    expect(mockListRevisions).toHaveBeenCalledWith('snippet-1');
  });

  it('does not call loadRevisions when history panel is open for a different snippet', async () => {
    mockSaveWithRevision.mockResolvedValueOnce(3);
    useSnippetStore.setState({ revisionsSnippetId: 'snippet-2' });

    await useSnippetStore.getState().restoreRevision('snippet-1', MOCK_REVISION);

    expect(mockListRevisions).not.toHaveBeenCalled();
  });
});
