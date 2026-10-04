-- AI-KNOWLEDGE P1 · Feedback on Ask SprintBrain answers.
--
-- Someone reads an answer and says it was useful, wrong, outdated, incomplete,
-- irrelevant, or at odds with company policy. That verdict lands here, with the
-- question, the answer and the sources the answer was built from, so a person
-- can go and look at those sources.
--
-- NOTHING HERE EDITS A SOURCE. Negative feedback never rewrites a snippet or a
-- Brain item; it opens a row someone reviews. That is the spec's rule ("do not
-- automatically rewrite authoritative company content solely because users
-- provide negative feedback") made structural: this table has no path to any
-- content table.
--
-- WHO SEES WHAT.
--   · The author always sees their own feedback.
--   · Team admins see the feedback their team members filed against that team
--     (organization_id), because admins are who maintains shared content.
--   · organization_id is optional: a person with no team files personal
--     feedback that only they see.
-- Inserting under a team requires membership of it, so a row cannot be pushed
-- into another team's review list.
--
-- `sources` is a snapshot ({kind, id, title, space_id, used} per source), not foreign
-- keys: a source can be deleted, renamed or moved after the feedback is filed,
-- and the review row must still say what the answer was built from.

create table if not exists public.knowledge_feedback (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  question        text not null,
  answer          text not null default '',
  -- Keep in step with ASK_VERDICTS in app/src/lib/askKnowledge.ts and the phone
  -- page; scripts/check-ask-knowledge.js fails CI if the three lists differ.
  verdict         text not null,
  sources         jsonb not null default '[]'::jsonb,
  status          text not null default 'open',
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid references auth.users(id) on delete set null,
  constraint knowledge_feedback_verdict check (
    verdict in ('useful', 'incorrect', 'outdated', 'incomplete', 'irrelevant', 'conflicting')
  ),
  constraint knowledge_feedback_status check (status in ('open', 'resolved')),
  constraint knowledge_feedback_question_length check (char_length(btrim(question)) between 1 and 1000),
  constraint knowledge_feedback_answer_length check (char_length(answer) <= 8000),
  constraint knowledge_feedback_sources_array check (jsonb_typeof(sources) = 'array'),
  constraint knowledge_feedback_resolution check (
    (status = 'open' and resolved_at is null) or (status = 'resolved' and resolved_at is not null)
  )
);

comment on table public.knowledge_feedback is
  'AI-KNOWLEDGE P1 · A verdict on one Ask SprintBrain answer. Opens a review row; never edits a source.';

create index if not exists knowledge_feedback_user_idx on public.knowledge_feedback (user_id, created_at desc);
create index if not exists knowledge_feedback_org_open_idx
  on public.knowledge_feedback (organization_id, created_at desc)
  where status = 'open';

alter table public.knowledge_feedback enable row level security;

create policy knowledge_feedback_select on public.knowledge_feedback
  for select to authenticated
  using (
    user_id = auth.uid()
    or (organization_id is not null and app.org_role(organization_id) = 'admin')
  );

create policy knowledge_feedback_insert on public.knowledge_feedback
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'open'
    and resolved_at is null
    and resolved_by is null
    and (organization_id is null or app.is_org_member(organization_id))
  );

-- Resolving is the only update: the author closes their own, an admin closes
-- their team's. The content columns are pinned by the trigger below, so an
-- update cannot rewrite what someone else reported.
create policy knowledge_feedback_update on public.knowledge_feedback
  for update to authenticated
  using (
    user_id = auth.uid()
    or (organization_id is not null and app.org_role(organization_id) = 'admin')
  )
  with check (
    user_id = auth.uid()
    or (organization_id is not null and app.org_role(organization_id) = 'admin')
  );

create or replace function app.knowledge_feedback_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.user_id         is distinct from old.user_id
  or new.organization_id is distinct from old.organization_id
  or new.question        is distinct from old.question
  or new.answer          is distinct from old.answer
  or new.verdict         is distinct from old.verdict
  or new.sources         is distinct from old.sources
  or new.created_at      is distinct from old.created_at then
    raise exception 'knowledge_feedback: only the review status can change';
  end if;

  if new.status = 'resolved' and old.status = 'open' then
    new.resolved_at := now();
    new.resolved_by := auth.uid();
  elsif new.status = 'open' then
    new.resolved_at := null;
    new.resolved_by := null;
  else
    -- Still resolved: who closed it, and when, stays as recorded.
    new.resolved_at := old.resolved_at;
    new.resolved_by := old.resolved_by;
  end if;
  return new;
end;
$$;

drop trigger if exists knowledge_feedback_guard on public.knowledge_feedback;
create trigger knowledge_feedback_guard
  before update on public.knowledge_feedback
  for each row execute function app.knowledge_feedback_guard();

-- No delete policy: feedback is a record. It is closed, not erased; account
-- deletion still removes it through the user_id cascade.
-- authenticated is revoked too, then given back only what the product uses:
-- Supabase's default privileges otherwise grant it TRUNCATE, which RLS does
-- not cover. (Production received this as a second step,
-- knowledge_feedback_least_privilege, on 2026-10-04.)
revoke all on public.knowledge_feedback from public, anon, authenticated;
grant select, insert, update on public.knowledge_feedback to authenticated;
