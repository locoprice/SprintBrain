import { create } from 'zustand';
import type { Folder, SnippetRow } from '@/types/database';
import type { FolderFormValues, SnippetFormValues } from '@/types/schemas';
import { snippetsApi } from '@/lib/api/snippetsApi';

interface SnippetStore {
  folders: Folder[];
  snippets: SnippetRow[];
  loading: boolean;
  error: string | null;
  selectedFolderId: string | null; // null = "All"
  searchQuery: string;
  /** Set of snippet IDs currently awaiting a share/unshare operation. */
  sharingIds: Set<string>;
  load: () => Promise<void>;
  setSelectedFolder: (id: string | null) => void;
  setSearchQuery: (q: string) => void;
  clearError: () => void;

  // Mutations — throw on failure so the calling dialog can keep the form open.
  addSnippet: (payload: SnippetFormValues) => Promise<SnippetRow>;
  editSnippet: (id: string, patch: Partial<SnippetFormValues>) => Promise<SnippetRow>;
  removeSnippet: (id: string) => Promise<void>;
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
}

export const useSnippetStore = create<SnippetStore>((set, get) => ({
  folders: [],
  snippets: [],
  loading: false,
  error: null,
  selectedFolderId: null,
  searchQuery: '',
  sharingIds: new Set<string>(),
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
      set((s) => ({
        snippets: s.snippets.filter((sn) => sn.id !== id),
        error: null,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete snippet';
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
}));

// Selector: filtered snippet list derived from current folder + query.
export function useFilteredSnippets(): SnippetRow[] {
  const snippets = useSnippetStore((s) => s.snippets);
  const folderId = useSnippetStore((s) => s.selectedFolderId);
  const query = useSnippetStore((s) => s.searchQuery.trim().toLowerCase());

  return snippets.filter((s) => {
    if (folderId !== null && s.folder_id !== folderId) return false;
    if (query.length === 0) return true;
    if (s.name.toLowerCase().includes(query)) return true;
    if (s.triggers.some((t) => t.toLowerCase().includes(query))) return true;
    if (s.tags.some((t) => t.toLowerCase().includes(query))) return true;
    return false;
  });
}
