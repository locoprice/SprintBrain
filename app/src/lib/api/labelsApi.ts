import { supabase } from '@/lib/supabase';
import { buildLabelAssignments, normalizeLabelName } from '@/lib/labelUtils';
import type { Label, LabelColor } from '@/types/database';

// Live Supabase reads + writes for the label vocabulary (LABELS-001).
//
// Labels are personal: RLS gates every table on `user_id = auth.uid()` with no
// access-helper call, so reads cost one comparison per row. The explicit
// `user_id` stamped on inserts mirrors the other api modules; the column also
// defaults to auth.uid() server-side.
//
// Assignments are insert/delete only — there is no UPDATE policy or grant on
// the link tables, because reassigning is a delete plus an insert.

/** Label ids keyed by asset id, split by asset type. */
export interface LabelAssignmentSets {
  snippets: Map<string, string[]>;
  prompts: Map<string, string[]>;
}

export interface LabelsApi {
  listLabels(): Promise<Label[]>;
  /** Every assignment the user owns, in one round trip per asset type. */
  listAssignments(): Promise<LabelAssignmentSets>;
  /** `parentId` nests the new label under an existing root (LABELS-002). */
  createLabel(name: string, color: LabelColor, parentId?: string | null): Promise<Label>;
  /**
   * Patch a label. `parent_id` is tri-state: omitted leaves the parent alone,
   * `null` moves the label to root, an id nests it. The DB trigger rejects a
   * move that would breach MAX_LABEL_DEPTH.
   */
  updateLabel(
    id: string,
    patch: { name?: string; color?: LabelColor; parent_id?: string | null },
  ): Promise<Label>;
  /** Deleting a label cascades to both link tables (FK `on delete cascade`). */
  deleteLabel(id: string): Promise<void>;
  /** Replace a snippet's labels with exactly `labelIds`. Idempotent. */
  setSnippetLabels(snippetId: string, labelIds: string[]): Promise<void>;
  /** Replace a prompt's labels with exactly `labelIds`. Idempotent. */
  setPromptLabels(promptId: string, labelIds: string[]): Promise<void>;
}

type DbLabel = {
  id: string;
  user_id: string;
  name: string;
  color: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
};

const LABEL_SELECT = 'id, user_id, name, color, parent_id, created_at, updated_at';

function dbLabelToLabel(row: DbLabel): Label {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    color: row.color as LabelColor,
    parent_id: row.parent_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Not authenticated');
  return data.user.id;
}

/**
 * Turn a constraint violation into a sentence. The UI validates first, so this
 * only fires on a race (the same name created in two tabs) — but "duplicate key
 * value violates unique constraint" is not something to show a user.
 */
function labelWriteError(error: { code?: string; message: string }, name?: string): Error {
  if (error.code === '23505') {
    return new Error(
      name ? `"${name}" already exists` : 'A label with that name already exists',
    );
  }
  if (error.code === '23514') return new Error('Label name is required');
  return new Error(error.message);
}

export const labelsApi: LabelsApi = {
  async listLabels() {
    const { data, error } = await supabase
      .from('labels')
      .select(LABEL_SELECT)
      .order('name', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as unknown as DbLabel[]).map(dbLabelToLabel);
  },

  async listAssignments() {
    const [snippetRes, promptRes] = await Promise.all([
      supabase.from('snippet_labels').select('snippet_id, label_id'),
      supabase.from('prompt_labels').select('prompt_id, label_id'),
    ]);
    if (snippetRes.error) throw snippetRes.error;
    if (promptRes.error) throw promptRes.error;

    const snippetRows = (snippetRes.data ?? []) as { snippet_id: string; label_id: string }[];
    const promptRows = (promptRes.data ?? []) as { prompt_id: string; label_id: string }[];

    return {
      snippets: buildLabelAssignments(
        snippetRows.map((r) => ({ asset_id: r.snippet_id, label_id: r.label_id })),
      ),
      prompts: buildLabelAssignments(
        promptRows.map((r) => ({ asset_id: r.prompt_id, label_id: r.label_id })),
      ),
    };
  },

  async createLabel(name, color, parentId = null) {
    const userId = await currentUserId();
    const trimmed = normalizeLabelName(name);
    const { data, error } = await supabase
      .from('labels')
      .insert({ user_id: userId, name: trimmed, color, parent_id: parentId })
      .select(LABEL_SELECT)
      .single();
    if (error) throw labelWriteError(error, trimmed);
    return dbLabelToLabel(data as unknown as DbLabel);
  },

  async updateLabel(id, patch) {
    const update: Record<string, unknown> = {};
    if (patch.name !== undefined) update['name'] = normalizeLabelName(patch.name);
    if (patch.color !== undefined) update['color'] = patch.color;
    // Tri-state: `null` is a real value here (move to root), so only an absent
    // key means "leave the parent alone".
    if (patch.parent_id !== undefined) update['parent_id'] = patch.parent_id;

    const { data, error } = await supabase
      .from('labels')
      .update(update)
      .eq('id', id)
      .select(LABEL_SELECT)
      .single();
    if (error) throw labelWriteError(error, patch.name && normalizeLabelName(patch.name));
    return dbLabelToLabel(data as unknown as DbLabel);
  },

  async deleteLabel(id) {
    const { data, error } = await supabase.from('labels').delete().eq('id', id).select('id');
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error('That label no longer exists.');
    }
  },

  setSnippetLabels(snippetId, labelIds) {
    return replaceAssignments('snippet_labels', 'snippet_id', snippetId, labelIds);
  },

  setPromptLabels(promptId, labelIds) {
    return replaceAssignments('prompt_labels', 'prompt_id', promptId, labelIds);
  },
};

/**
 * Reconcile one asset's assignments to exactly `labelIds`.
 *
 * Prunes what was removed, then upserts what was added — rather than
 * delete-all-then-insert, which would leave the asset unlabelled if the second
 * call failed. `ignoreDuplicates` makes re-saving an unchanged set a no-op.
 */
async function replaceAssignments(
  table: 'snippet_labels' | 'prompt_labels',
  assetColumn: 'snippet_id' | 'prompt_id',
  assetId: string,
  labelIds: string[],
): Promise<void> {
  const userId = await currentUserId();
  const desired = [...new Set(labelIds)];

  const prune = supabase.from(table).delete().eq(assetColumn, assetId);
  const { error: deleteError } = await (desired.length > 0
    ? prune.not('label_id', 'in', `(${desired.join(',')})`)
    : prune);
  if (deleteError) throw deleteError;

  if (desired.length === 0) return;

  const { error: insertError } = await supabase.from(table).upsert(
    desired.map((labelId) => ({ [assetColumn]: assetId, label_id: labelId, user_id: userId })),
    { onConflict: `${assetColumn},label_id`, ignoreDuplicates: true },
  );
  if (insertError) throw insertError;
}
