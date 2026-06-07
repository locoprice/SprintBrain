import { supabase } from '@/lib/supabase';
import type { FolderPermission, PermissionLevel, PrincipalType } from '@/types/database';

// Folder permission service (Phase B). Grant/revoke folder-level View/Edit/Owner
// access to a principal (the whole organization, or a specific teammate).
//
// Sharing a *personal* folder for the first time stamps `organization_id` on the
// folder AND on the snippets/prompts it contains, so the org folder-ACL RLS
// branch (`organization_id IS NOT NULL AND folder_id IS NOT NULL AND
// app.can_read_folder(folder_id)`) can see them. RLS is the backstop:
//   - folders/snippets/prompts updates require ownership (the caller owns the
//     personal folder being shared), and
//   - folder_permissions writes require folder owner / org-admin
//     (app.folder_level(folder_id) = 'owner').

const GRANT_SELECT = 'id, folder_id, principal_type, principal_id, level, created_at';

export interface ShareTarget {
  principalType: PrincipalType;
  /** organization_id | user_id | team_id, resolved by principalType. */
  principalId: string;
  level: PermissionLevel;
}

export interface PermissionsApi {
  /** All grants on a folder (visible to anyone who can read the folder). */
  listGrants(folderId: string): Promise<FolderPermission[]>;
  /**
   * Share a folder with a principal at a level. Moves the folder + its assets
   * into `orgId` if they are still personal, then upserts the grant.
   */
  shareFolder(folderId: string, orgId: string, target: ShareTarget): Promise<FolderPermission>;
  /** Change an existing grant's level. */
  updateGrantLevel(grantId: string, level: PermissionLevel): Promise<FolderPermission>;
  /** Remove a grant. */
  revokeGrant(grantId: string): Promise<void>;
}

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Not authenticated');
  return data.user.id;
}

/**
 * Stamp `organization_id` on a still-personal folder and the caller's assets
 * inside it, so the folder ACL can govern them. Idempotent: only touches rows
 * whose organization_id is still null.
 */
async function ensureFolderInOrg(folderId: string, orgId: string, userId: string): Promise<void> {
  const { error: folderErr } = await supabase
    .from('folders')
    .update({ organization_id: orgId })
    .eq('id', folderId)
    .eq('user_id', userId)
    .is('organization_id', null);
  if (folderErr) throw folderErr;

  const { error: snipErr } = await supabase
    .from('snippets')
    .update({ organization_id: orgId })
    .eq('folder_id', folderId)
    .eq('user_id', userId)
    .is('organization_id', null);
  if (snipErr) throw snipErr;

  const { error: promptErr } = await supabase
    .from('prompts')
    .update({ organization_id: orgId })
    .eq('folder_id', folderId)
    .eq('user_id', userId)
    .is('organization_id', null);
  if (promptErr) throw promptErr;
}

export const permissionsApi: PermissionsApi = {
  async listGrants(folderId) {
    const { data, error } = await supabase
      .from('folder_permissions')
      .select(GRANT_SELECT)
      .eq('folder_id', folderId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as FolderPermission[];
  },

  async shareFolder(folderId, orgId, target) {
    const userId = await currentUserId();
    await ensureFolderInOrg(folderId, orgId, userId);

    const { data, error } = await supabase
      .from('folder_permissions')
      .upsert(
        {
          folder_id: folderId,
          principal_type: target.principalType,
          principal_id: target.principalId,
          level: target.level,
          granted_by: userId,
        },
        { onConflict: 'folder_id,principal_type,principal_id' },
      )
      .select(GRANT_SELECT)
      .single();
    if (error) throw error;
    return data as FolderPermission;
  },

  async updateGrantLevel(grantId, level) {
    const { data, error } = await supabase
      .from('folder_permissions')
      .update({ level })
      .eq('id', grantId)
      .select(GRANT_SELECT)
      .single();
    if (error) throw error;
    return data as FolderPermission;
  },

  async revokeGrant(grantId) {
    const { error } = await supabase.from('folder_permissions').delete().eq('id', grantId);
    if (error) throw error;
  },
};
