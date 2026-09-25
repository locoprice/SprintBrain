-- MEMORY · Delete a trashed Brain for good.
--
-- WHAT THIS IS FOR. A Brain could be moved to the trash, and nothing could
-- reach it afterwards: no screen listed trashed Brains, so one could be neither
-- restored nor deleted, and everything in it stayed stored for good. The
-- dashboard now lists them. This is the permanent half: the Brain, every item
-- in it (live or trashed, since trashing a Brain leaves its items' own trash
-- state alone), their versions and label links (existing cascades), and the
-- rows of its uploaded files. Together with 20260924090000_memory_empty_trash it
-- is G1's trash half in docs/MEMORY_002_PLAN.md; purging a whole account is
-- still open.
--
-- ONLY FROM THE TRASH. A live Brain is refused, and the row is locked first, so
-- a restore racing this call either lands before it (the Brain is live, the
-- call is refused) or waits and finds the Brain gone.
--
-- FILES FIRST, ENFORCED. The stored originals cannot be deleted from SQL
-- (storage.protect_delete), so the dashboard removes them through the Storage
-- API and then calls this with the ids of the files it removed. If the Brain
-- holds any file not on that list, the call is refused and nothing is deleted:
-- deleting its row would leave the stored file behind with nothing pointing at
-- it, invisible and never deleted.
--
-- WHAT IT LEAVES. A piece of one of this Brain's files that was moved to
-- another Brain stays there, unlinked from the file, so the cascade on
-- source_id cannot take it. A file in another Brain that loses a piece moved
-- into this one is recounted.
--
-- AUDIT. One content-free `space.purge` entry with the counts; it covers
-- everything that went with the Brain.
--
-- SECURITY DEFINER for the same reason as memory_empty_trash: it writes an
-- audit row the caller cannot write. Ownership is checked against auth.uid()
-- on the locked row. REVOKE precedes the GRANT so nothing is reachable by anon.

create or replace function public.memory_purge_space(
  p_space_id     uuid,
  p_document_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid           uuid := auth.uid();
  v_trashed_at    timestamptz;
  v_docs          uuid[];
  v_parents       uuid[];
  v_items_removed int;
  v_docs_removed  int;
begin
  if v_uid is null then
    raise exception 'memory_purge_space: authentication required' using errcode = '42501';
  end if;

  select deleted_at into v_trashed_at
  from public.memory_spaces
  where id = p_space_id and user_id = v_uid
  for update;
  if not found then
    raise exception 'memory_purge_space: space not found' using errcode = '42501';
  end if;
  if v_trashed_at is null then
    raise exception 'memory_purge_space: only a Brain in the trash can be deleted'
      using errcode = '55000';
  end if;

  select coalesce(array_agg(d.id), '{}'::uuid[]) into v_docs
  from (
    select id from public.memory_documents where space_id = p_space_id for update
  ) d;

  if exists (
    select 1 from unnest(v_docs) as held(id)
    where not (held.id = any(coalesce(p_document_ids, '{}'::uuid[])))
  ) then
    raise exception 'memory_purge_space: a stored file was not removed first'
      using errcode = '55000';
  end if;

  -- Files in other Brains that are about to lose a piece; recounted below.
  select coalesce(array_agg(distinct s.source_id), '{}'::uuid[]) into v_parents
  from public.memory_shards s
  where s.space_id = p_space_id
    and s.source_id is not null
    and not (s.source_id = any(v_docs));

  update public.memory_shards
     set source_id = null,
         chunk_index = null
   where source_id = any(v_docs)
     and space_id <> p_space_id;

  delete from public.memory_shards where space_id = p_space_id;
  get diagnostics v_items_removed = row_count;

  delete from public.memory_documents where space_id = p_space_id;
  get diagnostics v_docs_removed = row_count;

  delete from public.memory_spaces where id = p_space_id;

  update public.memory_documents d
     set chunk_count = (select count(*) from public.memory_shards s where s.source_id = d.id)
   where d.id = any(v_parents);

  perform app.memory_audit(v_uid, 'space.purge', p_space_id, 'dashboard',
                           jsonb_build_object('items', v_items_removed, 'documents', v_docs_removed));

  return jsonb_build_object('items', v_items_removed, 'documents', v_docs_removed);
end; $$;

comment on function public.memory_purge_space(uuid, uuid[]) is
  'MEMORY · Permanently deletes a trashed Brain with its items, versions and file rows. Refused unless every stored file was removed first. SECURITY DEFINER: re-checks ownership against auth.uid().';

revoke all on function public.memory_purge_space(uuid, uuid[]) from public, anon;
grant execute on function public.memory_purge_space(uuid, uuid[]) to authenticated;
