-- HISTORY-001 fix · The prompt editor could not save a prompt in a shared folder.
--
-- Found on the first real save (2026-09-25), when prompt_versions still held
-- no rows at all. 20260923120000_prompt_versions.sql had two defects:
--
-- 1. p_folder_id was declared uuid, but folders.id and prompts.folder_id are
--    TEXT, and the LeibTour team folder's id is 'leibtour_team_shared'.
--    PostgREST casts every argument before the body runs, so every save of a
--    prompt in that folder failed with 22P02 (HTTP 400) and wrote nothing.
--    Every other function that takes a folder id takes text:
--    save_snippet_with_revision, app.can_write_folder, app.folder_level.
--
-- 2. The ownership check allowed only the prompt's owner. The prompts UPDATE
--    policy also lets an editor of the org folder write the row, and
--    save_snippet_with_revision applies that same Phase B guard. A SECURITY
--    DEFINER function bypasses RLS, so it has to repeat the guard itself.
--
-- The history read carried the same owner-only assumption: a teammate who can
-- open a shared prompt saw an empty history. promptver_select now mirrors
-- snippet_revisions_select.
--
-- A parameter's type is part of a function's identity. CREATE OR REPLACE with
-- a text folder id would add a second overload beside the broken one, and
-- PostgREST refuses a named-argument call that matches two functions. The old
-- signature is dropped first. The dashboard already sends the folder id as a
-- string, so no client changes.

drop function if exists public.save_prompt_with_version(
  uuid, text, text, jsonb, text, text, text, text, text, text, text, boolean, uuid, text, text
);

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
  p_folder_id          text,
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

  -- The owner, or an editor of the org folder the prompt sits in: the same
  -- guard as the prompts UPDATE policy and save_snippet_with_revision. Locked
  -- for the whole transaction, so two saves racing cannot both read the same
  -- highest version number and then collide on the unique constraint.
  perform 1 from public.prompts
   where id = p_prompt_id
     and ( user_id = v_uid
        or ( organization_id is not null
             and folder_id is not null
             and app.can_write_folder(folder_id) ) )
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

comment on function public.save_prompt_with_version(uuid, text, text, jsonb, text, text, text, text, text, text, text, boolean, text, text, text) is
  'HISTORY-001 · Updates a prompt and appends its version row in one transaction, under FOR UPDATE. SECURITY DEFINER: allows the owner or an editor of the org folder, the same guard as the prompts UPDATE policy.';

revoke all on function public.save_prompt_with_version(uuid, text, text, jsonb, text, text, text, text, text, text, text, boolean, text, text, text) from public, anon;
grant execute on function public.save_prompt_with_version(uuid, text, text, jsonb, text, text, text, text, text, text, text, boolean, text, text, text) to authenticated;

-- ── History read: anyone who can open the prompt ─────────────────────────────

drop policy if exists promptver_select on public.prompt_versions;
create policy promptver_select on public.prompt_versions
  for select using (
    exists (
      select 1 from public.prompts p
      where p.id = prompt_versions.prompt_id
        and ( p.user_id = auth.uid()
           or ( p.organization_id is not null
                and p.folder_id is not null
                and app.can_read_folder(p.folder_id) ) )
    )
  );
