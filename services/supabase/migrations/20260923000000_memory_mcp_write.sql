-- MEMORY · MCP write surface
--
-- MEMORY-001 shipped read-only tools. MEMORY-002 added the `write` scope to
-- memory_tokens and said outright that "writes arrive in S8". This is S8: an
-- agent holding a write-scoped token can add one memory item.
--
-- Three changes, in dependency order.
--
-- 1. app.memory_write_shard — the body of memory_save_shard, moved verbatim
--    into the unexposed schema and given its user_id as an argument instead of
--    reading auth.uid().
--
--    WHY THE MOVE. memory_save_shard is "the only write path that keeps a
--    shard's history complete" (row + version + audit, atomically). A token
--    call has no auth.uid(), so an MCP save could not reach it, and the obvious
--    alternative is a second function that writes the same three tables. Two
--    write paths drift: the day one of them stops writing a version, the
--    history is silently incomplete for whichever surface used it. So there
--    stays exactly one, and both entry points resolve identity their own way
--    before calling it.
--
-- 2. public.memory_mcp_save — the token-authenticated entry point.
--
--    CREATE ONLY, never update. An agent adding an item is recoverable: the
--    item is visible in the dashboard and can be deleted. An agent overwriting
--    an item the user wrote by hand is not, and nothing in "save this to
--    memory" asks for that power.
--
-- 3. public.memory_issue_token gains p_scopes, because until now every token
--    minted was read-only by default and there was no way to ask for anything
--    else. A write tool with no way to issue a write token is not shipped.
--
--    Deny by default is preserved: the parameter defaults to {read}, so an
--    existing two-argument call keeps its current meaning.

-- ── 1. The shared write body ────────────────────────────────────────────────

create or replace function app.memory_write_shard(
  p_uid            uuid,
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
  v_space uuid;
  v_id    uuid;
  v_next  int;
begin
  if p_uid is null then
    raise exception 'memory_write_shard: authentication required' using errcode = '42501';
  end if;

  -- A space the caller does not own is not an error the caller gets to
  -- distinguish from one that does not exist.
  if p_space_id is not null then
    select id into v_space
    from public.memory_spaces
    where id = p_space_id and user_id = p_uid and deleted_at is null;
    if not found then
      raise exception 'memory_write_shard: space not found' using errcode = '42501';
    end if;
  else
    v_space := app.memory_default_space(p_uid);
  end if;

  if p_shard_id is null then
    insert into public.memory_shards
      (user_id, space_id, name, summary, body, kind, metadata, pinned, priority)
    values
      (p_uid, v_space, p_name, coalesce(p_summary, ''), p_body, coalesce(p_kind, 'fact'),
       coalesce(p_metadata, '{}'::jsonb), coalesce(p_pinned, false), coalesce(p_priority, 0::smallint))
    returning id into v_id;
  else
    perform 1 from public.memory_shards
     where id = p_shard_id and user_id = p_uid
     for update;
    if not found then
      raise exception 'memory_write_shard: shard not found' using errcode = '42501';
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
    (v_id, v_next, p_uid, coalesce(nullif(btrim(p_editor_display), ''), 'unknown'),
     p_name, coalesce(p_summary, ''), p_body, p_edit_note);

  perform app.memory_audit(
    p_uid,
    case when p_shard_id is null then 'item.create' else 'item.update' end,
    v_id,
    p_surface,
    jsonb_build_object('version', v_next, 'space_id', v_space, 'kind', coalesce(p_kind, 'fact'))
  );

  return v_id;
end; $$;

comment on function app.memory_write_shard(uuid, uuid, text, text, text, text, uuid, text, jsonb, boolean, smallint, text, text) is
  'MEMORY · The one write body: row plus version plus audit. Unexposed — memory_save_shard and memory_mcp_save resolve identity, then call this.';

revoke all on function app.memory_write_shard(uuid, uuid, text, text, text, text, uuid, text, jsonb, boolean, smallint, text, text)
  from public, anon, authenticated;

-- ── 1b. memory_save_shard, now a wrapper ────────────────────────────────────
--
-- Signature unchanged, so CREATE OR REPLACE keeps its existing grants and every
-- deployed caller (dashboard, extension popup, extension worker) is unaffected.

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
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'memory_save_shard: authentication required' using errcode = '42501';
  end if;

  return app.memory_write_shard(
    v_uid, p_shard_id, p_name, p_summary, p_body, p_editor_display,
    p_space_id, p_kind, p_metadata, p_pinned, p_priority, p_edit_note, p_surface
  );
end; $$;

comment on function public.memory_save_shard(uuid, text, text, text, text, uuid, text, jsonb, boolean, smallint, text, text) is
  'MEMORY-002 · Session-authenticated save. Resolves auth.uid() and defers to app.memory_write_shard.';

-- ── 2. The MCP write tool ───────────────────────────────────────────────────
--
-- Returns null when the token is unknown, revoked, expired or read-only. That
-- matches the read wrappers, which return no rows in the same cases, and keeps
-- this surface from confirming which tokens exist. The caller can still tell
-- the save did not happen, because a successful save always returns an id.
--
-- A rate-limited token raises PT429 from the resolver, as everywhere else.

create or replace function public.memory_mcp_save(
  p_token    text,
  p_name     text,
  p_body     text,
  p_summary  text  default null,
  p_space_id uuid  default null,
  p_kind     text  default 'fact',
  p_metadata jsonb default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := app.memory_resolve_token(p_token, 'write');
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
  return app.memory_write_shard(
    v_uid, null::uuid, btrim(p_name), p_summary, p_body, 'MCP',
    p_space_id, p_kind, p_metadata, false, 0::smallint, null::text, 'mcp'
  );
end; $$;

comment on function public.memory_mcp_save(text, text, text, text, uuid, text, jsonb) is
  'MEMORY · Token-authenticated create for the MCP server. Requires the write scope; never updates an existing shard.';

revoke all on function public.memory_mcp_save(text, text, text, text, uuid, text, jsonb) from public;
grant execute on function public.memory_mcp_save(text, text, text, text, uuid, text, jsonb) to anon, authenticated;

-- ── 3. Issuing a token with scopes ──────────────────────────────────────────
--
-- Dropped rather than replaced: adding a defaulted third parameter alongside
-- the two-argument version would make every existing two-argument call
-- ambiguous rather than resolving to one of them.

drop function if exists public.memory_issue_token(text, timestamptz);

create or replace function public.memory_issue_token(
  p_name    text,
  p_expires timestamptz default null,
  p_scopes  text[]      default array['read']
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
  -- The table constraint would catch this too, as a constraint-violation error
  -- naming a column the caller never passed. Say what is actually wrong.
  if p_scopes is null or array_length(p_scopes, 1) is null then
    raise exception 'memory_issue_token: at least one scope is required' using errcode = '22023';
  end if;
  if not (p_scopes <@ array['read', 'write']::text[]) then
    raise exception 'memory_issue_token: scopes must be read, write, or both' using errcode = '22023';
  end if;

  v_token  := 'sbmw_'
              || replace(gen_random_uuid()::text, '-', '')
              || replace(gen_random_uuid()::text, '-', '');
  v_hash   := encode(sha256(v_token::bytea), 'hex');
  v_prefix := left(v_token, 13);

  insert into public.memory_tokens (user_id, name, token_hash, prefix, expires_at, scopes)
  values (v_uid, btrim(p_name), v_hash, v_prefix, p_expires, p_scopes)
  returning memory_tokens.id into v_id;

  return query select v_id, v_token, v_prefix, p_expires;
end; $$;

comment on function public.memory_issue_token(text, timestamptz, text[]) is
  'MEMORY-001 · Mints an MCP access token. Plaintext is returned once and never stored. Read-only unless write is asked for.';

revoke all on function public.memory_issue_token(text, timestamptz, text[]) from public, anon;
grant execute on function public.memory_issue_token(text, timestamptz, text[]) to authenticated;
