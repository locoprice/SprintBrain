import { create } from 'zustand';
import { applyTheme, getStoredTheme, type ThemePreference } from '@/lib/theme';

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

  // Create-prompt dialog (triggered by the header "New prompt" button)
  newPromptOpen: boolean;
  openNewPrompt: () => void;
  closeNewPrompt: () => void;

  // Edit-prompt dialog (triggered by clicking a prompt card)
  editPromptId: string | null;
  openEditPrompt: (id: string) => void;
  closeEditPrompt: () => void;

  // Prompt preview modal — shows assembled blocks + copy button
  promptPreviewId: string | null;
  openPromptPreview: (id: string) => void;
  closePromptPreview: () => void;

  // Draft preview — assembles blocks without requiring a saved prompt (create mode)
  promptDraftContent: string | null;
  openPromptDraftPreview: (content: string) => void;
  closePromptDraftPreview: () => void;

  // Transient toast notification (auto-dismissed by the Toast component)
  toast: { message: string; type: 'success' | 'error' } | null;
  showToast: (message: string, type?: 'success' | 'error') => void;
  clearToast: () => void;

  // Theme preference — persisted to localStorage, applied to <html data-theme>
  theme: ThemePreference;
  setTheme: (pref: ThemePreference) => void;
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

  newPromptOpen: false,
  openNewPrompt: () => set({ newPromptOpen: true }),
  closeNewPrompt: () => set({ newPromptOpen: false }),

  editPromptId: null,
  openEditPrompt: (id) => set({ editPromptId: id }),
  closeEditPrompt: () => set({ editPromptId: null }),

  promptPreviewId: null,
  openPromptPreview: (id) => set({ promptPreviewId: id }),
  closePromptPreview: () => set({ promptPreviewId: null }),

  promptDraftContent: null,
  openPromptDraftPreview: (content) => set({ promptDraftContent: content }),
  closePromptDraftPreview: () => set({ promptDraftContent: null }),

  toast: null,
  showToast: (message, type = 'success') => set({ toast: { message, type } }),
  clearToast: () => set({ toast: null }),

  theme: getStoredTheme(),
  setTheme: (pref) => {
    applyTheme(pref);
    set({ theme: pref });
  },
}));
