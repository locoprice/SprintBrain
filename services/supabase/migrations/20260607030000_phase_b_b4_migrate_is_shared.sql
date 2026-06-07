-- Phase B · B4 — migrate the legacy is_shared snippets into a shared org folder
--
-- Moves every `snippets.is_shared = true` row into a single org folder
-- ("Team Shared") that is granted org-wide VIEW, and stamps organization_id so
-- the Phase-B folder ACL governs access. is_shared is LEFT TRUE on purpose — it
-- is retired as a global-read in B5 and the column is dropped in B6, so the
-- currently-deployed extension/dashboard keep working through the transition.
--
-- Invariant established here (verified after apply): every is_shared snippet is
-- folder-readable by every LeibTour member, so retiring the is_shared global
-- read in B5 removes zero access for members (only non-members lose the leak).
--
-- Reversible: phase_b_share_migration records each row's prior folder_id +
-- organization_id. Rollback = restore those values + delete the folder/grant.

BEGIN;

-- Audit / reversal record. RLS on with no policies → not exposed via the API
-- (deny-by-default for authenticated/anon; service_role bypasses).
CREATE TABLE IF NOT EXISTS phase_b_share_migration (
  snippet_id           text PRIMARY KEY REFERENCES snippets(id) ON DELETE CASCADE,
  prev_folder_id       text,
  prev_organization_id uuid,
  migrated_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE phase_b_share_migration ENABLE ROW LEVEL SECURITY;

-- The shared folder (idempotent fixed id).
INSERT INTO folders (id, user_id, name, ico, sort_order, organization_id, description)
SELECT 'leibtour_team_shared', o.created_by, 'Team Shared', '🤝', 0, o.id,
       'Snippets shared with the whole LeibTour team. Migrated from the legacy per-snippet is_shared flag during Phase B.'
FROM organizations o
WHERE o.slug = 'leibtour'
ON CONFLICT (id) DO UPDATE
  SET organization_id = EXCLUDED.organization_id,
      name            = EXCLUDED.name,
      description      = EXCLUDED.description;

-- Snapshot prior state for reversal (only rows not already recorded).
INSERT INTO phase_b_share_migration (snippet_id, prev_folder_id, prev_organization_id)
SELECT s.id, s.folder_id, s.organization_id
FROM snippets s
WHERE s.is_shared = true
ON CONFLICT (snippet_id) DO NOTHING;

-- Move them into the shared org folder + stamp organization_id.
UPDATE snippets s
SET organization_id = (SELECT id FROM organizations WHERE slug = 'leibtour'),
    folder_id       = 'leibtour_team_shared',
    updated_at      = now()
WHERE s.is_shared = true;

-- Grant the whole org VIEW on the shared folder.
INSERT INTO folder_permissions (folder_id, principal_type, principal_id, level, granted_by)
SELECT 'leibtour_team_shared', 'organization', o.id, 'view', o.created_by
FROM organizations o
WHERE o.slug = 'leibtour'
ON CONFLICT (folder_id, principal_type, principal_id) DO UPDATE SET level = EXCLUDED.level;

COMMIT;
