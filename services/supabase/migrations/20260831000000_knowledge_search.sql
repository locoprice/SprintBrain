-- MEMORY-002 P2 · Candidate generation over the knowledge view.
--
-- SQL's half of the line drawn in P-2: this filters and coarse-ranks, and hands
-- back ids and scores. It returns NO BODIES, does no deduplication and does no
-- token budgeting. Those belong to app/src/lib/memory/engine.ts, which is the
-- single selection authority, and putting any of them here would create the
-- third ranking implementation the plan exists to prevent.
--
-- ⚠ public.knowledge_search IS DELIBERATELY *NOT* SECURITY DEFINER.
--
-- It reads app.knowledge_index, which is security_invoker. That setting resolves
-- against the role executing the query, so inside a definer function the role
-- would be the definer (postgres), RLS would be bypassed, and the function would
-- return every account's rows. P1 measured this: one account sees 97 rows, the
-- owner sees 117. Leaving this function SECURITY INVOKER is what keeps
-- authorization composed. Do not "fix" a permission error here by adding
-- SECURITY DEFINER.
--
-- It lives in `public` because that is the schema PostgREST exposes; `app` holds
-- the view and the helpers, which stay unreachable over REST.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ── Immutable unaccent ───────────────────────────────────────────────────────
--
-- extensions.unaccent(text) is STABLE, because it resolves a dictionary at call
-- time, and Postgres refuses a non-immutable function in an index expression.
-- Naming the dictionary explicitly makes the result depend only on the input,
-- which is what lets this be marked immutable.
--
-- The honest caveat: this is a promise that the `unaccent` dictionary will not
-- change underneath the indexes. If it ever does, the indexes must be rebuilt.
-- That is the standard trade for accent-insensitive search and it is the reason
-- this wrapper exists rather than calling unaccent() directly.
create or replace function app.immutable_unaccent(p_text text)
returns text
language sql
immutable
strict
parallel safe
set search_path = extensions
as $$ select extensions.unaccent('extensions.unaccent', p_text) $$;

comment on function app.immutable_unaccent(text) is
  'MEMORY-002 P2 · Accent folding pinned to a named dictionary so it can be marked immutable and used in an index. Rebuild dependent indexes if the dictionary changes.';

-- ── One tsvector definition ──────────────────────────────────────────────────
--
-- Defined ONCE and used by both the indexes and the query. An expression index
-- is only used when the query's expression matches it exactly, so writing the
-- expression twice would be a silent performance cliff the first time one copy
-- was edited.
--
-- 'simple' rather than 'english': SprintBrain is multilingual by design (EN, IT,
-- ES, FR) and an English stemmer applied to Italian produces worse matches than
-- no stemmer at all. Per-language configuration is a later refinement.
create or replace function app.knowledge_tsv(p_title text, p_body text)
returns tsvector
language sql
immutable
parallel safe
as $$
  select setweight(to_tsvector('simple', app.immutable_unaccent(coalesce(p_title, ''))), 'A')
      || setweight(to_tsvector('simple', app.immutable_unaccent(coalesce(p_body,  ''))), 'B');
$$;

comment on function app.knowledge_tsv(text, text) is
  'MEMORY-002 P2 · The single full-text projection. Used by both the GIN indexes and knowledge_search, so the two cannot drift.';

-- ── Indexes ──────────────────────────────────────────────────────────────────
--
-- Expression indexes rather than stored generated columns. The plan named a
-- `search_tsv` column; an index gives the same lookup without adding a column to
-- `snippets`, which is the hottest table in the product and read by the
-- extension, the popup and both dashboards. No table rewrite, no schema change
-- any consumer can see, and reversible with DROP INDEX.

create index if not exists snippets_knowledge_tsv_idx
  on public.snippets using gin (app.knowledge_tsv(title, body));

create index if not exists memory_shards_knowledge_tsv_idx
  on public.memory_shards using gin (app.knowledge_tsv(name, body));

-- Trigram on the title only. It exists to catch a typo or a partial handle in a
-- name; running it over bodies would match on incidental character overlap and
-- return noise.
--
-- ⚠ Indexed on the UNACCENTED title, not the raw one, because that is the
-- expression knowledge_search compares. An index on bare `title` looks correct,
-- builds fine and is silently never used: EXPLAIN on the real expression falls
-- back to a Seq Scan even with enable_seqscan off. This is the exact drift the
-- knowledge_tsv comment warns about, and it was caught by checking rather than
-- assuming.
create index if not exists snippets_title_trgm_idx
  on public.snippets using gin (app.immutable_unaccent(title) extensions.gin_trgm_ops);

create index if not exists memory_shards_name_trgm_idx
  on public.memory_shards using gin (app.immutable_unaccent(name) extensions.gin_trgm_ops);

-- ── The view gains a container, so a search can be scoped ────────────────────
--
-- CREATE OR REPLACE VIEW may append columns, so this is additive and existing
-- callers are unaffected. `container_id` is the space for a memory item and the
-- folder for a snippet: the same idea in each source's own vocabulary, which is
-- what lets one filter serve both without inventing a shared table.

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
    m.space_id::text              as container_id
  from public.memory_shards m
  where m.deleted_at is null

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
    s.folder_id     as container_id
  from public.snippets s
  where s.is_active;

comment on view app.knowledge_index is
  'MEMORY-002 · Retrieval projection over snippets and memory items. security_invoker: composes each source''s RLS, never widens it. Prompts excluded by design (instructions, not context). Callers MUST be SECURITY INVOKER.';

revoke all on app.knowledge_index from public, anon;
grant select on app.knowledge_index to authenticated, service_role;

-- ── Candidate generation ─────────────────────────────────────────────────────

/**
 * Rank candidates for a query. Ids, scores and summaries only.
 *
 * Fusion is Reciprocal Rank Fusion (1 / (k + rank), k = 60) rather than
 * weighted score blending, because a ts_rank and a trigram similarity are not
 * comparable numbers and RRF needs no normalisation between them. It also
 * degrades cleanly: an arm that matches nothing simply contributes nothing.
 *
 * Every filter is applied in `base`, which all arms read, so a filtered search
 * ranks the filtered set rather than filtering an already-ranked list and
 * returning a short one.
 *
 * With no query text the arms have nothing to match, so the result is a recency
 * listing of whatever the filters allow. Recency is deliberately NOT a third
 * fused arm when a query IS present: at k = 60 a rank-1 recency hit scores the
 * same as a rank-1 relevance hit, which would let "recently edited" outrank
 * "actually matches". It is a tiebreak instead.
 */
create or replace function public.knowledge_search(
  p_query        text   default null,
  p_kinds        text[] default null,
  p_label_ids    uuid[] default null,
  p_container_ids text[] default null,
  p_limit        int    default 20
)
returns table (
  kind         text,
  source_id    text,
  title        text,
  summary      text,
  tokens       int,
  rank         real,
  matched_arms text[]
)
language sql
stable
-- No SECURITY DEFINER. See the warning at the top of this file.
set search_path = public, extensions
as $$
  with base as (
    select k.*
    from app.knowledge_index k
    where (p_kinds         is null or k.kind         = any(p_kinds))
      and (p_container_ids is null or k.container_id = any(p_container_ids))
      and (p_label_ids     is null or k.label_ids && p_label_ids)
  ),
  q as (
    select case
             when p_query is null or btrim(p_query) = '' then null
             else websearch_to_tsquery('simple', app.immutable_unaccent(p_query))
           end as tsq,
           nullif(btrim(coalesce(p_query, '')), '') as raw
  ),
  fts as (
    select b.kind, b.source_id,
           row_number() over (
             order by ts_rank(app.knowledge_tsv(b.title, b.body), q.tsq) desc, b.source_id
           ) as rnk
    from base b, q
    where q.tsq is not null
      and app.knowledge_tsv(b.title, b.body) @@ q.tsq
  ),
  trg as (
    select b.kind, b.source_id,
           row_number() over (
             order by extensions.similarity(
                        app.immutable_unaccent(b.title),
                        app.immutable_unaccent(q.raw)
                      ) desc, b.source_id
           ) as rnk
    from base b, q
    where q.raw is not null
      -- OPERATOR(...) is the only way to schema-qualify an operator; `extensions.%`
      -- is a syntax error.
      and app.immutable_unaccent(b.title) operator(extensions.%) app.immutable_unaccent(q.raw)
  ),
  fused as (
    select kind, source_id, sum(score) as score, array_agg(distinct arm) as arms
    from (
      select kind, source_id, 1.0 / (60 + rnk) as score, 'fulltext' as arm from fts
      union all
      select kind, source_id, 1.0 / (60 + rnk) as score, 'trigram'  as arm from trg
    ) scored
    group by kind, source_id
  )
  select
    b.kind,
    b.source_id,
    b.title,
    b.summary,
    b.tokens,
    coalesce(f.score, 0)::real as rank,
    coalesce(f.arms, array['recency']::text[]) as matched_arms
  from base b
  left join fused f on f.kind = b.kind and f.source_id = b.source_id
  -- A query keeps only what an arm matched; without one, everything is listed.
  where (select raw from q) is null or f.source_id is not null
  order by coalesce(f.score, 0) desc, b.updated_at desc, b.source_id
  limit greatest(coalesce(p_limit, 20), 1);
$$;

comment on function public.knowledge_search(text, text[], uuid[], text[], int) is
  'MEMORY-002 P2 · Candidate generation: filter, coarse-rank, RRF-fuse. Returns ids, scores and summaries, never bodies. SECURITY INVOKER by design so RLS composes.';

revoke all on function public.knowledge_search(text, text[], uuid[], text[], int) from public, anon;
grant execute on function public.knowledge_search(text, text[], uuid[], text[], int) to authenticated;

grant execute on function app.immutable_unaccent(text) to authenticated, service_role;
grant execute on function app.knowledge_tsv(text, text) to authenticated, service_role;
