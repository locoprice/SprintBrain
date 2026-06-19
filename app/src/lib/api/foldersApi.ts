import { supabase } from '@/lib/supabase';
import type { Folder } from '@/types/database';
import type { FolderFormValues } from '@/types/schemas';

// Shared folder service. Folders are a generic container: a single folder can
// hold both snippets and prompts (both tables carry folder_id). The snippet and
// prompt stores both read/write folders through this module so the row mapping
// and the delete-time reassignment live in one place.
//
// RLS is the security layer: `listFolders` drops the `.eq('user_id')` filter so
// folders shared with the user (Phase B org ACL) surface alongside their own.
// The write helpers keep `.eq('user_id')` as an owner scope (defense-in-depth).

export interface FoldersApi {
  /** The user's own folders plus any shared with them (RLS-scoped). */
  listFolders(): Promise<Folder[]>;
  createFolder(payload: FolderFormValues): Promise<Folder>;
  updateFolder(id: string, patch: Partial<FolderFormValues>): Promise<Folder>;
  /** Delete a folder, reassigning its snippets AND prompts to "no folder" first. */
  deleteFolder(id: string): Promise<void>;
}

type DbFolder = {
  id: string;
  user_id: string | null;
  name: string;
  ico: string;
  sort_order: number;
  updated_at: string;
};

const FOLDER_SELECT = 'id, user_id, name, ico, sort_order, updated_at';

function dbFolderToFolder(row: DbFolder): Folder {
  return {
    id: row.id,
    user_id: row.user_id ?? '',
    name: row.name,
    icon: row.ico,
    sort_order: row.sort_order,
    updated_at: row.updated_at,
  };
}

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Not authenticated');
  return data.user.id;
}

export const foldersApi: FoldersApi = {
  async listFolders() {
    const { data, error } = await supabase
      .from('folders')
      .select(FOLDER_SELECT)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(dbFolderToFolder);
  },

  async createFolder(payload) {
    const userId = await currentUserId();
    const id = crypto.randomUUID();
    const { data, error } = await supabase
      .from('folders')
      .insert({
        id,
        user_id: userId,
        name: payload.name,
        ico: payload.icon,
        sort_order: Date.now(),
      })
      .select(FOLDER_SELECT)
      .single();
    if (error) throw error;
    return dbFolderToFolder(data as DbFolder);
  },

  async updateFolder(id, patch) {
    const userId = await currentUserId();
    const update: Record<string, unknown> = {};
    if (patch.name !== undefined) update['name'] = patch.name;
    if (patch.icon !== undefined) update['ico'] = patch.icon;

    const { data, error } = await supabase
      .from('folders')
      .update(update)
      .eq('id', id)
      .eq('user_id', userId)
      .select(FOLDER_SELECT)
      .single();
    if (error) throw error;
    return dbFolderToFolder(data as DbFolder);
  },

  async deleteFolder(id) {
    const userId = await currentUserId();
    // Reassign assets in this folder to "no folder" first, so nothing orphans.
    // Folders are shared by snippets AND prompts — reassign both tables.
    const { error: snipErr } = await supabase
      .from('snippets')
      .update({ folder_id: null })
      .eq('folder_id', id)
      .eq('user_id', userId);
    if (snipErr) throw snipErr;

    const { error: promptErr } = await supabase
      .from('prompts')
      .update({ folder_id: null })
      .eq('folder_id', id)
      .eq('user_id', userId);
    if (promptErr) throw promptErr;

    const { error } = await supabase
      .from('folders')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
  },
};
