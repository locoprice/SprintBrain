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

interface MemoryStore {
  spaces: MemorySpace[];
  /** Live item and token counts per space id. */
  totals: Map<string, MemorySpaceTotals>;
  /** Items of `activeSpaceId`, including trashed ones when `showTrashed`. */
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
  showTrashed: boolean;

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
  setShowTrashed: (show: boolean) => void;
  clearError: () => void;

  createSpace: (name: string, description?: string) => Promise<MemorySpace>;
  renameSpace: (id: string, patch: { name?: string; description?: string }) => Promise<void>;
  trashSpace: (id: string) => Promise<void>;

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

  /** Uploaded files of `activeSpaceId`. Their text is in `items`. */
  documents: MemoryDocument[];
  /** File name being read and filed, or null. One at a time, by design. */
  importing: string | null;
  loadDocuments: (spaceId: string) => Promise<void>;
  importDocument: (file: File, spaceId: string) => Promise<DocumentImportResult>;
  trashDocument: (id: string) => Promise<void>;
  restoreDocument: (id: string) => Promise<void>;
}

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function bySpaceOrder(a: MemorySpace, b: MemorySpace): number {
  if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/** Pinned first, then most recently touched. Matches the server ordering. */
function byItemOrder(a: MemoryItem, b: MemoryItem): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return b.updated_at.localeCompare(a.updated_at);
}

export const useMemoryStore = create<MemoryStore>((set, get) => ({
  spaces: [],
  totals: new Map<string, MemorySpaceTotals>(),
  items: [],
  allItems: [],
  allItemsLoaded: false,
  activeSpaceId: null,
  showTrashed: false,

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
      const [spaces, totals] = await Promise.all([
        memoryApi.listSpaces(),
        memoryApi.spaceTotals(),
      ]);
      set({ spaces: [...spaces].sort(bySpaceOrder), totals, loaded: true });
    } catch (err) {
      set({ error: message(err, 'Could not load your memory spaces.') });
    } finally {
      set({ loadingSpaces: false });
    }
  },

  loadItems: async (spaceId) => {
    set({ loadingItems: true, activeSpaceId: spaceId, error: null });
    try {
      const items = await memoryApi.listItems(spaceId, get().showTrashed);
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

  setShowTrashed: (show) => {
    set({ showTrashed: show });
    const spaceId = get().activeSpaceId;
    if (spaceId) {
      void get().loadItems(spaceId);
      void get().loadDocuments(spaceId);
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

  trashSpace: async (id) => {
    await memoryApi.trashSpace(id);
    set((state) => {
      const totals = new Map(state.totals);
      totals.delete(id);
      return { spaces: state.spaces.filter((s) => s.id !== id), totals };
    });
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
    await memoryApi.trashItem(id);
    const spaceId = get().activeSpaceId;
    if (spaceId) await get().loadItems(spaceId);
    set({ totals: await memoryApi.spaceTotals(), allItemsLoaded: false });
  },

  restoreItem: async (id) => {
    const name = get().items.find((item) => item.id === id)?.name;
    await memoryApi.restoreItem(id, name);
    const spaceId = get().activeSpaceId;
    if (spaceId) await get().loadItems(spaceId);
    set({ totals: await memoryApi.spaceTotals(), allItemsLoaded: false });
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
      set({ documents: await memoryApi.listDocuments(spaceId, get().showTrashed) });
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
    await memoryApi.trashDocument(id);
    const spaceId = get().activeSpaceId;
    if (spaceId) {
      await get().loadItems(spaceId);
      await get().loadDocuments(spaceId);
    }
    set({ totals: await memoryApi.spaceTotals(), allItemsLoaded: false });
  },

  restoreDocument: async (id) => {
    await memoryApi.restoreDocument(id);
    const spaceId = get().activeSpaceId;
    if (spaceId) {
      await get().loadItems(spaceId);
      await get().loadDocuments(spaceId);
    }
    set({ totals: await memoryApi.spaceTotals(), allItemsLoaded: false });
  },
}));
