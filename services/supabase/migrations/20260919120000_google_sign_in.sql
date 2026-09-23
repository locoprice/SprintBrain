-- AUTH-GOOGLE: Google sign-in on the dashboard.
--
-- 1. Login activity (Settings > Security) learns the 'google' method label.
-- 2. The name and photo a person sets in Settings survive Google sign-in.
--
-- Apply this BEFORE the Google provider is switched on in Supabase Auth: the
-- first Google sign-in of an existing account is the one that would overwrite
-- its name and photo.
--
-- Why (2): GoTrue merges the provider's identity data into raw_user_meta_data
-- at every OAuth sign-in (full_name, name, avatar_url, picture, iss, sub and
-- more). The dashboard stores the person's own name in full_name and their
-- uploaded photo in avatar_url, and every surface reads those two keys
-- (dashboard, extension popup, mobile, invite emails, the invitation RPCs).
-- Without this, each Google sign-in would replace both.
--
-- The rule (Valentina, 2026-09-19): what the person set wins; Google only fills
-- a blank. Settings writes the choice to chosen_full_name / chosen_avatar_url
-- next to the keys everyone reads, and the trigger below puts it back after
-- GoTrue's merge. No reader changes anywhere.
--
-- `iss` tells the two states apart. GoTrue writes it only from a provider
-- identity; email accounts never carry it (0 of 27 in prod on 2026-09-19).
--   * No iss: only the person has written these keys, so the trigger records
--     them as the choice. This also keeps a dashboard build that predates the
--     chosen_* keys correct, so the apply order against the frontend does not
--     matter.
--   * iss present: a provider may have just overwritten them, so a recorded
--     choice is put back. An empty chosen_avatar_url means the person removed
--     their photo on purpose, and it stays removed.
--
-- The dashboard signs in with PKCE, so the tokens are issued by a later
-- request that re-reads the user row: the session already carries the
-- restored values.

-- ── 1. Login method label ──────────────────────────────────────────────────
-- Same function as 20260702000000, with 'google' added to the accepted labels.
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
    when p_method in ('password', 'magic_link', 'email_otp', 'google') then p_method
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

revoke execute on function public.log_login_event(text) from public, anon;
grant execute on function public.log_login_event(text) to authenticated, service_role;

-- ── 2. Keep the chosen name and photo ──────────────────────────────────────
-- Touches nothing but the row being written, so it needs no privileges beyond
-- those of GoTrue's own role. A trigger function cannot be called directly.
create or replace function app.keep_chosen_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  if not (m ? 'iss') then
    m := m - 'chosen_full_name' - 'chosen_avatar_url';
    if nullif(m->>'full_name', '') is not null then
      m := m || jsonb_build_object('chosen_full_name', m->'full_name');
    end if;
    if nullif(m->>'avatar_url', '') is not null then
      m := m || jsonb_build_object('chosen_avatar_url', m->'avatar_url');
    end if;
  else
    if m ? 'chosen_full_name' then
      m := m || jsonb_build_object('full_name', m->'chosen_full_name');
      -- Some readers fall back to `name`, which Google also writes.
      if m ? 'name' then
        m := m || jsonb_build_object('name', m->'chosen_full_name');
      end if;
    end if;
    if m ? 'chosen_avatar_url' then
      if coalesce(m->>'chosen_avatar_url', '') = '' then
        m := m - 'avatar_url';
      else
        m := m || jsonb_build_object('avatar_url', m->'chosen_avatar_url');
      end if;
    end if;
  end if;

  new.raw_user_meta_data := m;
  return new;
end;
$$;

drop trigger if exists keep_chosen_profile on auth.users;
create trigger keep_chosen_profile
  before update of raw_user_meta_data on auth.users
  for each row execute function app.keep_chosen_profile();

-- Record today's names and photos as each person's choice. The self-assignment
-- fires the trigger above, which does the recording.
update auth.users
   set raw_user_meta_data = raw_user_meta_data
 where not (coalesce(raw_user_meta_data, '{}'::jsonb) ? 'iss')
   and (nullif(raw_user_meta_data->>'full_name', '') is not null
        or nullif(raw_user_meta_data->>'avatar_url', '') is not null);
