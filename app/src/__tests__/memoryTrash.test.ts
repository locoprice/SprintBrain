import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A Brain's trash: moving in and out of it, and deleting from it for good.
//
// Three contracts are pinned here.
// 1. Permanent deletes remove the stored files BEFORE the rows. The files
//    cannot be deleted from SQL, so the two cannot share a transaction, and a
//    failed file delete must leave the rows alone so a retry starts clean.
// 2. Moving to and from the trash is optimistic: the row moves on screen at
//    once and moves back if the server refuses.
// 3. The trash panel lists one row per thing deleted: a trashed file carries
//    its pieces, and a piece trashed on its own stays its own row.

const sb = vi.hoisted(() => {
  const state = {
    /** Every storage and RPC call, in the order it was made. */
    calls: [] as string[],
    removed: [] as string[][],
    rpcArgs: null as unknown,
    selectResult: { data: [] as unknown, error: null as { message: string } | null },
    removeResult: { data: [] as unknown, error: null as { message: string } | null },
    rpcResult: {
      data: { items: 0, documents: 0 } as unknown,
      error: null as { message: string } | null,
    },
  };
  return { state };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn((column: string, value: string) => {
          sb.state.calls.push(`select ${table} ${column}=${value}`);
          return Promise.resolve(sb.state.selectResult);
        }),
      })),
    })),
    storage: {
      from: vi.fn((bucket: string) => ({
        remove: vi.fn((paths: string[]) => {
          sb.state.calls.push(`remove ${bucket} ${paths.length}`);
          sb.state.removed.push(paths);
          return Promise.resolve(sb.state.removeResult);
        }),
      })),
    },
    rpc: vi.fn((name: string, args: unknown) => {
      sb.state.calls.push(`rpc ${name}`);
      sb.state.rpcArgs = args;
      return Promise.resolve(sb.state.rpcResult);
    }),
  },
}));

import { memoryApi } from '@/lib/api/memoryApi';
import { useMemoryStore } from '@/stores/memoryStore';
import { buildTrashRows, describeTrashRows } from '@/features/memory/trashRows';
import type { MemoryDocument, MemoryItem } from '@/types/database';

const EARLIER = '2026-09-24T08:00:00Z';
const LATER = '2026-09-24T09:00:00Z';

function doc(id: string, overrides: Partial<MemoryDocument> = {}): MemoryDocument {
  return {
    id,
    user_id: 'user-1',
    space_id: 'space-1',
    name: `${id}.pdf`,
    mime: 'application/pdf',
    byte_size: 100,
    storage_path: `user-1/${id}.pdf`,
    chunk_count: 1,
    content_hash: null,
    created_at: '2026-09-01T00:00:00Z',
    deleted_at: EARLIER,
    ...overrides,
  };
}

function item(id: string, overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id,
    user_id: 'user-1',
    space_id: 'space-1',
    name: id,
    summary: '',
    body: 'body',
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

function ids(rows: { id: string }[]): string[] {
  return rows.map((row) => row.id);
}

beforeEach(() => {
  sb.state.calls = [];
  sb.state.removed = [];
  sb.state.rpcArgs = null;
  sb.state.selectResult = { data: [], error: null };
  sb.state.removeResult = { data: [], error: null };
  sb.state.rpcResult = { data: { items: 0, documents: 0 }, error: null };
  useMemoryStore.setState({ activeSpaceId: 'space-1', error: null, items: [], documents: [] });
  // The store refreshes totals and reads lists back in the background.
  vi.spyOn(memoryApi, 'spaceTotals').mockResolvedValue(new Map());
  vi.spyOn(memoryApi, 'listItems').mockImplementation(async () => useMemoryStore.getState().items);
  vi.spyOn(memoryApi, 'listDocuments').mockImplementation(
    async () => useMemoryStore.getState().documents,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('memoryApi.deleteForever', () => {
  it('deletes the stored files before the rows, then returns what the server removed', async () => {
    sb.state.rpcResult = { data: { items: 3, documents: 1 }, error: null };

    const removed = await memoryApi.deleteForever('space-1', ['a', 'b', 'c'], [doc('file-1')]);

    expect(sb.state.calls).toEqual(['remove memory-docs 1', 'rpc memory_empty_trash']);
    expect(sb.state.removed).toEqual([['user-1/file-1.pdf']]);
    expect(sb.state.rpcArgs).toEqual({
      p_space_id: 'space-1',
      p_item_ids: ['a', 'b', 'c'],
      p_document_ids: ['file-1'],
    });
    expect(removed).toEqual({ items: 3, documents: 1 });
  });

  it('skips storage entirely when no file is being deleted', async () => {
    await memoryApi.deleteForever('space-1', ['a'], []);

    expect(sb.state.calls).toEqual(['rpc memory_empty_trash']);
  });

  it('removes files in batches of 1000, the most storage takes per request', async () => {
    const files = Array.from({ length: 1001 }, (_, index) => doc(`file-${index}`));

    await memoryApi.deleteForever('space-1', [], files);

    expect(sb.state.calls).toEqual([
      'remove memory-docs 1000',
      'remove memory-docs 1',
      'rpc memory_empty_trash',
    ]);
  });

  it('never reaches the rows when a file cannot be deleted, so a retry starts clean', async () => {
    sb.state.removeResult = { data: null, error: { message: 'storage is down' } };

    await expect(memoryApi.deleteForever('space-1', ['a'], [doc('file-1')])).rejects.toThrow(
      'Could not delete permanently: storage is down',
    );
    expect(sb.state.calls).toEqual(['remove memory-docs 1']);
  });

  it('reports a failed row delete in words rather than resolving', async () => {
    sb.state.rpcResult = { data: null, error: { message: 'space not found' } };

    await expect(memoryApi.deleteForever('space-1', ['a'], [])).rejects.toThrow(
      'Could not delete permanently: space not found',
    );
  });
});

describe('memoryApi.deleteSpaceForever', () => {
  it('reads every file of the Brain, removes them, then deletes the rows naming those files', async () => {
    sb.state.selectResult = {
      data: [
        { id: 'f1', storage_path: 'user-1/f1.pdf' },
        { id: 'f2', storage_path: 'user-1/f2.pdf' },
      ],
      error: null,
    };
    sb.state.rpcResult = { data: { items: 7, documents: 2 }, error: null };

    const removed = await memoryApi.deleteSpaceForever('space-9');

    expect(sb.state.calls).toEqual([
      'select memory_documents space_id=space-9',
      'remove memory-docs 2',
      'rpc memory_purge_space',
    ]);
    expect(sb.state.removed).toEqual([['user-1/f1.pdf', 'user-1/f2.pdf']]);
    expect(sb.state.rpcArgs).toEqual({ p_space_id: 'space-9', p_document_ids: ['f1', 'f2'] });
    expect(removed).toEqual({ items: 7, documents: 2 });
  });

  it('goes straight to the rows when the Brain holds no files', async () => {
    await memoryApi.deleteSpaceForever('space-9');

    expect(sb.state.calls).toEqual([
      'select memory_documents space_id=space-9',
      'rpc memory_purge_space',
    ]);
  });

  it('touches nothing when the file list cannot be read', async () => {
    sb.state.selectResult = { data: null, error: { message: 'offline' } };

    await expect(memoryApi.deleteSpaceForever('space-9')).rejects.toThrow(
      'Could not delete permanently: offline',
    );
    expect(sb.state.calls).toEqual(['select memory_documents space_id=space-9']);
  });

  it('never reaches the rows when a file cannot be removed', async () => {
    sb.state.selectResult = { data: [{ id: 'f1', storage_path: 'user-1/f1.pdf' }], error: null };
    sb.state.removeResult = { data: null, error: { message: 'storage is down' } };

    await expect(memoryApi.deleteSpaceForever('space-9')).rejects.toThrow(
      'Could not delete permanently: storage is down',
    );
    expect(sb.state.calls).toEqual([
      'select memory_documents space_id=space-9',
      'remove memory-docs 1',
    ]);
  });
});

describe('moving to and from the trash', () => {
  it('moves an item into the trash before the server answers', async () => {
    let settle: () => void = () => {};
    vi.spyOn(memoryApi, 'trashItem').mockReturnValue(
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
    );
    useMemoryStore.setState({ items: [item('note')] });

    const pending = useMemoryStore.getState().trashItem('note');

    expect(useMemoryStore.getState().items[0]?.deleted_at).not.toBeNull();
    settle();
    await pending;
    expect(useMemoryStore.getState().items[0]?.deleted_at).not.toBeNull();
  });

  it('puts the item back when the server refuses', async () => {
    vi.spyOn(memoryApi, 'trashItem').mockRejectedValue(new Error('offline'));
    useMemoryStore.setState({ items: [item('note')] });

    await expect(useMemoryStore.getState().trashItem('note')).rejects.toThrow('offline');

    expect(useMemoryStore.getState().items[0]?.deleted_at).toBeNull();
  });

  it('takes a file and its live pieces into the trash together', async () => {
    vi.spyOn(memoryApi, 'trashDocument').mockResolvedValue(undefined);
    useMemoryStore.setState({
      documents: [doc('contract', { deleted_at: null })],
      items: [item('piece-1', { source_id: 'contract' }), item('typed-note')],
    });

    await useMemoryStore.getState().trashDocument('contract');

    const state = useMemoryStore.getState();
    expect(state.documents[0]?.deleted_at).not.toBeNull();
    expect(state.items.find((row) => row.id === 'piece-1')?.deleted_at).not.toBeNull();
    expect(state.items.find((row) => row.id === 'typed-note')?.deleted_at).toBeNull();
  });

  it('keeps an item in the trash when restoring it collides with a name in use', async () => {
    vi.spyOn(memoryApi, 'restoreItem').mockRejectedValue(new Error('name taken'));
    useMemoryStore.setState({ items: [item('note', { deleted_at: EARLIER })] });

    await expect(useMemoryStore.getState().restoreItem('note')).rejects.toThrow('name taken');

    expect(useMemoryStore.getState().items[0]?.deleted_at).toBe(EARLIER);
  });
});

describe('useMemoryStore.deleteForever', () => {
  beforeEach(() => {
    useMemoryStore.setState({
      items: [
        item('live'),
        item('loose', { deleted_at: EARLIER }),
        item('piece-trashed', { deleted_at: EARLIER, source_id: 'contract' }),
        item('piece-live', { source_id: 'contract' }),
        item('other-brain', { space_id: 'space-2', deleted_at: EARLIER }),
      ],
      documents: [doc('contract'), doc('kept', { deleted_at: null })],
    });
  });

  it('sends a file with its trashed pieces, and never a live row or another Brain', async () => {
    const deleteForever = vi
      .spyOn(memoryApi, 'deleteForever')
      .mockResolvedValue({ items: 1, documents: 1 });

    await useMemoryStore
      .getState()
      .deleteForever('space-1', { itemIds: ['live', 'other-brain'], documentIds: ['contract', 'kept'] });

    expect(deleteForever).toHaveBeenCalledWith(
      'space-1',
      ['piece-trashed'],
      [expect.objectContaining({ id: 'contract' })],
    );
  });

  it('drops the deleted rows from the page at once', async () => {
    vi.spyOn(memoryApi, 'deleteForever').mockResolvedValue({ items: 2, documents: 1 });

    await useMemoryStore
      .getState()
      .deleteForever('space-1', { itemIds: ['loose'], documentIds: ['contract'] });

    const state = useMemoryStore.getState();
    expect(ids(state.items)).toEqual(['live', 'piece-live', 'other-brain']);
    expect(ids(state.documents)).toEqual(['kept']);
  });

  it('leaves everything in place when the delete fails', async () => {
    vi.spyOn(memoryApi, 'deleteForever').mockRejectedValue(new Error('offline'));

    await expect(
      useMemoryStore.getState().deleteForever('space-1', { itemIds: ['loose'], documentIds: [] }),
    ).rejects.toThrow('offline');

    expect(ids(useMemoryStore.getState().items)).toContain('loose');
  });
});

describe('buildTrashRows', () => {
  it('folds the pieces of a trashed file into its row', () => {
    const rows = buildTrashRows(
      [
        item('piece-1', { deleted_at: EARLIER, source_id: 'contract' }),
        item('piece-2', { deleted_at: EARLIER, source_id: 'contract' }),
      ],
      [doc('contract')],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'file', id: 'contract', pieces: 2 });
  });

  it('keeps a piece trashed on its own as a row, since its file is still live', () => {
    const rows = buildTrashRows(
      [item('piece-1', { deleted_at: EARLIER, source_id: 'kept' })],
      [doc('kept', { deleted_at: null })],
    );

    expect(rows).toMatchObject([{ kind: 'item', id: 'piece-1' }]);
  });

  it('leaves live rows out and puts the latest deletion first', () => {
    const rows = buildTrashRows(
      [item('live'), item('old', { deleted_at: EARLIER }), item('new', { deleted_at: LATER })],
      [],
    );

    expect(ids(rows)).toEqual(['new', 'old']);
  });

  it('names what is about to go the way the panel shows it', () => {
    const rows = buildTrashRows(
      [
        item('a', { deleted_at: EARLIER }),
        item('b', { deleted_at: EARLIER }),
        item('piece', { deleted_at: EARLIER, source_id: 'contract' }),
      ],
      [doc('contract')],
    );

    expect(describeTrashRows(rows)).toBe('1 file and 2 items');
    expect(describeTrashRows(rows.slice(0, 1))).toMatch(/^1 (file|item)$/);
  });
});
