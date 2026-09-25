-- HISTORY-001 · Prompts get a version history, like snippets and memory items.
--
-- THE GAP. Snippets have kept `snippet_revisions` since SNIPPETS-CRUD-001, and
-- memory items have kept `memory_shard_versions` since MEMORY-002. Prompts kept
-- nothing: an edit overwrote the previous text and there was no way back. The
-- three sections are one product in three shapes, so a prompt being the only
-- one whose past is unrecoverable is a defect rather than a design.
--
-- THE SHAPE. One row per save, holding what the prompt said at that moment:
-- its name, its assembled `content` and its `blocks`. Restoring does not touch
-- history; it saves the old text again as the NEXT version, which is the rule
-- the other two already follow.
--
-- WHAT IS NOT VERSIONED, on purpose. Pinning, moving a prompt between folders,
-- the usage counter and the Notion page id are properties of the prompt as an
-- object rather than of its text. Snippets draw the same line: only the
-- editor's save writes a revision. Recording every pin would bury the edits
-- that matter under noise nobody reads.
--
-- SECURITY. RLS mirrors the prompts table: a version is readable and writable
-- only by the owner of the prompt it belongs to, resolved through a subquery on
-- `prompts` rather than a duplicated `user_id` that could drift. The save
-- function is SECURITY DEFINER because it writes the version row inside the
-- same transaction as the update, and it re-checks ownership under the caller's
-- own `auth.uid()` before it writes anything. REVOKE precedes every GRANT.

create table if not exists public.prompt_versions (
  id             uuid primary key default gen_random_uuid(),
  prompt_id      uuid not null references public.prompts(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  editor_id      uuid references auth.users(id) on delete set null,
  -- Resolved at write time: an editor who later leaves must not turn every
  -- version they saved into an unnamed row.
  editor_display text not null default 'unknown',
  name           text not null,
  content        text not null default '',
  blocks         jsonb,
  edit_note      text,
  created_at     timestamptz not null default now(),
  unique (prompt_id, version_number)
);

comment on table public.prompt_versions is
  'HISTORY-001 · One row per prompt save: what it was called and what it said. Append-only; restoring writes a new version rather than rewriting one.';

create index if not exists prompt_versions_prompt_idx
  on public.prompt_versions (prompt_id, version_number desc);

alter table public.prompt_versions enable row level security;

drop policy if exists promptver_select on public.prompt_versions;
create policy promptver_select on public.prompt_versions
  for select using (
    exists (
      select 1 from public.prompts p
      where p.id = prompt_versions.prompt_id and p.user_id = auth.uid()
    )
  );

-- Read-only to every caller. Supabase's default privileges hand `authenticated`
-- full write access on a new public table, and revoking `public, anon` does not
-- touch that: only RLS would have stood between a signed-in account and an
-- invented version row. The rows are written by the SECURITY DEFINER function
-- below, which runs as the owner and needs no grant of its own. This matches
-- memory_shard_versions, which is select-only for the same reason.
revoke all on public.prompt_versions from public, anon, authenticated;
grant select on public.prompt_versions to authenticated;

-- ── Save: the update and its version, in one transaction ─────────────────────

-- The editor saves the whole prompt through this one call, rather than writing
-- the row and then adding a version beside it. Two statements would mean a
-- dropped connection could leave a saved prompt whose history skips the save
-- that is now on screen, and nothing in the schema could tell that apart from a
-- prompt nobody had edited.
create or replace function public.save_prompt_with_version(
  p_prompt_id          uuid,
  p_name               text,
  p_content            text,
  p_blocks             jsonb,
  p_shortcut           text,
  p_strategy_type      text,
  p_thinking_mode      text,
  p_preferred_model    text,
  p_complexity_level   text,
  p_intent_category    text,
  p_output_type        text,
  p_ask_user_questions boolean,
  p_folder_id          uuid,
  p_editor_display     text default 'unknown',
  p_edit_note          text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_next int;
begin
  if v_uid is null then
    raise exception 'save_prompt_with_version: authentication required' using errcode = '42501';
  end if;

  -- Locked for the whole transaction: two saves racing must not both read the
  -- same highest version number and then collide on the unique constraint.
  perform 1 from public.prompts
   where id = p_prompt_id and user_id = v_uid
   for update;
  if not found then
    raise exception 'save_prompt_with_version: prompt not found' using errcode = '42501';
  end if;

  update public.prompts
     set name               = p_name,
         content            = p_content,
         blocks             = p_blocks,
         shortcut           = nullif(btrim(coalesce(p_shortcut, '')), ''),
         strategy_type      = p_strategy_type,
         thinking_mode      = p_thinking_mode,
         preferred_model    = p_preferred_model,
         complexity_level   = p_complexity_level,
         intent_category    = p_intent_category,
         output_type        = p_output_type,
         ask_user_questions = coalesce(p_ask_user_questions, false),
         folder_id          = p_folder_id,
         updated_at         = now()
   where id = p_prompt_id;

  select coalesce(max(version_number), 0) + 1 into v_next
  from public.prompt_versions
  where prompt_id = p_prompt_id;

  -- Only the three fields a reader compares are kept: what it is called, what
  -- it says, and the blocks that produced it.
  insert into public.prompt_versions
    (prompt_id, version_number, editor_id, editor_display, name, content, blocks, edit_note)
  values
    (p_prompt_id, v_next, v_uid, coalesce(nullif(btrim(p_editor_display), ''), 'unknown'),
     p_name, coalesce(p_content, ''), p_blocks, p_edit_note);

  return v_next;
end; $$;

comment on function public.save_prompt_with_version(uuid, text, text, jsonb, text, text, text, text, text, text, text, boolean, uuid, text, text) is
  'HISTORY-001 · Updates a prompt and appends its version row in one transaction, under FOR UPDATE. SECURITY DEFINER: re-checks ownership against auth.uid().';

revoke all on function public.save_prompt_with_version(uuid, text, text, jsonb, text, text, text, text, text, text, text, boolean, uuid, text, text) from public, anon;
grant execute on function public.save_prompt_with_version(uuid, text, text, jsonb, text, text, text, text, text, text, text, boolean, uuid, text, text) to authenticated;
