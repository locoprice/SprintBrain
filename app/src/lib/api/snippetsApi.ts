import { supabase } from '@/lib/supabase';
import type { Folder, Snippet, SnippetBodies, SnippetRow } from '@/types/database';
import type { SnippetFormValues, FolderFormValues } from '@/types/schemas';

const EDGE_FN_SHARE = 'notion-snippet-push';

// Live Supabase reads + writes for snippets + folders, scoped to the authed user.
//
// RLS is the security layer: every public table enforces `auth.uid() = user_id`
// (snippets SELECT also allows `is_shared = true`), and the extension now
// authenticates per-user via JWT (AUTH-EXT-001 shipped), so isolation holds on
// both surfaces. The explicit `.eq('user_id', …)` filters below are therefore
// redundant for isolation — they remain as defense-in-depth and, for now, scope
// dashboard reads to the user's own rows. Team sharing (folder-level View/Edit)
// will revisit them so shared rows surface intentionally.

export interface SnippetsApi {
  listFolders(): Promise<Folder[]>;
  listSnippets(): Promise<SnippetRow[]>;
  createSnippet(payload: SnippetFormValues): Promise<SnippetRow>;
  updateSnippet(id: string, patch: Partial<SnippetFormValues>): Promise<SnippetRow>;
  deleteSnippet(id: string): Promise<void>;
  /** Toggle pinned flag without touching other fields. */
  setPinned(id: string, pinned: boolean): Promise<SnippetRow>;
  /** Toggle is_active flag without touching other fields. */
  setActive(id: string, isActive: boolean): Promise<SnippetRow>;
  /** Insert a copy of an existing snippet with a "(copy)" name suffix. */
  duplicateSnippet(id: string): Promise<SnippetRow>;
  createFolder(payload: FolderFormValues): Promise<Folder>;
  updateFolder(id: string, patch: Partial<FolderFormValues>): Promise<Folder>;
  deleteFolder(id: string): Promise<void>;
  /** Mark a snippet shared/unshared without touching Notion. */
  setShared(id: string, isShared: boolean): Promise<SnippetRow>;
  /** Push snippet to the team Notion DB via Edge Function, sets is_shared=true. */
  shareWithNotion(id: string): Promise<{ notion_page_id: string }>;
  /** Move multiple snippets to a folder in a single idempotent request. */
  bulkMoveSnippets(ids: string[], folderId: string | null): Promise<void>;
  /** Delete multiple snippets in a single request. */
  bulkDeleteSnippets(ids: string[]): Promise<void>;
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

type DbSnippetJoined = {
  id: string;
  user_id: string | null;
  title: string;
  shortcut: string;
  body: string;
  bodies: Record<string, unknown> | null;
  lang: string;
  folder_id: string | null;
  field_cfg: Record<string, unknown> | null;
  sort_order: number;
  updated_at: string;
  is_shared: boolean;
  notion_page_id: string | null;
  pinned: boolean | null;
  is_active: boolean | null;
  alternative_queries: string[] | null;
  enable_urgency_timer: boolean | null;
  timer_duration_ms: number | null;
  scarcity_count: number | null;
  folders: { name: string } | null;
  snippet_stats: Array<{ uses: number | null }> | null;
};

const LANGS = ['EN', 'IT', 'ES', 'FR', 'MULTI'] as const;
type LangTuple = typeof LANGS;
function normalizeLang(v: string | null | undefined): Snippet['language'] {
  const upper = (v ?? '').toUpperCase() as LangTuple[number];
  return LANGS.includes(upper) ? upper : 'MULTI';
}

/**
 * Coerce the raw `bodies` JSONB value into a typed SnippetBodies map. Old rows
 * that pre-date the per-language migration (or have an empty bodies object)
 * fall back to `{ [language]: body }` so the dashboard form has something to
 * show the moment a user opens them.
 */
function normalizeBodies(
  raw: Record<string, unknown> | null,
  fallbackLang: Snippet['language'],
  fallbackBody: string,
): SnippetBodies {
  const out: SnippetBodies = {};
  if (raw && typeof raw === 'object') {
    for (const key of LANGS) {
      const v = raw[key];
      if (typeof v === 'string' && v.length > 0) out[key] = v;
    }
  }
  if (Object.keys(out).length === 0 && fallbackBody) {
    out[fallbackLang] = fallbackBody;
  }
  return out;
}

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

function dbSnippetToSnippetRow(row: DbSnippetJoined): SnippetRow {
  const usage =
    Array.isArray(row.snippet_stats) && row.snippet_stats[0]?.uses != null
      ? row.snippet_stats[0].uses
      : 0;
  const body = row.body ?? '';
  const language = normalizeLang(row.lang);
  const bodies = normalizeBodies(row.bodies, language, body);
  return {
    id: row.id,
    user_id: row.user_id ?? '',
    name: row.title ?? '',
    content: body,
    bodies,
    // Schema has a single `shortcut`; dashboard expects an array.
    triggers: row.shortcut ? [row.shortcut] : [],
    // `tags` doesn't exist in the Supabase schema yet.
    tags: [],
    // Derived: body contains a formula placeholder.
    is_formula: body.includes('{='),
    formula: null,
    variables: row.field_cfg ?? {},
    folder_id: row.folder_id,
    language,
    is_shared: row.is_shared ?? false,
    notion_page_id: row.notion_page_id ?? null,
    pinned: row.pinned ?? false,
    is_active: row.is_active ?? true,
    alternative_queries: Array.isArray(row.alternative_queries) ? row.alternative_queries : [],
    enable_urgency_timer: row.enable_urgency_timer ?? false,
    timer_duration_ms: row.timer_duration_ms ?? 0,
    scarcity_count: row.scarcity_count ?? 0,
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

/**
 * Read just the language tag for one snippet. Used by updateSnippet when the
 * caller patches `content` or `bodies` without explicitly providing a new
 * language — we need the existing language to know which slot the active
 * body belongs to.
 */
async function readLanguage(
  id: string,
  userId: string,
): Promise<Snippet['language']> {
  const { data, error } = await supabase
    .from('snippets')
    .select('lang')
    .eq('id', id)
    .eq('user_id', userId)
    .single();
  if (error) throw error;
  return normalizeLang((data as { lang: string | null } | null)?.lang);
}

const SNIPPET_SELECT =
  'id, user_id, title, shortcut, body, bodies, lang, folder_id, field_cfg, sort_order, updated_at, is_shared, notion_page_id, pinned, is_active, alternative_queries, enable_urgency_timer, timer_duration_ms, scarcity_count, folders(name), snippet_stats(uses)';

/**
 * Build the canonical bodies map that gets persisted. Always includes the
 * active language under its own key (mirrors `body`) and preserves whatever
 * the form already had for inactive languages.
 */
function mergeActiveBody(
  bodies: SnippetBodies | undefined,
  language: Snippet['language'],
  activeBody: string,
): SnippetBodies {
  const next: SnippetBodies = { ...(bodies ?? {}) };
  if (activeBody.length > 0) {
    next[language] = activeBody;
  } else {
    delete next[language];
  }
  return next;
}

export const snippetsApi: SnippetsApi = {
  async listFolders() {
    const userId = await currentUserId();
    const { data, error } = await supabase
      .from('folders')
      .select(FOLDER_SELECT)
      .eq('user_id', userId)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(dbFolderToFolder);
  },

  async listSnippets() {
    const userId = await currentUserId();
    const { data, error } = await supabase
      .from('snippets')
      .select(SNIPPET_SELECT)
      .eq('user_id', userId)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as unknown as DbSnippetJoined[]).map(dbSnippetToSnippetRow);
  },

  async createSnippet(payload) {
    const userId = await currentUserId();
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const bodies = mergeActiveBody(payload.bodies, payload.language, payload.content);
    const insert = {
      id,
      user_id: userId,
      title: payload.name,
      shortcut: payload.trigger,
      body: payload.content,
      bodies,
      lang: payload.language,
      folder_id: payload.folder_id,
      field_cfg: {},
      sort_order: Date.now(),
      updated_at: now,
      pinned: payload.pinned ?? false,
      is_shared: payload.is_shared ?? false,
      alternative_queries: payload.alternative_queries ?? [],
      enable_urgency_timer: payload.enable_urgency_timer ?? false,
      timer_duration_ms: payload.timer_duration_ms ?? 0,
      scarcity_count: payload.scarcity_count ?? 0,
    };
    const { data, error } = await supabase
      .from('snippets')
      .insert(insert)
      .select(SNIPPET_SELECT)
      .single();
    if (error) throw error;
    return dbSnippetToSnippetRow(data as unknown as DbSnippetJoined);
  },

  async updateSnippet(id, patch) {
    const userId = await currentUserId();
    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (patch.name !== undefined) update['title'] = patch.name;
    if (patch.trigger !== undefined) update['shortcut'] = patch.trigger;
    if (patch.language !== undefined) update['lang'] = patch.language;
    if (patch.folder_id !== undefined) update['folder_id'] = patch.folder_id;
    if (patch.pinned !== undefined) update['pinned'] = patch.pinned;
    if (patch.is_shared !== undefined) update['is_shared'] = patch.is_shared;
    if (patch.alternative_queries !== undefined) update['alternative_queries'] = patch.alternative_queries;
    if (patch.enable_urgency_timer !== undefined)
      update['enable_urgency_timer'] = patch.enable_urgency_timer;
    if (patch.timer_duration_ms !== undefined)
      update['timer_duration_ms'] = patch.timer_duration_ms;
    if (patch.scarcity_count !== undefined) update['scarcity_count'] = patch.scarcity_count;

    // Body fields need to update together so the JSONB map, the active
    // language tag, and the denormalized `body` column never drift.
    const touchesBody =
      patch.content !== undefined ||
      patch.bodies !== undefined ||
      patch.language !== undefined;
    if (touchesBody) {
      const language = patch.language ?? (await readLanguage(id, userId));
      const activeBody = patch.content ?? '';
      const merged = mergeActiveBody(patch.bodies, language, activeBody);
      update['body'] = activeBody;
      update['bodies'] = merged;
    }

    const { data, error } = await supabase
      .from('snippets')
      .update(update)
      .eq('id', id)
      .eq('user_id', userId)
      .select(SNIPPET_SELECT)
      .single();
    if (error) throw error;
    return dbSnippetToSnippetRow(data as unknown as DbSnippetJoined);
  },

  async deleteSnippet(id) {
    const userId = await currentUserId();
    const { error } = await supabase
      .from('snippets')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
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
    // Reassign snippets in this folder to "no folder" first, so nothing orphans.
    const { error: reassignError } = await supabase
      .from('snippets')
      .update({ folder_id: null })
      .eq('folder_id', id)
      .eq('user_id', userId);
    if (reassignError) throw reassignError;

    const { error } = await supabase
      .from('folders')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
  },

  async setPinned(id, pinned) {
    const userId = await currentUserId();
    const { data, error } = await supabase
      .from('snippets')
      .update({ pinned, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .select(SNIPPET_SELECT)
      .single();
    if (error) throw error;
    return dbSnippetToSnippetRow(data as unknown as DbSnippetJoined);
  },

  async setActive(id, isActive) {
    const userId = await currentUserId();
    const { data, error } = await supabase
      .from('snippets')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .select(SNIPPET_SELECT)
      .single();
    if (error) throw error;
    return dbSnippetToSnippetRow(data as unknown as DbSnippetJoined);
  },

  async duplicateSnippet(id) {
    const userId = await currentUserId();
    // Read the source row first so we copy every column (incl. urgency + pin).
    const { data: src, error: readErr } = await supabase
      .from('snippets')
      .select(SNIPPET_SELECT)
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    if (readErr) throw readErr;
    const source = src as unknown as DbSnippetJoined;
    const now = new Date().toISOString();
    const insert = {
      id: crypto.randomUUID(),
      user_id: userId,
      title: `${source.title} (copy)`,
      shortcut: `${source.shortcut}_copy`,
      body: source.body,
      bodies: source.bodies ?? {},
      lang: source.lang,
      folder_id: source.folder_id,
      field_cfg: source.field_cfg ?? {},
      sort_order: Date.now(),
      updated_at: now,
      // A duplicate starts unpinned + unshared so the copy doesn't inherit
      // distribution state from the source. It does inherit is_active so
      // cloning a disabled snippet yields a disabled copy (predictable).
      pinned: false,
      is_shared: false,
      is_active: source.is_active ?? true,
      alternative_queries: Array.isArray(source.alternative_queries) ? source.alternative_queries : [],
      enable_urgency_timer: source.enable_urgency_timer ?? false,
      timer_duration_ms: source.timer_duration_ms ?? 0,
      scarcity_count: source.scarcity_count ?? 0,
    };
    const { data, error } = await supabase
      .from('snippets')
      .insert(insert)
      .select(SNIPPET_SELECT)
      .single();
    if (error) throw error;
    return dbSnippetToSnippetRow(data as unknown as DbSnippetJoined);
  },

  // Flip is_shared for a single snippet without touching Notion.
  // Used for unsharing (is_shared → false) and direct DB corrections.
  async setShared(id, isShared) {
    const userId = await currentUserId();
    const { data, error } = await supabase
      .from('snippets')
      .update({ is_shared: isShared, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .select(SNIPPET_SELECT)
      .single();
    if (error) throw error;
    return dbSnippetToSnippetRow(data as unknown as DbSnippetJoined);
  },

  // Call the Edge Function to push the snippet to the shared team Notion DB.
  // The EF sets is_shared=true and writes notion_page_id back to the DB.
  // Returns the Notion page ID on success.
  async shareWithNotion(id) {
    const { data, error } = await supabase.functions.invoke<{
      ok: boolean;
      notion_page_id: string;
    }>(EDGE_FN_SHARE, { body: { snippet_id: id } });
    if (error) throw error;
    if (!data?.ok || !data.notion_page_id) {
      throw new Error('notion-snippet-push returned unexpected response');
    }
    return { notion_page_id: data.notion_page_id };
  },

  // Move multiple snippets to a folder in one idempotent DB write.
  async bulkMoveSnippets(ids, folderId) {
    if (ids.length === 0) return;
    const userId = await currentUserId();
    const { error } = await supabase
      .from('snippets')
      .update({ folder_id: folderId, updated_at: new Date().toISOString() })
      .in('id', ids)
      .eq('user_id', userId);
    if (error) throw error;
  },

  // Delete multiple snippets in one request.
  async bulkDeleteSnippets(ids) {
    if (ids.length === 0) return;
    const userId = await currentUserId();
    const { error } = await supabase
      .from('snippets')
      .delete()
      .in('id', ids)
      .eq('user_id', userId);
    if (error) throw error;
  },
};
