import { create } from 'zustand';
import type { Folder, SnippetRow } from '@/types/database';
import { snippetsApi } from '@/lib/api/snippetsApi';

interface SnippetStore {
  folders: Folder[];
  snippets: SnippetRow[];
  loading: boolean;
  error: string | null;
  selectedFolderId: string | null; // null = "All"
  searchQuery: string;
  load: () => Promise<void>;
  setSelectedFolder: (id: string | null) => void;
  setSearchQuery: (q: string) => void;
}

export const useSnippetStore = create<SnippetStore>((set) => ({
  folders: [],
  snippets: [],
  loading: false,
  error: null,
  selectedFolderId: null,
  searchQuery: '',
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
