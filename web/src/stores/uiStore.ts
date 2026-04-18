import { create } from 'zustand';

// Cross-cutting UI state. Kept separate from feature stores to avoid coupling
// the snippet panel state with global modals or theme toggles in the future.
interface UiStore {
  newSnippetOpen: boolean;
  openNewSnippet: () => void;
  closeNewSnippet: () => void;
}

export const useUiStore = create<UiStore>((set) => ({
  newSnippetOpen: false,
  openNewSnippet: () => set({ newSnippetOpen: true }),
  closeNewSnippet: () => set({ newSnippetOpen: false }),
}));
