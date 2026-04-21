import { supabase } from '@/lib/supabase';
import type { NotionSyncState, Profile } from '@/types/database';

// Live reads for the Settings page.
//
// There is no `profiles` table yet — Profile is derived from the authed
// user (email, user_metadata). `shortcut_prefix` is an extension-level
// setting and is not persisted in Postgres; the dashboard just displays
// the default value. A future ticket can promote it to a real column on
// a per-user `settings` row.

export interface SettingsApi {
  getProfile(): Promise<Profile>;
  getNotionSync(): Promise<NotionSyncState>;
}

function pickDisplayName(
  metadata: Record<string, unknown> | undefined,
  email: string,
): string {
  const name = metadata?.['full_name'] ?? metadata?.['name'];
  if (typeof name === 'string' && name.trim()) return name.trim();
  const handle = email.split('@')[0];
  return handle && handle.length > 0 ? handle : 'Account';
}

export const settingsApi: SettingsApi = {
  async getProfile() {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    if (!data.user) throw new Error('Not authenticated');
    const u = data.user;
    const email = u.email ?? '';
    return {
      id: u.id,
      email,
      display_name: pickDisplayName(u.user_metadata, email),
      // Extension config; not yet persisted server-side.
      shortcut_prefix: ';',
      created_at: u.created_at ?? new Date().toISOString(),
    };
  },

  async getNotionSync() {
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr) throw userErr;
    if (!userData.user) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .from('notion_sync_log')
      .select('ran_at, error')
      .eq('user_id', userData.user.id)
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return {
        // database_id lives in the extension's chrome.storage config.
        // The dashboard doesn't know it; show empty until we migrate that.
        database_id: '',
        last_sync_at: null,
        status: 'idle',
        last_error: null,
      };
    }

    return {
      database_id: '',
      last_sync_at: data.ran_at,
      status: data.error ? 'error' : 'idle',
      last_error: data.error,
    };
  },
};
