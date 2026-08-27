import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the API before importing the store — vitest hoists these.
vi.mock('@/lib/api/memoryApi', () => ({
  memoryApi: {
    listSpaces: vi.fn(),
    spaceTotals: vi.fn(),
    createSpace: vi.fn(),
    updateSpace: vi.fn(),
    trashSpace: vi.fn(),
    restoreSpace: vi.fn(),
    listItems: vi.fn(),
    saveItem: vi.fn(),
    trashItem: vi.fn(),
    restoreItem: vi.fn(),
  },
}));

import { useMemoryStore } from '@/stores/memoryStore';
import { memoryApi } from '@/lib/api/memoryApi';
import { resolveSpaceIconKey, DEFAULT_SPACE_ICON } from '@/features/memory/spaceIcon';
import type { MemoryItem, MemorySpace } from '@/types/database';

const mockListSpaces = vi.mocked(memoryApi.listSpaces);
const mockSpaceTotals = vi.mocked(memoryApi.spaceTotals);
const mockListItems = vi.mocked(memoryApi.listItems);
const mockTrashItem = vi.mocked(memoryApi.trashItem);
const mockRestoreItem = vi.mocked(memoryApi.restoreItem);
const mockSaveItem = vi.mocked(memoryApi.saveItem);

function space(id: string, name: string, overrides: Partial<MemorySpace> = {}): MemorySpace {
  return {
    id,
    user_id: 'user-1',
    name,
    description: '',
    ico: 'brain',
    is_default: false,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    deleted_at: null,
    ...overrides,
  };
}

function item(id: string, name: string, overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id,
    user_id: 'user-1',
    space_id: 'space-1',
    name,
    summary: '',
    body: 'body',
    kind: 'fact',
    metadata: {},
    token_estimate: 1,
    pinned: false,
    priority: 0,
    content_hash: 'hash',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    deleted_at: null,
    ...overrides,
  };
}

function reset() {
  useMemoryStore.setState({
    spaces: [],
    totals: new Map(),
    items: [],
    activeSpaceId: null,
    showTrashed: false,
    loadingSpaces: false,
    loadingItems: false,
    loaded: false,
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  reset();
  mockSpaceTotals.mockResolvedValue(new Map());
  mockListItems.mockResolvedValue([]);
});

describe('resolveSpaceIconKey', () => {
  it('accepts a known key', () => {
    expect(resolveSpaceIconKey('gavel')).toBe('gavel');
  });

  it('falls back for an unknown value rather than throwing', () => {
    // The column is free text at the database level, so anything can arrive.
    expect(resolveSpaceIconKey('not-a-key')).toBe(DEFAULT_SPACE_ICON);
    expect(resolveSpaceIconKey(null)).toBe(DEFAULT_SPACE_ICON);
    expect(resolveSpaceIconKey(undefined)).toBe(DEFAULT_SPACE_ICON);
    expect(resolveSpaceIconKey('')).toBe(DEFAULT_SPACE_ICON);
  });

  it('matches the migration default', () => {
    expect(DEFAULT_SPACE_ICON).toBe('brain');
  });
});

describe('loadSpaces', () => {
  it('puts the default space first, then sorts by name', async () => {
    mockListSpaces.mockResolvedValue([
      space('c', 'Zulu'),
      space('a', 'Personal', { is_default: true }),
      space('b', 'Alpha'),
    ]);

    await useMemoryStore.getState().loadSpaces();

    expect(useMemoryStore.getState().spaces.map((s) => s.name)).toEqual([
      'Personal',
      'Alpha',
      'Zulu',
    ]);
    expect(useMemoryStore.getState().loaded).toBe(true);
  });

  it('surfaces a failure as a message instead of throwing', async () => {
    mockListSpaces.mockRejectedValue(new Error('network down'));

    await useMemoryStore.getState().loadSpaces();

    expect(useMemoryStore.getState().error).toBe('network down');
    expect(useMemoryStore.getState().loadingSpaces).toBe(false);
  });
});

describe('loadItems', () => {
  it('orders pinned first, then most recently updated', async () => {
    mockListItems.mockResolvedValue([
      item('1', 'old', { updated_at: '2026-08-01T00:00:00Z' }),
      item('2', 'new', { updated_at: '2026-08-20T00:00:00Z' }),
      item('3', 'pinned-old', { pinned: true, updated_at: '2026-07-01T00:00:00Z' }),
    ]);

    await useMemoryStore.getState().loadItems('space-1');

    expect(useMemoryStore.getState().items.map((i) => i.name)).toEqual([
      'pinned-old',
      'new',
      'old',
    ]);
  });

  it('passes the trash flag through to the query', async () => {
    useMemoryStore.setState({ showTrashed: true });
    await useMemoryStore.getState().loadItems('space-1');
    expect(mockListItems).toHaveBeenCalledWith('space-1', true);
  });
});

describe('mutations', () => {
  it('refetches after a save rather than patching the row in place', async () => {
    // token_estimate and content_hash are generated columns and the RPC stamps
    // updated_at, so a client-side patch would show stale derived values.
    mockSaveItem.mockResolvedValue('item-1');
    useMemoryStore.setState({ activeSpaceId: 'space-1' });

    await useMemoryStore.getState().saveItem({
      space_id: 'space-1',
      name: 'a',
      summary: '',
      body: 'x',
    });

    expect(mockSaveItem).toHaveBeenCalledOnce();
    expect(mockListItems).toHaveBeenCalledWith('space-1', false);
    expect(mockSpaceTotals).toHaveBeenCalled();
  });

  it('sends the item name with a restore so a name collision can be explained', async () => {
    // Names are unique among live rows only, so restoring can fail when the name
    // was reused while the item sat in the trash. The message needs the name.
    mockRestoreItem.mockResolvedValue(undefined);
    useMemoryStore.setState({
      activeSpaceId: 'space-1',
      items: [item('item-9', 'house-style', { deleted_at: '2026-08-22T00:00:00Z' })],
    });

    await useMemoryStore.getState().restoreItem('item-9');

    expect(mockRestoreItem).toHaveBeenCalledWith('item-9', 'house-style');
  });

  it('drops a trashed space from the totals map as well as the list', async () => {
    mockTrashItem.mockResolvedValue(undefined);
    useMemoryStore.setState({
      spaces: [space('space-1', 'One'), space('space-2', 'Two')],
      totals: new Map([
        ['space-1', { items: 3, tokens: 30 }],
        ['space-2', { items: 1, tokens: 10 }],
      ]),
    });

    await useMemoryStore.getState().trashSpace('space-1');

    const state = useMemoryStore.getState();
    expect(state.spaces.map((s) => s.id)).toEqual(['space-2']);
    expect(state.totals.has('space-1')).toBe(false);
  });
});
