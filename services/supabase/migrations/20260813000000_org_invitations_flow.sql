-- INVITE-001 — wire up the invitation join path (email invite → accept / decline).
--
-- `organization_invitations` shipped inert in Phase A: the table exists, but its
-- RLS (orginv_select / orginv_write) only admits an org's admins and managers.
-- An invitee is by definition NOT a member yet, so:
--   • they cannot SELECT the invitation addressed to them, and
--   • they cannot INSERT their own organization_members row (orgmem_write is
--     admin-only).
-- Every invitee-side operation therefore runs through a SECURITY DEFINER RPC
-- that matches invitations against the caller's VERIFIED email (auth.users),
-- never against a client-supplied value. That escalation is the whole point and
-- is bounded to: one pending, unexpired invitation addressed to that email.
--
-- No token ever travels in a URL. The invite email signs the person in, and the
-- mailbox possession GoTrue already proved is what authorizes the accept — so
-- there is no invite link to leak through a referrer, a shared screen, or a
-- forwarded message.

-- ── 'declined' is a real outcome, distinct from an admin's 'revoked' ─────────
ALTER TABLE organization_invitations
  DROP CONSTRAINT organization_invitations_status_check;

ALTER TABLE organization_invitations
  ADD CONSTRAINT organization_invitations_status_check
  CHECK (status IN ('pending', 'accepted', 'declined', 'revoked', 'expired'));

-- Lookup path for my_pending_invitations(): case-insensitive, pending only.
CREATE INDEX IF NOT EXISTS idx_invitations_pending_email
  ON organization_invitations (lower(email))
  WHERE status = 'pending';

-- ── caller identity ──────────────────────────────────────────────────────────
-- The caller's verified email, normalized. NULL when unauthenticated, which
-- makes every `lower(email) = app.caller_email()` comparison below match zero
-- rows rather than fall open.
CREATE OR REPLACE FUNCTION app.caller_email()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT lower(email) FROM auth.users WHERE id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION app.caller_email() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.caller_email() TO authenticated, service_role;

-- ── invitee: my own pending invitations ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.my_pending_invitations()
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  org_name text,
  org_slug text,
  role org_role,
  invited_by_name text,
  expires_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT i.id,
         i.organization_id,
         o.name,
         o.slug,
         i.role,
         COALESCE(NULLIF(inviter.raw_user_meta_data->>'display_name', ''), inviter.email)::text,
         i.expires_at,
         i.created_at
    FROM organization_invitations i
    JOIN organizations o ON o.id = i.organization_id
    LEFT JOIN auth.users inviter ON inviter.id = i.invited_by
   WHERE i.status = 'pending'
     AND i.expires_at > now()
     AND lower(i.email) = app.caller_email()
     AND NOT EXISTS (
           SELECT 1 FROM organization_members m
            WHERE m.organization_id = i.organization_id
              AND m.user_id = auth.uid())
   ORDER BY i.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.my_pending_invitations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_pending_invitations() TO authenticated, service_role;

-- ── invitee: accept ──────────────────────────────────────────────────────────
-- Returns the organization the caller just joined. Row-locked so a double
-- submit (or two tabs) cannot produce two membership rows.
CREATE OR REPLACE FUNCTION public.accept_org_invitation(p_invitation uuid)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_email text := app.caller_email();
  v_inv   organization_invitations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_email IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_inv FROM organization_invitations WHERE id = p_invitation FOR UPDATE;

  IF NOT FOUND OR lower(v_inv.email) <> v_email THEN
    RAISE EXCEPTION 'This invitation was sent to a different email address'
      USING ERRCODE = 'P0002';
  END IF;

  -- Already in the team (invited twice, or added directly): settle the
  -- invitation instead of erroring — the caller's intent is already satisfied.
  IF EXISTS (SELECT 1 FROM organization_members
              WHERE organization_id = v_inv.organization_id AND user_id = auth.uid()) THEN
    UPDATE organization_invitations SET status = 'accepted' WHERE id = p_invitation;
    RETURN v_inv.organization_id;
  END IF;

  IF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'This invitation is no longer open' USING ERRCODE = 'P0002';
  END IF;

  IF v_inv.expires_at <= now() THEN
    UPDATE organization_invitations SET status = 'expired' WHERE id = p_invitation;
    RAISE EXCEPTION 'This invitation has expired' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (v_inv.organization_id, auth.uid(), v_inv.role)
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  UPDATE organization_invitations SET status = 'accepted' WHERE id = p_invitation;

  RETURN v_inv.organization_id;
END; $$;

REVOKE EXECUTE ON FUNCTION public.accept_org_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_org_invitation(uuid) TO authenticated, service_role;

-- ── invitee: decline ─────────────────────────────────────────────────────────
-- No membership row is created and none is removed; the invitation is simply
-- closed. An admin can invite again, which reopens the same row as pending.
CREATE OR REPLACE FUNCTION public.decline_org_invitation(p_invitation uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_email text := app.caller_email();
  v_inv   organization_invitations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_email IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_inv FROM organization_invitations WHERE id = p_invitation FOR UPDATE;

  IF NOT FOUND OR lower(v_inv.email) <> v_email THEN
    RAISE EXCEPTION 'This invitation was sent to a different email address'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'This invitation is no longer open' USING ERRCODE = 'P0002';
  END IF;

  UPDATE organization_invitations SET status = 'declined' WHERE id = p_invitation;
END; $$;

REVOKE EXECUTE ON FUNCTION public.decline_org_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_org_invitation(uuid) TO authenticated, service_role;

-- ── admin: what has been sent ────────────────────────────────────────────────
-- RLS already lets admins/managers read the table, but PostgREST cannot resolve
-- the inviter's identity out of auth.users (same reason org_member_directory
-- exists) — and this shape deliberately omits `token` from the payload.
-- Accepted invitations are excluded: those people are in the roster now.
CREATE OR REPLACE FUNCTION public.org_invitations(p_org uuid)
RETURNS TABLE (
  id uuid,
  email text,
  role org_role,
  status text,
  expires_at timestamptz,
  created_at timestamptz,
  invited_by_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT i.id,
         i.email,
         i.role,
         CASE WHEN i.status = 'pending' AND i.expires_at <= now()
              THEN 'expired' ELSE i.status END,
         i.expires_at,
         i.created_at,
         COALESCE(NULLIF(u.raw_user_meta_data->>'display_name', ''), u.email)::text
    FROM organization_invitations i
    LEFT JOIN auth.users u ON u.id = i.invited_by
   WHERE i.organization_id = p_org
     AND app.org_role(p_org) IN ('admin', 'manager')
     AND i.status IN ('pending', 'declined')
   ORDER BY i.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.org_invitations(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_invitations(uuid) TO authenticated, service_role;

-- ── edge function support: does this email already have an account? ──────────
-- `invite-member` branches on this: an existing account gets a magic link, a
-- new one gets GoTrue's invite email. service_role ONLY — exposing it to
-- `authenticated` would turn it into an account-enumeration oracle.
CREATE OR REPLACE FUNCTION public.auth_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT id FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.auth_user_id_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_id_by_email(text) TO service_role;
