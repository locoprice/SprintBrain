import { create } from 'zustand';
import { supabase, clearRememberMe, type Session, type User } from '@/lib/supabase';
import { startSessionHeartbeat, stopSessionHeartbeat } from '@/lib/sessionHeartbeat';

/**
 * Auth store — single source of truth for the user's session.
 *
 * The three phases:
 *   - 'loading' : initial mount, we don't know yet whether a session exists
 *   - 'authed'  : a valid session is in memory
 *   - 'anon'    : no session (logged out, never logged in, or token expired)
 *
 * Call `init()` once from the AuthGate to hydrate from local/session storage
 * and subscribe to future Supabase auth events.
 */

type Status = 'loading' | 'authed' | 'anon';

interface AuthStore {
  user: User | null;
  session: Session | null;
  status: Status;
  init: () => Promise<void>;
  signOut: () => Promise<void>;
  signOutAllDevices: () => Promise<void>;
}

let initialized = false;

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  session: null,
  status: 'loading',

  init: async () => {
    if (initialized) return;
    initialized = true;

    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        console.warn('authStore: getSession failed', error);
        set({ status: 'anon' });
      } else {
        const session = data.session;
        set({
          session,
          user: session?.user ?? null,
          status: session ? 'authed' : 'anon',
        });
        if (session) startSessionHeartbeat();
      }
    } catch (err) {
      console.warn('authStore: init threw', err);
      set({ status: 'anon' });
    }

    supabase.auth.onAuthStateChange((_event, session) => {
      set({
        session,
        user: session?.user ?? null,
        status: session ? 'authed' : 'anon',
      });
      // The heartbeat notices sessions revoked from another device
      // (Settings → Security) before the access token expires.
      if (session) startSessionHeartbeat();
      else stopSessionHeartbeat();
    });
  },

  signOut: async () => {
    try {
      // This browser only. Ending every device's session is an explicit
      // action on Settings → Security (signOutAllDevices).
      await supabase.auth.signOut({ scope: 'local' });
      // onAuthStateChange fires with null session → state updates automatically
    } catch (err) {
      console.warn('authStore: signOut failed', err);
    }
    clearRememberMe();
  },

  signOutAllDevices: async () => {
    try {
      // GoTrue deletes every session server-side; refresh tokens die
      // instantly and other clients converge via the session_alive heartbeat.
      const { error } = await supabase.auth.signOut({ scope: 'global' });
      if (error) throw error;
    } catch (err) {
      console.warn('authStore: global signOut failed, ending local session', err);
      // The revoking browser must always land back at /login, even if the
      // global call failed — a local sign-out clears this session regardless.
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch (localErr) {
        console.warn('authStore: local fallback signOut failed', localErr);
      }
    }
    clearRememberMe();
  },
}));
