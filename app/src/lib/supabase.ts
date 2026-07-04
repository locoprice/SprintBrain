// Supabase client — single instance shared across the dashboard.
//
// The anon key is safe to embed in browser bundles: it only grants access
// subject to RLS policies. RLS is the real security layer (see PROJECT_CONTEXT §10).
// This mirrors how the Chrome extension hardcodes the same key in background.js.

import { createClient, type Session, type User } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://eyowustlbqujaimaxggt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_F_8LSMkr9ZK-9v50sPzXbQ_zjA0D_O0';

// "Remember me" — chosen on the login page before each sign-in. '0' routes the
// session to sessionStorage (cleared when the browser closes); any other value,
// including no flag at all, keeps the pre-existing localStorage persistence.
// The flag holds no secrets.
const REMEMBER_KEY = 'sb-sprintbrain-remember';

export function setRememberMe(remember: boolean): void {
  try {
    window.localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0');
  } catch (err) {
    console.warn('supabase: could not save remember-me flag', err);
  }
}

export function clearRememberMe(): void {
  try {
    window.localStorage.removeItem(REMEMBER_KEY);
  } catch {
    // Storage unavailable — nothing to clean up.
  }
}

function isPersistent(): boolean {
  try {
    return window.localStorage.getItem(REMEMBER_KEY) !== '0';
  } catch {
    return true;
  }
}

// Routes the session to localStorage (remembered) or sessionStorage
// (session-only) at write time, keeping exactly one copy. PKCE code verifiers
// always persist: the magic-link email opens in a new tab, whose
// sessionStorage starts empty. getItem falls back to localStorage so sessions
// stored before this adapter shipped keep working.
const rememberAwareStorage = {
  getItem(key: string): string | null {
    try {
      return window.sessionStorage.getItem(key) ?? window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      if (isPersistent() || key.endsWith('-code-verifier')) {
        window.localStorage.setItem(key, value);
        window.sessionStorage.removeItem(key);
      } else {
        window.sessionStorage.setItem(key, value);
        window.localStorage.removeItem(key);
      }
    } catch (err) {
      console.warn('supabase: session write failed', err);
    }
  },
  removeItem(key: string): void {
    try {
      window.sessionStorage.removeItem(key);
      window.localStorage.removeItem(key);
    } catch (err) {
      console.warn('supabase: session cleanup failed', err);
    }
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'sb-sprintbrain-auth',
    storage: rememberAwareStorage,
    flowType: 'pkce',
  },
});

export type { Session, User };
