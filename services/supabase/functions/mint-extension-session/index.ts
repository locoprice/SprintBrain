// mint-extension-session — Supabase Edge Function (Deno)
// AUTH-EXT-003: mints a one-time magiclink token_hash for the calling user.
// The dashboard's ExtensionLinkPage invokes this with the user's JWT and hands
// the returned token_hash to the Chrome extension, which redeems it at
// /auth/v1/verify to create a session of its own — an independent
// refresh-token family, so dashboard and extension token rotations can never
// revoke each other.
//
// The target user is always derived from the verified JWT; the function
// accepts no email or user parameter, so it cannot mint a session for anyone
// but the caller. No email is sent — generateLink only returns the hash.
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

  // ── Mint the one-time token for the caller's own account ─────────
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: linkData, error: linkError } = await serviceClient.auth.admin.generateLink({
    type: 'magiclink',
    email: user.email,
  });

  const tokenHash = linkData?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    return json({ error: 'mint_failed', detail: linkError?.message ?? 'no token issued' }, 500);
  }

  return json({ token_hash: tokenHash }, 200);
});
