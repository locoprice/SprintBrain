// Supabase client — single instance shared across the dashboard.
//
// The anon key is safe to embed in browser bundles: it only grants access
// subject to RLS policies. RLS is the real security layer (see PROJECT_CONTEXT §10).
// This mirrors how the Chrome extension hardcodes the same key in background.js.

import { createClient, type Session, type User } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://eyowustlbqujaimaxggt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_F_8LSMkr9ZK-9v50sPzXbQ_zjA0D_O0';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'sb-sprintbrain-auth',
    flowType: 'pkce',
  },
});

export type { Session, User };
