import { create } from 'zustand';
import type { Prompt } from '@/types/database';
import { promptsApi } from '@/lib/api/promptsApi';

export type PromptFilter = 'all' | 'one-shot' | 'few-shot';

interface PromptStore {
  prompts: Prompt[];
  loading: boolean;
  error: string | null;
  filter: PromptFilter;
  load: () => Promise<void>;
  setFilter: (f: PromptFilter) => void;
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
}));

export function useFilteredPrompts(): Prompt[] {
  const prompts = usePromptStore((s) => s.prompts);
  const filter = usePromptStore((s) => s.filter);
  if (filter === 'all') return prompts;
  return prompts.filter((p) => p.type === filter);
}
