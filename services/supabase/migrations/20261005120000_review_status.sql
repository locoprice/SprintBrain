-- AI-KNOWLEDGE P2 · Review status on snippets, prompts and Brain items.
--
-- Every item says where it stands: draft, ai_generated, under_review,
-- approved, deprecated or archived. Owner decisions, 2026-10-04:
--
--   1. Everything that exists today starts as approved, with no reviewer, so it
--      reads as "in use, never formally reviewed" rather than as a fake review.
--   2. Team admins approve team content. Personal content is approved by its
--      owner (there is nobody else to ask). Brain items are always personal.
--   3. A non-approver who edits an approved item sends it back to
--      under_review. An approver's own edits keep it approved.
--   4. deprecated still works everywhere, with a warning. archived stops
--      working: it never expands and Ask ignores it, but it stays listed in the
--      dashboard so it can be restored.
--
-- WHO IS AN APPROVER. For a row with an organization_id (a snippet or prompt
-- in a team folder), an admin of that team. For anything else, the row's
-- owner. This reuses the access helpers the folder ACL already runs on; no new
-- authorization model.
--
-- THE RULES LIVE IN A TRIGGER, NOT IN THE CLIENTS. Four surfaces write these
-- tables (dashboard, phone, extension, MCP) and older installed extensions
-- will keep writing for weeks. A trigger is the only place every write passes.
-- Writes with no signed-in user (service role, migrations, the token-based MCP
-- functions) are left as they are: the token path stamps its own status below.
--
-- TRIGGER ORDER. Postgres fires BEFORE triggers in name order. The guard must
-- see the organization_id that trg_*_tenancy derives from the folder, so its
-- name sorts after it ("trg_snippets_zreview" > "trg_snippets_tenancy").

-- ── Columns ──────────────────────────────────────────────────────────────────

alter table public.snippets
  add column if not exists review_status text not null default 'approved',
  add column if not exists reviewed_by   uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at   timestamptz;

alter table public.prompts
  add column if not exists review_status text not null default 'approved',
  add column if not exists reviewed_by   uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at   timestamptz;

alter table public.memory_shards
  add column if not exists review_status text not null default 'approved',
  add column if not exists reviewed_by   uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at   timestamptz;

-- Keep in step with REVIEW_STATUSES in app/src/lib/reviewStatus.ts and the
-- phone page; scripts/check-review-status.js fails CI if the lists differ.
alter table public.snippets drop constraint if exists snippets_review_status;
alter table public.snippets add constraint snippets_review_status check (
  review_status in ('draft', 'ai_generated', 'under_review', 'approved', 'deprecated', 'archived')
);
alter table public.prompts drop constraint if exists prompts_review_status;
alter table public.prompts add constraint prompts_review_status check (
  review_status in ('draft', 'ai_generated', 'under_review', 'approved', 'deprecated', 'archived')
);
alter table public.memory_shards drop constraint if exists memory_shards_review_status;
alter table public.memory_shards add constraint memory_shards_review_status check (
  review_status in ('draft', 'ai_generated', 'under_review', 'approved', 'deprecated', 'archived')
);

comment on column public.snippets.review_status is
  'AI-KNOWLEDGE P2 · draft | ai_generated | under_review | approved | deprecated | archived. Rules in app.review_status_guard().';
comment on column public.prompts.review_status is
  'AI-KNOWLEDGE P2 · draft | ai_generated | under_review | approved | deprecated | archived. Rules in app.review_status_guard().';
comment on column public.memory_shards.review_status is
  'AI-KNOWLEDGE P2 · draft | ai_generated | under_review | approved | deprecated | archived. Rules in app.review_status_guard().';

-- The review page lists what is waiting; the rest of the library is approved.
create index if not exists snippets_review_waiting_idx
  on public.snippets (review_status) where review_status <> 'approved';
create index if not exists prompts_review_waiting_idx
  on public.prompts (review_status) where review_status <> 'approved';
create index if not exists memory_shards_review_waiting_idx
  on public.memory_shards (review_status) where review_status <> 'approved';

-- ── The guard ────────────────────────────────────────────────────────────────

create or replace function app.review_status_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_row       jsonb := to_jsonb(new);
  v_org       uuid := nullif(v_row ->> 'organization_id', '')::uuid;
  v_approver  boolean;
  v_keys      text[];
  v_changed   boolean := false;
  v_key       text;
  -- Statuses only an approver may set or leave.
  c_reviewed  constant text[] := array['approved', 'deprecated', 'archived'];
begin
  -- No signed-in user: service role, migrations, token-authenticated MCP
  -- functions. They are trusted server code and set what they set.
  if v_uid is null then
    return new;
  end if;

  v_approver := case
    when v_org is not null then coalesce(app.org_role(v_org) = 'admin', false)
    else new.user_id = v_uid
  end;

  if tg_op = 'INSERT' then
    -- Something new from a non-approver waits for an approver, whatever the
    -- client asked for.
    if not v_approver and new.review_status = any (c_reviewed) then
      new.review_status := 'under_review';
    end if;
    -- Nobody reviewed it yet; a client cannot claim otherwise.
    new.reviewed_by := null;
    new.reviewed_at := null;
    return new;
  end if;

  -- UPDATE from here on.
  if new.review_status is distinct from old.review_status then
    if not v_approver
       and (new.review_status = any (c_reviewed) or old.review_status = any (c_reviewed)) then
      raise exception 'review: only a team admin can change this status'
        using errcode = '42501';
    end if;
  else
    -- Status untouched. A non-approver's content edit to an approved item
    -- sends it back for review. Usage writes (pin, last used, counts, the
    -- enable switch) are not content and leave it alone.
    if not v_approver and old.review_status = 'approved' then
      v_keys := case tg_table_name
        when 'snippets'      then array['title', 'body', 'bodies']
        when 'prompts'       then array['name', 'content', 'blocks']
        when 'memory_shards' then array['name', 'summary', 'body']
        else array[]::text[]
      end;
      foreach v_key in array v_keys loop
        if (v_row -> v_key) is distinct from (to_jsonb(old) -> v_key) then
          v_changed := true;
          exit;
        end if;
      end loop;
      -- Moving into a team is a change too: otherwise a member could approve
      -- something as its personal owner, then move it into a team folder
      -- already approved.
      if v_org is not null
         and v_org is distinct from nullif(to_jsonb(old) ->> 'organization_id', '')::uuid then
        v_changed := true;
      end if;
      if v_changed then
        new.review_status := 'under_review';
      end if;
    end if;
  end if;

  -- Who reviewed it, and when, is stamped here and nowhere else.
  if new.review_status is distinct from old.review_status
     and new.review_status = any (c_reviewed) then
    new.reviewed_by := v_uid;
    new.reviewed_at := now();
  else
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
  end if;

  return new;
end;
$$;

comment on function app.review_status_guard() is
  'AI-KNOWLEDGE P2 · Approver = team admin for team rows, owner otherwise. Non-approver edits of approved content return it to under_review; only approvers set or leave approved/deprecated/archived; reviewer stamped server-side.';

drop trigger if exists trg_snippets_zreview on public.snippets;
create trigger trg_snippets_zreview
  before insert or update on public.snippets
  for each row execute function app.review_status_guard();

drop trigger if exists trg_prompts_zreview on public.prompts;
create trigger trg_prompts_zreview
  before insert or update on public.prompts
  for each row execute function app.review_status_guard();

drop trigger if exists trg_memory_shards_zreview on public.memory_shards;
create trigger trg_memory_shards_zreview
  before insert or update on public.memory_shards
  for each row execute function app.review_status_guard();

-- ── Ask and the Context panel never read archived content ────────────────────
--
-- The retrieval view keeps every column it had, in order (CREATE OR REPLACE
-- VIEW may only append), gains review_status at the end, and drops archived
-- rows. Still security_invoker: see 20260830000000_knowledge_index_view.sql.

create or replace view app.knowledge_index
with (security_invoker = true) as

  select
    'memory'::text                as kind,
    m.id::text                    as source_id,
    m.name                        as title,
    m.summary                     as summary,
    m.body                        as body,
    coalesce(m.token_estimate, 0) as tokens,
    m.updated_at                  as updated_at,
    m.user_id                     as owner_id,
    array(
      select ml.label_id
      from public.memory_shard_labels ml
      where ml.shard_id = m.id
      order by ml.label_id
    )                             as label_ids,
    m.space_id::text              as container_id,
    coalesce(m.body, '')          as search_text,
    m.review_status               as review_status
  from public.memory_shards m
  where m.deleted_at is null
    and m.review_status <> 'archived'

  union all

  select
    'snippet'::text as kind,
    s.id            as source_id,
    s.title         as title,
    left(
      coalesce(
        nullif(btrim(split_part(s.body, E'\n', 1)), ''),
        btrim(s.body)
      ),
      280
    )               as summary,
    s.body          as body,
    ceil(char_length(s.body) / 4.0)::int as tokens,
    s.updated_at    as updated_at,
    s.user_id       as owner_id,
    array(
      select sl.label_id
      from public.snippet_labels sl
      where sl.snippet_id = s.id
      order by sl.label_id
    )               as label_ids,
    s.folder_id     as container_id,
    concat_ws(
      E'\n',
      s.body,
      case when jsonb_typeof(s.bodies) = 'object' then
        (select string_agg(e.value, E'\n' order by e.key)
           from jsonb_each_text(s.bodies) as e(key, value)
          where e.value is distinct from s.body
            and btrim(e.value) <> '')
      end
    )               as search_text,
    s.review_status as review_status
  from public.snippets s
  where s.is_active
    and s.review_status <> 'archived';

comment on view app.knowledge_index is
  'MEMORY-002 · Retrieval projection over snippets and memory items. security_invoker: composes each source''s RLS, never widens it. Prompts excluded by design (instructions, not context). Archived items excluded (AI-KNOWLEDGE P2). Callers MUST be SECURITY INVOKER.';

revoke all on app.knowledge_index from public, anon;
grant select on app.knowledge_index to authenticated, service_role;

-- ── knowledge_search reports each row's review status ────────────────────────
--
-- The extension's Context panel marks a deprecated item before it is inserted.
-- Ranking, gating and every existing column are unchanged; review_status is
-- appended last, so callers that read columns by name are unaffected. A new
-- result column changes the function's type, so it is dropped and created
-- again, then granted exactly as before. Still SECURITY INVOKER: see
-- 20260831000000_knowledge_search.sql. Archived rows never reach it (the view
-- leaves them out).

drop function if exists public.knowledge_search(text, text[], uuid[], text[], int);

create function public.knowledge_search(
  p_query         text   default null,
  p_kinds         text[] default null,
  p_label_ids     uuid[] default null,
  p_container_ids text[] default null,
  p_limit         int    default 20
)
returns table (
  kind         text,
  source_id    text,
  title        text,
  summary      text,
  tokens       int,
  rank         real,
  matched_arms text[],
  review_status text
)
language sql
stable
-- No SECURITY DEFINER. See the header, and 20260831000000_knowledge_search.sql.
set search_path = public, extensions
as $$
  with base as materialized (
    select k.*,
           app.knowledge_tsv(k.title, k.search_text) as tsv,
           to_tsvector('simple', app.immutable_unaccent(coalesce(k.title, ''))) as title_tsv,
           lower(app.immutable_unaccent(coalesce(k.title, ''))) as title_norm,
           -- One language's length, not all of them: see the header, point 3.
           greatest(char_length(coalesce(k.body, '')), 1)::float8 as doc_len
    from app.knowledge_index k
    where (p_kinds         is null or k.kind         = any(p_kinds))
      and (p_container_ids is null or k.container_id = any(p_container_ids))
      and (p_label_ids     is null or k.label_ids && p_label_ids)
  ),
  stats as (
    select greatest(count(*), 1)::float8        as n,
           greatest(avg(doc_len), 1)::float8    as avg_len
    from base
  ),
  words as (
    select distinct w
    from regexp_split_to_table(lower(app.immutable_unaccent(coalesce(p_query, ''))), '[^[:alnum:]]+') as w
    where char_length(w) >= 3
      and coalesce(ts_lexize('pg_catalog.italian_stem'::regdictionary, w) <> '{}'::text[], true)
      and coalesce(ts_lexize('pg_catalog.spanish_stem'::regdictionary, w) <> '{}'::text[], true)
      and coalesce(ts_lexize('pg_catalog.english_stem'::regdictionary, w) <> '{}'::text[], true)
      and coalesce(ts_lexize('pg_catalog.french_stem'::regdictionary,  w) <> '{}'::text[], true)
  ),
  terms as (
    -- The shortest stem that is still a prefix of the word, across languages.
    select w,
           (select s
              from unnest(array[
                (ts_lexize('pg_catalog.italian_stem'::regdictionary, w))[1],
                (ts_lexize('pg_catalog.spanish_stem'::regdictionary, w))[1],
                (ts_lexize('pg_catalog.english_stem'::regdictionary, w))[1],
                (ts_lexize('pg_catalog.french_stem'::regdictionary,  w))[1],
                w
              ]) as s
             where s is not null and s <> '' and left(w, char_length(s)) = s
             order by char_length(s), s
             limit 1) as stem
    from words
  ),
  queries as (
    select w,
           case when char_length(stem) >= 4
                then to_tsquery('simple', quote_literal(stem) || ':*')
                else to_tsquery('simple', quote_literal(w) || ' | ' || quote_literal(w || 's'))
           end as tq
    from terms
  ),
  freq as (
    select q.w, q.tq, (select count(*) from base b where b.tsv @@ q.tq) as df
    from queries q
  ),
  typo as (
    select f.w,
           (select count(*) from base b where extensions.word_similarity(f.w, b.title_norm) >= 0.5) as fdf
    from freq f
    where f.df = 0
  ),
  hits as (
    select b.kind, b.source_id, f.w,
           (b.title_tsv @@ f.tq) as in_title,
           power(ln(1 + st.n / f.df), 2)
             * case when b.title_tsv @@ f.tq then 2.0
                    else 2.2 / (1 + 1.2 * (0.25 + 0.75 * b.doc_len / st.avg_len))
               end as weight,
           'fulltext'::text as arm
    from freq f
    cross join stats st
    join base b on f.df > 0 and b.tsv @@ f.tq
    union all
    select b.kind, b.source_id, y.w, true,
           power(ln(1 + st.n / y.fdf), 2),
           'typo'::text
    from typo y
    cross join stats st
    join base b on y.fdf > 0 and extensions.word_similarity(y.w, b.title_norm) >= 0.5
  ),
  scored as (
    select kind, source_id,
           sum(weight)          as score,
           count(distinct w)    as matched,
           bool_or(in_title)    as in_title,
           array_agg(distinct arm) as arms
    from hits
    group by kind, source_id
  ),
  gated as (
    select s.*, max(s.score) over () as best
    from scored s
  )
  select
    b.kind,
    b.source_id,
    b.title,
    b.summary,
    b.tokens,
    coalesce(g.score, 0)::real                       as rank,
    coalesce(g.arms, array['recency']::text[])       as matched_arms,
    b.review_status                                  as review_status
  from base b
  left join gated g on g.kind = b.kind and g.source_id = b.source_id
  -- No content words: a browse, everything the filters allow, newest first.
  where not exists (select 1 from words)
     or (g.score is not null
         and g.score >= greatest(8.0, 0.5 * g.best)
         and (g.in_title or g.matched >= least(2, (select count(*) from words))))
  order by coalesce(g.score, 0) desc, b.updated_at desc, b.source_id
  limit greatest(coalesce(p_limit, 20), 1);
$$;

comment on function public.knowledge_search(text, text[], uuid[], text[], int) is
  'MEMORY-002 · Candidate generation for a written draft: content words in four languages, stem-prefix and typo matching, idf-squared scoring with a title boost, gated to the strongest candidates. Returns ids, scores and summaries, never bodies. SECURITY INVOKER by design so RLS composes.';

comment on function public.knowledge_search(text, text[], uuid[], text[], int) is
  'MEMORY-002 · Candidate generation for a written draft: content words in four languages, stem-prefix and typo matching, idf-squared scoring with a title boost, gated to the strongest candidates. Returns ids, scores, summaries and review status, never bodies. Archived items excluded by the view. SECURITY INVOKER by design so RLS composes.';

revoke all on function public.knowledge_search(text, text[], uuid[], text[], int) from public, anon;
grant execute on function public.knowledge_search(text, text[], uuid[], text[], int) to authenticated;

-- ── The MCP server: archived items are never attached; AI writes say so ──────

create or replace function public.memory_mcp_index(p_token text)
returns table(id uuid, name text, summary text, token_estimate integer, pinned boolean, priority smallint, label_ids uuid[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := app.memory_resolve_token(p_token, 'read');
begin
  if v_uid is null then
    return;
  end if;

  return query
    select
      m.id, m.name, m.summary, m.token_estimate, m.pinned, m.priority,
      coalesce(array_agg(ml.label_id) filter (where ml.label_id is not null), '{}'::uuid[])
    from public.memory_shards m
    left join public.memory_shard_labels ml on ml.shard_id = m.id
    where m.user_id = v_uid
      and m.deleted_at is null
      and m.review_status <> 'archived'
    group by m.id
    order by m.pinned desc, m.priority desc, m.name;
end; $$;

create or replace function public.memory_mcp_bodies(p_token text, p_ids uuid[])
returns table(id uuid, name text, summary text, body text, token_estimate integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := app.memory_resolve_token(p_token, 'read');
begin
  if v_uid is null then
    return;
  end if;

  return query
    select m.id, m.name, m.summary, m.body, m.token_estimate
    from public.memory_shards m
    where m.user_id = v_uid
      and m.deleted_at is null
      and m.review_status <> 'archived'
      and m.id = any(coalesce(p_ids, '{}'::uuid[]))
    order by m.name;
end; $$;

-- An item an AI agent wrote through MCP is marked ai_generated, so a person
-- sees it was not written by them and can approve it. The token path has no
-- signed-in user, so the guard leaves this write alone.
create or replace function public.memory_mcp_save(
  p_token    text,
  p_name     text,
  p_body     text,
  p_summary  text  default null,
  p_space_id uuid  default null,
  p_kind     text  default 'fact',
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := app.memory_resolve_token(p_token, 'write');
  v_id  uuid;
begin
  if v_uid is null then
    return null;
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'memory_mcp_save: name is required' using errcode = '22023';
  end if;
  if btrim(coalesce(p_body, '')) = '' then
    raise exception 'memory_mcp_save: body is required' using errcode = '22023';
  end if;

  -- p_shard_id is hard-coded null: this entry point creates, never overwrites.
  v_id := app.memory_write_shard(
    v_uid, null::uuid, btrim(p_name), p_summary, p_body, 'MCP',
    p_space_id, p_kind, p_metadata, false, 0::smallint, null::text, 'mcp'
  );

  update public.memory_shards set review_status = 'ai_generated' where id = v_id;

  return v_id;
end; $$;
