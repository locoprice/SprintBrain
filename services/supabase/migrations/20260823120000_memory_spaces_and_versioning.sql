-- MEMORY-002 S1 · Spaces, item kinds, versioning, audit, and token hardening.
--
-- MEMORY-001 shipped a working memory (shards, steps, a token-authenticated MCP
-- read surface) and nothing to manage any of it with. This adds the layer a
-- person touches. A space groups shards. A shard gains a kind, free-form
-- metadata, a content hash and a trash state. Every save appends a version. The
-- MCP tokens grow scopes and a rate limit, so a later slice can accept writes
-- without the surface becoming an open door.
--
-- WHY THIS LANDS BEFORE ITS UI. Every memory_* table has zero rows in
-- production. Adding space_id as NOT NULL, and adding a stored generated column,
-- is free today and becomes a table rewrite plus a data migration the moment the
-- dashboard ships. The window is open now and closes on first use.
--
-- DELIBERATELY NOT HERE:
--   · Sharing. memory_space_shares and the non-owner read path land together in
--     S9, with the performance work a cross-account policy deserves. A table
--     that grants nothing is half a feature. Shards stay strictly personal,
--     exactly as MEMORY-001 argued: a teammate's fact must not silently steer
--     your assistant.
--   · Documents. source_id and chunk_index arrive with memory_documents in S3.
--   · Search. search_tsv, pg_trgm and unaccent arrive in S6, where something
--     reads them. content_hash IS here, because deduplication and import both
--     need it and a stored generated column is cheapest to add while the table
--     is empty.
--
-- No new extension dependency. sha256(bytea), gen_random_uuid() and the text to
-- bytea I/O cast are all core Postgres; the cast was verified to be accepted
-- inside a stored generated column on this instance before this was written.

-- ── memory_spaces ────────────────────────────────────────────────────────────
--
-- A space is a container, not a permission boundary. It exists so a person can
-- keep the facts one kind of work needs apart from another, and so a later
-- Context Builder can be pointed at a subset instead of a library.

create table if not exists public.memory_spaces (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  description text not null default '',
  -- Keyword key resolved per surface, the same contract as folders.ico and
  -- labels.color. Never a hex, never markup.
  ico         text not null default 'brain',
  -- Exactly one live default per user, enforced by a partial unique index below.
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Trash, not erasure. Purging is a separate explicit act (S9).
  deleted_at  timestamptz,
  constraint memory_spaces_name_not_blank check (btrim(name) <> ''),
  constraint memory_spaces_name_length    check (char_length(btrim(name)) <= 64),
  constraint memory_spaces_desc_length    check (char_length(description) <= 280)
);

comment on table public.memory_spaces is
  'MEMORY-002 · Groups shards into one body of knowledge. Personal, never org-shared (sharing lands in S9).';
comment on column public.memory_spaces.deleted_at is
  'Trash marker. Rows stay readable to their owner so the trash view can list them; a purge deletes them for real.';

-- Names are unique among LIVE spaces only. Trashing "Research" must not block
-- creating a new space with that name, and a purge must not be required first.
create unique index if not exists memory_spaces_user_name_ci_uniq
  on public.memory_spaces (user_id, lower(btrim(name)))
  where deleted_at is null;

create unique index if not exists memory_spaces_one_default_uniq
  on public.memory_spaces (user_id)
  where is_default and deleted_at is null;

create index if not exists memory_spaces_user_live_idx
  on public.memory_spaces (user_id)
  where deleted_at is null;

create or replace function app.memory_spaces_normalize()
returns trigger language plpgsql set search_path = public as $$
begin
  new.name := btrim(new.name);
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists memory_spaces_normalize on public.memory_spaces;
create trigger memory_spaces_normalize
  before insert or update on public.memory_spaces
  for each row execute function app.memory_spaces_normalize();

/**
 * The caller's default space, created on first need.
 *
 * Lives in `app` because it writes, and because nothing outside this schema
 * should be able to conjure a space for an arbitrary user id. The public save
 * function below is the only caller that passes anything other than auth.uid().
 *
 * The re-select after ON CONFLICT covers the race where two concurrent first
 * writes both miss the initial lookup: one insert wins, the other returns
 * nothing, and the loser reads the winner's row rather than failing.
 */
create or replace function app.memory_default_space(p_uid uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_uid is null then
    return null;
  end if;

  select id into v_id
  from public.memory_spaces
  where user_id = p_uid and is_default and deleted_at is null;

  if found then
    return v_id;
  end if;

  insert into public.memory_spaces (user_id, name, description, is_default)
  values (p_uid, 'Personal', 'Everything not filed anywhere else.', true)
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
    from public.memory_spaces
    where user_id = p_uid and is_default and deleted_at is null;
  end if;

  return v_id;
end; $$;

comment on function app.memory_default_space(uuid) is
  'MEMORY-002 · The user''s default space, created on first need. Unexposed schema: writes on behalf of a user id.';

-- ── memory_shards: kinds, metadata, trash, content hash, space ───────────────

alter table public.memory_shards
  add column if not exists space_id   uuid references public.memory_spaces(id) on delete cascade,
  add column if not exists kind       text not null default 'fact',
  add column if not exists metadata   jsonb not null default '{}',
  add column if not exists deleted_at timestamptz;

-- Stored, not virtual: deduplication reads it on every import and every context
-- build, and an exact-match index over it is the cheap first pass.
alter table public.memory_shards
  add column if not exists content_hash text
    generated always as (encode(sha256(body::bytea), 'hex')) stored;

comment on column public.memory_shards.kind is
  'How the fact arrived. Retrieval treats all four identically; the distinction is for the reader and for filters.';
comment on column public.memory_shards.content_hash is
  'sha256 of body. The exact-duplicate pass of the Context Builder, and what makes a re-import idempotent.';
comment on column public.memory_shards.metadata is
  'Free-form, caller-owned. Capped so an MCP client cannot use it as unbounded storage.';

alter table public.memory_shards
  drop constraint if exists memory_shards_kind_known;
alter table public.memory_shards
  add constraint memory_shards_kind_known
    check (kind in ('fact', 'note', 'document', 'conversation'));

alter table public.memory_shards
  drop constraint if exists memory_shards_metadata_size;
alter table public.memory_shards
  add constraint memory_shards_metadata_size
    check (length(metadata::text) <= 4096);

-- Backfill, then require it. In production this loop touches zero rows, which is
-- the whole reason this migration is ahead of its UI.
do $backfill$
declare
  r record;
begin
  for r in select distinct user_id from public.memory_shards where space_id is null loop
    update public.memory_shards
       set space_id = app.memory_default_space(r.user_id)
     where user_id = r.user_id and space_id is null;
  end loop;
end $backfill$;

alter table public.memory_shards alter column space_id set not null;

-- The name stays unique per USER, not per space. memory_attach resolves a shard
-- by bare name, and a per-space handle would turn that into an ambiguous lookup
-- the moment two spaces both hold a "house-style". Made partial so trashing a
-- shard frees its name without a purge.
drop index if exists public.memory_shards_user_name_ci_uniq;
create unique index memory_shards_user_name_ci_uniq
  on public.memory_shards (user_id, lower(btrim(name)))
  where deleted_at is null;

create index if not exists memory_shards_space_live_idx
  on public.memory_shards (space_id)
  where deleted_at is null;

create index if not exists memory_shards_content_hash_idx
  on public.memory_shards (user_id, content_hash);

-- ── memory_shard_versions ────────────────────────────────────────────────────
--
-- Same contract as snippet_revisions: append-only, 1-indexed, strictly
-- increasing per shard, serialised by the FOR UPDATE lock in the save function.
-- Application code never updates or deletes a version; the cascade from
-- memory_shards is the only removal path.

create table if not exists public.memory_shard_versions (
  id             uuid primary key default gen_random_uuid(),
  shard_id       uuid not null references public.memory_shards(id) on delete cascade,
  version_number int not null check (version_number > 0),
  editor_id      uuid not null references auth.users(id),
  -- Denormalized at save time, like snippet_revisions.editor_display: a history
  -- panel must still name the author after the account is gone.
  editor_display text not null,
  name           text not null,
  summary        text not null default '',
  body           text not null,
  edit_note      text,
  created_at     timestamptz not null default now(),
  unique (shard_id, version_number)
);

comment on table public.memory_shard_versions is
  'MEMORY-002 · Immutable snapshot per save. Append-only: no UPDATE or DELETE policy exists.';

create index if not exists memory_shard_versions_shard_idx
  on public.memory_shard_versions (shard_id, version_number desc);

-- ── memory_audit_log ─────────────────────────────────────────────────────────
--
-- Content-free by design. It records that something happened to which row, from
-- which surface, and never what the row said. An audit trail that mirrors the
-- bodies it protects is a second copy of the data to secure.

create table if not exists public.memory_audit_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete set null,
  action     text not null,
  target_id  uuid,
  surface    text not null default 'dashboard',
  metadata   jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint memory_audit_surface_known check (surface in ('dashboard', 'mcp', 'extension')),
  constraint memory_audit_action_shape  check (action ~ '^[a-z_]+\.[a-z_]+$'),
  constraint memory_audit_metadata_size check (length(metadata::text) <= 2048)
);

comment on table public.memory_audit_log is
  'MEMORY-002 · Append-only trail: actor, action, target, surface. Never item bodies.';
comment on column public.memory_audit_log.action is
  'Dotted verb, e.g. item.create, item.purge, space.share, export.run, token.issue.';

create index if not exists memory_audit_log_user_created_idx
  on public.memory_audit_log (user_id, created_at desc);

/** Write one audit row. Definer, because no client may forge or omit an entry. */
create or replace function app.memory_audit(
  p_uid      uuid,
  p_action   text,
  p_target   uuid,
  p_surface  text,
  p_metadata jsonb default '{}'
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.memory_audit_log (user_id, action, target_id, surface, metadata)
  values (p_uid, p_action, p_target, coalesce(p_surface, 'dashboard'), coalesce(p_metadata, '{}'::jsonb));
$$;

comment on function app.memory_audit(uuid, text, uuid, text, jsonb) is
  'MEMORY-002 · The only writer of memory_audit_log. Unexposed schema, definer, so entries cannot be forged or skipped.';

-- ── memory_save_shard ────────────────────────────────────────────────────────

/**
 * Create or update one shard and append its version, in one transaction.
 *
 * Mirrors save_snippet_with_revision: the FOR UPDATE lock serialises concurrent
 * saves of the same row so two writers cannot claim the same version_number.
 *
 * p_shard_id null creates. p_space_id null files the shard in the caller's
 * default space, creating that space if this is their first item, so the
 * dashboard never has to make a space before it can make a note.
 *
 * Returns the shard id, new or existing.
 */
create or replace function public.memory_save_shard(
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
  p_surface        text     default 'dashboard'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_space uuid;
  v_id    uuid;
  v_next  int;
begin
  if v_uid is null then
    raise exception 'memory_save_shard: authentication required' using errcode = '42501';
  end if;

  -- A space the caller does not own is not an error the caller gets to
  -- distinguish from one that does not exist.
  if p_space_id is not null then
    select id into v_space
    from public.memory_spaces
    where id = p_space_id and user_id = v_uid and deleted_at is null;
    if not found then
      raise exception 'memory_save_shard: space not found' using errcode = '42501';
    end if;
  else
    v_space := app.memory_default_space(v_uid);
  end if;

  if p_shard_id is null then
    insert into public.memory_shards
      (user_id, space_id, name, summary, body, kind, metadata, pinned, priority)
    values
      (v_uid, v_space, p_name, coalesce(p_summary, ''), p_body, coalesce(p_kind, 'fact'),
       coalesce(p_metadata, '{}'::jsonb), coalesce(p_pinned, false), coalesce(p_priority, 0::smallint))
    returning id into v_id;
  else
    perform 1 from public.memory_shards
     where id = p_shard_id and user_id = v_uid
     for update;
    if not found then
      raise exception 'memory_save_shard: shard not found' using errcode = '42501';
    end if;

    update public.memory_shards
       set space_id   = v_space,
           name       = p_name,
           summary    = coalesce(p_summary, ''),
           body       = p_body,
           kind       = coalesce(p_kind, 'fact'),
           metadata   = coalesce(p_metadata, '{}'::jsonb),
           pinned     = coalesce(p_pinned, false),
           priority   = coalesce(p_priority, 0::smallint),
           -- Restoring from trash is an explicit call, not a side effect of a save.
           updated_at = now()
     where id = p_shard_id;

    v_id := p_shard_id;
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next
  from public.memory_shard_versions
  where shard_id = v_id;

  insert into public.memory_shard_versions
    (shard_id, version_number, editor_id, editor_display, name, summary, body, edit_note)
  values
    (v_id, v_next, v_uid, coalesce(nullif(btrim(p_editor_display), ''), 'unknown'),
     p_name, coalesce(p_summary, ''), p_body, p_edit_note);

  perform app.memory_audit(
    v_uid,
    case when p_shard_id is null then 'item.create' else 'item.update' end,
    v_id,
    p_surface,
    jsonb_build_object('version', v_next, 'space_id', v_space, 'kind', coalesce(p_kind, 'fact'))
  );

  return v_id;
end; $$;

comment on function public.memory_save_shard(uuid, text, text, text, text, uuid, text, jsonb, boolean, smallint, text, text) is
  'MEMORY-002 · Atomic save plus version plus audit entry. The only write path that keeps a shard''s history complete.';

-- ── memory_tokens: scopes and a rate limit ───────────────────────────────────
--
-- MEMORY-001 shipped read-only tools and said outright that request-rate
-- limiting was not implemented, pointing at a counter column here as the fix if
-- abuse appeared. Writes arrive in S8, so it is added now rather than after.

alter table public.memory_tokens
  add column if not exists scopes             text[] not null default '{read}',
  add column if not exists rate_limit_per_min int not null default 60,
  add column if not exists window_started_at  timestamptz,
  add column if not exists window_count       int not null default 0;

alter table public.memory_tokens
  drop constraint if exists memory_tokens_scopes_known;
alter table public.memory_tokens
  add constraint memory_tokens_scopes_known
    check (scopes <@ array['read', 'write']::text[] and array_length(scopes, 1) >= 1);

alter table public.memory_tokens
  drop constraint if exists memory_tokens_rate_sane;
alter table public.memory_tokens
  add constraint memory_tokens_rate_sane
    check (rate_limit_per_min between 1 and 6000);

comment on column public.memory_tokens.scopes is
  'Deny-by-default: a token is read-only unless write was requested at issue. Never widened in place.';

-- ── app.memory_resolve_token, second version ─────────────────────────────────
--
-- Two changes from MEMORY-001.
--
-- 1. Scope. The caller states what it needs. A token without that scope resolves
--    to null, which the wrappers already treat as "no rows", so a read-only
--    token reaching a write tool looks exactly like an unknown token.
--
-- 2. Rate limiting, as a fixed one-minute window.
--
-- ⚠ THIS REVERSES AN EXPLICIT MEMORY-001 OPTIMISATION, knowingly. That migration
-- throttled last_used_at to one write per five minutes on the grounds that "a
-- row update on each would turn every read into a write for no extra signal".
-- Counting requests IS extra signal, and there is no cheaper counter in core
-- Postgres, so the window counter is written on every call. last_used_at keeps
-- its five-minute throttle, so the two writes coalesce into one UPDATE.
--
-- The over-limit case RAISES rather than returning null, which is a deliberate
-- exception to the "a wrong token returns zero rows" contract. That contract
-- exists so the surface cannot confirm which tokens exist. A rate-limit response
-- only ever reaches a caller already holding a valid token, so it confirms
-- nothing, and a silent empty result would make a client retry harder instead of
-- backing off. SQLSTATE PT429 is PostgREST's convention for "answer with HTTP
-- 429"; on a gateway that does not honour it the caller still gets the message.

drop function if exists app.memory_resolve_token(text);

create or replace function app.memory_resolve_token(p_token text, p_scope text default 'read')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash  text;
  v_row   public.memory_tokens%rowtype;
  v_fresh boolean;
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

  -- A missing scope is indistinguishable from a missing token, on purpose.
  if not (coalesce(p_scope, 'read') = any(v_row.scopes)) then
    return null;
  end if;

  v_fresh := v_row.window_started_at is null
             or v_row.window_started_at < now() - interval '1 minute';

  if not v_fresh and v_row.window_count >= v_row.rate_limit_per_min then
    raise exception
      'memory: rate limit of % requests per minute reached for token %', v_row.rate_limit_per_min, v_row.prefix
      using errcode = 'PT429';
  end if;

  update public.memory_tokens
     set window_started_at = case when v_fresh then now() else window_started_at end,
         window_count      = case when v_fresh then 1 else window_count + 1 end,
         last_used_at      = case
                               when last_used_at is null or last_used_at < now() - interval '5 minutes'
                               then now() else last_used_at
                             end
   where id = v_row.id;

  return v_row.user_id;
end; $$;

comment on function app.memory_resolve_token(text, text) is
  'MEMORY-002 · Token plus required scope to user_id, with a fixed one-minute rate window. Unexposed: only the memory_mcp_* wrappers call it.';

-- ── MCP read surface: skip trashed shards ────────────────────────────────────
--
-- Signatures are unchanged, so CREATE OR REPLACE keeps the existing grants and
-- no deployed MCP client needs an update. The only behaviour change is that a
-- shard in the trash stops being attachable, which is the entire point of
-- putting it there. space_id and kind are NOT added to the index shape here:
-- nothing reads them until S8, and adding a column to a set-returning function
-- means dropping it and restating every grant.

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
  v_uid uuid := app.memory_resolve_token(p_token, 'read');
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
    group by m.id
    order by m.pinned desc, m.priority desc, m.name;
end; $$;

create or replace function public.memory_mcp_bodies(p_token text, p_ids uuid[])
returns table (id uuid, name text, summary text, body text, token_estimate int)
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
      and m.id = any(coalesce(p_ids, '{}'::uuid[]))
    order by m.name;
end; $$;

comment on function public.memory_mcp_index(text) is
  'MEMORY-001 · Shard index without bodies. Token resolved once; trashed shards excluded (MEMORY-002).';
comment on function public.memory_mcp_bodies(text, uuid[]) is
  'MEMORY-001 · Bodies for an explicit id list. Token resolved once; trashed shards excluded (MEMORY-002).';

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.memory_spaces         enable row level security;
alter table public.memory_shard_versions enable row level security;
alter table public.memory_audit_log      enable row level security;

drop policy if exists "memory_spaces: select own" on public.memory_spaces;
create policy "memory_spaces: select own" on public.memory_spaces
  for select using (auth.uid() = user_id);

drop policy if exists "memory_spaces: insert own" on public.memory_spaces;
create policy "memory_spaces: insert own" on public.memory_spaces
  for insert with check (user_id = auth.uid());

drop policy if exists "memory_spaces: update own" on public.memory_spaces;
create policy "memory_spaces: update own" on public.memory_spaces
  for update using (auth.uid() = user_id) with check (user_id = auth.uid());

drop policy if exists "memory_spaces: delete own" on public.memory_spaces;
create policy "memory_spaces: delete own" on public.memory_spaces
  for delete using (auth.uid() = user_id);

-- Versions are readable by the owner of the parent shard and written only by
-- memory_save_shard. No UPDATE or DELETE policy exists: a history that can be
-- edited is not a history.
drop policy if exists "memory_shard_versions: select own" on public.memory_shard_versions;
create policy "memory_shard_versions: select own" on public.memory_shard_versions
  for select using (
    exists (
      select 1 from public.memory_shards s
      where s.id = memory_shard_versions.shard_id
        and s.user_id = auth.uid()
    )
  );

-- Own-row read, no write policy at all. app.memory_audit is a definer function
-- and bypasses this; a client cannot insert, amend or remove an entry.
drop policy if exists "memory_audit_log: select own" on public.memory_audit_log;
create policy "memory_audit_log: select own" on public.memory_audit_log
  for select using (auth.uid() = user_id);

-- ── Grants (GRANTS-001: anon none, authenticated CRUD behind RLS) ────────────

revoke all on public.memory_spaces         from anon;
revoke all on public.memory_shard_versions from anon;
revoke all on public.memory_audit_log      from anon;

grant select, insert, update, delete on public.memory_spaces to authenticated;
-- Read only. Versions are appended by memory_save_shard, never by a client.
grant select on public.memory_shard_versions to authenticated;
grant select on public.memory_audit_log      to authenticated;

grant all on public.memory_spaces         to service_role;
grant all on public.memory_shard_versions to service_role;
grant all on public.memory_audit_log      to service_role;

grant execute on function app.memory_spaces_normalize() to authenticated, service_role;

-- Internal. Only the definer functions above may call these, and they do not
-- need the caller to hold the privilege.
revoke all on function app.memory_default_space(uuid) from public, anon, authenticated;
revoke all on function app.memory_audit(uuid, text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function app.memory_resolve_token(text, text) from public, anon, authenticated;

revoke all on function public.memory_save_shard(uuid, text, text, text, text, uuid, text, jsonb, boolean, smallint, text, text) from public, anon;
grant execute on function public.memory_save_shard(uuid, text, text, text, text, uuid, text, jsonb, boolean, smallint, text, text) to authenticated;

-- Restated because the three wrappers were replaced. Their signatures are
-- unchanged, so this is belt and braces rather than a requirement.
revoke all on function public.memory_mcp_manifest(text) from public;
revoke all on function public.memory_mcp_index(text)    from public;
revoke all on function public.memory_mcp_bodies(text, uuid[]) from public;

grant execute on function public.memory_mcp_manifest(text) to anon, authenticated;
grant execute on function public.memory_mcp_index(text)    to anon, authenticated;
grant execute on function public.memory_mcp_bodies(text, uuid[]) to anon, authenticated;
