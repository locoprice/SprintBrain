-- Add leibtour@gmail.com (Valentina) to the LeibTour org as admin.
--
-- WHY: The B1 migration (20260607010000_phase_b_b1_leibtour_org.sql) created
-- the org and added only locopricesl@gmail.com, sprintbrainapp@gmail.com, and
-- b2b@leibtour.com. leibtour@gmail.com was omitted.
--
-- Without a row in organization_members, app.folder_level() cannot resolve the
-- org from the caller's membership when evaluating folder_permissions grants:
--
--   LEFT JOIN folder_permissions p
--     ON  p.principal_type = 'organization'
--     AND p.principal_id   = (SELECT organization_id
--                              FROM organization_members
--                              WHERE user_id = auth.uid() LIMIT 1)
--
-- The sub-select returns NULL, so the JOIN never matches, can_read_folder()
-- returns NULL, and accessible_snippets() returns zero org rows for Valentina —
-- even though every shared snippet is already in leibtour_team_shared with an
-- org-wide VIEW grant.
--
-- Granting admin (not just member) so Valentina can also re-home/un-share org
-- folders from the extension without hitting the "org admin only" guard in the
-- enforce_folder_tenancy trigger.
--
-- SAFE: ON CONFLICT DO NOTHING makes this idempotent on re-run.

INSERT INTO organization_members (organization_id, user_id, role)
SELECT o.id, u.id, 'admin'::org_role
FROM   organizations o
CROSS  JOIN auth.users u
WHERE  o.slug  = 'leibtour'
  AND  u.email = 'leibtour@gmail.com'
ON CONFLICT (organization_id, user_id) DO NOTHING;
