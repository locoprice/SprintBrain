-- SECURITY-SESSIONS · SprintBrain v2.86.0
-- Date: 2026-07-02
--
-- Backend for the Settings → Security tab: list active sessions ("Your
-- devices"), revoke a single session, check session liveness (heartbeat), and
-- capture login activity into public.auth_audit_log (created 2026-05-22, first
-- populated here — writes go through log_login_event(), which derives ip,
-- user-agent and country server-side from PostgREST request headers, so
-- clients only choose the method label; this supersedes the original
-- edge-function-writer note in that migration).
--
-- Sessions live in auth.sessions (GoTrue): every row already carries
-- user_agent, ip and refreshed_at, and JWTs carry a session_id claim.
-- "Sign out from all devices" needs no SQL — it is supabase-js
-- signOut({ scope: 'global' }). Deleting a session row revokes its refresh
-- token immediately; already-issued access tokens stay valid at the data API
-- until expiry, so clients poll session_alive() to converge fast.
--
-- All functions: SECURITY DEFINER with pinned search_path; EXECUTE revoked
-- from PUBLIC/anon, granted to authenticated + service_role.
-- Verified 2026-07-02: request.headers exposes cf-connecting-ip,
-- x-forwarded-for, cf-ipcountry, user-agent; auth.sessions.refreshed_at is a
-- naive UTC timestamp (hence AT TIME ZONE 'utc'), ip is inet (hence host()).

-- One 'login' row per real session — race-proof dedupe target for
-- log_login_event (SIGNED_IN can re-fire on tab focus / StrictMode).
create unique index if not exists auth_audit_log_login_session_uidx
  on public.auth_audit_log ((metadata->>'session_id'))
  where event = 'login' and (metadata->>'session_id') is not null;

-- Active sessions for the calling user, newest activity first, current session
-- pinned on top. Country comes from the session's own login row when one
-- exists (history starts with this feature, so older sessions fall back to
-- showing their IP in the UI). Sessions idle > 60 days are hidden, never the
-- caller's current one; a global sign-out deletes all rows regardless.
create or replace function public.list_user_sessions()
returns table (
  id uuid,
  created_at timestamptz,
  last_active_at timestamptz,
  user_agent text,
  ip text,
  country text,
  is_current boolean
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select s.id,
         s.created_at,
         coalesce(s.refreshed_at at time zone 'utc', s.updated_at, s.created_at) as last_active_at,
         s.user_agent,
         host(s.ip) as ip,
         l.country,
         (s.id::text = coalesce(auth.jwt()->>'session_id', '')) as is_current
  from auth.sessions s
  left join lateral (
    select a.metadata->>'country' as country
    from public.auth_audit_log a
    where a.event = 'login'
      and a.metadata->>'session_id' = s.id::text
    limit 1
  ) l on true
  where s.user_id = auth.uid()
    and (s.not_after is null or s.not_after > now())
    and (coalesce(s.refreshed_at at time zone 'utc', s.updated_at, s.created_at) > now() - interval '60 days'
         or s.id::text = coalesce(auth.jwt()->>'session_id', ''))
  order by is_current desc, last_active_at desc
  limit 50;
$$;

-- Sign out one device. Deleting the auth.sessions row revokes its refresh
-- token (GoTrue cascades); the device's UI converges via session_alive().
-- Scoped to the caller's own sessions; revoking the current one is allowed
-- (self sign-out). Returns whether a row was deleted.
create or replace function public.revoke_session(p_session_id uuid)
returns boolean
language sql
volatile
security definer
set search_path = public, auth
as $$
  with deleted as (
    delete from auth.sessions
    where id = p_session_id
      and user_id = auth.uid()
    returning 1
  )
  select count(*) > 0 from deleted;
$$;

-- Heartbeat: does the calling JWT's session still exist (and is it inside its
-- not_after window)? Missing claim → true: fail-open against unexpected token
-- shapes so a heartbeat can never cause a lockout loop. Clients treat ONLY an
-- explicit false as fatal; RPC/network errors are ignored.
create or replace function public.session_alive()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select case
    when auth.jwt()->>'session_id' is null then true
    else exists (
      select 1
      from auth.sessions s
      where s.id = (auth.jwt()->>'session_id')::uuid
        and (s.not_after is null or s.not_after > now())
    )
  end;
$$;

-- Append one login-activity row for the calling session. Everything except
-- the method label is server-derived (headers set by Cloudflare/PostgREST),
-- so a client cannot forge ip, user-agent, country or timestamps — at worst it
-- can decline to log. The unique index above makes repeat calls for the same
-- session no-ops. cf-ipcountry 'XX'/'T1' (unknown/Tor) are stored as null.
create or replace function public.log_login_event(p_method text)
returns void
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  v_uid    uuid  := auth.uid();
  v_sid    text  := auth.jwt()->>'session_id';
  v_hdrs   jsonb := coalesce(current_setting('request.headers', true), '{}')::jsonb;
  v_method text;
  v_country text;
begin
  if v_uid is null or v_sid is null then
    return;
  end if;

  v_method := case
    when p_method in ('password', 'magic_link', 'email_otp') then p_method
    else 'unknown'
  end;

  v_country := nullif(trim(v_hdrs->>'cf-ipcountry'), '');
  if v_country in ('XX', 'T1') then
    v_country := null;
  end if;

  insert into public.auth_audit_log (user_id, event, method, ip_address, user_agent, metadata)
  values (
    v_uid,
    'login',
    v_method,
    coalesce(nullif(trim(v_hdrs->>'cf-connecting-ip'), ''),
             nullif(trim(split_part(v_hdrs->>'x-forwarded-for', ',', 1)), '')),
    left(v_hdrs->>'user-agent', 512),
    jsonb_strip_nulls(jsonb_build_object(
      'session_id', v_sid,
      'country', v_country
    ))
  )
  on conflict ((metadata->>'session_id'))
    where event = 'login' and (metadata->>'session_id') is not null
    do nothing;
end;
$$;

revoke execute on function public.list_user_sessions() from public, anon;
revoke execute on function public.revoke_session(uuid) from public, anon;
revoke execute on function public.session_alive() from public, anon;
revoke execute on function public.log_login_event(text) from public, anon;

grant execute on function public.list_user_sessions() to authenticated, service_role;
grant execute on function public.revoke_session(uuid) to authenticated, service_role;
grant execute on function public.session_alive() to authenticated, service_role;
grant execute on function public.log_login_event(text) to authenticated, service_role;
