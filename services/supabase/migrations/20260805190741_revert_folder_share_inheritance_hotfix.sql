-- HOTFIX · revert folder share inheritance (applied to production 2026-08-05 19:07 UTC)
--
-- Restores app.can_read_folder / app.can_write_folder to their definitions from
-- 20260606020000_phase_a_org_access_and_rls.sql.
--
-- WHY
-- 20260731000000_folder_hierarchy.sql routed both functions through
-- app.folder_level_eff -> app.folder_chain, a recursive CTE. Those two functions
-- are evaluated PER ROW by the RLS policies on folders, snippets, prompts and
-- snippet_revisions, so the cost lands on every read in the product.
--
-- Measured on live data (warmed, interleaved A/B, 6 rounds x 300 iterations
-- over 10 folders — a cold-instance measurement had shown misleading numbers):
--   app.folder_level      0.313 ms/iter
--   app.folder_level_eff  3.200 ms/iter   (10.2x)
--
-- On this project that 10x was enough to saturate the instance:
--   compute nano (shared CPU) · max_connections 60 · statement_timeout 120s
--   ~113k requests in the window (27k accessible_snippets, 27k folders)
--   60 x "canceling statement due to statement timeout" between 15:52 and 16:38
--   Postgres stopped accepting connections 16:54 -> ~19:05 UTC (~2h outage)
--
-- WHAT THIS COSTS
-- Folder shares no longer inherit: a grant on a parent folder does not reach its
-- subfolders. Nesting, drag & drop, descriptions and breadcrumbs are unaffected —
-- those are columns and UI, not these functions.
--
-- app.folder_chain and app.folder_level_eff are deliberately LEFT INSTALLED but
-- unreferenced. They are harmless while nothing calls them, and they let
-- inheritance be re-landed later without rebuilding from scratch.
--
-- BEFORE RE-LANDING INHERITANCE, read the note at the top of
-- 20260731000000_folder_hierarchy.sql. A per-row ancestor walk inside an RLS
-- policy is the shape to avoid; resolve the closure once per query instead
-- (e.g. a materialised closure table maintained by trigger, or a single
-- recursive CTE joined once rather than called per row), and benchmark it
-- warmed and interleaved before shipping.

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
