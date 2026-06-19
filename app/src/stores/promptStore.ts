import { useMemo } from 'react';
import { create } from 'zustand';
import type {
  Prompt,
  Folder,
  FolderShareInfo,
  StrategyType,
  PreferredModel,
  ComplexityLevel,
  ExecutionType,
  IntentCategory,
  OutputType,
} from '@/types/database';
import { promptsApi } from '@/lib/api/promptsApi';
import { foldersApi } from '@/lib/api/foldersApi';
import { permissionsApi } from '@/lib/api/permissionsApi';
import { buildFolderShares } from '@/lib/folderShares';
import type { PromptFormValues, FolderFormValues } from '@/types/schemas';

export interface PromptFilters {
  type: 'all' | 'one-shot' | 'few-shot';
  strategy: StrategyType | null;
  intent: IntentCategory | null;
  model: PreferredModel | null;
  complexity: ComplexityLevel | null;
  executionType: ExecutionType | null;
  outputType: OutputType | null;
  search: string;
}

// Legacy alias kept for components that read a single `filter` value.
export type PromptFilter = 'all' | 'one-shot' | 'few-shot';

const DEFAULT_FILTERS: PromptFilters = {
  type: 'all',
  strategy: null,
  intent: null,
  model: null,
  complexity: null,
  executionType: null,
  outputType: null,
  search: '',
};

interface PromptStore {
  prompts: Prompt[];
  loading: boolean;
  error: string | null;
  filters: PromptFilters;
  cmdKOpen: boolean;
  /** Set of prompt IDs currently awaiting a Notion push. */
  notionPushingIds: Set<string>;
  /** Folders (shared with snippets) for grouping prompts + team sharing. */
  folders: Folder[];
  /** Per-folder sharing status (shared/team) for the folder-tree badges. */
  folderShares: Map<string, FolderShareInfo>;
  /** Selected folder filter; null = "All prompts". */
  selectedFolderId: string | null;
  load: () => Promise<void>;
  setFilters: (patch: Partial<PromptFilters>) => void;
  resetFilters: () => void;
  setCmdKOpen: (open: boolean) => void;
  setSelectedFolder: (id: string | null) => void;
  addPrompt: (payload: PromptFormValues) => Promise<Prompt>;
  editPrompt: (id: string, patch: Partial<PromptFormValues>) => Promise<Prompt>;
  removePrompt: (id: string) => Promise<void>;
  markUsed: (id: string) => void;
  /** Create a folder and add it to the store. */
  addFolder: (payload: FolderFormValues) => Promise<Folder>;
  /** Rename / change icon of a folder. */
  editFolder: (id: string, patch: Partial<FolderFormValues>) => Promise<Folder>;
  /** Delete a folder; its prompts drop back to "no folder". */
  removeFolder: (id: string) => Promise<void>;
  /**
   * Push (or re-push) a prompt to the shared team Notion DB via Edge Function.
   * Idempotent: updates the existing Notion page when one is already linked.
   */
  pushPromptToNotion: (id: string) => Promise<void>;
  // Legacy compat — reads/writes filters.type
  filter: PromptFilter;
  setFilter: (f: PromptFilter) => void;
}

export const usePromptStore = create<PromptStore>((set, get) => ({
  prompts: [],
  loading: false,
  error: null,
  filters: DEFAULT_FILTERS,
  cmdKOpen: false,
  notionPushingIds: new Set<string>(),
  folders: [],
  folderShares: new Map<string, FolderShareInfo>(),
  selectedFolderId: null,

  // Legacy shim
  get filter() {
    return get().filters.type;
  },
  setFilter: (f) => set((s) => ({ filters: { ...s.filters, type: f } })),

  load: async () => {
    set({ loading: true, error: null });
    // Folder share-status powers the tree badges. Fetched in parallel but kept
    // strictly NON-FATAL: a grants failure must never block the prompt list.
    // Mirrors snippetStore.load.
    const sharesPromise = permissionsApi
      .listAllGrants()
      .then(buildFolderShares)
      .catch(() => new Map<string, FolderShareInfo>());
    try {
      const [folders, prompts] = await Promise.all([
        foldersApi.listFolders(),
        promptsApi.listPrompts(),
      ]);
      set({ folders, prompts, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load prompts',
      });
    }
    set({ folderShares: await sharesPromise });
  },

  setFilters: (patch) =>
    set((s) => ({ filters: { ...s.filters, ...patch } })),

  resetFilters: () => set({ filters: DEFAULT_FILTERS }),

  setCmdKOpen: (open) => set({ cmdKOpen: open }),

  setSelectedFolder: (id) => set({ selectedFolderId: id }),

  addPrompt: async (payload) => {
    try {
      const row = await promptsApi.createPrompt(payload);
      set((s) => ({ prompts: [row, ...s.prompts], error: null }));
      return row;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to create prompt' });
      throw err;
    }
  },

  editPrompt: async (id, patch) => {
    try {
      const row = await promptsApi.updatePrompt(id, patch);
      set((s) => ({
        prompts: s.prompts
          .map((p) => (p.id === id ? row : p))
          .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)),
        error: null,
      }));
      return row;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to update prompt' });
      throw err;
    }
  },

  removePrompt: async (id) => {
    try {
      await promptsApi.deletePrompt(id);
      set((s) => ({ prompts: s.prompts.filter((p) => p.id !== id), error: null }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to delete prompt' });
      throw err;
    }
  },

  addFolder: async (payload) => {
    try {
      const folder = await foldersApi.createFolder(payload);
      set((s) => ({ folders: [...s.folders, folder], error: null }));
      return folder;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to create folder' });
      throw err;
    }
  },

  editFolder: async (id, patch) => {
    try {
      const folder = await foldersApi.updateFolder(id, patch);
      set((s) => ({
        folders: s.folders.map((f) => (f.id === id ? folder : f)),
        error: null,
      }));
      return folder;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to update folder' });
      throw err;
    }
  },

  removeFolder: async (id) => {
    try {
      await foldersApi.deleteFolder(id);
      set((s) => ({
        folders: s.folders.filter((f) => f.id !== id),
        // Mirror the server-side reassignment: prompts in this folder drop back
        // to "no folder" in memory.
        prompts: s.prompts.map((p) =>
          p.folder_id === id ? { ...p, folder_id: null } : p,
        ),
        // Clear the folder selection if it was the one we just removed.
        selectedFolderId: s.selectedFolderId === id ? null : s.selectedFolderId,
        error: null,
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to delete folder' });
      throw err;
    }
  },

  markUsed: (id) => {
    void promptsApi.markUsed(id);
    const now = new Date().toISOString();
    set((s) => ({
      prompts: s.prompts.map((p) =>
        p.id === id ? { ...p, last_used_at: now } : p,
      ),
    }));
  },

  pushPromptToNotion: async (id) => {
    set((s) => ({ notionPushingIds: new Set([...s.notionPushingIds, id]) }));
    try {
      const { notion_page_id } = await promptsApi.pushToNotion(id);
      set((s) => ({
        prompts: s.prompts.map((p) => (p.id === id ? { ...p, notion_page_id } : p)),
        notionPushingIds: new Set([...s.notionPushingIds].filter((x) => x !== id)),
        error: null,
      }));
    } catch (err) {
      set((s) => ({
        notionPushingIds: new Set([...s.notionPushingIds].filter((x) => x !== id)),
        error: err instanceof Error ? err.message : 'Failed to push prompt to Notion',
      }));
      throw err;
    }
  },
}));

export function useFilteredPrompts(): Prompt[] {
  const prompts = usePromptStore((s) => s.prompts);
  const filters = usePromptStore((s) => s.filters);
  const selectedFolderId = usePromptStore((s) => s.selectedFolderId);

  return useMemo(() => prompts.filter((p) => {
    if (selectedFolderId !== null && p.folder_id !== selectedFolderId) return false;
    if (filters.type !== 'all' && p.type !== filters.type) return false;
    if (filters.strategy && p.strategy_type !== filters.strategy) return false;
    if (filters.intent && p.intent_category !== filters.intent) return false;
    if (filters.model && p.preferred_model !== filters.model) return false;
    if (filters.complexity && p.complexity_level !== filters.complexity) return false;
    if (filters.executionType && p.execution_type !== filters.executionType) return false;
    if (filters.outputType && p.output_type !== filters.outputType) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const inName = p.name.toLowerCase().includes(q);
      const inTags = p.tags.some((t) => t.toLowerCase().includes(q));
      const inIntent = (p.intent_category ?? '').toLowerCase().includes(q);
      const inContent = p.content.toLowerCase().includes(q);
      if (!inName && !inTags && !inIntent && !inContent) return false;
    }
    return true;
  }), [prompts, filters, selectedFolderId]);
}

export function useActiveFilterCount(): number {
  const filters = usePromptStore((s) => s.filters);
  let count = 0;
  if (filters.type !== 'all') count++;
  if (filters.strategy) count++;
  if (filters.intent) count++;
  if (filters.model) count++;
  if (filters.complexity) count++;
  if (filters.executionType) count++;
  if (filters.outputType) count++;
  if (filters.search) count++;
  return count;
}
