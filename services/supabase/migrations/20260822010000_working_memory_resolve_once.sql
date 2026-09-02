-- MEMORY-001 followup · Resolve the MCP token once per call, not once per row.
--
-- The bug. 20260822000000 wrote the three read functions as `language sql` with
-- the resolver in the WHERE clause:
--
--   where m.user_id = app.memory_resolve_token(p_token)
--
-- app.memory_resolve_token is VOLATILE (it throttle-writes last_used_at), and
-- Postgres evaluates a volatile function in a WHERE clause once PER ROW. Two
-- consequences, both found by probing the applied schema rather than by reading
-- it:
--
-- 1. Cost. A user with 200 shards paid 200 SHA-256 hashes and 200 indexed
--    lookups on memory_tokens for a single memory_mcp_index call.
-- 2. last_used_at never updated for a user with zero shards, because with no
--    rows to filter the WHERE clause is never evaluated and the resolver is
--    never called at all. A token could be in daily use and still look unused.
--
-- The fix is to resolve once into a local and compare against that. plpgsql
-- rather than a MATERIALIZED CTE because the null case then reads as what it
-- is: an unknown token returns no rows and never touches the shard tables.
--
-- Behaviour is otherwise identical, including the contract that a wrong token
-- yields zero rows rather than an error, so the surface does not confirm which
-- tokens exist. Signatures and column names are unchanged, so PostgREST clients
-- need no update.

create or replace function public.memory_mcp_manifest(p_token text)
returns table (
  step_key     text,
  step_name    text,
  description  text,
  token_budget int,
  sort_order   smallint,
  label_id     uuid,
  label_name   text,
  weight       smallint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := app.memory_resolve_token(p_token);
begin
  if v_uid is null then
    return;
  end if;

  return query
    select
      s.key, s.name, s.description, s.token_budget, s.sort_order,
      l.id, l.name, sl.weight
    from public.memory_steps s
    left join public.memory_step_labels sl on sl.step_id = s.id
    left join public.labels l              on l.id = sl.label_id
    where s.user_id = v_uid
    order by s.sort_order, s.key, l.name;
end; $$;

comment on function public.memory_mcp_manifest(text) is
  'MEMORY-001 · Steps and their required labels, one flat row per (step, label). Token resolved once.';

create or replace function public.memory_mcp_index(p_token text)
returns table (
  id             uuid,
  name           text,
  summary        text,
  token_estimate int,
  pinned         boolean,
  priority       smallint,
  label_ids      uuid[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := app.memory_resolve_token(p_token);
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
    group by m.id
    order by m.pinned desc, m.priority desc, m.name;
end; $$;

comment on function public.memory_mcp_index(text) is
  'MEMORY-001 · Shard index without bodies. Token resolved once; listing costs no body reads.';

create or replace function public.memory_mcp_bodies(p_token text, p_ids uuid[])
returns table (id uuid, name text, summary text, body text, token_estimate int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := app.memory_resolve_token(p_token);
begin
  if v_uid is null then
    return;
  end if;

  return query
    select m.id, m.name, m.summary, m.body, m.token_estimate
    from public.memory_shards m
    where m.user_id = v_uid
      and m.id = any(coalesce(p_ids, '{}'::uuid[]))
    order by m.name;
end; $$;

comment on function public.memory_mcp_bodies(text, uuid[]) is
  'MEMORY-001 · Bodies for an explicit id list, the only call returning shard text. Token resolved once.';

-- CREATE OR REPLACE keeps existing grants, but the language changed, so restate
-- them rather than assume.
revoke all on function public.memory_mcp_manifest(text) from public;
revoke all on function public.memory_mcp_index(text)    from public;
revoke all on function public.memory_mcp_bodies(text, uuid[]) from public;

grant execute on function public.memory_mcp_manifest(text) to anon, authenticated;
grant execute on function public.memory_mcp_index(text)    to anon, authenticated;
grant execute on function public.memory_mcp_bodies(text, uuid[]) to anon, authenticated;
