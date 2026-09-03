import { create } from 'zustand';
import { applyTheme, getStoredTheme, type ThemePreference } from '@/lib/theme';

// Cross-cutting UI state. Kept separate from feature stores to avoid coupling
// the snippet panel state with global modals or theme toggles in the future.

interface UiStore {
  // Create-snippet dialog (triggered by the header "New snippet" button)
  newSnippetOpen: boolean;
  openNewSnippet: () => void;
  closeNewSnippet: () => void;

  // Edit-snippet dialog (triggered by clicking a table row)
  editSnippetId: string | null;
  openEditSnippet: (id: string) => void;
  closeEditSnippet: () => void;

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

  // Version history panel — opened by clicking History on any snippet row
  historySnippetId: string | null;
  openHistory: (id: string) => void;
  closeHistory: () => void;

  // Label manager dialog — opened from the label filter on Snippets or Prompts
  labelManagerOpen: boolean;
  openLabelManager: () => void;
  closeLabelManager: () => void;

  // "Getting Started" onboarding modal (sidebar button + auto-shown once)
  onboardingOpen: boolean;
  openOnboarding: () => void;
  closeOnboarding: () => void;

  // Transient toast notification (auto-dismissed by the Toast component)
  toast: { message: string; type: 'success' | 'error' } | null;
  showToast: (message: string, type?: 'success' | 'error') => void;
  clearToast: () => void;

  // Theme preference — persisted to localStorage, applied to <html data-theme>
  theme: ThemePreference;
  setTheme: (pref: ThemePreference) => void;

  // Snippet editor's live preview panel — a per-device layout preference, so a
  // narrow screen can put it away and keep it away.
  snippetPreviewOpen: boolean;
  setSnippetPreviewOpen: (open: boolean) => void;

  // Snippets folder rail — same kind of per-device preference. The rail costs
  // the table 272px, which a 1024px screen cannot spare, so it starts closed
  // on a narrow one and open on a wide one until the user says otherwise.
  foldersRailOpen: boolean;
  setFoldersRailOpen: (open: boolean) => void;

  // Workspace sidebar, hidden to give the canvas the full width. Same kind of
  // per-device layout preference as the folder rail; persisted so a screen that
  // needs the room keeps it. Starts visible.
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

const PREVIEW_KEY = 'sprintbrain-snippet-preview';

// Same storage guard as getStoredTheme: a browser with site data blocked throws
// on access, and the vitest 'node' environment has no localStorage at all.
// Open is the default, since the preview is the reason the panel exists.
function getStoredPreviewOpen(): boolean {
  try {
    return localStorage.getItem(PREVIEW_KEY) !== 'closed';
  } catch {
    return true;
  }
}

function storePreviewOpen(open: boolean): void {
  try {
    localStorage.setItem(PREVIEW_KEY, open ? 'open' : 'closed');
  } catch {
    // Storage unavailable — the preference is per-device convenience only.
  }
}

const FOLDERS_RAIL_KEY = 'sprintbrain-folders-rail';

// The width below which the rail costs more than it gives: the snippets table
// needs ~967px and a 1280px window leaves it 667px with the rail open.
const FOLDERS_RAIL_MIN_WIDTH = 1280;

// No stored answer means no opinion yet, so the viewport decides. Once the user
// toggles it the stored value wins at every width — a deliberate choice should
// not be undone by resizing a window.
function getStoredFoldersRailOpen(): boolean {
  try {
    const stored = localStorage.getItem(FOLDERS_RAIL_KEY);
    if (stored === 'open') return true;
    if (stored === 'closed') return false;
  } catch {
    // fall through to the viewport default
  }
  try {
    return window.matchMedia(`(min-width: ${FOLDERS_RAIL_MIN_WIDTH}px)`).matches;
  } catch {
    return true;
  }
}

function storeFoldersRailOpen(open: boolean): void {
  try {
    localStorage.setItem(FOLDERS_RAIL_KEY, open ? 'open' : 'closed');
  } catch {
    // Storage unavailable — the preference is per-device convenience only.
  }
}

const SIDEBAR_KEY = 'sprintbrain-sidebar-collapsed';

// Mirrors the folder-rail helpers: a blocked store throws on access and the
// vitest 'node' environment has no localStorage. Visible is the default.
function getStoredSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

function storeSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'expanded');
  } catch {
    // Storage unavailable: the preference is per-device convenience only.
  }
}

export const useUiStore = create<UiStore>((set) => ({
  newSnippetOpen: false,
  openNewSnippet: () => set({ newSnippetOpen: true }),
  closeNewSnippet: () => set({ newSnippetOpen: false }),

  editSnippetId: null,
  openEditSnippet: (id) => set({ editSnippetId: id }),
  closeEditSnippet: () => set({ editSnippetId: null }),

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

  historySnippetId: null,
  openHistory: (id) => set({ historySnippetId: id }),
  closeHistory: () => set({ historySnippetId: null }),

  labelManagerOpen: false,
  openLabelManager: () => set({ labelManagerOpen: true }),
  closeLabelManager: () => set({ labelManagerOpen: false }),

  onboardingOpen: false,
  openOnboarding: () => set({ onboardingOpen: true }),
  closeOnboarding: () => set({ onboardingOpen: false }),

  toast: null,
  showToast: (message, type = 'success') => set({ toast: { message, type } }),
  clearToast: () => set({ toast: null }),

  theme: getStoredTheme(),
  setTheme: (pref) => {
    applyTheme(pref);
    set({ theme: pref });
  },

  snippetPreviewOpen: getStoredPreviewOpen(),
  setSnippetPreviewOpen: (open) => {
    storePreviewOpen(open);
    set({ snippetPreviewOpen: open });
  },

  foldersRailOpen: getStoredFoldersRailOpen(),
  setFoldersRailOpen: (open) => {
    storeFoldersRailOpen(open);
    set({ foldersRailOpen: open });
  },

  sidebarCollapsed: getStoredSidebarCollapsed(),
  setSidebarCollapsed: (collapsed) => {
    storeSidebarCollapsed(collapsed);
    set({ sidebarCollapsed: collapsed });
  },
}));
