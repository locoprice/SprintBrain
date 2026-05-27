import { create } from 'zustand';
import { APP_VERSION } from '@/lib/appInfo';

const KEYS = {
  init:     'sb_notif_initialized',
  snippets: 'sb_notif_seen_snippets',
  prompts:  'sb_notif_seen_prompts',
  version:  'sb_notif_seen_version',
} as const;

function loadSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function persistSet(key: string, set: Set<string>): void {
  localStorage.setItem(key, JSON.stringify(Array.from(set)));
}

interface NotificationsStore {
  seenSnippetIds: Set<string>;
  seenPromptIds: Set<string>;
  seenVersion: string;
  /**
   * Mark every currently loaded item as seen. Called the first time the store
   * is hydrated against a loaded snippet/prompt list, so that pre-existing
   * content does not register as a notification.
   */
  initialize: (currentSnippetIds: string[], currentPromptIds: string[]) => void;
  /** Mark every currently loaded item plus the current version as seen. */
  markAllSeen: (currentSnippetIds: string[], currentPromptIds: string[]) => void;
}

export const useNotificationsStore = create<NotificationsStore>((set) => ({
  seenSnippetIds: loadSet(KEYS.snippets),
  seenPromptIds:  loadSet(KEYS.prompts),
  seenVersion:    localStorage.getItem(KEYS.version) ?? '',

  initialize: (snippetIds, promptIds) => {
    if (localStorage.getItem(KEYS.init)) return;
    const seenSnippetIds = new Set(snippetIds);
    const seenPromptIds  = new Set(promptIds);
    persistSet(KEYS.snippets, seenSnippetIds);
    persistSet(KEYS.prompts,  seenPromptIds);
    localStorage.setItem(KEYS.version, APP_VERSION);
    localStorage.setItem(KEYS.init, '1');
    set({ seenSnippetIds, seenPromptIds, seenVersion: APP_VERSION });
  },

  markAllSeen: (snippetIds, promptIds) => {
    const seenSnippetIds = new Set(snippetIds);
    const seenPromptIds  = new Set(promptIds);
    persistSet(KEYS.snippets, seenSnippetIds);
    persistSet(KEYS.prompts,  seenPromptIds);
    localStorage.setItem(KEYS.version, APP_VERSION);
    set({ seenSnippetIds, seenPromptIds, seenVersion: APP_VERSION });
  },
}));
