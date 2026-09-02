import { create } from 'zustand';
import type { MemoryItem, MemorySpace, MemorySpaceTotals } from '@/types/database';
import { memoryApi, type SaveMemoryItemInput } from '@/lib/api/memoryApi';

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
  activeSpaceId: string | null;
  showTrashed: boolean;

  loadingSpaces: boolean;
  loadingItems: boolean;
  /** True once spaces have loaded, so a remount does not refetch. */
  loaded: boolean;
  error: string | null;

  loadSpaces: () => Promise<void>;
  loadItems: (spaceId: string) => Promise<void>;
  setShowTrashed: (show: boolean) => void;
  clearError: () => void;

  createSpace: (name: string, description?: string) => Promise<MemorySpace>;
  renameSpace: (id: string, patch: { name?: string; description?: string }) => Promise<void>;
  trashSpace: (id: string) => Promise<void>;

  saveItem: (input: SaveMemoryItemInput) => Promise<void>;
  trashItem: (id: string) => Promise<void>;
  restoreItem: (id: string) => Promise<void>;
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
  activeSpaceId: null,
  showTrashed: false,

  loadingSpaces: false,
  loadingItems: false,
  loaded: false,
  error: null,

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

  setShowTrashed: (show) => {
    set({ showTrashed: show });
    const spaceId = get().activeSpaceId;
    if (spaceId) void get().loadItems(spaceId);
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
    set({ totals });
  },

  trashItem: async (id) => {
    await memoryApi.trashItem(id);
    const spaceId = get().activeSpaceId;
    if (spaceId) await get().loadItems(spaceId);
    set({ totals: await memoryApi.spaceTotals() });
  },

  restoreItem: async (id) => {
    const name = get().items.find((item) => item.id === id)?.name;
    await memoryApi.restoreItem(id, name);
    const spaceId = get().activeSpaceId;
    if (spaceId) await get().loadItems(spaceId);
    set({ totals: await memoryApi.spaceTotals() });
  },
}));
