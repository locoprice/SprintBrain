-- ── Company logo storage (BRANDING-001) ─────────────────────────────────────
-- Per-user company branding: the dashboard lets each user upload a logo that
-- co-brands the topbar and sidebar. Objects live in the public-read bucket
-- `company-logos` under a per-user folder ({user_id}/logo-<ts>.<ext>); the
-- object's public URL is stored in auth.users.user_metadata.company_logo_url
-- (a short string — never image bytes, which would bloat the JWT).
--
-- storage.objects has RLS enabled by default and this project had no storage
-- policies before this migration. Writes are scoped to the caller's own
-- folder; reads are public (logos are display assets served via public URL).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'company-logos',
  'company-logos',
  true,
  1048576, -- 1 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "company_logos_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'company-logos');

CREATE POLICY "company_logos_owner_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'company-logos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "company_logos_owner_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'company-logos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'company-logos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "company_logos_owner_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'company-logos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
