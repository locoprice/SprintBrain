import { create } from 'zustand';
import { supabase, type Session, type User } from '@/lib/supabase';

/**
 * Auth store — single source of truth for the user's session.
 *
 * The three phases:
 *   - 'loading' : initial mount, we don't know yet whether a session exists
 *   - 'authed'  : a valid session is in memory
 *   - 'anon'    : no session (logged out, never logged in, or token expired)
 *
 * Call `init()` once from the AuthGate to hydrate from localStorage and
 * subscribe to future Supabase auth events.
 */

type Status = 'loading' | 'authed' | 'anon';

interface AuthStore {
  user: User | null;
  session: Session | null;
  status: Status;
  init: () => Promise<void>;
  signOut: () => Promise<void>;
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
    });
  },

  signOut: async () => {
    try {
      await supabase.auth.signOut();
      // onAuthStateChange fires with null session → state updates automatically
    } catch (err) {
      console.warn('authStore: signOut failed', err);
    }
  },
}));
