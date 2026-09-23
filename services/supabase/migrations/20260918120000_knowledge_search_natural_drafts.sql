-- MEMORY-002 · knowledge_search reads a written draft, not a keyword list.
--
-- THE DEFECT. The Context panel sends whatever the user has typed as the query.
-- knowledge_search turned it into websearch_to_tsquery, which joins every word
-- with AND, function words included:
--
--   'scrivi' & 'al' & 'cliente' & 'che' & 'sono' & 'in' & 'aeroporto' & ...
--
-- No item contains every word of a sentence, so every real draft returned
-- nothing, and the only thing the panel could ever offer was a recency browse.
-- One or two bare keywords worked, which is why the fixtures passed. Measured on
-- 2026-09-18 on a production library: 0 results for four ordinary drafts in
-- Spanish, Italian and English, including one that describes an existing
-- snippet almost word for word.
--
-- THE REPLACEMENT, still candidate generation only (P-2): ids, scores and
-- summaries, no bodies, no budgeting, no deduplication.
--
--   1. Content words. The draft is unaccented, lowercased and split on anything
--      that is not a letter or digit. Words under three characters go, and so do
--      function words in any of the four library languages, using the stop lists
--      Postgres ships with its Italian, Spanish, English and French stemmers
--      (ts_lexize returns an empty array for a stop word).
--   2. Word forms. Each word is matched by its shortest stem across the four
--      stemmers, as a prefix, when that stem is four characters or more: cliente
--      finds clienti, recibido finds RECIBO. Shorter words match exactly or with
--      an s, so bed finds beds.
--   3. Any word may match. An item scores the sum, over the words it contains,
--      of idf squared, idf = ln(1 + N / df) over the items the caller can see.
--      Squaring lets the one rare word that names the subject outweigh several
--      common ones that appear in every reply. A word in the title counts
--      double; a word only in the body is scaled by the body's length (BM25,
--      k1 = 1.2, b = 0.75), measured on the item's own language only, so a
--      snippet that stores four translations is not penalised for it.
--   4. Typos. A word that matches nothing anywhere may match a title that reads
--      almost the same (pg_trgm word_similarity >= 0.5): aeropoto finds
--      AEROPORTO.
--   5. The gate. An item is returned only if its score is at least 8 and at
--      least half the best score, AND it either matched in its title or matched
--      two different words of the draft (one, for a one-word draft). A single
--      common word, a greeting, a role word like cliente, is not a match.
--
-- `rank` is now that score: 0 for a browse, otherwise higher is more relevant.
-- It is no longer a reciprocal-rank fusion, which needed two arms that each
-- ranked everything; with the draft as the query the trigram arm compared a
-- whole sentence to a title and matched nothing. The extension's relevance
-- floor (1/75) is inert against these scores, and the panel pre-selects only
-- the strongest candidates (see memory-picker.js).
--
-- A query with no content words ("ciao come stai") is treated as a browse, the
-- same as an empty one.
--
-- THE VIEW gains `search_text`: a snippet's body plus every other language held
-- in its `bodies` map. Thirty production snippets keep their translations in
-- that map, so a Spanish draft could not find a snippet whose Spanish lived
-- there. Appended last, so CREATE OR REPLACE is additive and every existing
-- column keeps its position and meaning.
--
-- SECURITY: unchanged. The view stays security_invoker and is restated as such
-- below; the function stays SECURITY INVOKER. Neither may ever become owner- or
-- definer-rights: RLS on snippets and memory_shards is what keeps one account's
-- items out of another's results. The expression indexes from
-- 20260831000000_knowledge_search.sql are no longer used by this function; they
-- are left in place and cost only index maintenance.

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
    coalesce(m.body, '')          as search_text
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
    s.folder_id     as container_id,
    concat_ws(
      E'\n',
      s.body,
      -- Guarded: jsonb_each_text raises on anything that is not an object, and
      -- one malformed row would otherwise fail every search for every user.
      case when jsonb_typeof(s.bodies) = 'object' then
        (select string_agg(e.value, E'\n' order by e.key)
           from jsonb_each_text(s.bodies) as e(key, value)
          where e.value is distinct from s.body
            and btrim(e.value) <> '')
      end
    )               as search_text
  from public.snippets s
  where s.is_active;

comment on view app.knowledge_index is
  'MEMORY-002 · Retrieval projection over snippets and memory items. security_invoker: composes each source''s RLS, never widens it. Prompts excluded by design (instructions, not context). search_text = the body plus every other language a snippet holds, for matching only. Callers MUST be SECURITY INVOKER.';

revoke all on app.knowledge_index from public, anon;
grant select on app.knowledge_index to authenticated, service_role;

create or replace function public.knowledge_search(
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
  matched_arms text[]
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
    coalesce(g.arms, array['recency']::text[])       as matched_arms
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

revoke all on function public.knowledge_search(text, text[], uuid[], text[], int) from public, anon;
grant execute on function public.knowledge_search(text, text[], uuid[], text[], int) to authenticated;
