-- Auth audit log — server-side counterpart to the client analytics.track() calls.
-- Populated by a future Supabase Edge Function or DB trigger; the client never
-- writes here directly. Provides a durable trail for security review.

create table if not exists public.auth_audit_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  event       text        not null,
  method      text,
  ip_address  text,
  user_agent  text,
  metadata    jsonb       not null default '{}',
  created_at  timestamptz not null default now()
);

alter table public.auth_audit_log enable row level security;

-- Users can inspect their own audit trail; service role writes on their behalf.
create policy "Users can read own audit log"
  on public.auth_audit_log
  for select
  using (auth.uid() = user_id);

-- No direct INSERT policy from the anon key; writes go via service role only.
-- (service role bypasses RLS by default — no additional policy required.)

-- Fast lookup for recent events per user
create index if not exists auth_audit_log_user_id_created_at_idx
  on public.auth_audit_log (user_id, created_at desc);
