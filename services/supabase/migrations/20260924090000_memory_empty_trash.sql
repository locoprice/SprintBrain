-- MEMORY · Empty a Brain's trash.
--
-- WHAT THIS IS FOR. Deleting from a Brain has two stages, and until now only
-- the first one existed: `deleted_at` hides an item or a file, it does not
-- erase it. The trash could be viewed and restored from but never emptied, so
-- anything trashed stayed stored for good. This is the second stage, for one
-- Brain at a time, the way the page shows its trash. It is the trash half of
-- G1 in docs/MEMORY_002_PLAN.md; purging a whole Brain or account is still open.
--
-- WHAT IT REMOVES. Exactly the items and files the caller lists, and each one
-- only while it is still in the trash, in this Brain, and the caller's own. An
-- id restored after the list was drawn is skipped, never deleted. Versions and
-- label links go with an item through the cascades that already exist.
--
-- WHAT IT LEAVES.
--   * A piece of a purged file that is not itself listed (restored on its own,
--     or moved to another Brain) stays, and stops pointing at the file. Left
--     pointing, the cascade on source_id would delete it without a word.
--   * A live file whose trashed pieces are purged stays, and its chunk_count is
--     recounted so the page never promises pieces that are gone.
--
-- WHAT IT CANNOT REMOVE: the stored file. storage.objects refuses direct
-- deletes (storage.protect_delete), and a row deleted in SQL would orphan the
-- object in the bucket anyway. The dashboard removes the files through the
-- Storage API first and calls this second. A failure in between leaves trash
-- rows whose file is already gone, which the next attempt finishes; the other
-- order would leave files that nothing points at, invisible and never deleted.
--
-- AUDIT. Content-free, like every entry in memory_audit_log: one per purged
-- file (`document.purge`) and one per purged item that was not a piece of one
-- of those files (`item.purge`). A file's own entry covers its pieces.
--
-- SECURITY DEFINER for the same reason as memory_trash_document: it writes
-- audit rows the caller cannot write. Every statement re-checks ownership
-- against auth.uid(). REVOKE precedes the GRANT so nothing is reachable by anon.

create or replace function public.memory_empty_trash(
  p_space_id     uuid,
  p_item_ids     uuid[],
  p_document_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid           uuid := auth.uid();
  v_docs          uuid[];
  v_items         uuid[];
  v_loose         uuid[];
  v_parents       uuid[];
  v_items_removed int;
  v_docs_removed  int;
begin
  if v_uid is null then
    raise exception 'memory_empty_trash: authentication required' using errcode = '42501';
  end if;

  perform 1 from public.memory_spaces where id = p_space_id and user_id = v_uid;
  if not found then
    raise exception 'memory_empty_trash: space not found' using errcode = '42501';
  end if;

  -- Both lists are locked, the way a restore locks its row: a restore racing
  -- this call either commits first, so the row no longer qualifies, or waits
  -- and finds it gone. Documents first, then items, the same order the trash
  -- and restore functions take, so the two can never deadlock.
  select coalesce(array_agg(d.id), '{}'::uuid[]) into v_docs
  from (
    select id
    from public.memory_documents
    where id = any(coalesce(p_document_ids, '{}'::uuid[]))
      and user_id = v_uid
      and space_id = p_space_id
      and deleted_at is not null
    for update
  ) d;

  select coalesce(array_agg(s.id), '{}'::uuid[]) into v_items
  from (
    select id
    from public.memory_shards
    where id = any(coalesce(p_item_ids, '{}'::uuid[]))
      and user_id = v_uid
      and space_id = p_space_id
      and deleted_at is not null
    for update
  ) s;

  -- Read before anything is deleted: which purged items are not pieces of a
  -- purged file (they get their own audit entry), and which live files are
  -- about to lose pieces (they get recounted).
  select coalesce(array_agg(id), '{}'::uuid[]) into v_loose
  from public.memory_shards
  where id = any(v_items)
    and (source_id is null or not (source_id = any(v_docs)));

  select coalesce(array_agg(distinct source_id), '{}'::uuid[]) into v_parents
  from public.memory_shards
  where id = any(v_items)
    and source_id is not null
    and not (source_id = any(v_docs));

  update public.memory_shards
     set source_id = null,
         chunk_index = null
   where source_id = any(v_docs)
     and user_id = v_uid
     and not (id = any(v_items));

  delete from public.memory_shards where id = any(v_items);
  get diagnostics v_items_removed = row_count;

  delete from public.memory_documents where id = any(v_docs);
  get diagnostics v_docs_removed = row_count;

  update public.memory_documents d
     set chunk_count = (select count(*) from public.memory_shards s where s.source_id = d.id)
   where d.id = any(v_parents);

  perform app.memory_audit(v_uid, 'document.purge', purged.id, 'dashboard',
                           jsonb_build_object('space_id', p_space_id))
  from unnest(v_docs) as purged(id);

  perform app.memory_audit(v_uid, 'item.purge', purged.id, 'dashboard',
                           jsonb_build_object('space_id', p_space_id))
  from unnest(v_loose) as purged(id);

  return jsonb_build_object('items', v_items_removed, 'documents', v_docs_removed);
end; $$;

comment on function public.memory_empty_trash(uuid, uuid[], uuid[]) is
  'MEMORY · Permanently deletes the listed items and files from one Brain''s trash, skipping anything restored since. The dashboard removes the stored files first. SECURITY DEFINER: re-checks ownership against auth.uid().';

revoke all on function public.memory_empty_trash(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.memory_empty_trash(uuid, uuid[], uuid[]) to authenticated;
