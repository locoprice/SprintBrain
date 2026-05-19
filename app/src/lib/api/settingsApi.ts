import { supabase } from '@/lib/supabase';
import type { NotionSyncState, Profile } from '@/types/database';

// Live reads + writes for the Settings page.
//
// There is no `profiles` table — Profile is derived from the authed
// auth.users row. Edits land in `user_metadata` via supabase.auth.updateUser,
// which Supabase persists server-side and ships back via getUser/onAuthStateChange.

type Prefix = '/' | '::' | ';';

const PREFIXES: readonly Prefix[] = ['/', '::', ';'];
function isPrefix(v: unknown): v is Prefix {
  return typeof v === 'string' && (PREFIXES as readonly string[]).includes(v);
}

export interface SettingsApi {
  getProfile(): Promise<Profile>;
  updateProfile(patch: { display_name?: string; shortcut_prefix?: Prefix }): Promise<Profile>;
  updateEmail(newEmail: string): Promise<void>;
  getNotionSync(): Promise<NotionSyncState>;
  updateNotionSettings(patch: { api_key?: string; db_id?: string }): Promise<void>;
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

function pickShortcutPrefix(metadata: Record<string, unknown> | undefined): Prefix {
  const v = metadata?.['shortcut_prefix'];
  return isPrefix(v) ? v : '::';
}

function userToProfile(u: { id: string; email?: string | null; user_metadata?: Record<string, unknown>; created_at?: string }): Profile {
  const email = u.email ?? '';
  return {
    id: u.id,
    email,
    display_name: pickDisplayName(u.user_metadata, email),
    shortcut_prefix: pickShortcutPrefix(u.user_metadata),
    created_at: u.created_at ?? new Date().toISOString(),
  };
}

export const settingsApi: SettingsApi = {
  async getProfile() {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    if (!data.user) throw new Error('Not authenticated');
    return userToProfile(data.user);
  },

  async updateEmail(newEmail: string) {
    const trimmed = newEmail.trim().toLowerCase();
    // emailRedirectTo ensures the confirmation link lands on /auth/callback,
    // where the auth store is subscribed to onAuthStateChange and will pick
    // up the USER_UPDATED event with the new email. Without it, Supabase
    // falls back to the project Site URL and the dashboard never refreshes.
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent('/settings')}`;
    const { error } = await supabase.auth.updateUser(
      { email: trimmed },
      { emailRedirectTo: redirectTo },
    );
    if (error) throw error;
  },

  async updateProfile(patch) {
    const { data: cur, error: getErr } = await supabase.auth.getUser();
    if (getErr) throw getErr;
    if (!cur.user) throw new Error('Not authenticated');

    // Merge into existing user_metadata so unrelated keys (e.g. set by other
    // surfaces) survive. Only forward keys the caller actually changed.
    const next: Record<string, unknown> = { ...(cur.user.user_metadata ?? {}) };
    if (patch.display_name !== undefined) next['full_name'] = patch.display_name.trim();
    if (patch.shortcut_prefix !== undefined) next['shortcut_prefix'] = patch.shortcut_prefix;

    const { data, error } = await supabase.auth.updateUser({ data: next });
    if (error) throw error;
    if (!data.user) throw new Error('Update returned no user');
    return userToProfile(data.user);
  },

  async getNotionSync() {
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr) throw userErr;
    if (!userData.user) throw new Error('Not authenticated');

    const meta = userData.user.user_metadata ?? {};
    const api_key = typeof meta['notion_api_key'] === 'string' ? meta['notion_api_key'] : '';
    const database_id = typeof meta['notion_db_id'] === 'string' ? meta['notion_db_id'] : '';

    const { data, error } = await supabase
      .from('notion_sync_log')
      .select('ran_at, error')
      .eq('user_id', userData.user.id)
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    return {
      database_id,
      api_key,
      last_sync_at: data?.ran_at ?? null,
      status: (data?.error ? 'error' : 'idle') as NotionSyncState['status'],
      last_error: data?.error ?? null,
    };
  },

  async updateNotionSettings(patch) {
    const { data: cur, error: getErr } = await supabase.auth.getUser();
    if (getErr) throw getErr;
    if (!cur.user) throw new Error('Not authenticated');

    const next: Record<string, unknown> = { ...(cur.user.user_metadata ?? {}) };
    if (patch.api_key !== undefined) next['notion_api_key'] = patch.api_key.trim();
    if (patch.db_id !== undefined) next['notion_db_id'] = patch.db_id.trim();

    const { error } = await supabase.auth.updateUser({ data: next });
    if (error) throw error;
  },

};
