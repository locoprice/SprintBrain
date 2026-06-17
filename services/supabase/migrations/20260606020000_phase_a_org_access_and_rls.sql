-- Phase A · access helper functions (recursion-safe, SECURITY DEFINER) + RLS for new tables.
-- Applied to live DB 2026-06-06 via MCP (migration: phase_a_org_access_and_rls).
-- Functions live in the unexposed `app` schema (NOT reachable via /rest/v1/rpc).
-- Existing asset-table policies (folders/snippets/prompts) are deliberately UNTOUCHED here;
-- their org-aware branches land in Phase B alongside the is_shared retirement.

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

create or replace function app.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from organization_members where organization_id = p_org and user_id = auth.uid());
$$;

create or replace function app.org_role(p_org uuid)
returns org_role language sql stable security definer set search_path = public as $$
  select role from organization_members where organization_id = p_org and user_id = auth.uid();
$$;

create or replace function app.team_org(p_team uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from teams where id = p_team;
$$;

create or replace function app.folder_org(p_folder text)
returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from folders where id = p_folder;
$$;

create or replace function app.folder_level(p_folder text)
returns permission_level language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_owner uuid; v_level permission_level;
begin
  select organization_id, user_id into v_org, v_owner from folders where id = p_folder;
  if not found then return null; end if;
  if v_owner = auth.uid() then return 'owner'; end if;
  if v_org is not null and app.org_role(v_org) = 'admin' then return 'owner'; end if;
  select fp.level into v_level from folder_permissions fp
   where fp.folder_id = p_folder
     and ( (fp.principal_type = 'user' and fp.principal_id = auth.uid())
        or (fp.principal_type = 'organization' and app.is_org_member(fp.principal_id))
        or (fp.principal_type = 'team' and fp.principal_id in
              (select team_id from team_members where user_id = auth.uid())) )
   order by fp.level desc limit 1;
  return v_level;
end; $$;

create or replace function app.can_read_folder(p_folder text)
returns boolean language sql stable security definer set search_path = public as $$
  select app.folder_level(p_folder) is not null
     or exists (select 1 from default_folders d where d.folder_id = p_folder
                  and ( (d.scope_type='organization' and app.is_org_member(d.scope_id))
                     or (d.scope_type='team' and d.scope_id in
                           (select team_id from team_members where user_id = auth.uid())) ));
$$;

create or replace function app.can_write_folder(p_folder text)
returns boolean language sql stable security definer set search_path = public as $$
  select app.folder_level(p_folder) in ('edit','owner');
$$;

revoke execute on all functions in schema app from public;
grant execute on all functions in schema app to authenticated, service_role;

-- ── policies: new tables only ────────────────────────────────────────────────
create policy org_select on organizations for select to authenticated using (app.is_org_member(id));
create policy org_insert on organizations for insert to authenticated with check (created_by = auth.uid());
create policy org_update on organizations for update to authenticated using (app.org_role(id)='admin') with check (app.org_role(id)='admin');
create policy org_delete on organizations for delete to authenticated using (app.org_role(id)='admin');

create policy orgmem_select on organization_members for select to authenticated using (app.is_org_member(organization_id));
create policy orgmem_write on organization_members for all to authenticated using (app.org_role(organization_id)='admin') with check (app.org_role(organization_id)='admin');

create policy orginv_select on organization_invitations for select to authenticated using (app.org_role(organization_id) in ('admin','manager'));
create policy orginv_write on organization_invitations for all to authenticated using (app.org_role(organization_id) in ('admin','manager')) with check (app.org_role(organization_id) in ('admin','manager'));

create policy team_select on teams for select to authenticated using (app.is_org_member(organization_id));
create policy team_write on teams for all to authenticated using (app.org_role(organization_id) in ('admin','manager')) with check (app.org_role(organization_id) in ('admin','manager'));

create policy teammem_select on team_members for select to authenticated using (app.is_org_member(app.team_org(team_id)));
create policy teammem_write on team_members for all to authenticated using (app.org_role(app.team_org(team_id)) in ('admin','manager')) with check (app.org_role(app.team_org(team_id)) in ('admin','manager'));

create policy fperm_select on folder_permissions for select to authenticated using (app.can_read_folder(folder_id));
create policy fperm_manage on folder_permissions for all to authenticated using (app.folder_level(folder_id)='owner') with check (app.folder_level(folder_id)='owner');

create policy deffold_select on default_folders for select to authenticated using (app.is_org_member(app.folder_org(folder_id)));
create policy deffold_write on default_folders for all to authenticated using (app.org_role(app.folder_org(folder_id)) in ('admin','manager')) with check (app.org_role(app.folder_org(folder_id)) in ('admin','manager'));

create policy mprop_select on member_properties for select to authenticated using (app.is_org_member(organization_id));
create policy mprop_write on member_properties for all to authenticated using (app.org_role(organization_id)='admin') with check (app.org_role(organization_id)='admin');

create policy mpropval_select on member_property_values for select to authenticated using (user_id = auth.uid() or app.org_role(organization_id)='admin');
create policy mpropval_write on member_property_values for all to authenticated using (user_id = auth.uid() or app.org_role(organization_id)='admin') with check (user_id = auth.uid() or app.org_role(organization_id)='admin');
