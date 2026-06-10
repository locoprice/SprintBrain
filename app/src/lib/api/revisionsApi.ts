import { supabase } from '@/lib/supabase';
import type { SnippetBodies, SnippetRevision } from '@/types/database';

// Live Supabase reads + writes for snippet revision history.
//
// Revisions are append-only: INSERT is allowed via RLS; UPDATE and DELETE are
// not. The companion Postgres function `save_snippet_with_revision` handles the
// atomic snippet-update + revision-insert in a single transaction.

const LANGS = ['EN', 'IT', 'ES', 'FR', 'MULTI'] as const;

type DbRevision = {
  id: string;
  snippet_id: string;
  version_number: number;
  editor_id: string;
  editor_display: string;
  title: string;
  body: string;
  bodies: Record<string, unknown> | null;
  edit_note: string | null;
  created_at: string;
};

function dbRevisionToRevision(r: DbRevision): SnippetRevision {
  const bodies: SnippetBodies = {};
  if (r.bodies && typeof r.bodies === 'object') {
    for (const key of LANGS) {
      const v = r.bodies[key];
      if (typeof v === 'string' && v.length > 0) bodies[key] = v;
    }
  }
  return {
    id: r.id,
    snippet_id: r.snippet_id,
    version_number: r.version_number,
    editor_id: r.editor_id,
    editor_display: r.editor_display,
    title: r.title,
    body: r.body,
    bodies,
    edit_note: r.edit_note,
    created_at: r.created_at,
  };
}

async function currentEditorDisplay(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) throw new Error('Not authenticated');
  // Prefer display_name from user_metadata (set during OTP sign-up), fall back to email.
  return (
    (user.user_metadata?.display_name as string | undefined) ??
    user.email ??
    user.id
  );
}

export interface SaveRevisionParams {
  title: string;
  shortcut: string;
  body: string;
  bodies: SnippetBodies;
  lang: string;
  folder_id: string | null;
  pinned: boolean;
  alternative_queries: string[];
  enable_urgency_timer: boolean;
  timer_duration_ms: number;
  scarcity_count: number;
}

export interface RevisionsApi {
  /** Fetch all revisions for a snippet, newest first. */
  listRevisions(snippetId: string): Promise<SnippetRevision[]>;
  /**
   * Atomically update the snippet and append a revision via the
   * `save_snippet_with_revision` Postgres function. Returns the new
   * version_number.
   */
  saveWithRevision(
    snippetId: string,
    params: SaveRevisionParams,
    editNote?: string,
  ): Promise<number>;
}

export const revisionsApi: RevisionsApi = {
  async listRevisions(snippetId) {
    const { data, error } = await supabase
      .from('snippet_revisions')
      .select(
        'id, snippet_id, version_number, editor_id, editor_display, title, body, bodies, edit_note, created_at',
      )
      .eq('snippet_id', snippetId)
      .order('version_number', { ascending: false });
    if (error) throw error;
    return ((data ?? []) as DbRevision[]).map(dbRevisionToRevision);
  },

  async saveWithRevision(snippetId, params, editNote) {
    const editorDisplay = await currentEditorDisplay();
    const { data, error } = await supabase.rpc('save_snippet_with_revision', {
      p_snippet_id: snippetId,
      p_title: params.title,
      p_shortcut: params.shortcut,
      p_body: params.body,
      p_bodies: params.bodies,
      p_lang: params.lang,
      p_folder_id: params.folder_id,
      p_pinned: params.pinned,
      p_enable_urgency_timer: params.enable_urgency_timer,
      p_timer_duration_ms: params.timer_duration_ms,
      p_scarcity_count: params.scarcity_count,
      p_alternative_queries: params.alternative_queries,
      p_editor_display: editorDisplay,
      p_edit_note: editNote ?? null,
    });
    if (error) throw error;
    return data as number;
  },
};
