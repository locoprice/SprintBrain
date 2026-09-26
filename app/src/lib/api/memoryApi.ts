import { supabase } from '@/lib/supabase';
import { toApiError } from '@/lib/api/apiError';
import { buildChunkItems } from '@/lib/documentImport';
import { DocumentTextError, extractDocumentText } from '@/lib/documentText';
import { loadMemoryChunk } from '@/lib/memoryChunk';
import type {
  MemoryDocument,
  MemoryItem,
  MemoryItemKind,
  MemorySpace,
  MemorySpaceTotals,
  MemoryVersion,
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
  'pinned, priority, content_hash, source_id, created_at, updated_at, deleted_at';

const VERSION_SELECT =
  'id, shard_id, version_number, editor_id, editor_display, name, summary, body, ' +
  'edit_note, created_at';

const DOCUMENT_SELECT =
  'id, user_id, space_id, name, mime, byte_size, storage_path, chunk_count, ' +
  'content_hash, created_at, deleted_at';

/** The private bucket the original files live in (migration 20260923090000). */
const DOCUMENT_BUCKET = 'memory-docs';

/** Storage deletes at most this many objects per request. */
const STORAGE_REMOVE_LIMIT = 1000;

/** What the interface needs to report after a file has landed. */
export interface DocumentImportResult {
  documentId: string;
  /** Items created, which is how many pieces the file was cut into. */
  chunkCount: number;
  /** Pieces the chunker had to cut mid-paragraph; worth saying out loud. */
  forced: number;
  /** Pages, for a PDF. Zero for everything else. */
  pages: number;
}

/** What a permanent delete removed, as counted by the server. */
export interface DeleteForeverResult {
  items: number;
  documents: number;
}

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
  /** `name` is only used to word the collision message when the name was reused. */
  restoreSpace(id: string, name?: string): Promise<void>;
  /**
   * Permanently deletes a trashed space with everything in it: items, their
   * versions, file rows and the stored originals.
   */
  deleteSpaceForever(spaceId: string): Promise<DeleteForeverResult>;

  /** Every saved version of one item, newest first. */
  listVersions(itemId: string): Promise<MemoryVersion[]>;
  /**
   * Puts an older version's text back. It saves through the same RPC an edit
   * uses, so the restore becomes the NEXT version rather than rewriting what
   * happened: the history stays a record, not a draft. The live item is passed
   * in whole because everything except name, summary and body is a property of
   * the item today and must survive the restore untouched.
   */
  restoreVersion(item: MemoryItem, version: MemoryVersion): Promise<void>;

  /** Uploaded sources in a space, newest first. */
  listDocuments(spaceId: string, includeTrashed?: boolean): Promise<MemoryDocument[]>;
  /**
   * Reads a file, splits it and files the pieces as items, in one transaction.
   * Throws `DocumentTextError` when the file itself is the problem, so the
   * caller can word "no readable text" differently from "that did not save".
   */
  importDocument(file: File, spaceId: string): Promise<DocumentImportResult>;
  /** Moves a document and every item cut from it to the trash. */
  trashDocument(id: string): Promise<void>;
  restoreDocument(id: string): Promise<void>;
  /** A short-lived link to the original file, for opening it from the list. */
  documentUrl(storagePath: string): Promise<string>;

  listItems(spaceId: string, includeTrashed?: boolean): Promise<MemoryItem[]>;
  /** Live items across every space. Feeds the one search bar's panel (SEARCH-001). */
  listAllItems(): Promise<MemoryItem[]>;
  /** Returns the item id, new or existing. Appends a version and an audit entry. */
  saveItem(input: SaveMemoryItemInput): Promise<string>;
  trashItem(id: string): Promise<void>;
  /** `name` is only used to word the collision message when the name was reused. */
  restoreItem(id: string, name?: string): Promise<void>;
  /**
   * Permanently deletes the listed trashed items and files of one space,
   * stored originals included. Emptying the trash lists all of it; deleting one
   * row lists that row. Anything restored since the list was drawn is skipped
   * rather than deleted.
   */
  deleteForever(
    spaceId: string,
    itemIds: string[],
    documents: MemoryDocument[],
  ): Promise<DeleteForeverResult>;
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
  source_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type DbDocument = {
  id: string;
  user_id: string;
  space_id: string;
  name: string;
  mime: string;
  byte_size: number;
  storage_path: string;
  chunk_count: number;
  content_hash: string | null;
  created_at: string;
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
    source_id: row.source_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  };
}

function dbDocumentToDocument(row: DbDocument): MemoryDocument {
  return {
    id: row.id,
    user_id: row.user_id,
    space_id: row.space_id,
    name: row.name,
    mime: row.mime,
    byte_size: row.byte_size,
    storage_path: row.storage_path,
    chunk_count: row.chunk_count,
    content_hash: row.content_hash,
    created_at: row.created_at,
    deleted_at: row.deleted_at,
  };
}

/**
 * SHA-256 of the extracted text, hex, matching the shape a shard's own
 * `content_hash` uses. Re-uploading the identical file is then recognisable
 * rather than silently doubling a space.
 */
async function hashText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw toApiError(error);
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
    return toApiError(
      error,
      action === 'restore'
        ? `${subject} was taken while this was in the trash. Rename the one that is in use, then restore again.`
        : `${subject} already exists. Names have to be unique.`,
    );
  }
  if (error.code === '23514') {
    return toApiError(error, 'That does not fit: check the name, the body length and the item kind.');
  }
  if (error.code === '42501') return toApiError(error, 'You do not have access to that Brain.');
  return toApiError(error);
}

/**
 * Removes stored originals ahead of a permanent delete. Files first, rows
 * second: the storage schema refuses deletes from SQL, so the two cannot share
 * a transaction, and this is the order that fails safe. A break in between
 * leaves rows whose file is already gone, which the next attempt finishes; the
 * other order would leave files that nothing points at, invisible and never
 * deleted.
 */
async function removeStoredFiles(paths: string[]): Promise<void> {
  for (let start = 0; start < paths.length; start += STORAGE_REMOVE_LIMIT) {
    const { error } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .remove(paths.slice(start, start + STORAGE_REMOVE_LIMIT));
    if (error) throw new Error(`Could not delete permanently: ${error.message}`);
  }
}

export const memoryApi: MemoryApi = {
  async listSpaces(includeTrashed = false) {
    let query = supabase.from('memory_spaces').select(SPACE_SELECT);
    if (!includeTrashed) query = query.is('deleted_at', null);
    const { data, error } = await query
      .order('is_default', { ascending: false })
      .order('name', { ascending: true });
    if (error) throw toApiError(error);
    return ((data ?? []) as unknown as DbSpace[]).map(dbSpaceToSpace);
  },

  async spaceTotals() {
    // Two columns, no bodies. The whole point of the summary/index split is that
    // counting a library never costs the library.
    const { data, error } = await supabase
      .from('memory_shards')
      .select('space_id, token_estimate')
      .is('deleted_at', null);
    if (error) throw toApiError(error);

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
    if (error) throw toApiError(error);
  },

  async restoreSpace(id, name) {
    // Restoring can fail on the partial unique index when a live space took the
    // name while this one sat in the trash. The caller passes the name because
    // a failed UPDATE returns no row to read it from.
    const { error } = await supabase
      .from('memory_spaces')
      .update({ deleted_at: null })
      .eq('id', id);
    if (error) throw memoryWriteError(error, name, 'restore');
  },

  async deleteSpaceForever(spaceId) {
    // Every file of the space, live or trashed: the whole space goes. The
    // function refuses the rows unless each of these was removed first.
    const { data, error } = await supabase
      .from('memory_documents')
      .select('id, storage_path')
      .eq('space_id', spaceId);
    if (error) throw new Error(`Could not delete permanently: ${error.message}`);
    const documents = (data ?? []) as { id: string; storage_path: string }[];

    await removeStoredFiles(documents.map((doc) => doc.storage_path));

    const { data: removed, error: purgeError } = await supabase.rpc('memory_purge_space', {
      p_space_id: spaceId,
      p_document_ids: documents.map((doc) => doc.id),
    });
    if (purgeError) throw new Error(`Could not delete permanently: ${purgeError.message}`);
    return removed as DeleteForeverResult;
  },

  async listItems(spaceId, includeTrashed = false) {
    let query = supabase.from('memory_shards').select(ITEM_SELECT).eq('space_id', spaceId);
    if (!includeTrashed) query = query.is('deleted_at', null);
    const { data, error } = await query
      .order('pinned', { ascending: false })
      .order('updated_at', { ascending: false });
    if (error) throw toApiError(error);
    return ((data ?? []) as unknown as DbItem[]).map(dbItemToItem);
  },

  async listAllItems() {
    // No space filter: RLS already scopes the read to this user. Trashed rows
    // are left behind because a trashed note is not attachable, so offering it
    // as a search result would promise something that cannot be used.
    const { data, error } = await supabase
      .from('memory_shards')
      .select(ITEM_SELECT)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false });
    if (error) throw toApiError(error);
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
    if (error) throw toApiError(error);
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

  async listVersions(itemId) {
    const { data, error } = await supabase
      .from('memory_shard_versions')
      .select(VERSION_SELECT)
      .eq('shard_id', itemId)
      .order('version_number', { ascending: false });
    if (error) throw toApiError(error);
    return (data ?? []) as unknown as MemoryVersion[];
  },

  async restoreVersion(item, version) {
    const editorDisplay = await currentEditorDisplay();
    const { error } = await supabase.rpc('memory_save_shard', {
      p_shard_id: item.id,
      p_name: version.name,
      p_summary: version.summary,
      p_body: version.body,
      p_editor_display: editorDisplay,
      // Where the item lives, what kind it is, and whether it is pinned are
      // properties of the item as it stands today, not of the text being put
      // back. They are passed through unchanged because the RPC rewrites every
      // column it receives: omitting them would file the item in the default
      // space, call it a fact and unpin it, none of which the person asked for.
      p_space_id: item.space_id,
      p_kind: item.kind,
      p_metadata: item.metadata,
      p_pinned: item.pinned,
      p_priority: item.priority,
      p_edit_note: `restored from v${version.version_number}`,
      p_surface: 'dashboard',
    });
    if (error) throw memoryWriteError(error, version.name, 'save');
  },

  async listDocuments(spaceId, includeTrashed = false) {
    let query = supabase.from('memory_documents').select(DOCUMENT_SELECT).eq('space_id', spaceId);
    if (!includeTrashed) query = query.is('deleted_at', null);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw toApiError(error);
    return ((data ?? []) as unknown as DbDocument[]).map(dbDocumentToDocument);
  },

  async importDocument(file, spaceId) {
    const userId = await currentUserId();
    const editorDisplay = await currentEditorDisplay();

    // Read and split before anything is stored. A file that turns out to hold
    // no text must leave nothing behind: no object in the bucket, no row.
    const { text, pages } = await extractDocumentText(file);
    const chunker = await loadMemoryChunk();
    const { chunks, forced } = chunker.chunkText(text);
    const items = buildChunkItems(file.name, chunks);
    if (items.length === 0) {
      throw new DocumentTextError('no-text', `${file.name} holds no text that can be copied`);
    }

    const extension = file.name.toLowerCase().split('.').pop() ?? 'bin';
    // The first path segment is the owner: every storage policy on this bucket
    // gates on it. A random name keeps one file from overwriting another with
    // the same title.
    const storagePath = `${userId}/${crypto.randomUUID()}.${extension}`;

    const upload = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .upload(storagePath, file, { contentType: file.type || undefined, upsert: false });
    if (upload.error) throw new Error(`${file.name} could not be stored: ${upload.error.message}`);

    const { data, error } = await supabase.rpc('memory_import_document', {
      p_space_id: spaceId,
      p_name: file.name.slice(0, 200),
      p_mime: file.type || '',
      p_byte_size: file.size,
      p_storage_path: storagePath,
      p_chunks: items,
      p_editor_display: editorDisplay,
      p_content_hash: await hashText(text),
    });

    if (error) {
      // The rows never landed, so the stored file has nothing pointing at it.
      // Left behind it would be invisible and permanent.
      await supabase.storage.from(DOCUMENT_BUCKET).remove([storagePath]);
      throw memoryWriteError(error, file.name, 'save');
    }

    return { documentId: data as string, chunkCount: items.length, forced, pages };
  },

  async trashDocument(id) {
    const { error } = await supabase.rpc('memory_trash_document', { p_document_id: id });
    if (error) throw toApiError(error);
  },

  async restoreDocument(id) {
    const { error } = await supabase.rpc('memory_restore_document', { p_document_id: id });
    if (error) throw memoryWriteError(error, undefined, 'restore');
  },

  async documentUrl(storagePath) {
    // The bucket is private, so the list cannot link to it directly. Ten
    // minutes is long enough to open a file and short enough that a copied
    // link is not a lasting hole.
    const { data, error } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .createSignedUrl(storagePath, 600);
    if (error) throw toApiError(error);
    return data.signedUrl;
  },

  async deleteForever(spaceId, itemIds, documents) {
    await removeStoredFiles(documents.map((doc) => doc.storage_path));

    const { data, error } = await supabase.rpc('memory_empty_trash', {
      p_space_id: spaceId,
      p_item_ids: itemIds,
      p_document_ids: documents.map((doc) => doc.id),
    });
    if (error) throw new Error(`Could not delete permanently: ${error.message}`);
    return data as DeleteForeverResult;
  },
};
