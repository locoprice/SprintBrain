// invite-member — Supabase Edge Function (Deno)
// INVITE-001: a team admin or manager invites someone to their organization by
// email. Creates (or refreshes) the pending `organization_invitations` row and
// sends the email that carries the person to /invite, where they accept or
// decline.
//
// WHY THIS IS SERVER-SIDE — the dashboard client runs `flowType: 'pkce'`, so a
// magic link requested from the inviter's browser stores its code verifier in
// the INVITER's localStorage and can only be redeemed there. Requested here,
// GoTrue issues a token-hash link that opens in any browser, which is the whole
// point of an invitation.
//
// The target org is derived from the caller's own membership — never taken from
// the request body — so a member cannot invite people into someone else's team.
//
// Environment secrets (all injected automatically by the runtime):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Where the invitation link lands. Taken from an allow-list, never from the
// request, so a forged Origin header cannot turn an invite into an open
// redirect. Anything unrecognized falls back to production.
const ALLOWED_ORIGINS = ['https://app.sprintbrain.com', 'http://localhost:5173'];
const DEFAULT_ORIGIN = 'https://app.sprintbrain.com';

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // matches the column default
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type OrgRole = 'admin' | 'manager' | 'member';
const ROLES: OrgRole[] = ['admin', 'manager', 'member'];

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  // CORS pre-flight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  // ── Auth: validate the caller's JWT ──────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return json({ error: 'unauthorized' }, 401);
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();

  if (authError || !user || !user.email) {
    return json({ error: 'unauthorized' }, 401);
  }

  // ── Input ────────────────────────────────────────────────────────
  let body: { email?: unknown; role?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const role = (typeof body.role === 'string' ? body.role : 'member') as OrgRole;

  if (!EMAIL_RE.test(email)) {
    return json({ error: 'invalid_email' }, 400);
  }
  if (!ROLES.includes(role)) {
    return json({ error: 'invalid_role' }, 400);
  }
  if (email === user.email.toLowerCase()) {
    return json({ error: 'self_invite' }, 400);
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // ── The caller's org + their standing in it ──────────────────────
  // Earliest membership = the active org, matching orgApi.getActiveOrg().
  const { data: membership, error: memberError } = await serviceClient
    .from('organization_members')
    .select('organization_id, role, organizations(name)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (memberError) {
    return json({ error: 'invite_failed', detail: memberError.message }, 500);
  }
  if (!membership) {
    return json({ error: 'no_organization' }, 404);
  }

  const callerRole = membership.role as OrgRole;
  if (callerRole !== 'admin' && callerRole !== 'manager') {
    return json({ error: 'not_authorized' }, 403);
  }
  // A manager must not be able to mint an admin — that would let them promote
  // themselves by proxy through the account they invited.
  if (role === 'admin' && callerRole !== 'admin') {
    return json({ error: 'admin_role_requires_admin' }, 403);
  }

  const orgId = membership.organization_id as string;
  const orgRel = membership.organizations as { name: string } | { name: string }[] | null;
  const orgName = (Array.isArray(orgRel) ? orgRel[0]?.name : orgRel?.name) ?? 'your team';

  // ── Does the invitee already have an account / already belong? ───
  const { data: existingUserId, error: lookupError } = await serviceClient.rpc(
    'auth_user_id_by_email',
    { p_email: email },
  );
  if (lookupError) {
    return json({ error: 'invite_failed', detail: lookupError.message }, 500);
  }

  if (existingUserId) {
    const { data: alreadyMember, error: dupError } = await serviceClient
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', orgId)
      .eq('user_id', existingUserId)
      .maybeSingle();
    if (dupError) {
      return json({ error: 'invite_failed', detail: dupError.message }, 500);
    }
    if (alreadyMember) {
      return json({ error: 'already_member' }, 409);
    }
  }

  // ── Create or refresh the pending invitation ─────────────────────
  // Re-inviting a declined, revoked, or expired address reopens the same row
  // (unique on organization_id + email) with a fresh clock.
  const { error: upsertError } = await serviceClient
    .from('organization_invitations')
    .upsert(
      {
        organization_id: orgId,
        email,
        role,
        invited_by: user.id,
        status: 'pending',
        expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
      },
      { onConflict: 'organization_id,email' },
    );

  if (upsertError) {
    return json({ error: 'invite_failed', detail: upsertError.message }, 500);
  }

  // ── Send the email ───────────────────────────────────────────────
  const requestOrigin = req.headers.get('Origin') ?? '';
  const base = ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : DEFAULT_ORIGIN;
  const redirectTo = `${base}/auth/callback?next=/invite`;

  const inviterName =
    (user.user_metadata?.display_name as string | undefined)?.trim() || user.email;

  let emailError: string | null = null;

  if (existingUserId) {
    // The account exists, so GoTrue's invite endpoint would reject it. A magic
    // link signs them in and lands them on /invite. This anon client keeps the
    // default implicit flow — no PKCE verifier, so the link is portable.
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    const { error } = await anonClient.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
    });
    emailError = error?.message ?? null;
  } else {
    const { error } = await serviceClient.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { invited_to_org: orgName, invited_by: inviterName },
    });
    emailError = error?.message ?? null;
  }

  // The invitation row stands either way — the admin can resend, and an
  // already-signed-in invitee sees it in-app regardless of email delivery.
  // Reporting `emailed: false` keeps a delivery failure visible instead of
  // dressing a half-finished invite up as a success.
  return json(
    {
      status: 'sent',
      account: existingUserId ? 'existing' : 'new',
      emailed: emailError === null,
      emailError,
    },
    200,
  );
});
