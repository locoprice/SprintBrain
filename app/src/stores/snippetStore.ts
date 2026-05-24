import { create } from 'zustand';
import type { Folder, Snippet, SnippetRow } from '@/types/database';
import type { FolderFormValues, SnippetFormValues } from '@/types/schemas';
import { snippetsApi } from '@/lib/api/snippetsApi';

export type SortColumn = 'updated_at' | 'usage_count' | 'name';
export type SortDir = 'asc' | 'desc';

export interface ImportBatchResult {
  imported: number;
  failed: number;
}

interface SnippetStore {
  folders: Folder[];
  snippets: SnippetRow[];
  loading: boolean;
  error: string | null;
  selectedFolderId: string | null; // null = "All"
  searchQuery: string;
  /** Set of snippet IDs currently awaiting a share/unshare operation. */
  sharingIds: Set<string>;
  /** IDs of rows checked in the bulk-selection column. */
  selectedIds: Set<string>;
  sortBy: SortColumn;
  sortDir: SortDir;
  languageFilter: Snippet['language'] | null;
  /** True while a bulk-move network request is in flight. */
  bulkMoving: boolean;
  /** True while a bulk-delete network request is in flight. */
  bulkDeleting: boolean;
  load: () => Promise<void>;
  setSelectedFolder: (id: string | null) => void;
  setSearchQuery: (q: string) => void;
  clearError: () => void;
  toggleSelectSnippet: (id: string) => void;
  /** Replace the current selection with the provided ids. */
  selectAllSnippets: (ids: string[]) => void;
  clearSelection: () => void;
  /** Switch sort column; toggles direction when the same column is clicked twice. */
  setSortBy: (col: SortColumn) => void;
  setLanguageFilter: (lang: Snippet['language'] | null) => void;
  /** Move selected snippets to a folder in one network request. Clears selection on success. */
  bulkMoveSnippets: (ids: string[], folderId: string | null) => Promise<void>;
  /** Delete multiple snippets in one network request. Clears selection on success. */
  bulkDeleteSnippets: (ids: string[]) => Promise<void>;

  // Mutations — throw on failure so the calling dialog can keep the form open.
  addSnippet: (payload: SnippetFormValues) => Promise<SnippetRow>;
  editSnippet: (id: string, patch: Partial<SnippetFormValues>) => Promise<SnippetRow>;
  removeSnippet: (id: string) => Promise<void>;
  /** Toggle the pinned flag on a snippet. Optimistic; rolls back on failure. */
  togglePin: (id: string) => Promise<void>;
  /** Duplicate a snippet. Returns the new row. */
  duplicateSnippet: (id: string) => Promise<SnippetRow>;
  addFolder: (payload: FolderFormValues) => Promise<Folder>;
  editFolder: (id: string, patch: Partial<FolderFormValues>) => Promise<Folder>;
  removeFolder: (id: string) => Promise<void>;
  /**
   * Push snippet to the shared team Notion DB via Edge Function.
   * Optimistically sets is_shared=true; rolls back on failure.
   */
  shareSnippet: (id: string) => Promise<void>;
  /**
   * Unshare a snippet: sets is_shared=false in Supabase.
   * The Notion page is intentionally preserved as team knowledge history.
   */
  unshareSnippet: (id: string) => Promise<void>;
  /**
   * Bulk-create snippets from an import payload. Creates each snippet
   * individually and appends all successful rows to the store in one
   * update. Does not set store.error — callers own result feedback.
   */
  importSnippets: (items: SnippetFormValues[]) => Promise<ImportBatchResult>;
}

export const useSnippetStore = create<SnippetStore>((set, get) => ({
  folders: [],
  snippets: [],
  loading: false,
  error: null,
  selectedFolderId: null,
  searchQuery: '',
  sharingIds: new Set<string>(),
  selectedIds: new Set<string>(),
  sortBy: 'updated_at',
  sortDir: 'desc',
  languageFilter: null,
  bulkMoving: false,
  bulkDeleting: false,
  load: async () => {
    set({ loading: true, error: null });
    try {
      const [folders, snippets] = await Promise.all([
        snippetsApi.listFolders(),
        snippetsApi.listSnippets(),
      ]);
      set({ folders, snippets, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load snippets',
      });
    }
  },
  setSelectedFolder: (id) => set({ selectedFolderId: id }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  clearError: () => set({ error: null }),

  toggleSelectSnippet: (id) =>
    set((s) => {
      const next = new Set(s.selectedIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { selectedIds: next };
    }),

  selectAllSnippets: (ids) => set({ selectedIds: new Set(ids) }),

  clearSelection: () => set({ selectedIds: new Set<string>() }),

  setSortBy: (col) =>
    set((s) => ({
      sortBy: col,
      // Toggle direction on repeated click; default to desc (most recent/most-used first)
      // except for name where asc (A-Z) is the natural default.
      sortDir:
        s.sortBy === col
          ? s.sortDir === 'asc'
            ? 'desc'
            : 'asc'
          : col === 'name'
            ? 'asc'
            : 'desc',
    })),

  setLanguageFilter: (lang) => set({ languageFilter: lang }),

  bulkMoveSnippets: async (ids, folderId) => {
    if (ids.length === 0) return;
    const preState = get().snippets;
    const folder = folderId ? get().folders.find((f) => f.id === folderId) : null;
    // Optimistic update.
    set((s) => ({
      snippets: s.snippets.map((sn) =>
        ids.includes(sn.id)
          ? { ...sn, folder_id: folderId, folder_name: folder?.name ?? null }
          : sn,
      ),
      bulkMoving: true,
    }));
    try {
      await snippetsApi.bulkMoveSnippets(ids, folderId);
      set({ selectedIds: new Set<string>(), bulkMoving: false, error: null });
    } catch (err) {
      // Rollback optimistic update on failure.
      set({
        snippets: preState,
        bulkMoving: false,
        error: err instanceof Error ? err.message : 'Failed to move snippets',
      });
      throw err;
    }
  },

  bulkDeleteSnippets: async (ids) => {
    if (ids.length === 0) return;
    const preState = get().snippets;
    // Optimistic removal.
    set((s) => ({
      snippets: s.snippets.filter((sn) => !ids.includes(sn.id)),
      bulkDeleting: true,
    }));
    try {
      await snippetsApi.bulkDeleteSnippets(ids);
      set({ selectedIds: new Set<string>(), bulkDeleting: false, error: null });
    } catch (err) {
      // Rollback optimistic removal on failure.
      set({
        snippets: preState,
        bulkDeleting: false,
        error: err instanceof Error ? err.message : 'Failed to delete snippets',
      });
      throw err;
    }
  },

  addSnippet: async (payload) => {
    try {
      const row = await snippetsApi.createSnippet(payload);
      // Ensure the folder_name is populated (the join returns it on insert, but
      // fall back to our local folders list if needed).
      const folder = get().folders.find((f) => f.id === row.folder_id);
      const enriched: SnippetRow = {
        ...row,
        folder_name: row.folder_name ?? folder?.name ?? null,
      };
      set((s) => ({ snippets: [...s.snippets, enriched], error: null }));
      return enriched;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create snippet';
      set({ error: msg });
      throw err;
    }
  },

  editSnippet: async (id, patch) => {
    try {
      const row = await snippetsApi.updateSnippet(id, patch);
      const folder = get().folders.find((f) => f.id === row.folder_id);
      const enriched: SnippetRow = {
        ...row,
        folder_name: row.folder_name ?? folder?.name ?? null,
      };
      set((s) => ({
        snippets: s.snippets.map((sn) => (sn.id === id ? enriched : sn)),
        error: null,
      }));
      return enriched;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update snippet';
      set({ error: msg });
      throw err;
    }
  },

  removeSnippet: async (id) => {
    try {
      await snippetsApi.deleteSnippet(id);
      set((s) => {
        const selectedIds = new Set(s.selectedIds);
        selectedIds.delete(id);
        return {
          snippets: s.snippets.filter((sn) => sn.id !== id),
          selectedIds,
          error: null,
        };
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete snippet';
      set({ error: msg });
      throw err;
    }
  },

  togglePin: async (id) => {
    const target = get().snippets.find((s) => s.id === id);
    if (!target) return;
    const next = !target.pinned;
    // Optimistic update.
    set((s) => ({
      snippets: s.snippets.map((sn) => (sn.id === id ? { ...sn, pinned: next } : sn)),
    }));
    try {
      const row = await snippetsApi.setPinned(id, next);
      const folder = get().folders.find((f) => f.id === row.folder_id);
      set((s) => ({
        snippets: s.snippets.map((sn) =>
          sn.id === id ? { ...row, folder_name: row.folder_name ?? folder?.name ?? null } : sn,
        ),
        error: null,
      }));
    } catch (err) {
      // Rollback on failure.
      set((s) => ({
        snippets: s.snippets.map((sn) =>
          sn.id === id ? { ...sn, pinned: target.pinned } : sn,
        ),
        error: err instanceof Error ? err.message : 'Failed to toggle pin',
      }));
      throw err;
    }
  },

  duplicateSnippet: async (id) => {
    try {
      const row = await snippetsApi.duplicateSnippet(id);
      const folder = get().folders.find((f) => f.id === row.folder_id);
      const enriched: SnippetRow = {
        ...row,
        folder_name: row.folder_name ?? folder?.name ?? null,
      };
      set((s) => ({ snippets: [...s.snippets, enriched], error: null }));
      return enriched;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to duplicate snippet';
      set({ error: msg });
      throw err;
    }
  },

  addFolder: async (payload) => {
    try {
      const folder = await snippetsApi.createFolder(payload);
      set((s) => ({ folders: [...s.folders, folder], error: null }));
      return folder;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create folder';
      set({ error: msg });
      throw err;
    }
  },

  editFolder: async (id, patch) => {
    try {
      const folder = await snippetsApi.updateFolder(id, patch);
      set((s) => ({
        folders: s.folders.map((f) => (f.id === id ? folder : f)),
        // Propagate any rename to cached snippet rows.
        snippets: s.snippets.map((sn) =>
          sn.folder_id === id ? { ...sn, folder_name: folder.name } : sn,
        ),
        error: null,
      }));
      return folder;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update folder';
      set({ error: msg });
      throw err;
    }
  },

  removeFolder: async (id) => {
    try {
      await snippetsApi.deleteFolder(id);
      set((s) => ({
        folders: s.folders.filter((f) => f.id !== id),
        // Mirror the server-side reassignment: snippets in this folder drop
        // back to "no folder" in memory.
        snippets: s.snippets.map((sn) =>
          sn.folder_id === id ? { ...sn, folder_id: null, folder_name: null } : sn,
        ),
        // Clear the folder selection if it was the one we just removed.
        selectedFolderId: s.selectedFolderId === id ? null : s.selectedFolderId,
        error: null,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete folder';
      set({ error: msg });
      throw err;
    }
  },

  shareSnippet: async (id) => {
    // Optimistic update: flip is_shared immediately so the toggle feels instant.
    set((s) => ({
      snippets: s.snippets.map((sn) => (sn.id === id ? { ...sn, is_shared: true } : sn)),
      sharingIds: new Set([...s.sharingIds, id]),
    }));
    try {
      const { notion_page_id } = await snippetsApi.shareWithNotion(id);
      // Persist the notion_page_id returned by the Edge Function.
      set((s) => ({
        snippets: s.snippets.map((sn) =>
          sn.id === id ? { ...sn, is_shared: true, notion_page_id } : sn,
        ),
        sharingIds: new Set([...s.sharingIds].filter((x) => x !== id)),
        error: null,
      }));
    } catch (err) {
      // Rollback optimistic update on failure.
      set((s) => ({
        snippets: s.snippets.map((sn) => (sn.id === id ? { ...sn, is_shared: false } : sn)),
        sharingIds: new Set([...s.sharingIds].filter((x) => x !== id)),
        error: err instanceof Error ? err.message : 'Failed to share snippet',
      }));
      throw err;
    }
  },

  unshareSnippet: async (id) => {
    // Optimistic update.
    set((s) => ({
      snippets: s.snippets.map((sn) => (sn.id === id ? { ...sn, is_shared: false } : sn)),
      sharingIds: new Set([...s.sharingIds, id]),
    }));
    try {
      const updated = await snippetsApi.setShared(id, false);
      set((s) => ({
        snippets: s.snippets.map((sn) => (sn.id === id ? { ...sn, ...updated } : sn)),
        sharingIds: new Set([...s.sharingIds].filter((x) => x !== id)),
        error: null,
      }));
    } catch (err) {
      // Rollback optimistic update on failure.
      set((s) => ({
        snippets: s.snippets.map((sn) => (sn.id === id ? { ...sn, is_shared: true } : sn)),
        sharingIds: new Set([...s.sharingIds].filter((x) => x !== id)),
        error: err instanceof Error ? err.message : 'Failed to unshare snippet',
      }));
      throw err;
    }
  },

  importSnippets: async (items) => {
    let imported = 0;
    let failed = 0;
    const created: SnippetRow[] = [];

    for (const item of items) {
      try {
        const row = await snippetsApi.createSnippet(item);
        const folder = get().folders.find((f) => f.id === row.folder_id);
        created.push({ ...row, folder_name: row.folder_name ?? folder?.name ?? null });
        imported++;
      } catch {
        failed++;
      }
    }

    if (created.length > 0) {
      set((s) => ({ snippets: [...s.snippets, ...created] }));
    }

    return { imported, failed };
  },
}));

// Selector: filtered + sorted snippet list derived from current store state.
export function useFilteredSnippets(): SnippetRow[] {
  const snippets = useSnippetStore((s) => s.snippets);
  const folderId = useSnippetStore((s) => s.selectedFolderId);
  const query = useSnippetStore((s) => s.searchQuery.trim().toLowerCase());
  const languageFilter = useSnippetStore((s) => s.languageFilter);
  const sortBy = useSnippetStore((s) => s.sortBy);
  const sortDir = useSnippetStore((s) => s.sortDir);

  const filtered = snippets.filter((s) => {
    if (folderId !== null && s.folder_id !== folderId) return false;
    if (languageFilter !== null && s.language !== languageFilter) return false;
    if (query.length === 0) return true;
    if (s.name.toLowerCase().includes(query)) return true;
    if (s.triggers.some((t) => t.toLowerCase().includes(query))) return true;
    if (s.tags.some((t) => t.toLowerCase().includes(query))) return true;
    return false;
  });

  return [...filtered].sort((a, b) => {
    // Pinned snippets always float to the top regardless of sort column.
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;

    let cmp = 0;
    if (sortBy === 'name') {
      cmp = a.name.localeCompare(b.name);
    } else if (sortBy === 'usage_count') {
      cmp = a.usage_count - b.usage_count;
    } else {
      cmp = a.updated_at.localeCompare(b.updated_at);
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });
}
