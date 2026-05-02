import { create } from 'zustand';
import type { NotionSyncState, Profile } from '@/types/database';
import { settingsApi } from '@/lib/api/settingsApi';

type Prefix = '/' | '::' | ';';

interface SettingsStore {
  profile: Profile | null;
  notionSync: NotionSyncState | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  editProfile: (patch: { display_name?: string; shortcut_prefix?: Prefix }) => Promise<Profile>;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  profile: null,
  notionSync: null,
  loading: false,
  error: null,
  load: async () => {
    set({ loading: true, error: null });
    try {
      const [profile, notionSync] = await Promise.all([
        settingsApi.getProfile(),
        settingsApi.getNotionSync(),
      ]);
      set({ profile, notionSync, loading: false });
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
}));
