import { create } from 'zustand';
import type {
  Prompt,
  StrategyType,
  PreferredModel,
  ComplexityLevel,
  ExecutionType,
  IntentCategory,
  OutputType,
} from '@/types/database';
import { promptsApi } from '@/lib/api/promptsApi';
import type { PromptFormValues } from '@/types/schemas';

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
  load: () => Promise<void>;
  setFilters: (patch: Partial<PromptFilters>) => void;
  resetFilters: () => void;
  setCmdKOpen: (open: boolean) => void;
  addPrompt: (payload: PromptFormValues) => Promise<Prompt>;
  editPrompt: (id: string, patch: Partial<PromptFormValues>) => Promise<Prompt>;
  removePrompt: (id: string) => Promise<void>;
  markUsed: (id: string) => void;
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

  // Legacy shim
  get filter() {
    return get().filters.type;
  },
  setFilter: (f) => set((s) => ({ filters: { ...s.filters, type: f } })),

  load: async () => {
    set({ loading: true, error: null });
    try {
      const prompts = await promptsApi.listPrompts();
      set({ prompts, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load prompts',
      });
    }
  },

  setFilters: (patch) =>
    set((s) => ({ filters: { ...s.filters, ...patch } })),

  resetFilters: () => set({ filters: DEFAULT_FILTERS }),

  setCmdKOpen: (open) => set({ cmdKOpen: open }),

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

  markUsed: (id) => {
    void promptsApi.markUsed(id);
    const now = new Date().toISOString();
    set((s) => ({
      prompts: s.prompts.map((p) =>
        p.id === id ? { ...p, last_used_at: now } : p,
      ),
    }));
  },
}));

export function useFilteredPrompts(): Prompt[] {
  const prompts = usePromptStore((s) => s.prompts);
  const filters = usePromptStore((s) => s.filters);

  return prompts.filter((p) => {
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
  });
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
