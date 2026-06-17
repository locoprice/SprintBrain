-- Phase A · tenancy + permission foundation (ADDITIVE — existing tables' RLS untouched).
-- Applied to live DB 2026-06-06 via MCP (migration: phase_a_org_foundation_schema).
-- New rows are inert until Phase B/C wire them up; existing assets stay personal (org_id NULL).
-- See docs/ENTERPRISE_ARCHITECTURE.md for the full design.

-- ── enums ────────────────────────────────────────────────────────────────────
create type org_role as enum ('admin','manager','member');
create type team_role as enum ('admin','member');
create type permission_level as enum ('view','edit','owner');
create type principal_type as enum ('user','team','organization');

-- ── tenancy tables ───────────────────────────────────────────────────────────
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table organization_members (
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role org_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  email text not null,
  role org_role not null default 'member',
  token uuid not null default gen_random_uuid(),
  invited_by uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  unique (organization_id, email)
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  description text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role team_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

-- ── folder ACL + defaults ──────────────────────────────────────────────────────
create table folder_permissions (
  id uuid primary key default gen_random_uuid(),
  folder_id text not null references folders(id) on delete cascade,
  principal_type principal_type not null,
  principal_id uuid not null,
  level permission_level not null default 'view',
  granted_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (folder_id, principal_type, principal_id)
);

create table default_folders (
  id uuid primary key default gen_random_uuid(),
  folder_id text not null references folders(id) on delete cascade,
  scope_type text not null check (scope_type in ('organization','team')),
  scope_id uuid not null,
  level permission_level not null default 'view',
  created_at timestamptz not null default now(),
  unique (folder_id, scope_type, scope_id)
);

-- ── member properties (schema-only stub for now) ───────────────────────────────
create table member_properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  key text not null,
  label text not null,
  data_type text not null default 'text' check (data_type in ('text','number','date','boolean')),
  created_at timestamptz not null default now(),
  unique (organization_id, key)
);

create table member_property_values (
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null references member_properties(id) on delete cascade,
  value text,
  primary key (property_id, user_id)
);

-- ── indexes ────────────────────────────────────────────────────────────────────
create index idx_org_members_user on organization_members(user_id);
create index idx_team_members_user on team_members(user_id);
create index idx_team_members_team on team_members(team_id);
create index idx_folder_perms_folder on folder_permissions(folder_id);
create index idx_folder_perms_principal on folder_permissions(principal_type, principal_id);
create index idx_default_folders_scope on default_folders(scope_type, scope_id);
create index idx_teams_org on teams(organization_id);
create index idx_invitations_org on organization_invitations(organization_id);
create index idx_invitations_email on organization_invitations(email);

-- ── additive columns on existing tables (all NULLABLE → zero behavior change) ────
alter table folders  add column organization_id uuid references organizations(id);
alter table folders  add column description text;
alter table snippets add column organization_id uuid references organizations(id);
alter table prompts  add column organization_id uuid references organizations(id);
alter table prompts  add column folder_id text references folders(id);
create index idx_folders_org on folders(organization_id);
create index idx_snippets_org_folder on snippets(organization_id, folder_id);
create index idx_prompts_org_folder on prompts(organization_id, folder_id);

-- ── RLS on (policies arrive in the access+rls migration; until then deny-all to
--    authenticated, service_role bypasses for the backfill) ─────────────────────
alter table organizations enable row level security;
alter table organization_members enable row level security;
alter table organization_invitations enable row level security;
alter table teams enable row level security;
alter table team_members enable row level security;
alter table folder_permissions enable row level security;
alter table default_folders enable row level security;
alter table member_properties enable row level security;
alter table member_property_values enable row level security;

-- ── grants (GRANTS-001 convention) ──────────────────────────────────────────────
revoke all on organizations, organization_members, organization_invitations, teams,
  team_members, folder_permissions, default_folders, member_properties, member_property_values
  from anon;
grant select, insert, update, delete on organizations, organization_members,
  organization_invitations, teams, team_members, folder_permissions, default_folders,
  member_properties, member_property_values to authenticated;
grant all on organizations, organization_members, organization_invitations, teams,
  team_members, folder_permissions, default_folders, member_properties, member_property_values
  to service_role;
