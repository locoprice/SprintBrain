import { create } from 'zustand';

// Cross-cutting UI state. Kept separate from feature stores to avoid coupling
// the snippet panel state with global modals or theme toggles in the future.

export type FolderDialogTarget = 'new' | string;

interface UiStore {
  // Create-snippet dialog (triggered by the header "New snippet" button)
  newSnippetOpen: boolean;
  openNewSnippet: () => void;
  closeNewSnippet: () => void;

  // Edit-snippet dialog (triggered by clicking a table row)
  editSnippetId: string | null;
  openEditSnippet: (id: string) => void;
  closeEditSnippet: () => void;

  // Folder dialog — 'new' = create mode, uuid = edit mode, null = closed
  folderDialogId: FolderDialogTarget | null;
  openFolderDialog: (id: FolderDialogTarget) => void;
  closeFolderDialog: () => void;
}

export const useUiStore = create<UiStore>((set) => ({
  newSnippetOpen: false,
  openNewSnippet: () => set({ newSnippetOpen: true }),
  closeNewSnippet: () => set({ newSnippetOpen: false }),

  editSnippetId: null,
  openEditSnippet: (id) => set({ editSnippetId: id }),
  closeEditSnippet: () => set({ editSnippetId: null }),

  folderDialogId: null,
  openFolderDialog: (id) => set({ folderDialogId: id }),
  closeFolderDialog: () => set({ folderDialogId: null }),
}));
