-- Folder hierarchy · nest folders one under another ("Villa X" > "Preventivi").
--
-- Adds folders.parent_id and teaches the access helpers to walk ancestors so a
-- share on a parent reaches its whole subtree. Sharing "Villa X" with the team
-- must also share "Villa X > Preventivi" — otherwise a teammate sees the parent
-- and none of its contents.
--
-- Two hard guards, because a self-referencing tree walked inside a SECURITY
-- DEFINER function is a correctness AND availability hazard:
--   1. a BEFORE trigger rejects self-parenting, cycles, and depth > 3
--   2. every recursive walk is depth-capped independently, so even a cycle
--      introduced out-of-band (direct SQL, restore) cannot spin a policy check
--
-- NOT APPLIED to the live DB by this file. Apply via MCP/CLI deliberately.

-- ── schema ───────────────────────────────────────────────────────────────────
alter table folders
  add column if not exists parent_id text references folders(id) on delete set null;

-- Deleting a parent promotes its children to root rather than cascading:
-- losing a whole subtree of snippets to one click is not recoverable in-product.

create index if not exists folders_parent_id_idx on folders(parent_id);

comment on column folders.parent_id is
  'Parent folder, NULL = root. Max depth 3 (Property > Category > Sub), enforced by folders_hierarchy_guard.';

-- ── hierarchy guard ──────────────────────────────────────────────────────────
-- Depth is 1-based: a root folder is depth 1.
create or replace function app.folders_hierarchy_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  max_depth      constant int := 3;
  v_parent_depth int;
  v_subtree_high int;
begin
  if new.parent_id is null then
    return new;  -- moving to root can only reduce depth
  end if;

  if new.parent_id = new.id then
    raise exception 'A folder cannot be its own parent';
  end if;

  -- Cycle: would the new parent already sit below this folder?
  if exists (
    with recursive up as (
      select f.id, f.parent_id, 1 as depth
        from folders f where f.id = new.parent_id
      union all
      select f.id, f.parent_id, up.depth + 1
        from folders f join up on f.id = up.parent_id
       where up.depth < max_depth + 1
    )
    select 1 from up where up.id = new.id
  ) then
    raise exception 'Cannot move folder % into its own subtree', new.id;
  end if;

  -- Depth of the proposed parent (1 = root).
  with recursive up as (
    select f.id, f.parent_id, 1 as depth
      from folders f where f.id = new.parent_id
    union all
    select f.id, f.parent_id, up.depth + 1
      from folders f join up on f.id = up.parent_id
     where up.depth < max_depth + 1
  )
  select coalesce(max(up.depth), 0) into v_parent_depth from up;

  -- How tall is the subtree being moved? 1 = the folder itself, no children.
  with recursive sub as (
    select f.id, 1 as depth from folders f where f.id = new.id
    union all
    select f.id, sub.depth + 1
      from folders f join sub on f.parent_id = sub.id
     where sub.depth < max_depth + 1
  )
  select coalesce(max(sub.depth), 1) into v_subtree_high from sub;

  if v_parent_depth + v_subtree_high > max_depth then
    raise exception 'Folder nesting is limited to % levels', max_depth;
  end if;

  return new;
end; $$;

drop trigger if exists folders_hierarchy_guard on folders;
create trigger folders_hierarchy_guard
  before insert or update of parent_id on folders
  for each row execute function app.folders_hierarchy_guard();

-- ── access helpers ───────────────────────────────────────────────────────────
-- The folder itself plus every ancestor, nearest first. Depth-capped so a cycle
-- can never make this spin.
create or replace function app.folder_chain(p_folder text)
returns table (id text)
language sql stable security definer set search_path = public as $$
  with recursive chain as (
    select f.id, f.parent_id, 1 as depth
      from folders f where f.id = p_folder
    union all
    select f.id, f.parent_id, chain.depth + 1
      from folders f join chain on f.id = chain.parent_id
     where chain.depth < 8
  )
  select chain.id from chain;
$$;

-- Strongest permission held on the folder or anything above it.
-- `order by ... desc limit 1` mirrors app.folder_level's existing pattern and
-- relies on permission_level being declared ascending ('view','edit','owner').
create or replace function app.folder_level_eff(p_folder text)
returns permission_level
language sql stable security definer set search_path = public as $$
  select lvl from (
    select app.folder_level(c.id) as lvl from app.folder_chain(p_folder) c
  ) levels
  where lvl is not null
  order by lvl desc
  limit 1;
$$;

-- Reads and writes now resolve through the chain. app.folder_level keeps its
-- direct-only meaning on purpose: fperm_manage gates share administration on it,
-- and inheriting 'owner' downward would let a grantee re-share a subfolder.
create or replace function app.can_read_folder(p_folder text)
returns boolean language sql stable security definer set search_path = public as $$
  select app.folder_level_eff(p_folder) is not null
     or exists (select 1 from default_folders d
                 where d.folder_id in (select c.id from app.folder_chain(p_folder) c)
                   and ( (d.scope_type='organization' and app.is_org_member(d.scope_id))
                      or (d.scope_type='team' and d.scope_id in
                            (select team_id from team_members where user_id = auth.uid())) ));
$$;

create or replace function app.can_write_folder(p_folder text)
returns boolean language sql stable security definer set search_path = public as $$
  select app.folder_level_eff(p_folder) in ('edit','owner');
$$;

revoke execute on all functions in schema app from public;
grant execute on all functions in schema app to authenticated, service_role;
