import { create } from 'zustand';
import type {
  MemoryDocument,
  MemoryItem,
  MemorySpace,
  MemorySpaceTotals,
  MemoryVersion,
} from '@/types/database';
import {
  memoryApi,
  type DeleteForeverResult,
  type DocumentImportResult,
  type SaveMemoryItemInput,
} from '@/lib/api/memoryApi';

// Memory spaces and their items (MEMORY-002).
//
// One store for both levels, because the index needs per-space totals that only
// a read of the items can produce, and the detail page needs the space row the
// index already fetched. Splitting them would mean the detail page refetching a
// space it was navigated to from a list that had it.
//
// `items` holds one space at a time rather than a map keyed by space. A library
// is bounded by a token budget, not by a page, and the detail view is the only
// consumer; caching every space's items would trade memory for a refetch nobody
// waits on.
//
// Moving to and from the trash is optimistic: the row changes on screen first
// and goes back if the server refuses. That is what lets Undo feel instant, and
// the trash panel count stay right without a second read.

/** Which trashed rows a permanent delete takes. A file brings its trashed pieces. */
export interface DeleteForeverTarget {
  itemIds: string[];
  documentIds: string[];
}

interface MemoryStore {
  /** Live spaces. Everything else in the app lists, links to and searches these. */
  spaces: MemorySpace[];
  /** Spaces in the trash, most recently trashed first. Only the Brains trash panel reads them. */
  trashedSpaces: MemorySpace[];
  /** Live item and token counts per space id, trashed spaces included. */
  totals: Map<string, MemorySpaceTotals>;
  /**
   * Every item of `activeSpaceId`, trashed ones included. The page lists the
   * live ones and the trash panel the rest, so both counts stay current from
   * one read.
   */
  items: MemoryItem[];
  /**
   * Live items across every space, for the one search bar's panel (SEARCH-001).
   * Separate from `items` on purpose: that one is the space being viewed and is
   * refetched on every write, while this is a read-only index fetched once.
   */
  allItems: MemoryItem[];
  /** True once `loadAllItems` has completed, so searching again does not refetch. */
  allItemsLoaded: boolean;
  activeSpaceId: string | null;

  loadingSpaces: boolean;
  loadingItems: boolean;
  /** True while the cross-space index is being fetched. */
  loadingAllItems: boolean;
  /** True once spaces have loaded, so a remount does not refetch. */
  loaded: boolean;
  error: string | null;

  loadSpaces: () => Promise<void>;
  loadItems: (spaceId: string) => Promise<void>;
  /** Fetch every space's items once, the first time someone searches. */
  loadAllItems: () => Promise<void>;
  clearError: () => void;

  createSpace: (name: string, description?: string) => Promise<MemorySpace>;
  renameSpace: (id: string, patch: { name?: string; description?: string }) => Promise<void>;
  trashSpace: (id: string) => Promise<void>;
  restoreSpace: (id: string) => Promise<void>;
  /** Permanently deletes a trashed space and everything in it, stored files included. */
  deleteSpaceForever: (id: string) => Promise<DeleteForeverResult>;

  saveItem: (input: SaveMemoryItemInput) => Promise<void>;
  trashItem: (id: string) => Promise<void>;
  restoreItem: (id: string) => Promise<void>;

  /** Saved versions of `versionsItemId`, newest first. */
  versions: MemoryVersion[];
  /** The item `versions` belongs to, so reopening the same one does not refetch. */
  versionsItemId: string | null;
  versionsLoading: boolean;
  loadVersions: (itemId: string) => Promise<void>;
  /** Saves an older version's text back as the newest version. */
  restoreVersion: (item: MemoryItem, version: MemoryVersion) => Promise<void>;

  /** Every uploaded file of `activeSpaceId`, trashed ones included. Their text is in `items`. */
  documents: MemoryDocument[];
  /** File name being read and filed, or null. One at a time, by design. */
  importing: string | null;
  loadDocuments: (spaceId: string) => Promise<void>;
  importDocument: (file: File, spaceId: string) => Promise<DocumentImportResult>;
  trashDocument: (id: string) => Promise<void>;
  restoreDocument: (id: string) => Promise<void>;

  /**
   * Permanently deletes trashed rows of `spaceId`: one row from the trash
   * panel, or all of them when the trash is emptied.
   */
  deleteForever: (spaceId: string, target: DeleteForeverTarget) => Promise<DeleteForeverResult>;
}

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function bySpaceOrder(a: MemorySpace, b: MemorySpace): number {
  if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/** Most recently trashed first, the order someone looks for what they just removed. */
function byTrashedOrder(a: MemorySpace, b: MemorySpace): number {
  return (b.deleted_at ?? '').localeCompare(a.deleted_at ?? '');
}

/** Pinned first, then most recently touched. Matches the server ordering. */
function byItemOrder(a: MemoryItem, b: MemoryItem): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return b.updated_at.localeCompare(a.updated_at);
}

/**
 * Moves a space between the live list and the trash, stamped with
 * `deletedAt`, and returns the row as it was, for `putSpaceBack`.
 */
function moveSpace(id: string, deletedAt: string | null): MemorySpace | undefined {
  const { spaces, trashedSpaces } = useMemoryStore.getState();
  const original = [...spaces, ...trashedSpaces].find((space) => space.id === id);
  if (!original) return undefined;
  const moved = { ...original, deleted_at: deletedAt };
  useMemoryStore.setState((state) => {
    const liveRest = state.spaces.filter((space) => space.id !== id);
    const trashedRest = state.trashedSpaces.filter((space) => space.id !== id);
    return deletedAt === null
      ? { spaces: [...liveRest, moved].sort(bySpaceOrder), trashedSpaces: trashedRest }
      : { spaces: liveRest, trashedSpaces: [moved, ...trashedRest].sort(byTrashedOrder) };
  });
  return original;
}

function putSpaceBack(original: MemorySpace | undefined): void {
  if (original) moveSpace(original.id, original.deleted_at);
}

/**
 * The totals only feed the Brains index, so they are refreshed without holding
 * up the caller: the page has already shown the change.
 */
function refreshTotals(): void {
  memoryApi
    .spaceTotals()
    .then((totals) => useMemoryStore.setState({ totals }))
    .catch((err: unknown) =>
      useMemoryStore.setState({ error: message(err, 'Could not update the Brain totals.') }),
    );
}

/**
 * Applies `change` to every item `match` picks and returns the rows as they
 * were, for `revertItems`. The server's own update trigger stamps updated_at,
 * so callers stamp it here too and the order does not jump on the next read.
 */
function patchItems(match: (item: MemoryItem) => boolean, change: Partial<MemoryItem>): MemoryItem[] {
  const originals = useMemoryStore.getState().items.filter(match);
  useMemoryStore.setState((state) => ({
    items: state.items.map((item) => (match(item) ? { ...item, ...change } : item)).sort(byItemOrder),
  }));
  return originals;
}

function revertItems(originals: MemoryItem[]): void {
  const byId = new Map(originals.map((item) => [item.id, item]));
  useMemoryStore.setState((state) => ({
    items: state.items.map((item) => byId.get(item.id) ?? item).sort(byItemOrder),
  }));
}

function patchDocument(id: string, change: Partial<MemoryDocument>): MemoryDocument | undefined {
  const original = useMemoryStore.getState().documents.find((doc) => doc.id === id);
  useMemoryStore.setState((state) => ({
    documents: state.documents.map((doc) => (doc.id === id ? { ...doc, ...change } : doc)),
  }));
  return original;
}

function revertDocument(original: MemoryDocument | undefined): void {
  if (!original) return;
  useMemoryStore.setState((state) => ({
    documents: state.documents.map((doc) => (doc.id === original.id ? original : doc)),
  }));
}

export const useMemoryStore = create<MemoryStore>((set, get) => ({
  spaces: [],
  trashedSpaces: [],
  totals: new Map<string, MemorySpaceTotals>(),
  items: [],
  allItems: [],
  allItemsLoaded: false,
  activeSpaceId: null,

  loadingSpaces: false,
  loadingItems: false,
  loadingAllItems: false,
  loaded: false,
  error: null,
  documents: [],
  importing: null,
  versions: [],
  versionsItemId: null,
  versionsLoading: false,

  loadSpaces: async () => {
    if (get().loadingSpaces) return;
    set({ loadingSpaces: true, error: null });
    try {
      // Totals come from a separate read of ids and token counts, never bodies.
      // Trashed spaces come in the same read, so the trash count is known
      // before anyone opens the trash.
      const [all, totals] = await Promise.all([
        memoryApi.listSpaces(true),
        memoryApi.spaceTotals(),
      ]);
      set({
        spaces: all.filter((space) => space.deleted_at === null).sort(bySpaceOrder),
        trashedSpaces: all.filter((space) => space.deleted_at !== null).sort(byTrashedOrder),
        totals,
        loaded: true,
      });
    } catch (err) {
      set({ error: message(err, 'Could not load your memory spaces.') });
    } finally {
      set({ loadingSpaces: false });
    }
  },

  loadItems: async (spaceId) => {
    set({ loadingItems: true, activeSpaceId: spaceId, error: null });
    try {
      const items = await memoryApi.listItems(spaceId, true);
      set({ items: [...items].sort(byItemOrder) });
    } catch (err) {
      set({ error: message(err, 'Could not load this space.') });
    } finally {
      set({ loadingItems: false });
    }
  },

  loadAllItems: async () => {
    if (get().allItemsLoaded || get().loadingAllItems) return;
    set({ loadingAllItems: true });
    try {
      set({ allItems: await memoryApi.listAllItems(), allItemsLoaded: true });
    } catch (err) {
      // Non-fatal: searching still finds snippets, prompts and space names. A
      // banner here would interrupt a search the user is in the middle of.
      set({ error: message(err, 'Could not search your memory notes.') });
    } finally {
      set({ loadingAllItems: false });
    }
  },

  clearError: () => set({ error: null }),

  createSpace: async (name, description) => {
    const space = await memoryApi.createSpace(name, description);
    set((state) => ({ spaces: [...state.spaces, space].sort(bySpaceOrder) }));
    return space;
  },

  renameSpace: async (id, patch) => {
    const updated = await memoryApi.updateSpace(id, patch);
    set((state) => ({
      spaces: state.spaces.map((s) => (s.id === id ? updated : s)).sort(bySpaceOrder),
    }));
  },

  // Trashing a space moves it at once and keeps its totals: the trash panel
  // shows how many items would come back with it.
  trashSpace: async (id) => {
    const original = moveSpace(id, new Date().toISOString());
    try {
      await memoryApi.trashSpace(id);
    } catch (err) {
      putSpaceBack(original);
      throw err;
    }
  },

  restoreSpace: async (id) => {
    const original = moveSpace(id, null);
    try {
      await memoryApi.restoreSpace(id, original?.name);
    } catch (err) {
      putSpaceBack(original);
      throw err;
    }
  },

  deleteSpaceForever: async (id) => {
    const removed = await memoryApi.deleteSpaceForever(id);
    set((state) => {
      const totals = new Map(state.totals);
      totals.delete(id);
      return { trashedSpaces: state.trashedSpaces.filter((space) => space.id !== id), totals };
    });
    // The cross-space search index may still hold the items that just went.
    set({ allItemsLoaded: false });
    return removed;
  },

  saveItem: async (input) => {
    const spaceId = input.space_id ?? get().activeSpaceId;
    await memoryApi.saveItem(input);
    // Refetch rather than patch in place: the save RPC fills the default space
    // when none was given, stamps updated_at, and regenerates token_estimate and
    // content_hash. Reconstructing all of that client-side would be a second
    // implementation of the server's rules.
    if (spaceId) await get().loadItems(spaceId);
    const totals = await memoryApi.spaceTotals();
    // The cross-space search index no longer reflects what is stored, so the
    // next search rebuilds it rather than offering the old text.
    set({ totals, allItemsLoaded: false });
  },

  trashItem: async (id) => {
    const now = new Date().toISOString();
    const originals = patchItems((item) => item.id === id, { deleted_at: now, updated_at: now });
    try {
      await memoryApi.trashItem(id);
    } catch (err) {
      revertItems(originals);
      throw err;
    }
    set({ allItemsLoaded: false });
    refreshTotals();
  },

  restoreItem: async (id) => {
    const name = get().items.find((item) => item.id === id)?.name;
    const originals = patchItems((item) => item.id === id, {
      deleted_at: null,
      updated_at: new Date().toISOString(),
    });
    try {
      await memoryApi.restoreItem(id, name);
    } catch (err) {
      revertItems(originals);
      throw err;
    }
    set({ allItemsLoaded: false });
    refreshTotals();
  },

  loadVersions: async (itemId) => {
    set({ versionsLoading: true, versionsItemId: itemId });
    try {
      set({ versions: await memoryApi.listVersions(itemId) });
    } catch (err) {
      set({ versions: [], error: message(err, 'Could not load this item history.') });
    } finally {
      set({ versionsLoading: false });
    }
  },

  restoreVersion: async (item, version) => {
    await memoryApi.restoreVersion(item, version);
    // The restore is itself a save, so the list it came from is now one version
    // short, and the space holds different text.
    await get().loadVersions(item.id);
    const spaceId = get().activeSpaceId;
    if (spaceId) await get().loadItems(spaceId);
    set({ totals: await memoryApi.spaceTotals(), allItemsLoaded: false });
  },

  loadDocuments: async (spaceId) => {
    try {
      set({ documents: await memoryApi.listDocuments(spaceId, true) });
    } catch (err) {
      set({ error: message(err, 'Could not load the files in this space.') });
    }
  },

  importDocument: async (file, spaceId) => {
    set({ importing: file.name });
    try {
      const result = await memoryApi.importDocument(file, spaceId);
      // The items the file became are new rows, so the space is reloaded the
      // same way a save reloads it rather than guessing at what landed.
      await get().loadItems(spaceId);
      await get().loadDocuments(spaceId);
      set({ totals: await memoryApi.spaceTotals(), allItemsLoaded: false });
      return result;
    } finally {
      set({ importing: null });
    }
  },

  trashDocument: async (id) => {
    const now = new Date().toISOString();
    const original = patchDocument(id, { deleted_at: now });
    // The live pieces go with it, the same rows memory_trash_document moves.
    const pieces = patchItems((item) => item.source_id === id && item.deleted_at === null, {
      deleted_at: now,
      updated_at: now,
    });
    try {
      await memoryApi.trashDocument(id);
    } catch (err) {
      revertDocument(original);
      revertItems(pieces);
      throw err;
    }
    set({ allItemsLoaded: false });
    refreshTotals();
  },

  restoreDocument: async (id) => {
    const original = patchDocument(id, { deleted_at: null });
    // Every piece comes back, as memory_restore_document brings them all.
    const pieces = patchItems((item) => item.source_id === id, {
      deleted_at: null,
      updated_at: new Date().toISOString(),
    });
    try {
      await memoryApi.restoreDocument(id);
    } catch (err) {
      revertDocument(original);
      revertItems(pieces);
      throw err;
    }
    set({ allItemsLoaded: false });
    refreshTotals();
  },

  deleteForever: async (spaceId, target) => {
    const { items, documents } = get();
    const files = documents.filter(
      (doc) =>
        doc.space_id === spaceId && doc.deleted_at !== null && target.documentIds.includes(doc.id),
    );
    const fileIds = new Set(files.map((doc) => doc.id));
    // A file's trashed pieces go with it, so deleting the file never leaves
    // them behind as loose rows in the trash.
    const itemIds = items
      .filter(
        (item) =>
          item.space_id === spaceId &&
          item.deleted_at !== null &&
          (target.itemIds.includes(item.id) ||
            (item.source_id !== null && fileIds.has(item.source_id))),
      )
      .map((item) => item.id);

    const removed = await memoryApi.deleteForever(spaceId, itemIds, files);

    const gone = new Set(itemIds);
    set((state) => ({
      items: state.items.filter((item) => !gone.has(item.id)),
      documents: state.documents.filter((doc) => !fileIds.has(doc.id)),
    }));
    // Read back once in the background: the server may have recounted a live
    // file's pieces or unlinked a live piece from a file it deleted.
    void get().loadItems(spaceId);
    void get().loadDocuments(spaceId);
    return removed;
  },
}));
