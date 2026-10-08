-- Fill from link · a per-person limit on reading web pages.
--
-- The read-link edge function fetches a page somebody pasted, from
-- SprintBrain's servers. Without a limit, one account could use it to hammer a
-- site. read-link asks link_read_allow() before every fetch; the answer is
-- false once the caller has read 20 pages in the last minute or 300 in the
-- last day, and read-link answers 429 with Retry-After.
--
-- WHAT IS KEPT. One row per read: who and when. Not the link, not the host,
-- not anything the page said. Rows older than a day are deleted by the next
-- call from the same person, so the table holds at most a day of timestamps
-- per account.
--
-- WHO CAN TOUCH IT. Nobody directly: the table lives in the unexposed `app`
-- schema with every privilege revoked, and the only way in is the function,
-- which keys on auth.uid() and accepts no user id, so a caller can count only
-- their own reads. read-link calls it with the caller's own JWT, keeping that
-- function's "no service-role client" promise.
--
-- Additive: no existing table, policy or function is touched.
-- Apply BEFORE deploying the read-link edge function: read-link refuses to
-- read anything (503) while it cannot check the limit.

create table if not exists app.link_reads (
  id       bigint generated always as identity primary key,
  user_id  uuid not null references auth.users(id) on delete cascade,
  read_at  timestamptz not null default now()
);

create index if not exists link_reads_user_time on app.link_reads (user_id, read_at desc);

alter table app.link_reads enable row level security;
revoke all on app.link_reads from public, anon, authenticated;

create or replace function public.link_read_allow()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_minute integer;
  v_day integer;
begin
  if v_uid is null then
    return false;
  end if;

  delete from app.link_reads
   where user_id = v_uid
     and read_at < now() - interval '1 day';

  select count(*) filter (where read_at > now() - interval '1 minute'),
         count(*)
    into v_minute, v_day
    from app.link_reads
   where user_id = v_uid;

  if v_minute >= 20 or v_day >= 300 then
    return false;
  end if;

  insert into app.link_reads (user_id) values (v_uid);
  return true;
end;
$$;

revoke all on function public.link_read_allow() from public, anon;
grant execute on function public.link_read_allow() to authenticated;
