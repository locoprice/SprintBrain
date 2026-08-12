-- LABELS-002 · Sub-labels. Nest one label under another ("Booking" > "Cancellation").
--
-- Depth is capped at 2: a label is either a root or a child of a root. That cap
-- is what keeps this migration cheap — with only one level of nesting possible,
-- every rule below is a constant-time lookup on labels_parent_id_idx. There is
-- no recursive CTE anywhere in this file, and nothing here is referenced by an
-- RLS policy.
--
-- ⚠ WHY THAT MATTERS. Read the header of 20260731000000_folder_hierarchy.sql
-- before extending this. Folder nesting drives ACCESS (share inheritance), so
-- its ancestry helpers ended up inside RLS policies, evaluated per row on every
-- read of folders/snippets/prompts — a recursive CTE on the hottest path, 10.2x
-- measured, which exhausted the connection pool and wedged production for ~2h on
-- 2026-08-05.
--
-- Label hierarchy cannot repeat that, structurally: labels are PERSONAL and have
-- no ACL, so nesting never informs a policy. The RLS on labels stays exactly as
-- 20260807000000_asset_labels.sql left it — `auth.uid() = user_id`, one
-- comparison, no function call. The tree is resolved on the client, over the
-- catalog the dashboard already fetches in a single query (see
-- app/src/lib/labelTree.ts). Nesting adds zero per-row query cost.
--
-- If sub-labels ever need to reach the extension or a shared vocabulary, that is
-- the point to re-read the folder post-mortem — not now.
--
-- NAMES STAY GLOBALLY UNIQUE per user. labels_user_name_ci_uniq is untouched, so
-- "Urgent" exists at most once regardless of where it sits. Sibling-scoped names
-- would need a coalesce-based index (Postgres treats NULL parent_ids as distinct,
-- so a naive composite index would let duplicate roots through) and would break
-- the name-keyed dedup in app/src/lib/labelSuggest.ts.

-- ── schema ───────────────────────────────────────────────────────────────────

alter table public.labels
  add column if not exists parent_id uuid references public.labels(id) on delete set null;

-- ON DELETE SET NULL, not CASCADE: deleting a parent PROMOTES its children to
-- root. Cascading would delete the children too, and the FK on snippet_labels /
-- prompt_labels would then cascade again and silently strip those labels off
-- every snippet and prompt carrying them. One click, unrecoverable in-product.
-- Same reasoning as folders.parent_id.

create index if not exists labels_parent_id_idx on public.labels (parent_id);

comment on column public.labels.parent_id is
  'Parent label, NULL = root. Max depth 2 (Label > Sub-label), enforced by labels_hierarchy_guard. Deleting a parent promotes its children to root.';

-- ── hierarchy guard ──────────────────────────────────────────────────────────
-- Four rules, each a single indexed lookup. No recursion is needed or wanted:
-- at depth 2 a cycle is unreachable once "parent must be a root" holds.

create or replace function app.labels_hierarchy_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  v_parent_user_id   uuid;
  v_parent_parent_id uuid;
begin
  if new.parent_id is null then
    return new;  -- becoming a root can only reduce depth
  end if;

  if new.parent_id = new.id then
    raise exception 'A label cannot be its own parent';
  end if;

  select user_id, parent_id into v_parent_user_id, v_parent_parent_id
    from labels where id = new.parent_id;

  -- Not found covers two cases: the id is bogus, or it belongs to someone else
  -- and RLS hid it from this statement. Both are the same answer to the caller.
  if not found then
    raise exception 'That parent label does not exist';
  end if;

  -- Explicit ownership check for callers that bypass RLS (service_role, admin
  -- tooling), where the SELECT above would have succeeded across users.
  if v_parent_user_id <> new.user_id then
    raise exception 'A label can only nest under one of your own labels';
  end if;

  -- Depth 2: the parent must itself be a root.
  if v_parent_parent_id is not null then
    raise exception 'Label nesting is limited to 2 levels';
  end if;

  -- ...and the label being nested must not already have children, which would
  -- push those children to depth 3. Only reachable on UPDATE — on INSERT the
  -- row is new and childless — and it is the case most easily missed.
  if exists (select 1 from labels c where c.parent_id = new.id) then
    raise exception 'Move its sub-labels out first — nesting is limited to 2 levels';
  end if;

  return new;
end; $$;

drop trigger if exists labels_hierarchy_guard on public.labels;
create trigger labels_hierarchy_guard
  before insert or update of parent_id on public.labels
  for each row execute function app.labels_hierarchy_guard();

-- Fires before labels_normalize (triggers run in name order, h < n); the two are
-- independent — this one reads parent_id, that one rewrites name/updated_at.

grant execute on function app.labels_hierarchy_guard() to authenticated, service_role;
