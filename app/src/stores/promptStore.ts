import { create } from 'zustand';
import type { Prompt } from '@/types/database';
import { promptsApi } from '@/lib/api/promptsApi';
import type { PromptFormValues } from '@/types/schemas';

export type PromptFilter = 'all' | 'one-shot' | 'few-shot';

interface PromptStore {
  prompts: Prompt[];
  loading: boolean;
  error: string | null;
  filter: PromptFilter;
  load: () => Promise<void>;
  setFilter: (f: PromptFilter) => void;
  addPrompt: (payload: PromptFormValues) => Promise<Prompt>;
  editPrompt: (id: string, patch: Partial<PromptFormValues>) => Promise<Prompt>;
  removePrompt: (id: string) => Promise<void>;
}

export const usePromptStore = create<PromptStore>((set) => ({
  prompts: [],
  loading: false,
  error: null,
  filter: 'all',
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
  setFilter: (filter) => set({ filter }),
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
}));

export function useFilteredPrompts(): Prompt[] {
  const prompts = usePromptStore((s) => s.prompts);
  const filter = usePromptStore((s) => s.filter);
  if (filter === 'all') return prompts;
  return prompts.filter((p) => p.type === filter);
}
