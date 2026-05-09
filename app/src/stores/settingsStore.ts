import { create } from 'zustand';
import type { NotionSyncState, Profile } from '@/types/database';
import { settingsApi } from '@/lib/api/settingsApi';
import { snippetsApi } from '@/lib/api/snippetsApi';

type Prefix = '/' | '::' | ';';

interface SettingsStore {
  profile: Profile | null;
  notionSync: NotionSyncState | null;
  lastSyncedAt: string | null;
  loading: boolean;
  syncing: boolean;
  error: string | null;
  syncError: string | null;
  load: () => Promise<void>;
  editProfile: (patch: { display_name?: string; shortcut_prefix?: Prefix }) => Promise<Profile>;
  syncTeam: () => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  profile: null,
  notionSync: null,
  lastSyncedAt: null,
  loading: false,
  syncing: false,
  error: null,
  syncError: null,
  load: async () => {
    set({ loading: true, error: null });
    try {
      const [profile, notionSync, lastSyncedAt] = await Promise.all([
        settingsApi.getProfile(),
        settingsApi.getNotionSync(),
        settingsApi.getLastSyncedAt(),
      ]);
      set({ profile, notionSync, lastSyncedAt, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load settings',
      });
    }
  },
  editProfile: async (patch) => {
    try {
      const profile = await settingsApi.updateProfile(patch);
      set({ profile, error: null });
      return profile;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to save profile' });
      throw err;
    }
  },
  syncTeam: async () => {
    set({ syncing: true, syncError: null });
    try {
      await snippetsApi.syncSnippets();
      const ts = await settingsApi.markSynced();
      set({ lastSyncedAt: ts, syncing: false });
    } catch (err) {
      set({
        syncing: false,
        syncError: err instanceof Error ? err.message : 'Sincronizzazione fallita',
      });
      throw err;
    }
  },
}));
