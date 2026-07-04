import { supabase } from '@/lib/supabase';
import { securityApi } from '@/lib/api/securityApi';

// Session heartbeat — closes the gap between "session revoked server-side"
// (Settings → Security on another device) and "this tab notices". Revocation
// kills the refresh token instantly, but an already-issued access token stays
// valid until expiry; without this check a revoked tab could keep working for
// up to an hour. Runs every 60s while visible, plus on focus/visibility
// (throttled), whenever the auth store holds a session.
//
// Fail-open by design: only an explicit `false` from session_alive() signs
// the tab out (securityApi swallows every error into `true`), so an outage or
// flaky network can never mass-logout users.
//
// Plain module (not a hook): the vitest environment is node, and the auth
// store — not the component tree — owns the session lifecycle.

const CHECK_INTERVAL_MS = 60_000;
const FOCUS_THROTTLE_MS = 15_000;

let intervalId: number | null = null;
let lastCheckAt = 0;
let checking = false;
let sessionDead = false;

/** One liveness check. Exported for tests; production uses start/stop. */
export async function heartbeatTick(): Promise<void> {
  if (checking || sessionDead) return;
  checking = true;
  lastCheckAt = Date.now();
  try {
    const alive = await securityApi.sessionAlive();
    if (!alive && !sessionDead) {
      sessionDead = true;
      stopSessionHeartbeat();
      // The server-side session row is already gone — only local cleanup is
      // possible. AuthGate redirects to /login on the resulting SIGNED_OUT.
      await supabase.auth.signOut({ scope: 'local' });
    }
  } finally {
    checking = false;
  }
}

function onVisible(): void {
  if (document.visibilityState !== 'visible') return;
  if (Date.now() - lastCheckAt < FOCUS_THROTTLE_MS) return;
  void heartbeatTick();
}

export function startSessionHeartbeat(): void {
  // A (re)start means a live session exists again — clear the dead latch
  // before the environment guard so tests can reset module state.
  sessionDead = false;
  if (typeof window === 'undefined' || intervalId !== null) return;
  intervalId = window.setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    void heartbeatTick();
  }, CHECK_INTERVAL_MS);
  window.addEventListener('focus', onVisible);
  document.addEventListener('visibilitychange', onVisible);
}

export function stopSessionHeartbeat(): void {
  if (typeof window === 'undefined' || intervalId === null) return;
  window.clearInterval(intervalId);
  intervalId = null;
  window.removeEventListener('focus', onVisible);
  document.removeEventListener('visibilitychange', onVisible);
}
