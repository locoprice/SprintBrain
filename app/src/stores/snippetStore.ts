import { create } from 'zustand';
import type { Folder, FolderShareInfo, Snippet, SnippetRevision, SnippetRow } from '@/types/database';
import type { FolderFormValues, SnippetFormValues } from '@/types/schemas';
import { snippetsApi } from '@/lib/api/snippetsApi';
import { permissionsApi } from '@/lib/api/permissionsApi';
import { revisionsApi } from '@/lib/api/revisionsApi';
import { buildFolderShares } from '@/lib/folderShares';

export type SortColumn = 'updated_at' | 'usage_count' | 'name';
export type SortDir = 'asc' | 'desc';

export interface ImportBatchResult {
  imported: number;
  failed: number;
}

interface SnippetStore {
  folders: Folder[];
  snippets: SnippetRow[];
  /** Per-folder sharing status (shared/team) for the folder-tree badges. Folders absent from the map are private. */
  folderShares: Map<string, FolderShareInfo>;
  loading: boolean;
  error: string | null;
  selectedFolderId: string | null; // null = "All"
  searchQuery: string;
  /** Set of snippet IDs currently awaiting a Notion push. */
  notionPushingIds: Set<string>;
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
  /** Add or remove a batch of ids from the selection in one update (group rows). */
  setSnippetsSelected: (ids: string[], selected: boolean) => void;
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
  /** Toggle the is_active flag on a snippet. Optimistic; rolls back on failure. */
  toggleActive: (id: string) => Promise<void>;
  /** Duplicate a snippet. Returns the new row. */
  duplicateSnippet: (id: string) => Promise<SnippetRow>;
  addFolder: (payload: FolderFormValues) => Promise<Folder>;
  editFolder: (id: string, patch: Partial<FolderFormValues>) => Promise<Folder>;
  removeFolder: (id: string) => Promise<void>;
  /**
   * Push (or re-push) a snippet to the shared team Notion DB via Edge
   * Function. Idempotent: updates the existing Notion page when one is
   * already linked. Team visibility is folder-level — this only syndicates
   * content to Notion.
   */
  pushSnippetToNotion: (id: string) => Promise<void>;
  /**
   * Bulk-create snippets from an import payload. Creates each snippet
   * individually and appends all successful rows to the store in one
   * update. Does not set store.error — callers own result feedback.
   */
  importSnippets: (items: SnippetFormValues[]) => Promise<ImportBatchResult>;

  // ── Version history ────────────────────────────────────────────────────────
  revisions: SnippetRevision[];
  revisionsSnippetId: string | null;
  revisionsLoading: boolean;
  /** Fetch all revisions for a snippet and cache them in the store. */
  loadRevisions: (snippetId: string) => Promise<void>;
  /**
   * Save the snippet's full content via the atomic `save_snippet_with_revision`
   * RPC, then update the in-memory row. Replaces `editSnippet` in the edit
   * dialog so every "Save changes" click produces a revision entry.
   */
  editSnippetWithRevision: (
    id: string,
    patch: SnippetFormValues,
    editNote?: string,
  ) => Promise<SnippetRow>;
  /**
   * Restore an older revision by re-saving its content as a new version.
   * The restored snippet gets the revision's title + body + bodies; all other
   * metadata (shortcut, folder, pinned, etc.) is preserved from the current row.
   */
  restoreRevision: (snippetId: string, revision: SnippetRevision) => Promise<void>;
}

export const useSnippetStore = create<SnippetStore>((set, get) => ({
  folders: [],
  snippets: [],
  folderShares: new Map<string, FolderShareInfo>(),
  loading: false,
  error: null,
  revisions: [],
  revisionsSnippetId: null,
  revisionsLoading: false,
  selectedFolderId: null,
  searchQuery: '',
  notionPushingIds: new Set<string>(),
  selectedIds: new Set<string>(),
  sortBy: 'updated_at',
  sortDir: 'desc',
  languageFilter: null,
  bulkMoving: false,
  bulkDeleting: false,
  load: async () => {
    set({ loading: true, error: null });
    // Folder share-status powers the tree badges. Fetched in parallel but kept
    // strictly NON-FATAL: a grants failure must never block the folder list
    // (that fragility is exactly what produced the "Failed to load snippets"
    // regression). On any error we fall back to "no badges".
    const sharesPromise = permissionsApi
      .listAllGrants()
      .then(buildFolderShares)
      .catch(() => new Map<string, FolderShareInfo>());
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
    set({ folderShares: await sharesPromise });
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

  setSnippetsSelected: (ids, selected) =>
    set((s) => {
      const next = new Set(s.selectedIds);
      if (selected) {
        for (const id of ids) next.add(id);
      } else {
        for (const id of ids) next.delete(id);
      }
      return { selectedIds: next };
    }),

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

  toggleActive: async (id) => {
    const target = get().snippets.find((s) => s.id === id);
    if (!target) return;
    const next = !target.is_active;
    // Optimistic update so the row dims (or un-dims) immediately.
    set((s) => ({
      snippets: s.snippets.map((sn) => (sn.id === id ? { ...sn, is_active: next } : sn)),
    }));
    try {
      const row = await snippetsApi.setActive(id, next);
      const folder = get().folders.find((f) => f.id === row.folder_id);
      set((s) => ({
        snippets: s.snippets.map((sn) =>
          sn.id === id ? { ...row, folder_name: row.folder_name ?? folder?.name ?? null } : sn,
        ),
        error: null,
      }));
    } catch (err) {
      // Rollback optimistic update on failure.
      set((s) => ({
        snippets: s.snippets.map((sn) =>
          sn.id === id ? { ...sn, is_active: target.is_active } : sn,
        ),
        error: err instanceof Error ? err.message : 'Failed to toggle snippet status',
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

  pushSnippetToNotion: async (id) => {
    // The spinner (notionPushingIds) is the user feedback; nothing to update
    // optimistically because the push only links a Notion page.
    set((s) => ({ notionPushingIds: new Set([...s.notionPushingIds, id]) }));
    try {
      const { notion_page_id } = await snippetsApi.pushToNotion(id);
      // Persist the notion_page_id returned by the Edge Function.
      set((s) => ({
        snippets: s.snippets.map((sn) =>
          sn.id === id ? { ...sn, notion_page_id } : sn,
        ),
        notionPushingIds: new Set([...s.notionPushingIds].filter((x) => x !== id)),
        error: null,
      }));
    } catch (err) {
      set((s) => ({
        notionPushingIds: new Set([...s.notionPushingIds].filter((x) => x !== id)),
        error: err instanceof Error ? err.message : 'Failed to push snippet to Notion',
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

  // ── Version history ──────────────────────────────────────────────────────

  loadRevisions: async (snippetId) => {
    set({ revisionsLoading: true, revisionsSnippetId: snippetId });
    try {
      const revisions = await revisionsApi.listRevisions(snippetId);
      set({ revisions, revisionsLoading: false });
    } catch (err) {
      set({
        revisionsLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load version history',
      });
    }
  },

  editSnippetWithRevision: async (id, patch, editNote) => {
    const snippet = get().snippets.find((s) => s.id === id);
    if (!snippet) throw new Error('Snippet not found');
    try {
      await revisionsApi.saveWithRevision(
        id,
        {
          title: patch.name,
          shortcut: patch.trigger,
          body: patch.content,
          bodies: patch.bodies,
          lang: patch.language,
          folder_id: patch.folder_id,
          pinned: patch.pinned ?? false,
          alternative_queries: patch.alternative_queries ?? [],
          enable_urgency_timer: patch.enable_urgency_timer ?? false,
          timer_duration_ms: patch.timer_duration_ms ?? 0,
          scarcity_count: patch.scarcity_count ?? 0,
        },
        editNote,
      );
      const folder = patch.folder_id
        ? get().folders.find((f) => f.id === patch.folder_id)
        : null;
      const updatedRow: SnippetRow = {
        ...snippet,
        name: patch.name,
        content: patch.content,
        bodies: patch.bodies,
        triggers: [patch.trigger],
        language: patch.language,
        folder_id: patch.folder_id,
        folder_name:
          patch.folder_id === snippet.folder_id
            ? snippet.folder_name
            : (folder?.name ?? null),
        pinned: patch.pinned ?? false,
        alternative_queries: patch.alternative_queries ?? [],
        enable_urgency_timer: patch.enable_urgency_timer ?? false,
        timer_duration_ms: patch.timer_duration_ms ?? 0,
        scarcity_count: patch.scarcity_count ?? 0,
        updated_at: new Date().toISOString(),
      };
      set((s) => ({
        snippets: s.snippets.map((sn) => (sn.id === id ? updatedRow : sn)),
        // Invalidate the revision cache for this snippet so the next History
        // panel open always re-fetches rather than showing a stale list.
        revisions: s.revisionsSnippetId === id ? [] : s.revisions,
        revisionsSnippetId: s.revisionsSnippetId === id ? null : s.revisionsSnippetId,
        error: null,
      }));
      return updatedRow;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save snippet';
      set({ error: msg });
      throw err;
    }
  },

  restoreRevision: async (snippetId, revision) => {
    const snippet = get().snippets.find((s) => s.id === snippetId);
    if (!snippet) throw new Error('Snippet not found');
    try {
      // Re-save the revision's content as a new version, preserving all current
      // metadata (shortcut, folder, pinned, etc.) unchanged.
      await revisionsApi.saveWithRevision(
        snippetId,
        {
          title: revision.title,
          shortcut: snippet.triggers[0] ?? '',
          body: revision.body,
          bodies: revision.bodies,
          lang: snippet.language,
          folder_id: snippet.folder_id,
          pinned: snippet.pinned,
          enable_urgency_timer: snippet.enable_urgency_timer,
          timer_duration_ms: snippet.timer_duration_ms,
          scarcity_count: snippet.scarcity_count,
          alternative_queries: snippet.alternative_queries,
        },
        `Restored from v${revision.version_number}`,
      );
      const restoredRow: SnippetRow = {
        ...snippet,
        name: revision.title,
        content: revision.body,
        bodies: revision.bodies,
        updated_at: new Date().toISOString(),
      };
      set((s) => ({
        snippets: s.snippets.map((sn) => (sn.id === snippetId ? restoredRow : sn)),
        error: null,
      }));
      // Refresh the history list so the new "restored" version appears.
      if (get().revisionsSnippetId === snippetId) {
        await get().loadRevisions(snippetId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to restore revision';
      set({ error: msg });
      throw err;
    }
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
    if (s.alternative_queries.some((q) => q.toLowerCase().includes(query))) return true;
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
