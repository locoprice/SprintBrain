import { create } from 'zustand';
import type { Label, LabelColor } from '@/types/database';
import { labelsApi } from '@/lib/api/labelsApi';

// The label vocabulary and its assignments (LABELS-001).
//
// One store, not two: a label is shared by snippets and prompts, so the catalog
// and the assignment maps have to live somewhere both pages can read. What each
// page does NOT share is the active filter — selecting "Sales" on Snippets must
// not silently filter Prompts — so that state stays in snippetStore /
// promptStore alongside their other filters.
//
// This store is loaded independently of the asset lists. A failure here shows a
// message and leaves badges off; it never blocks a snippet or prompt from
// rendering (same contract as folderShares).

interface LabelStore {
  labels: Label[];
  /** Label ids keyed by snippet id. */
  snippetLabels: Map<string, string[]>;
  /** Label ids keyed by prompt id. */
  promptLabels: Map<string, string[]>;
  loading: boolean;
  /** True once a load has completed, so both pages don't refetch on every mount. */
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  clearError: () => void;
  /** `parentId` nests the new label under an existing root (LABELS-002). */
  addLabel: (name: string, color: LabelColor, parentId?: string | null) => Promise<Label>;
  editLabel: (
    id: string,
    patch: { name?: string; color?: LabelColor; parent_id?: string | null },
  ) => Promise<Label>;
  /**
   * Delete a label; mirrors the DB cascade by dropping it from both maps, and
   * the DB's ON DELETE SET NULL by promoting its sub-labels to root.
   */
  removeLabel: (id: string) => Promise<void>;
  setSnippetLabels: (snippetId: string, labelIds: string[]) => Promise<void>;
  setPromptLabels: (promptId: string, labelIds: string[]) => Promise<void>;
}

function byName(a: Label, b: Label): number {
  return a.name.localeCompare(b.name);
}

/** Drop one label id from every asset in a map, keeping unaffected rows shared. */
function stripLabel(map: Map<string, string[]>, labelId: string): Map<string, string[]> {
  const next = new Map(map);
  for (const [assetId, ids] of next) {
    if (!ids.includes(labelId)) continue;
    const kept = ids.filter((id) => id !== labelId);
    if (kept.length > 0) {
      next.set(assetId, kept);
    } else {
      next.delete(assetId);
    }
  }
  return next;
}

/** Write one asset's assignments into a map, dropping the key when empty. */
function assign(
  map: Map<string, string[]>,
  assetId: string,
  labelIds: string[],
): Map<string, string[]> {
  const next = new Map(map);
  if (labelIds.length > 0) {
    next.set(assetId, [...labelIds]);
  } else {
    next.delete(assetId);
  }
  return next;
}

export const useLabelStore = create<LabelStore>((set, get) => ({
  labels: [],
  snippetLabels: new Map<string, string[]>(),
  promptLabels: new Map<string, string[]>(),
  loading: false,
  loaded: false,
  error: null,

  load: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const [labels, assignments] = await Promise.all([
        labelsApi.listLabels(),
        labelsApi.listAssignments(),
      ]);
      set({
        labels: [...labels].sort(byName),
        snippetLabels: assignments.snippets,
        promptLabels: assignments.prompts,
        loading: false,
        loaded: true,
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load labels',
      });
    }
  },

  clearError: () => set({ error: null }),

  addLabel: async (name, color, parentId = null) => {
    try {
      const label = await labelsApi.createLabel(name, color, parentId);
      set((s) => ({ labels: [...s.labels, label].sort(byName), error: null }));
      return label;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to create label' });
      throw err;
    }
  },

  editLabel: async (id, patch) => {
    try {
      const label = await labelsApi.updateLabel(id, patch);
      set((s) => ({
        labels: s.labels.map((l) => (l.id === id ? label : l)).sort(byName),
        error: null,
      }));
      return label;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to update label' });
      throw err;
    }
  },

  removeLabel: async (id) => {
    try {
      await labelsApi.deleteLabel(id);
      set((s) => ({
        // Promote sub-labels to root rather than losing them, mirroring the
        // FK's ON DELETE SET NULL. Without this they'd keep pointing at a
        // deleted parent until the next reload and render as orphans.
        labels: s.labels
          .filter((l) => l.id !== id)
          .map((l) => (l.parent_id === id ? { ...l, parent_id: null } : l)),
        // The FK cascade already removed the rows server-side; mirror it in
        // memory so every badge disappears without a refetch.
        snippetLabels: stripLabel(s.snippetLabels, id),
        promptLabels: stripLabel(s.promptLabels, id),
        error: null,
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to delete label' });
      throw err;
    }
  },

  setSnippetLabels: async (snippetId, labelIds) => {
    const previous = get().snippetLabels;
    set((s) => ({ snippetLabels: assign(s.snippetLabels, snippetId, labelIds) }));
    try {
      await labelsApi.setSnippetLabels(snippetId, labelIds);
      set({ error: null });
    } catch (err) {
      set({
        snippetLabels: previous,
        error: err instanceof Error ? err.message : 'Failed to save labels',
      });
      throw err;
    }
  },

  setPromptLabels: async (promptId, labelIds) => {
    const previous = get().promptLabels;
    set((s) => ({ promptLabels: assign(s.promptLabels, promptId, labelIds) }));
    try {
      await labelsApi.setPromptLabels(promptId, labelIds);
      set({ error: null });
    } catch (err) {
      set({
        promptLabels: previous,
        error: err instanceof Error ? err.message : 'Failed to save labels',
      });
      throw err;
    }
  },
}));
