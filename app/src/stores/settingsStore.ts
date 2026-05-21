import { create } from 'zustand';
import type { NotionSyncState, Profile } from '@/types/database';
import { settingsApi } from '@/lib/api/settingsApi';
import { supabase } from '@/lib/supabase';

type Prefix = '/' | '::' | ';';

interface SettingsStore {
  profile: Profile | null;
  notionSync: NotionSyncState | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  editProfile: (patch: { display_name?: string; shortcut_prefix?: Prefix }) => Promise<Profile>;
  changeEmail: (newEmail: string) => Promise<void>;
  editNotionSettings: (patch: { api_key?: string; db_id?: string }) => Promise<void>;
}

let authSubscribed = false;

export const useSettingsStore = create<SettingsStore>((set, get) => ({
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

    // Subscribe once: when Supabase emits USER_UPDATED (e.g. after the
    // email-change confirmation link is clicked), re-derive the profile so
    // the Account panel reflects the new email without a page reload.
    if (!authSubscribed) {
      authSubscribed = true;
      supabase.auth.onAuthStateChange((event) => {
        if (event !== 'USER_UPDATED') return;
        if (!get().profile) return;
        void settingsApi
          .getProfile()
          .then((profile) => set({ profile }))
          .catch((err) => {
            set({
              error:
                err instanceof Error ? err.message : 'Failed to refresh profile',
            });
          });
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
  changeEmail: async (newEmail: string) => {
    try {
      await settingsApi.updateEmail(newEmail);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to send verification email' });
      throw err;
    }
  },
  editNotionSettings: async (patch) => {
    try {
      await settingsApi.updateNotionSettings(patch);
      set((s) => {
        if (!s.notionSync) return {};
        return {
          notionSync: {
            ...s.notionSync,
            ...(patch.api_key !== undefined && { api_key: patch.api_key }),
            ...(patch.db_id !== undefined && { database_id: patch.db_id }),
          },
          error: null,
        };
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to save Notion settings' });
      throw err;
    }
  },
}));
