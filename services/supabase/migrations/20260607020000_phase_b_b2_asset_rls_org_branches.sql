-- Phase B · B2 — org-aware RLS branches on the asset tables (folders/snippets/prompts)
--
-- ADDITIVE & NON-BREAKING. Every policy keeps its existing personal branch
-- (`auth.uid() = user_id`) verbatim and OR-adds an org branch resolved by the
-- recursion-safe app.* SECURITY DEFINER functions from Phase A. The snippets
-- SELECT policy ALSO keeps the `is_shared = true` branch — that global read is
-- retired separately in B5, after data + clients have moved to folder ACL.
--
-- Access model (folder = the permission boundary; assets inherit):
--   read  org asset  ⇢ organization_id IS NOT NULL AND folder_id IS NOT NULL
--                       AND app.can_read_folder(folder_id)
--   write org asset  ⇢ … AND app.can_write_folder(folder_id)   (edit/owner grant)
-- Personal rows (organization_id IS NULL) are unaffected — the org branch
-- short-circuits on the NULL check.
--
-- Reversible: restore the prior policy bodies (kept verbatim in the comments
-- below each DROP) — see PHASE_B_PLAN.md §4.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- FOLDERS — a shared folder must be visible to its grantees, and manageable by
-- its owner / org-admin.
-- ─────────────────────────────────────────────────────────────────────────────
-- prior: USING (auth.uid() = user_id)
DROP POLICY "folders: select own" ON folders;
CREATE POLICY "folders: select own" ON folders FOR SELECT TO authenticated
USING (
  auth.uid() = user_id
  OR (organization_id IS NOT NULL AND app.can_read_folder(id))
);

-- prior: WITH CHECK (auth.uid() = user_id)
DROP POLICY "folders: insert own" ON folders;
CREATE POLICY "folders: insert own" ON folders FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND (organization_id IS NULL OR app.is_org_member(organization_id))
);

-- prior: USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)
DROP POLICY "folders: update own" ON folders;
CREATE POLICY "folders: update own" ON folders FOR UPDATE TO authenticated
USING (
  auth.uid() = user_id
  OR (organization_id IS NOT NULL AND app.folder_level(id) = 'owner')
)
WITH CHECK (
  auth.uid() = user_id
  OR (organization_id IS NOT NULL AND app.folder_level(id) = 'owner')
);

-- prior: USING (auth.uid() = user_id)
DROP POLICY "folders: delete own" ON folders;
CREATE POLICY "folders: delete own" ON folders FOR DELETE TO authenticated
USING (
  auth.uid() = user_id
  OR (organization_id IS NOT NULL AND app.folder_level(id) = 'owner')
);

-- ─────────────────────────────────────────────────────────────────────────────
-- SNIPPETS — keep personal + is_shared (retired in B5); add the org folder read,
-- and add org write for edit/owner grantees.
-- ─────────────────────────────────────────────────────────────────────────────
-- prior: USING (auth.uid() = user_id OR is_shared = true)
DROP POLICY "snippets: select own or shared" ON snippets;
CREATE POLICY "snippets: select own or shared" ON snippets FOR SELECT TO authenticated
USING (
  auth.uid() = user_id
  OR is_shared = true
  OR (organization_id IS NOT NULL AND folder_id IS NOT NULL AND app.can_read_folder(folder_id))
);

-- prior: WITH CHECK (auth.uid() = user_id)
DROP POLICY "snippets: insert own" ON snippets;
CREATE POLICY "snippets: insert own" ON snippets FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND (organization_id IS NULL OR (folder_id IS NOT NULL AND app.can_write_folder(folder_id)))
);

-- prior: USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)
DROP POLICY "snippets: update own" ON snippets;
CREATE POLICY "snippets: update own" ON snippets FOR UPDATE TO authenticated
USING (
  auth.uid() = user_id
  OR (organization_id IS NOT NULL AND folder_id IS NOT NULL AND app.can_write_folder(folder_id))
)
WITH CHECK (
  auth.uid() = user_id
  OR (organization_id IS NOT NULL AND folder_id IS NOT NULL AND app.can_write_folder(folder_id))
);

-- prior: USING (auth.uid() = user_id)
DROP POLICY "snippets: delete own" ON snippets;
CREATE POLICY "snippets: delete own" ON snippets FOR DELETE TO authenticated
USING (
  auth.uid() = user_id
  OR (organization_id IS NOT NULL AND folder_id IS NOT NULL AND app.can_write_folder(folder_id))
);

-- ─────────────────────────────────────────────────────────────────────────────
-- PROMPTS — foldered as of Phase A; same folder-ACL inheritance. Role kept as
-- the pre-existing `public` (anon has no auth.uid(), so the app.* checks are
-- false for it — no anon exposure).
-- ─────────────────────────────────────────────────────────────────────────────
-- prior: USING (auth.uid() = user_id)
DROP POLICY "prompts: select own" ON prompts;
CREATE POLICY "prompts: select own" ON prompts FOR SELECT TO public
USING (
  auth.uid() = user_id
  OR (organization_id IS NOT NULL AND folder_id IS NOT NULL AND app.can_read_folder(folder_id))
);

-- prior: WITH CHECK (auth.uid() = user_id)
DROP POLICY "prompts: insert own" ON prompts;
CREATE POLICY "prompts: insert own" ON prompts FOR INSERT TO public
WITH CHECK (
  user_id = auth.uid()
  AND (organization_id IS NULL OR (folder_id IS NOT NULL AND app.can_write_folder(folder_id)))
);

-- prior: USING (auth.uid() = user_id)
DROP POLICY "prompts: update own" ON prompts;
CREATE POLICY "prompts: update own" ON prompts FOR UPDATE TO public
USING (
  auth.uid() = user_id
  OR (organization_id IS NOT NULL AND folder_id IS NOT NULL AND app.can_write_folder(folder_id))
)
WITH CHECK (
  auth.uid() = user_id
  OR (organization_id IS NOT NULL AND folder_id IS NOT NULL AND app.can_write_folder(folder_id))
);

-- prior: USING (auth.uid() = user_id)
DROP POLICY "prompts: delete own" ON prompts;
CREATE POLICY "prompts: delete own" ON prompts FOR DELETE TO public
USING (
  auth.uid() = user_id
  OR (organization_id IS NOT NULL AND folder_id IS NOT NULL AND app.can_write_folder(folder_id))
);

-- ─────────────────────────────────────────────────────────────────────────────
-- accessible_snippets() — permission-aware read for the Chrome extension, which
-- talks raw REST (not supabase-js) and cannot express the folder ACL as a REST
-- querystring. SECURITY DEFINER + STABLE so PostgREST allows GET on /rpc/.
-- Returns personal + folder-readable snippets; the extension projects/filters
-- columns (is_active, select, order) on the result set as usual.
-- (No is_shared branch — by the time the permission-aware extension ships, B4
-- has migrated every shared snippet into a readable org folder.)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.accessible_snippets()
RETURNS SETOF snippets
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.*
    FROM snippets s
   WHERE s.user_id = auth.uid()
      OR ( s.organization_id IS NOT NULL
           AND s.folder_id IS NOT NULL
           AND app.can_read_folder(s.folder_id) );
$$;

REVOKE EXECUTE ON FUNCTION public.accessible_snippets() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accessible_snippets() TO authenticated, service_role;

COMMIT;
