-- MEMORY-002 · D1. A document is a source; its chunks are memory items.
--
-- WHAT THIS IS FOR. Until now a memory item could only be typed. Everything a
-- team already knows lives in files: a contract, a price list, a procedure. The
-- upload path turns one file into one source row plus the memory items that
-- carry its text, so the Context panel can find a paragraph of a PDF the same
-- way it finds a typed fact.
--
-- THE SHAPE.
--   * `memory_documents` is the source: the file's name, its type, its size and
--     where the file itself sits in the private bucket. It holds no text.
--   * The text lives in `memory_shards`, one row per chunk, split by the shared
--     chunker (`extension/shared/memory-chunk.js`) so no body exceeds the
--     20,000-character cap the table already enforces.
--   * `memory_shards.source_id` points back at the document and cascades on
--     delete, so a purged document can never leave orphan chunks behind, and
--     `chunk_index` keeps them in reading order.
--
-- WHY AN IMPORT FUNCTION RATHER THAN N SAVES. `memory_save_shard` writes one
-- shard, its first version and its audit entry in one transaction. Calling it
-- once per chunk from the browser would make a twenty-chunk file twenty
-- transactions: a dropped connection halfway leaves a document whose text is
-- half there, and nothing in the schema could tell that state from a complete
-- one. `memory_import_document` does the whole file in a single transaction,
-- writing the same version and audit rows per chunk, so a file either arrives
-- whole or not at all.
--
-- SECURITY. The bucket is PRIVATE: these are contracts and internal procedures,
-- not avatars. Every storage policy gates on the first path segment being the
-- caller's own id, which is the pattern the other buckets already use, and the
-- SELECT policy is owner-only rather than public. The functions are SECURITY
-- DEFINER for the same reason `memory_save_shard` is (they write version and
-- audit rows the caller may not write directly) and each one re-checks
-- ownership of the space and of the document under the caller's `auth.uid()`.
-- REVOKE precedes every GRANT so nothing is reachable by `anon`.

-- ── The source row ───────────────────────────────────────────────────────────

create table if not exists public.memory_documents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  space_id     uuid not null references public.memory_spaces(id) on delete cascade,
  -- The file name as the operator saw it on their own disk. It is what the
  -- space lists, so it is trimmed but never rewritten.
  name         text not null check (char_length(btrim(name)) between 1 and 200),
  mime         text not null default '',
  byte_size    integer not null default 0 check (byte_size >= 0),
  -- Path inside the private bucket: `<user_id>/<document_id><ext>`. The storage
  -- policies below depend on that first segment.
  storage_path text not null,
  chunk_count  integer not null default 0 check (chunk_count >= 0),
  -- Same hash rule as a shard: lets a re-upload of the identical file be
  -- recognised rather than silently duplicated.
  content_hash text,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

comment on table public.memory_documents is
  'MEMORY-002 · One uploaded file. The text is in memory_shards rows pointing back through source_id; this row holds only the file''s identity and its object path.';

create index if not exists memory_documents_space_live_idx
  on public.memory_documents (space_id, created_at desc)
  where deleted_at is null;

create index if not exists memory_documents_user_idx
  on public.memory_documents (user_id);

alter table public.memory_documents enable row level security;

drop policy if exists memdoc_select on public.memory_documents;
create policy memdoc_select on public.memory_documents
  for select using (user_id = auth.uid());

drop policy if exists memdoc_insert on public.memory_documents;
create policy memdoc_insert on public.memory_documents
  for insert with check (user_id = auth.uid());

drop policy if exists memdoc_update on public.memory_documents;
create policy memdoc_update on public.memory_documents
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists memdoc_delete on public.memory_documents;
create policy memdoc_delete on public.memory_documents
  for delete using (user_id = auth.uid());

revoke all on public.memory_documents from public, anon;
grant select, insert, update, delete on public.memory_documents to authenticated;

-- ── Chunk provenance on the item ─────────────────────────────────────────────

alter table public.memory_shards
  add column if not exists source_id uuid references public.memory_documents(id) on delete cascade;

alter table public.memory_shards
  add column if not exists chunk_index integer;

comment on column public.memory_shards.source_id is
  'The uploaded document this item was cut from, or null when it was typed. Cascades: purging a document purges its chunks.';
comment on column public.memory_shards.chunk_index is
  'Position of this chunk within its document, 0-based. Null for a typed item.';

create index if not exists memory_shards_source_idx
  on public.memory_shards (source_id, chunk_index)
  where source_id is not null;

-- ── The private bucket ───────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit)
values ('memory-docs', 'memory-docs', false, 20971520)
on conflict (id) do update
  set public = false,
      file_size_limit = 20971520;

drop policy if exists memory_docs_owner_read on storage.objects;
create policy memory_docs_owner_read on storage.objects
  for select using (
    bucket_id = 'memory-docs'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

drop policy if exists memory_docs_owner_insert on storage.objects;
create policy memory_docs_owner_insert on storage.objects
  for insert with check (
    bucket_id = 'memory-docs'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

drop policy if exists memory_docs_owner_update on storage.objects;
create policy memory_docs_owner_update on storage.objects
  for update using (
    bucket_id = 'memory-docs'
    and (storage.foldername(name))[1] = (auth.uid())::text
  ) with check (
    bucket_id = 'memory-docs'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

drop policy if exists memory_docs_owner_delete on storage.objects;
create policy memory_docs_owner_delete on storage.objects
  for delete using (
    bucket_id = 'memory-docs'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

-- ── Import: one file, one transaction ────────────────────────────────────────

create or replace function public.memory_import_document(
  p_space_id       uuid,
  p_name           text,
  p_mime           text,
  p_byte_size      integer,
  p_storage_path   text,
  p_chunks         jsonb,
  p_editor_display text default 'unknown',
  p_content_hash   text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_space  uuid;
  v_doc    uuid;
  v_chunk  jsonb;
  v_shard  uuid;
  v_index  int := 0;
  v_total  int;
begin
  if v_uid is null then
    raise exception 'memory_import_document: authentication required' using errcode = '42501';
  end if;

  if jsonb_typeof(p_chunks) <> 'array' or jsonb_array_length(p_chunks) = 0 then
    raise exception 'memory_import_document: nothing to import' using errcode = '22023';
  end if;

  -- The space is re-checked here rather than trusted from the caller: this
  -- function is definer-rights, so an id from another account must not resolve.
  if p_space_id is not null then
    select id into v_space
    from public.memory_spaces
    where id = p_space_id and user_id = v_uid and deleted_at is null;
    if not found then
      raise exception 'memory_import_document: space not found' using errcode = '42501';
    end if;
  else
    v_space := app.memory_default_space(v_uid);
  end if;

  insert into public.memory_documents
    (user_id, space_id, name, mime, byte_size, storage_path, content_hash)
  values
    (v_uid, v_space, btrim(p_name), coalesce(p_mime, ''), coalesce(p_byte_size, 0),
     p_storage_path, p_content_hash)
  returning id into v_doc;

  for v_chunk in select * from jsonb_array_elements(p_chunks)
  loop
    -- A blank chunk would fail the body check and take the whole file with it.
    -- The client already drops them; this is the backstop.
    if coalesce(btrim(v_chunk->>'body'), '') = '' then
      continue;
    end if;

    -- The table caps a name at 64 characters and a summary at 280. A file named
    -- past that limit is ordinary, so it is cut here rather than rejected: the
    -- full name stays on the document row and in the item's metadata.
    insert into public.memory_shards
      (user_id, space_id, name, summary, body, kind, metadata, source_id, chunk_index)
    values
      (v_uid, v_space,
       left(coalesce(nullif(btrim(v_chunk->>'name'), ''), btrim(p_name)), 64),
       left(coalesce(v_chunk->>'summary', ''), 280),
       btrim(v_chunk->>'body'),
       'document',
       jsonb_build_object('source_name', btrim(p_name)),
       v_doc, v_index)
    returning id into v_shard;

    -- Version 1 of a chunk, so an imported item carries history from the start
    -- exactly like a typed one.
    insert into public.memory_shard_versions
      (shard_id, version_number, editor_id, editor_display, name, summary, body, edit_note)
    values
      (v_shard, 1, v_uid, coalesce(nullif(btrim(p_editor_display), ''), 'unknown'),
       left(coalesce(nullif(btrim(v_chunk->>'name'), ''), btrim(p_name)), 64),
       left(coalesce(v_chunk->>'summary', ''), 280),
       btrim(v_chunk->>'body'),
       'imported from ' || btrim(p_name));

    v_index := v_index + 1;
  end loop;

  v_total := v_index;

  -- A file whose every chunk was blank is a file with no readable text. It must
  -- not leave a source row behind that lists nothing: the whole transaction goes.
  if v_total = 0 then
    raise exception 'memory_import_document: no readable text' using errcode = '22023';
  end if;

  update public.memory_documents
     set chunk_count = v_total
   where id = v_doc;

  perform app.memory_audit(
    v_uid, 'document.import', v_doc, 'dashboard',
    jsonb_build_object('space_id', v_space, 'chunks', v_total, 'bytes', coalesce(p_byte_size, 0))
  );

  return v_doc;
end; $$;

comment on function public.memory_import_document(uuid, text, text, integer, text, jsonb, text, text) is
  'MEMORY-002 · Creates one memory_documents row and its chunk shards, with a version and an audit entry each, in a single transaction. SECURITY DEFINER: re-checks the space against auth.uid().';

revoke all on function public.memory_import_document(uuid, text, text, integer, text, jsonb, text, text) from public, anon;
grant execute on function public.memory_import_document(uuid, text, text, integer, text, jsonb, text, text) to authenticated;

-- ── Trash and restore, the same two stages as an item ────────────────────────

create or replace function public.memory_trash_document(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'memory_trash_document: authentication required' using errcode = '42501';
  end if;

  perform 1 from public.memory_documents
   where id = p_document_id and user_id = v_uid
   for update;
  if not found then
    raise exception 'memory_trash_document: document not found' using errcode = '42501';
  end if;

  -- The chunks go with it. Leaving them behind would put paragraphs of a
  -- document the operator just removed back into someone's context.
  update public.memory_shards
     set deleted_at = v_now
   where source_id = p_document_id and user_id = v_uid and deleted_at is null;

  update public.memory_documents
     set deleted_at = v_now
   where id = p_document_id;

  perform app.memory_audit(v_uid, 'document.trash', p_document_id, 'dashboard', '{}'::jsonb);
end; $$;

create or replace function public.memory_restore_document(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'memory_restore_document: authentication required' using errcode = '42501';
  end if;

  perform 1 from public.memory_documents
   where id = p_document_id and user_id = v_uid
   for update;
  if not found then
    raise exception 'memory_restore_document: document not found' using errcode = '42501';
  end if;

  update public.memory_shards
     set deleted_at = null
   where source_id = p_document_id and user_id = v_uid;

  update public.memory_documents
     set deleted_at = null
   where id = p_document_id;

  perform app.memory_audit(v_uid, 'document.restore', p_document_id, 'dashboard', '{}'::jsonb);
end; $$;

comment on function public.memory_trash_document(uuid) is
  'MEMORY-002 · Two-stage delete: moves a document and every chunk cut from it to the trash.';
comment on function public.memory_restore_document(uuid) is
  'MEMORY-002 · Brings a trashed document and its chunks back.';

revoke all on function public.memory_trash_document(uuid) from public, anon;
revoke all on function public.memory_restore_document(uuid) from public, anon;
grant execute on function public.memory_trash_document(uuid) to authenticated;
grant execute on function public.memory_restore_document(uuid) to authenticated;
