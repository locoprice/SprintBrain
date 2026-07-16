import { supabase } from '@/lib/supabase';
import type { ActivationKey, NotionSyncState, Profile } from '@/types/database';
import { DEFAULT_TRIGGER_CONFIG } from '@/lib/triggerUtils';
import {
  AVATAR_BUCKET,
  buildAvatarPath,
  buildLogoPath,
  LOGO_BUCKET,
  objectPathFromPublicUrl,
  pickHttpsUrl,
  validateImageFile,
} from '@/lib/branding';

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

/** Allowed fields for a profile patch. All keys are optional. */
export interface ProfilePatch {
  display_name?: string;
  company_name?: string;
  shortcut_prefix?: Prefix;
  trigger_snippet_seq?: string;
  trigger_prompt_seq?: string;
  trigger_snippet_key?: ActivationKey;
  trigger_prompt_key?: ActivationKey;
}

export interface SettingsApi {
  getProfile(): Promise<Profile>;
  updateProfile(patch: ProfilePatch): Promise<Profile>;
  updateEmail(newEmail: string): Promise<void>;
  uploadCompanyLogo(file: File): Promise<Profile>;
  removeCompanyLogo(): Promise<Profile>;
  uploadAvatar(file: File): Promise<Profile>;
  removeAvatar(): Promise<Profile>;
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

/** Read a trigger sequence from user_metadata, falling back to a safe default. */
function pickTriggerSeq(
  metadata: Record<string, unknown> | undefined,
  key: string,
  fallback: string,
): string {
  const v = metadata?.[key];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : fallback;
}

/** Read an activation key from user_metadata, defaulting to 'Tab'. */
function pickActivationKey(
  metadata: Record<string, unknown> | undefined,
  key: string,
): ActivationKey {
  const v = metadata?.[key];
  return v === 'Tab' || v === 'Enter' ? v : 'Tab';
}

function pickCompanyName(metadata: Record<string, unknown> | undefined): string {
  const v = metadata?.['company_name'];
  return typeof v === 'string' ? v.trim() : '';
}

function userToProfile(u: { id: string; email?: string | null; user_metadata?: Record<string, unknown>; created_at?: string }): Profile {
  const email = u.email ?? '';
  const meta = u.user_metadata;
  return {
    id: u.id,
    email,
    display_name: pickDisplayName(meta, email),
    shortcut_prefix: pickShortcutPrefix(meta),
    created_at: u.created_at ?? new Date().toISOString(),
    trigger_snippet_seq: pickTriggerSeq(meta, 'trigger_snippet_seq', DEFAULT_TRIGGER_CONFIG.snippetTrigger),
    trigger_prompt_seq:  pickTriggerSeq(meta, 'trigger_prompt_seq',  DEFAULT_TRIGGER_CONFIG.promptTrigger),
    trigger_snippet_key: pickActivationKey(meta, 'trigger_snippet_key'),
    trigger_prompt_key:  pickActivationKey(meta, 'trigger_prompt_key'),
    company_name: pickCompanyName(meta),
    company_logo_url: pickHttpsUrl(meta, 'company_logo_url'),
    avatar_url: pickHttpsUrl(meta, 'avatar_url'),
  };
}

/**
 * Upload a user image (logo or avatar) into its bucket and point the given
 * user_metadata key at the new public URL. Shared by both image kinds so the
 * ordering rules live in one place.
 */
async function uploadUserImage(
  bucket: string,
  buildPath: (userId: string, mime: string, now: number) => string,
  metaKey: string,
  file: File,
): Promise<Profile> {
  const invalid = validateImageFile(file);
  if (invalid) throw new Error(invalid);

  const { data: cur, error: getErr } = await supabase.auth.getUser();
  if (getErr) throw getErr;
  if (!cur.user) throw new Error('Not authenticated');

  // Timestamped per-user key — a replacement gets a fresh URL, so no
  // CDN/browser cache can keep serving the old image.
  const path = buildPath(cur.user.id, file.type, Date.now());
  const { error: uploadErr } = await supabase.storage
    .from(bucket)
    .upload(path, file, { contentType: file.type, cacheControl: '3600' });
  if (uploadErr) throw uploadErr;

  const prevUrl = pickHttpsUrl(cur.user.user_metadata, metaKey);
  const { publicUrl } = supabase.storage.from(bucket).getPublicUrl(path).data;

  const next: Record<string, unknown> = { ...(cur.user.user_metadata ?? {}) };
  next[metaKey] = publicUrl;
  const { data, error } = await supabase.auth.updateUser({ data: next });
  if (error || !data.user) {
    // The pointer never landed — drop the fresh object instead of orphaning it.
    void supabase.storage.from(bucket).remove([path]);
    throw error ?? new Error('Update returned no user');
  }

  // Best-effort cleanup of the replaced object; a leftover is harmless.
  const prevPath = prevUrl ? objectPathFromPublicUrl(prevUrl, bucket) : null;
  if (prevPath && prevPath !== path) {
    void supabase.storage.from(bucket).remove([prevPath]);
  }
  return userToProfile(data.user);
}

/** Clear a user-image metadata pointer, then best-effort delete its object. */
async function removeUserImage(bucket: string, metaKey: string): Promise<Profile> {
  const { data: cur, error: getErr } = await supabase.auth.getUser();
  if (getErr) throw getErr;
  if (!cur.user) throw new Error('Not authenticated');

  const prevUrl = pickHttpsUrl(cur.user.user_metadata, metaKey);

  // Clear the pointer first — a failed object delete leaves an orphaned file
  // (harmless), while the reverse order could leave a dangling URL.
  const next: Record<string, unknown> = { ...(cur.user.user_metadata ?? {}) };
  next[metaKey] = null;
  const { data, error } = await supabase.auth.updateUser({ data: next });
  if (error) throw error;
  if (!data.user) throw new Error('Update returned no user');

  const prevPath = prevUrl ? objectPathFromPublicUrl(prevUrl, bucket) : null;
  if (prevPath) {
    void supabase.storage.from(bucket).remove([prevPath]);
  }
  return userToProfile(data.user);
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
    if (patch.company_name !== undefined) next['company_name'] = patch.company_name.trim();
    if (patch.shortcut_prefix !== undefined) next['shortcut_prefix'] = patch.shortcut_prefix;
    if (patch.trigger_snippet_seq !== undefined) next['trigger_snippet_seq'] = patch.trigger_snippet_seq;
    if (patch.trigger_prompt_seq  !== undefined) next['trigger_prompt_seq']  = patch.trigger_prompt_seq;
    if (patch.trigger_snippet_key !== undefined) next['trigger_snippet_key'] = patch.trigger_snippet_key;
    if (patch.trigger_prompt_key  !== undefined) next['trigger_prompt_key']  = patch.trigger_prompt_key;

    const { data, error } = await supabase.auth.updateUser({ data: next });
    if (error) throw error;
    if (!data.user) throw new Error('Update returned no user');
    return userToProfile(data.user);
  },

  async uploadCompanyLogo(file: File) {
    return uploadUserImage(LOGO_BUCKET, buildLogoPath, 'company_logo_url', file);
  },

  async removeCompanyLogo() {
    return removeUserImage(LOGO_BUCKET, 'company_logo_url');
  },

  async uploadAvatar(file: File) {
    return uploadUserImage(AVATAR_BUCKET, buildAvatarPath, 'avatar_url', file);
  },

  async removeAvatar() {
    return removeUserImage(AVATAR_BUCKET, 'avatar_url');
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
