import { supabase } from '@/lib/supabase';
import type { Folder, Snippet, SnippetRow } from '@/types/database';

// Live Supabase reads for snippets + folders, scoped to the authed user.
//
// Why we filter explicitly by user_id in app code instead of relying on RLS:
// the DB still has permissive `team_*` policies (qual: true) needed by the
// extension's anon-key queries. PERMISSIVE policies combine with OR, so the
// per-user `auth.uid() = user_id` policies provide no isolation yet. When the
// extension migrates to user JWTs (AUTH-EXT-001), the team_* policies come
// off and RLS alone is sufficient. Until then, every query is .eq'd below.

export interface SnippetsApi {
  listFolders(): Promise<Folder[]>;
  listSnippets(): Promise<SnippetRow[]>;
}

type DbFolder = {
  id: string;
  user_id: string | null;
  name: string;
  ico: string;
  sort_order: number;
};

type DbSnippetJoined = {
  id: string;
  user_id: string | null;
  title: string;
  shortcut: string;
  body: string;
  lang: string;
  folder_id: string | null;
  field_cfg: Record<string, unknown> | null;
  sort_order: number;
  updated_at: string;
  folders: { name: string } | null;
  snippet_stats: Array<{ uses: number | null }> | null;
};

const LANGS = ['EN', 'IT', 'ES', 'FR', 'MULTI'] as const;
type LangTuple = typeof LANGS;
function normalizeLang(v: string | null | undefined): Snippet['language'] {
  const upper = (v ?? '').toUpperCase() as LangTuple[number];
  return LANGS.includes(upper) ? upper : 'MULTI';
}

function dbFolderToFolder(row: DbFolder): Folder {
  return {
    id: row.id,
    user_id: row.user_id ?? '',
    name: row.name,
    icon: row.ico,
    sort_order: row.sort_order,
  };
}

function dbSnippetToSnippetRow(row: DbSnippetJoined): SnippetRow {
  const usage =
    Array.isArray(row.snippet_stats) && row.snippet_stats[0]?.uses != null
      ? row.snippet_stats[0].uses
      : 0;
  const body = row.body ?? '';
  return {
    id: row.id,
    user_id: row.user_id ?? '',
    name: row.title ?? '',
    content: body,
    // Schema has a single `shortcut`; dashboard expects an array.
    triggers: row.shortcut ? [row.shortcut] : [],
    // `tags` doesn't exist in the Supabase schema yet.
    tags: [],
    // Derived: body contains a formula placeholder.
    is_formula: body.includes('{='),
    formula: null,
    variables: row.field_cfg ?? {},
    folder_id: row.folder_id,
    language: normalizeLang(row.lang),
    updated_at: row.updated_at,
    folder_name: row.folders?.name ?? null,
    usage_count: usage,
  };
}

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Not authenticated');
  return data.user.id;
}

export const snippetsApi: SnippetsApi = {
  async listFolders() {
    const userId = await currentUserId();
    const { data, error } = await supabase
      .from('folders')
      .select('id, user_id, name, ico, sort_order')
      .eq('user_id', userId)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(dbFolderToFolder);
  },

  async listSnippets() {
    const userId = await currentUserId();
    const { data, error } = await supabase
      .from('snippets')
      .select(
        'id, user_id, title, shortcut, body, lang, folder_id, field_cfg, sort_order, updated_at, folders(name), snippet_stats(uses)',
      )
      .eq('user_id', userId)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as unknown as DbSnippetJoined[]).map(dbSnippetToSnippetRow);
  },
};
