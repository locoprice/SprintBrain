-- Brain items drafted with AI (AI-KNOWLEDGE P3, docs/AI_KNOWLEDGE_PLAN.md).
--
-- A new item written from an AI draft is saved as ai_generated, never as
-- approved. Snippets and prompts insert straight into their tables and send the
-- status with the row. Brain items save through memory_save_shard, which had no
-- way to carry it, so this adds p_review_status and applies it inside the same
-- call: the item is never approved, not even for a moment.
--
-- Only a status that waits for a person can be asked for here. Approving,
-- deprecating and archiving stay deliberate steps, taken in the status menu or
-- on the Review page, where app.review_status_guard() checks the approver.
--
-- A thirteenth parameter added by CREATE OR REPLACE would leave two overloads,
-- and every existing call would become ambiguous, so the old signature is
-- dropped first (memory_issue_token went the same way in 20260923000000). The
-- new parameter defaults to null, and every deployed caller (dashboard,
-- extension, phone) names its arguments and leaves it out, so they all keep
-- working unchanged.
--
-- Requires 20261005120000_review_status.sql (the review_status column).

drop function if exists public.memory_save_shard(uuid, text, text, text, text, uuid, text, jsonb, boolean, smallint, text, text);

create function public.memory_save_shard(
  p_shard_id       uuid,
  p_name           text,
  p_summary        text,
  p_body           text,
  p_editor_display text,
  p_space_id       uuid     default null,
  p_kind           text     default 'fact',
  p_metadata       jsonb    default '{}',
  p_pinned         boolean  default false,
  p_priority       smallint default 0,
  p_edit_note      text     default null,
  p_surface        text     default 'dashboard',
  p_review_status  text     default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'memory_save_shard: authentication required' using errcode = '42501';
  end if;

  if p_review_status is not null
     and p_review_status not in ('draft', 'ai_generated', 'under_review') then
    raise exception 'memory_save_shard: only draft, ai_generated or under_review can be set here'
      using errcode = '22023';
  end if;

  v_id := app.memory_write_shard(
    v_uid, p_shard_id, p_name, p_summary, p_body, p_editor_display,
    p_space_id, p_kind, p_metadata, p_pinned, p_priority, p_edit_note, p_surface
  );

  -- The row belongs to the caller (memory_write_shard checked it), and the
  -- review guard still runs on this update as the caller.
  if p_review_status is not null then
    update public.memory_shards set review_status = p_review_status where id = v_id;
  end if;

  return v_id;
end; $$;

comment on function public.memory_save_shard(uuid, text, text, text, text, uuid, text, jsonb, boolean, smallint, text, text, text) is
  'MEMORY-002 · Session-authenticated save. Resolves auth.uid() and defers to app.memory_write_shard. p_review_status (AI-KNOWLEDGE P3) marks a new item draft, ai_generated or under_review in the same call.';

revoke all on function public.memory_save_shard(uuid, text, text, text, text, uuid, text, jsonb, boolean, smallint, text, text, text) from public, anon;
grant execute on function public.memory_save_shard(uuid, text, text, text, text, uuid, text, jsonb, boolean, smallint, text, text, text) to authenticated;
