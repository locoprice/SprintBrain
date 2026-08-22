-- MEMORY-001 · Working memory: shards, steps, and token-authenticated MCP reads.
--
-- The problem. An agent that loads every fact it might need pays for all of
-- them on every turn. This schema stores facts as individually addressable
-- shards, tags them with the EXISTING labels vocabulary, and lets a named step
-- declare which labels it needs. The orchestrator (services/mcp-memory) then
-- attaches only what the current step asks for, inside a token budget.
--
-- Why labels rather than a new tag column. LABELS-001 already owns a per-user
-- vocabulary shared by snippets and prompts. A second tag namespace would mean
-- the same idea spelled two ways and a user maintaining both. Shards join the
-- same table, so one rename fixes every surface.
--
-- Why a new table rather than reusing prompts. A shard is a fact, a prompt is
-- an instruction. prompts carries strategy_type, thinking_mode, output_type and
-- fifteen other columns that mean nothing for a fact, and mixing the two would
-- fill the prompt library with things nobody wants to run.
--
-- ⚠ RLS COST. The link tables (memory_shard_labels, memory_step_labels)
-- denormalize user_id and their read policies compare it directly, calling no
-- access helper. That is the same deliberate choice as snippet_labels: routing
-- a per-row policy through a recursive CTE exhausted the connection pool and
-- wedged production for ~2h on 2026-08-05. Ownership is verified in WITH CHECK,
-- which only runs on writes.
--
-- Scope: shards are PERSONAL, like labels. Folder sharing is deliberately not
-- wired in. A shard is background knowledge injected into someone's model
-- context, and org-wide inheritance (see app.folder_level_eff) would mean a
-- teammate's fact silently steering your assistant. If team memory is wanted
-- later it should be an explicit opt-in, not inherited.
--
-- No extension dependency: sha256(bytea) and gen_random_uuid() are both core
-- Postgres, so this applies without pgcrypto.

-- ── memory_shards ────────────────────────────────────────────────────────────

create table if not exists public.memory_shards (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null,
  summary    text not null default '',
  body       text not null,
  -- Kept in lockstep with estimateTokens() in app/src/lib/memory/engine.ts.
  -- Crude on purpose: budgeting needs a number that is stable, cheap, and
  -- identical on both sides of the wire. A real tokenizer cannot run in a
  -- generated column, so a budget is approximate by design.
  token_estimate int generated always as (ceil(char_length(body) / 4.0)::int) stored,
  -- Always attached, never evicted. The always-on core.
  pinned     boolean not null default false,
  -- Tie-break within a step. Higher wins.
  priority   smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memory_shards_name_not_blank check (btrim(name) <> ''),
  constraint memory_shards_name_length   check (char_length(btrim(name)) <= 64),
  constraint memory_shards_summary_length check (char_length(summary) <= 280),
  -- A shard larger than this is a document, not a fact, and no budget survives
  -- attaching one. Split it instead.
  constraint memory_shards_body_length   check (char_length(body) between 1 and 20000)
);

comment on table public.memory_shards is
  'MEMORY-001 · One fact per row, the unit an orchestrator attaches and detaches. Personal, never org-shared.';
comment on column public.memory_shards.token_estimate is
  'ceil(char_length(body) / 4.0). Must match CHARS_PER_TOKEN in app/src/lib/memory/engine.ts.';
comment on column public.memory_shards.summary is
  'One line. Lets the index be listed without loading a single body. That is the actual token saving.';

create unique index if not exists memory_shards_user_name_ci_uniq
  on public.memory_shards (user_id, lower(btrim(name)));

create index if not exists memory_shards_user_id_idx on public.memory_shards (user_id);
create index if not exists memory_shards_pinned_idx  on public.memory_shards (user_id) where pinned;

create or replace function app.memory_shards_normalize()
returns trigger language plpgsql set search_path = public as $$
begin
  new.name := btrim(new.name);
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists memory_shards_normalize on public.memory_shards;
create trigger memory_shards_normalize
  before insert or update on public.memory_shards
  for each row execute function app.memory_shards_normalize();

-- ── memory_steps ─────────────────────────────────────────────────────────────
--
-- Deliberately unseeded. Steps are the user's own vocabulary: a clinic's
-- "intake" and a firm's "discovery" are as valid as an engineer's "explore",
-- and shipping one industry's phase names would violate the industry-neutral
-- rule in CLAUDE.md. The dashboard authoring UI (follow-up) creates these; the
-- MCP server README carries example SQL to adapt.

create table if not exists public.memory_steps (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- Stable handle the agent passes; the name is what a human reads.
  key          text not null,
  name         text not null,
  description  text not null default '',
  token_budget int not null default 4000,
  sort_order   smallint not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint memory_steps_key_not_blank check (btrim(key) <> ''),
  constraint memory_steps_key_shape     check (key ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
  constraint memory_steps_name_not_blank check (btrim(name) <> ''),
  constraint memory_steps_budget_sane   check (token_budget between 100 and 200000)
);

comment on table public.memory_steps is
  'MEMORY-001 · A named phase of work and its token budget. The step manifest lives here, not in a config file, so every surface reads the same rows.';

create unique index if not exists memory_steps_user_key_uniq
  on public.memory_steps (user_id, key);

create index if not exists memory_steps_user_id_idx on public.memory_steps (user_id);

create or replace function app.memory_steps_normalize()
returns trigger language plpgsql set search_path = public as $$
begin
  new.key  := lower(btrim(new.key));
  new.name := btrim(new.name);
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists memory_steps_normalize on public.memory_steps;
create trigger memory_steps_normalize
  before insert or update on public.memory_steps
  for each row execute function app.memory_steps_normalize();

-- ── link tables ──────────────────────────────────────────────────────────────

create table if not exists public.memory_shard_labels (
  shard_id   uuid not null references public.memory_shards(id) on delete cascade,
  label_id   uuid not null references public.labels(id)        on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (shard_id, label_id)
);

comment on table public.memory_shard_labels is
  'Shard ⇄ label assignments. Same denormalized-user_id contract as snippet_labels: reads cost one comparison, never a function call.';

create index if not exists memory_shard_labels_user_id_idx  on public.memory_shard_labels (user_id);
create index if not exists memory_shard_labels_label_id_idx on public.memory_shard_labels (label_id);

create table if not exists public.memory_step_labels (
  step_id    uuid not null references public.memory_steps(id) on delete cascade,
  label_id   uuid not null references public.labels(id)       on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- Ranking weight, not a filter. Eligibility is a union over the step's
  -- labels; weight decides what gets in first when the budget is tight.
  weight     smallint not null default 1,
  created_at timestamptz not null default now(),
  primary key (step_id, label_id),
  constraint memory_step_labels_weight_sane check (weight between 0 and 100)
);

comment on table public.memory_step_labels is
  'Step ⇄ label requirements. A shard is eligible for a step if it carries ANY of the step''s labels; weights sum into its rank.';

create index if not exists memory_step_labels_user_id_idx  on public.memory_step_labels (user_id);
create index if not exists memory_step_labels_label_id_idx on public.memory_step_labels (label_id);

-- ── memory_tokens ────────────────────────────────────────────────────────────
--
-- Personal access tokens for the MCP server, which is a headless process with
-- no browser and therefore no Supabase session to inherit. Only the hash is
-- stored: a database dump does not yield a working credential, and the
-- plaintext is returned exactly once at issue time.

create table if not exists public.memory_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name         text not null,
  -- sha256 hex of the full plaintext token. Never the token itself.
  token_hash   text not null,
  -- Leading characters, for telling two tokens apart in a list.
  prefix       text not null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  constraint memory_tokens_name_not_blank check (btrim(name) <> ''),
  constraint memory_tokens_name_length    check (char_length(btrim(name)) <= 48)
);

comment on table public.memory_tokens is
  'MEMORY-001 · Hashed personal access tokens for the MCP server. Plaintext is shown once at issue and never stored.';

create unique index if not exists memory_tokens_hash_uniq on public.memory_tokens (token_hash);
create index if not exists memory_tokens_user_id_idx on public.memory_tokens (user_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.memory_shards       enable row level security;
alter table public.memory_steps        enable row level security;
alter table public.memory_shard_labels enable row level security;
alter table public.memory_step_labels  enable row level security;
alter table public.memory_tokens       enable row level security;

drop policy if exists "memory_shards: select own" on public.memory_shards;
create policy "memory_shards: select own" on public.memory_shards
  for select using (auth.uid() = user_id);

drop policy if exists "memory_shards: insert own" on public.memory_shards;
create policy "memory_shards: insert own" on public.memory_shards
  for insert with check (user_id = auth.uid());

drop policy if exists "memory_shards: update own" on public.memory_shards;
create policy "memory_shards: update own" on public.memory_shards
  for update using (auth.uid() = user_id) with check (user_id = auth.uid());

drop policy if exists "memory_shards: delete own" on public.memory_shards;
create policy "memory_shards: delete own" on public.memory_shards
  for delete using (auth.uid() = user_id);

drop policy if exists "memory_steps: select own" on public.memory_steps;
create policy "memory_steps: select own" on public.memory_steps
  for select using (auth.uid() = user_id);

drop policy if exists "memory_steps: insert own" on public.memory_steps;
create policy "memory_steps: insert own" on public.memory_steps
  for insert with check (user_id = auth.uid());

drop policy if exists "memory_steps: update own" on public.memory_steps;
create policy "memory_steps: update own" on public.memory_steps
  for update using (auth.uid() = user_id) with check (user_id = auth.uid());

drop policy if exists "memory_steps: delete own" on public.memory_steps;
create policy "memory_steps: delete own" on public.memory_steps
  for delete using (auth.uid() = user_id);

-- Assignments are insert/delete only, matching snippet_labels: changing a set
-- is a delete plus an insert, so no UPDATE policy is needed. memory_step_labels
-- is the exception, because `weight` is edited in place.

drop policy if exists "memory_shard_labels: select own" on public.memory_shard_labels;
create policy "memory_shard_labels: select own" on public.memory_shard_labels
  for select using (auth.uid() = user_id);

drop policy if exists "memory_shard_labels: insert own" on public.memory_shard_labels;
create policy "memory_shard_labels: insert own" on public.memory_shard_labels
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.labels l where l.id = label_id and l.user_id = auth.uid())
    and exists (select 1 from public.memory_shards s where s.id = shard_id and s.user_id = auth.uid())
  );

drop policy if exists "memory_shard_labels: delete own" on public.memory_shard_labels;
create policy "memory_shard_labels: delete own" on public.memory_shard_labels
  for delete using (auth.uid() = user_id);

drop policy if exists "memory_step_labels: select own" on public.memory_step_labels;
create policy "memory_step_labels: select own" on public.memory_step_labels
  for select using (auth.uid() = user_id);

drop policy if exists "memory_step_labels: insert own" on public.memory_step_labels;
create policy "memory_step_labels: insert own" on public.memory_step_labels
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.labels l where l.id = label_id and l.user_id = auth.uid())
    and exists (select 1 from public.memory_steps s where s.id = step_id and s.user_id = auth.uid())
  );

drop policy if exists "memory_step_labels: update own" on public.memory_step_labels;
create policy "memory_step_labels: update own" on public.memory_step_labels
  for update using (auth.uid() = user_id) with check (user_id = auth.uid());

drop policy if exists "memory_step_labels: delete own" on public.memory_step_labels;
create policy "memory_step_labels: delete own" on public.memory_step_labels
  for delete using (auth.uid() = user_id);

-- Tokens are readable and revocable by their owner, but never INSERTable
-- directly: issuing goes through memory_issue_token() so the hash is computed
-- server-side and a client can never store a hash it chose itself.
drop policy if exists "memory_tokens: select own" on public.memory_tokens;
create policy "memory_tokens: select own" on public.memory_tokens
  for select using (auth.uid() = user_id);

drop policy if exists "memory_tokens: update own" on public.memory_tokens;
create policy "memory_tokens: update own" on public.memory_tokens
  for update using (auth.uid() = user_id) with check (user_id = auth.uid());

drop policy if exists "memory_tokens: delete own" on public.memory_tokens;
create policy "memory_tokens: delete own" on public.memory_tokens
  for delete using (auth.uid() = user_id);

-- ── Token issuance (authenticated only) ──────────────────────────────────────

/**
 * Mint a personal access token. Returns the plaintext ONCE; only its hash is
 * stored, so a lost token is reissued, never recovered.
 *
 * Entropy comes from two gen_random_uuid() values (122 random bits each, 244
 * total) rendered as 64 hex characters. That avoids a pgcrypto dependency for
 * gen_random_bytes while staying far beyond guessable.
 */
-- Output columns are deliberately NOT named id/prefix/expires_at. In plpgsql a
-- `returns table` column becomes an OUT variable, and one sharing a name with a
-- column of the table being written makes every reference to it ambiguous
-- (variable_conflict defaults to `error`). Prefixed names keep the INSERT and
-- its RETURNING unambiguous without a conflict pragma.
create or replace function public.memory_issue_token(
  p_name    text,
  p_expires timestamptz default null
)
returns table (token_id uuid, token text, token_prefix text, token_expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_token  text;
  v_hash   text;
  v_prefix text;
  v_id     uuid;
begin
  if v_uid is null then
    raise exception 'memory_issue_token: authentication required' using errcode = '42501';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'memory_issue_token: name is required' using errcode = '22023';
  end if;

  v_token  := 'sbmw_'
              || replace(gen_random_uuid()::text, '-', '')
              || replace(gen_random_uuid()::text, '-', '');
  v_hash   := encode(sha256(v_token::bytea), 'hex');
  v_prefix := left(v_token, 13);

  insert into public.memory_tokens (user_id, name, token_hash, prefix, expires_at)
  values (v_uid, btrim(p_name), v_hash, v_prefix, p_expires)
  returning memory_tokens.id into v_id;

  return query select v_id, v_token, v_prefix, p_expires;
end; $$;

comment on function public.memory_issue_token(text, timestamptz) is
  'MEMORY-001 · Mints an MCP access token. Plaintext is returned once and never stored.';

/**
 * Resolve a plaintext token to its owner, or null.
 *
 * Lives in the unexposed `app` schema so it is never reachable over PostgREST:
 * the public wrappers below are the only callers. Expired and revoked tokens
 * resolve to null.
 *
 * last_used_at is throttled to one write per five minutes. An MCP session makes
 * many calls and a row update on each would turn every read into a write for no
 * extra signal.
 */
create or replace function app.memory_resolve_token(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_row  public.memory_tokens%rowtype;
begin
  if p_token is null or p_token = '' then
    return null;
  end if;

  v_hash := encode(sha256(p_token::bytea), 'hex');

  select * into v_row
  from public.memory_tokens
  where token_hash = v_hash
    and revoked_at is null
    and (expires_at is null or expires_at > now());

  if not found then
    return null;
  end if;

  if v_row.last_used_at is null or v_row.last_used_at < now() - interval '5 minutes' then
    update public.memory_tokens set last_used_at = now() where id = v_row.id;
  end if;

  return v_row.user_id;
end; $$;

comment on function app.memory_resolve_token(text) is
  'MEMORY-001 · Token → user_id. Unexposed schema: only the public memory_mcp_* wrappers call it.';

-- ── MCP read surface ─────────────────────────────────────────────────────────
--
-- ⚠ These three are the only functions in the schema granted to `anon`, and the
-- grant is deliberate. An MCP server is headless: it has a token and no
-- session, so it authenticates by presenting the token on every call. What
-- makes that safe is that NONE of them accepts a user_id: identity is derived
-- from the token alone, so there is no parameter an attacker could vary to read
-- someone else's rows. A wrong token returns zero rows, not an error, so the
-- surface does not confirm which tokens exist.
--
-- Not covered here: request-rate limiting, which Postgres cannot express. These
-- ride the platform's API gateway limits. If abuse ever shows up, the fix is a
-- counter column on memory_tokens, not a policy change.

-- All three are VOLATILE, not STABLE. They call app.memory_resolve_token, which
-- throttle-writes last_used_at, and a non-volatile function propagates a
-- read-only SPI context to everything it calls, so that write would fail on
-- every request. STABLE would buy nothing here: PostgREST reaches these by POST
-- either way.

/** Every step and the labels it requires. One flat row per (step, label). */
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
language sql
security definer
set search_path = public
as $$
  select
    s.key, s.name, s.description, s.token_budget, s.sort_order,
    l.id, l.name, sl.weight
  from public.memory_steps s
  left join public.memory_step_labels sl on sl.step_id = s.id
  left join public.labels l              on l.id = sl.label_id
  where s.user_id = app.memory_resolve_token(p_token)
  order by s.sort_order, s.key, l.name;
$$;

/**
 * The shard index: everything needed to RANK a shard, and no body.
 *
 * This split is the feature. Listing 200 shards costs a few hundred tokens of
 * names and summaries; the bodies are fetched only for what the budget admits.
 */
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
language sql
security definer
set search_path = public
as $$
  select
    m.id, m.name, m.summary, m.token_estimate, m.pinned, m.priority,
    coalesce(array_agg(ml.label_id) filter (where ml.label_id is not null), '{}'::uuid[])
  from public.memory_shards m
  left join public.memory_shard_labels ml on ml.shard_id = m.id
  where m.user_id = app.memory_resolve_token(p_token)
  group by m.id
  order by m.pinned desc, m.priority desc, m.name;
$$;

/** Bodies for an explicit id list. The only call that returns shard text. */
create or replace function public.memory_mcp_bodies(p_token text, p_ids uuid[])
returns table (id uuid, name text, summary text, body text, token_estimate int)
language sql
security definer
set search_path = public
as $$
  select m.id, m.name, m.summary, m.body, m.token_estimate
  from public.memory_shards m
  where m.user_id = app.memory_resolve_token(p_token)
    and m.id = any(coalesce(p_ids, '{}'::uuid[]))
  order by m.name;
$$;

-- ── Grants (GRANTS-001 model: anon none, authenticated CRUD behind RLS) ──────

revoke all on public.memory_shards       from anon;
revoke all on public.memory_steps        from anon;
revoke all on public.memory_shard_labels from anon;
revoke all on public.memory_step_labels  from anon;
revoke all on public.memory_tokens       from anon;

grant select, insert, update, delete on public.memory_shards       to authenticated;
grant select, insert, update, delete on public.memory_steps        to authenticated;
grant select, insert, delete         on public.memory_shard_labels to authenticated;
grant select, insert, update, delete on public.memory_step_labels  to authenticated;
-- No INSERT: issuing a token goes through memory_issue_token().
grant select, update, delete         on public.memory_tokens       to authenticated;

grant all on public.memory_shards       to service_role;
grant all on public.memory_steps        to service_role;
grant all on public.memory_shard_labels to service_role;
grant all on public.memory_step_labels  to service_role;
grant all on public.memory_tokens       to service_role;

grant execute on function app.memory_shards_normalize() to authenticated, service_role;
grant execute on function app.memory_steps_normalize()  to authenticated, service_role;

-- The resolver is internal. Nothing but the wrappers may call it, and the
-- wrappers run as definer so they do not need the caller to hold this.
revoke all on function app.memory_resolve_token(text) from public, anon, authenticated;

revoke all on function public.memory_issue_token(text, timestamptz) from public, anon;
grant execute on function public.memory_issue_token(text, timestamptz) to authenticated;

-- The token-authenticated surface. See the warning above the definitions.
revoke all on function public.memory_mcp_manifest(text) from public;
revoke all on function public.memory_mcp_index(text)    from public;
revoke all on function public.memory_mcp_bodies(text, uuid[]) from public;

grant execute on function public.memory_mcp_manifest(text) to anon, authenticated;
grant execute on function public.memory_mcp_index(text)    to anon, authenticated;
grant execute on function public.memory_mcp_bodies(text, uuid[]) to anon, authenticated;
