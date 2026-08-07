-- LABELS-001 · Global, color-coded labels for snippets AND prompts.
--
-- One label vocabulary per user, reusable across both asset types. Two link
-- tables rather than one polymorphic table: snippets.id is text and prompts.id
-- is uuid, so a single table could carry a foreign key to neither — and the FK
-- is what makes "deleting a label removes every assignment" a database
-- guarantee instead of client bookkeeping.
--
-- ⚠ RLS COST. The link-table read policies compare a denormalized user_id and
-- call nothing. That is deliberate. app.can_read_folder is evaluated PER ROW by
-- the RLS policies on snippets/prompts, and routing it through a recursive CTE
-- exhausted the connection pool and wedged production for ~2h on 2026-08-05
-- (see 20260731000000_folder_hierarchy.sql). Label ownership is verified in
-- WITH CHECK, which only runs on writes.
--
-- Scope: labels are PERSONAL. A shared-folder teammate reading your snippet
-- sees their own labels, not yours — a private taxonomy never leaks across the
-- org, and the read path stays free of access-helper calls.

-- ── labels ───────────────────────────────────────────────────────────────────

create table if not exists public.labels (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null,
  color      text not null default 'azure',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint labels_name_not_blank check (btrim(name) <> ''),
  constraint labels_name_length    check (char_length(btrim(name)) <= 32),
  constraint labels_color_known    check (
    color in ('azure', 'violet', 'green', 'orange', 'teal', 'rose', 'amber', 'slate')
  )
);

comment on table public.labels is
  'Per-user label vocabulary (LABELS-001). Shared by snippets and prompts via snippet_labels / prompt_labels.';
comment on column public.labels.color is
  'Palette key resolved per surface — see app/src/lib/labelColors.ts and docs/DESIGN_SYSTEM.md. Never a hex.';

-- Case-insensitive uniqueness per user: "Sales" and "sales" are one label.
create unique index if not exists labels_user_name_ci_uniq
  on public.labels (user_id, lower(btrim(name)));

create index if not exists labels_user_id_idx on public.labels (user_id);

-- Names are stored trimmed, so the blank CHECK above rejects a whitespace-only
-- name (it normalizes to '') and the unique index never sees padding drift.
create or replace function app.labels_normalize()
returns trigger language plpgsql set search_path = public as $$
begin
  new.name := btrim(new.name);
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists labels_normalize on public.labels;
create trigger labels_normalize
  before insert or update on public.labels
  for each row execute function app.labels_normalize();

-- ── snippet_labels ───────────────────────────────────────────────────────────

create table if not exists public.snippet_labels (
  snippet_id text not null references public.snippets(id) on delete cascade,
  label_id   uuid not null references public.labels(id)   on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (snippet_id, label_id)
);

comment on table public.snippet_labels is
  'Snippet ⇄ label assignments. user_id is denormalized so RLS reads cost one comparison, never a function call.';

create index if not exists snippet_labels_user_id_idx  on public.snippet_labels (user_id);
create index if not exists snippet_labels_label_id_idx on public.snippet_labels (label_id);

-- ── prompt_labels ────────────────────────────────────────────────────────────

create table if not exists public.prompt_labels (
  prompt_id  uuid not null references public.prompts(id) on delete cascade,
  label_id   uuid not null references public.labels(id)  on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (prompt_id, label_id)
);

comment on table public.prompt_labels is
  'Prompt ⇄ label assignments. Same denormalized-user_id contract as snippet_labels.';

create index if not exists prompt_labels_user_id_idx  on public.prompt_labels (user_id);
create index if not exists prompt_labels_label_id_idx on public.prompt_labels (label_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.labels         enable row level security;
alter table public.snippet_labels enable row level security;
alter table public.prompt_labels  enable row level security;

drop policy if exists "labels: select own" on public.labels;
create policy "labels: select own" on public.labels
  for select using (auth.uid() = user_id);

drop policy if exists "labels: insert own" on public.labels;
create policy "labels: insert own" on public.labels
  for insert with check (user_id = auth.uid());

drop policy if exists "labels: update own" on public.labels;
create policy "labels: update own" on public.labels
  for update using (auth.uid() = user_id) with check (user_id = auth.uid());

drop policy if exists "labels: delete own" on public.labels;
create policy "labels: delete own" on public.labels
  for delete using (auth.uid() = user_id);

-- Assignments are insert/delete only — changing a set is a delete plus an
-- insert, so no UPDATE policy (or grant) is needed to reassign labels.

drop policy if exists "snippet_labels: select own" on public.snippet_labels;
create policy "snippet_labels: select own" on public.snippet_labels
  for select using (auth.uid() = user_id);

drop policy if exists "snippet_labels: insert own" on public.snippet_labels;
create policy "snippet_labels: insert own" on public.snippet_labels
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.labels l where l.id = label_id and l.user_id = auth.uid())
  );

drop policy if exists "snippet_labels: delete own" on public.snippet_labels;
create policy "snippet_labels: delete own" on public.snippet_labels
  for delete using (auth.uid() = user_id);

drop policy if exists "prompt_labels: select own" on public.prompt_labels;
create policy "prompt_labels: select own" on public.prompt_labels
  for select using (auth.uid() = user_id);

drop policy if exists "prompt_labels: insert own" on public.prompt_labels;
create policy "prompt_labels: insert own" on public.prompt_labels
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.labels l where l.id = label_id and l.user_id = auth.uid())
  );

drop policy if exists "prompt_labels: delete own" on public.prompt_labels;
create policy "prompt_labels: delete own" on public.prompt_labels
  for delete using (auth.uid() = user_id);

-- ── Grants (GRANTS-001 model: anon none, authenticated CRUD behind RLS) ──────

revoke all on public.labels from anon;
grant select, insert, update, delete on public.labels to authenticated;
grant all on public.labels to service_role;

revoke all on public.snippet_labels from anon;
grant select, insert, delete on public.snippet_labels to authenticated;
grant all on public.snippet_labels to service_role;

revoke all on public.prompt_labels from anon;
grant select, insert, delete on public.prompt_labels to authenticated;
grant all on public.prompt_labels to service_role;

grant execute on function app.labels_normalize() to authenticated, service_role;
