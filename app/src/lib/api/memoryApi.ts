import { supabase } from '@/lib/supabase';
import type {
  MemoryItem,
  MemoryItemKind,
  MemorySpace,
  MemorySpaceTotals,
} from '@/types/database';

// Live Supabase reads and writes for memory spaces and items (MEMORY-002).
//
// Spaces are personal: RLS gates every table on `user_id = auth.uid()` with no
// access-helper call, so a read costs one comparison per row. Sharing is a
// separate, explicit feature and nothing here grants a teammate anything.
//
// Writes to an item go through the `memory_save_shard` RPC rather than a direct
// table write. That function appends the version row and the audit entry inside
// the same transaction as the update, under a FOR UPDATE lock, so a save can
// never leave a shard without its history. Writing the table directly would
// skip both, which is why the dashboard does not do it.
//
// Deletion is two-stage everywhere: `deleted_at` moves a row to the trash, and
// purging is a separate explicit act. RLS deliberately keeps trashed rows
// readable by their owner, so every list here filters them out unless asked.

const SPACE_SELECT =
  'id, user_id, name, description, ico, is_default, created_at, updated_at, deleted_at';

const ITEM_SELECT =
  'id, user_id, space_id, name, summary, body, kind, metadata, token_estimate, ' +
  'pinned, priority, content_hash, created_at, updated_at, deleted_at';

/** Everything a save needs. `id` absent creates; `space_id` absent files it in the default space. */
export interface SaveMemoryItemInput {
  id?: string | null;
  space_id?: string | null;
  name: string;
  summary: string;
  body: string;
  kind?: MemoryItemKind;
  metadata?: Record<string, unknown>;
  pinned?: boolean;
  priority?: number;
  editNote?: string | null;
}

export interface MemoryApi {
  listSpaces(includeTrashed?: boolean): Promise<MemorySpace[]>;
  /** Item and token totals per space id, over live items only. */
  spaceTotals(): Promise<Map<string, MemorySpaceTotals>>;
  createSpace(name: string, description?: string): Promise<MemorySpace>;
  updateSpace(id: string, patch: { name?: string; description?: string; ico?: string }): Promise<MemorySpace>;
  trashSpace(id: string): Promise<void>;
  restoreSpace(id: string): Promise<void>;

  listItems(spaceId: string, includeTrashed?: boolean): Promise<MemoryItem[]>;
  /** Returns the item id, new or existing. Appends a version and an audit entry. */
  saveItem(input: SaveMemoryItemInput): Promise<string>;
  trashItem(id: string): Promise<void>;
  /** `name` is only used to word the collision message when the name was reused. */
  restoreItem(id: string, name?: string): Promise<void>;
}

type DbSpace = {
  id: string;
  user_id: string;
  name: string;
  description: string;
  ico: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type DbItem = {
  id: string;
  user_id: string;
  space_id: string;
  name: string;
  summary: string;
  body: string;
  kind: string;
  metadata: Record<string, unknown> | null;
  token_estimate: number;
  pinned: boolean;
  priority: number;
  content_hash: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

const KINDS: readonly MemoryItemKind[] = ['fact', 'note', 'document', 'conversation'];

function toKind(raw: string): MemoryItemKind {
  return (KINDS as readonly string[]).includes(raw) ? (raw as MemoryItemKind) : 'fact';
}

function dbSpaceToSpace(row: DbSpace): MemorySpace {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    description: row.description,
    ico: row.ico,
    is_default: row.is_default,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  };
}

function dbItemToItem(row: DbItem): MemoryItem {
  return {
    id: row.id,
    user_id: row.user_id,
    space_id: row.space_id,
    name: row.name,
    summary: row.summary,
    body: row.body,
    kind: toKind(row.kind),
    metadata: row.metadata ?? {},
    token_estimate: row.token_estimate,
    pinned: row.pinned,
    priority: row.priority,
    content_hash: row.content_hash,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  };
}

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Not authenticated');
  return data.user.id;
}

/** Same derivation as revisionsApi, so both histories name an author the same way. */
async function currentEditorDisplay(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) throw new Error('Not authenticated');
  return (
    (user.user_metadata?.['display_name'] as string | undefined) ?? user.email ?? user.id
  );
}

/**
 * Turn a constraint violation into a sentence.
 *
 * 23505 on a name is the one a user will actually hit, and it has a
 * non-obvious cause worth explaining: names are unique among LIVE rows only, so
 * trashing an item frees its name, and restoring it afterwards collides with
 * whatever took the name in the meantime. Saying "already exists" without that
 * context reads as a bug.
 */
function memoryWriteError(
  error: { code?: string; message: string },
  name: string | undefined,
  action: 'save' | 'restore',
): Error {
  if (error.code === '23505') {
    const subject = name ? `"${name}"` : 'That name';
    return action === 'restore'
      ? new Error(
          `${subject} was taken while this was in the trash. Rename the one that is in use, then restore again.`,
        )
      : new Error(`${subject} already exists. Names have to be unique.`);
  }
  if (error.code === '23514') return new Error('That does not fit: check the name, the body length and the item kind.');
  if (error.code === '42501') return new Error('You do not have access to that space.');
  return new Error(error.message);
}

export const memoryApi: MemoryApi = {
  async listSpaces(includeTrashed = false) {
    let query = supabase.from('memory_spaces').select(SPACE_SELECT);
    if (!includeTrashed) query = query.is('deleted_at', null);
    const { data, error } = await query
      .order('is_default', { ascending: false })
      .order('name', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as unknown as DbSpace[]).map(dbSpaceToSpace);
  },

  async spaceTotals() {
    // Two columns, no bodies. The whole point of the summary/index split is that
    // counting a library never costs the library.
    const { data, error } = await supabase
      .from('memory_shards')
      .select('space_id, token_estimate')
      .is('deleted_at', null);
    if (error) throw error;

    const totals = new Map<string, MemorySpaceTotals>();
    for (const row of (data ?? []) as { space_id: string; token_estimate: number }[]) {
      const current = totals.get(row.space_id) ?? { items: 0, tokens: 0 };
      current.items += 1;
      current.tokens += row.token_estimate;
      totals.set(row.space_id, current);
    }
    return totals;
  },

  async createSpace(name, description = '') {
    const userId = await currentUserId();
    const trimmed = name.trim();
    const { data, error } = await supabase
      .from('memory_spaces')
      .insert({ user_id: userId, name: trimmed, description: description.trim() })
      .select(SPACE_SELECT)
      .single();
    if (error) throw memoryWriteError(error, trimmed, 'save');
    return dbSpaceToSpace(data as unknown as DbSpace);
  },

  async updateSpace(id, patch) {
    const update: Record<string, unknown> = {};
    if (patch.name !== undefined) update['name'] = patch.name.trim();
    if (patch.description !== undefined) update['description'] = patch.description.trim();
    if (patch.ico !== undefined) update['ico'] = patch.ico;

    const { data, error } = await supabase
      .from('memory_spaces')
      .update(update)
      .eq('id', id)
      .select(SPACE_SELECT)
      .single();
    if (error) throw memoryWriteError(error, patch.name?.trim(), 'save');
    return dbSpaceToSpace(data as unknown as DbSpace);
  },

  async trashSpace(id) {
    // The items inside keep their own deleted_at untouched. Trashing a space
    // hides the container, and purging it later is what removes the contents,
    // so restoring a space brings back exactly what it held.
    const { error } = await supabase
      .from('memory_spaces')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
  },

  async restoreSpace(id) {
    const { error } = await supabase
      .from('memory_spaces')
      .update({ deleted_at: null })
      .eq('id', id);
    if (error) throw memoryWriteError(error, undefined, 'restore');
  },

  async listItems(spaceId, includeTrashed = false) {
    let query = supabase.from('memory_shards').select(ITEM_SELECT).eq('space_id', spaceId);
    if (!includeTrashed) query = query.is('deleted_at', null);
    const { data, error } = await query
      .order('pinned', { ascending: false })
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return ((data ?? []) as unknown as DbItem[]).map(dbItemToItem);
  },

  async saveItem(input) {
    const editorDisplay = await currentEditorDisplay();
    const { data, error } = await supabase.rpc('memory_save_shard', {
      p_shard_id: input.id ?? null,
      p_name: input.name.trim(),
      p_summary: input.summary.trim(),
      p_body: input.body,
      p_editor_display: editorDisplay,
      p_space_id: input.space_id ?? null,
      p_kind: input.kind ?? 'fact',
      p_metadata: input.metadata ?? {},
      p_pinned: input.pinned ?? false,
      p_priority: input.priority ?? 0,
      p_edit_note: input.editNote ?? null,
      p_surface: 'dashboard',
    });
    if (error) throw memoryWriteError(error, input.name.trim(), 'save');
    return data as string;
  },

  async trashItem(id) {
    const { error } = await supabase
      .from('memory_shards')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
  },

  async restoreItem(id, name) {
    // Restoring can fail on the partial unique index when the name was reused
    // while this row sat in the trash. The caller passes the name because a
    // failed UPDATE returns no row to read it from.
    const { error } = await supabase
      .from('memory_shards')
      .update({ deleted_at: null })
      .eq('id', id);
    if (error) throw memoryWriteError(error, name, 'restore');
  },
};
