-- ── Team cover (TEAM-COVER-001) ─────────────────────────────────────────────
-- Notion-style header cover for the Team page. One value per organization,
-- chosen by an org admin, visible to every member.
--
-- `organizations.cover` holds either a preset key (e.g. 'azure', rendered as a
-- CSS gradient client-side) or the public URL of an uploaded image in the
-- `team-covers` bucket. NULL = no cover.
--
-- No new table policy is needed: the existing `org_update` RLS is already
-- admin-only (app.org_role(id) = 'admin') and `org_select` lets any member
-- read — so writes to this column are admin-gated and reads are member-wide by
-- the policies already in place.

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS cover text;

-- Uploaded-cover storage. Objects live under a per-org folder
-- ({org_id}/cover-<ts>.<ext>); writes are gated to org admins via the same
-- recursion-safe app.org_role() the table policies use; reads are public
-- (covers are display assets served by public URL).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'team-covers',
  'team-covers',
  true,
  2097152, -- 2 MB (covers are photos, larger than logos/avatars)
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "team_covers_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'team-covers');

CREATE POLICY "team_covers_admin_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'team-covers'
    AND app.org_role(((storage.foldername(name))[1])::uuid) = 'admin'
  );

CREATE POLICY "team_covers_admin_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'team-covers'
    AND app.org_role(((storage.foldername(name))[1])::uuid) = 'admin'
  )
  WITH CHECK (
    bucket_id = 'team-covers'
    AND app.org_role(((storage.foldername(name))[1])::uuid) = 'admin'
  );

CREATE POLICY "team_covers_admin_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'team-covers'
    AND app.org_role(((storage.foldername(name))[1])::uuid) = 'admin'
  );
