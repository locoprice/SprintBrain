import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

/**
 * The magic link from the email lands here. Supabase SDK auto-detects
 * the token in the URL hash (detectSessionInUrl: true) and persists the
 * session before this component mounts. We just wait briefly for the
 * auth store to pick it up, then bounce to the dashboard.
 */
export function AuthCallback() {
  const status = useAuthStore((s) => s.status);
  const init = useAuthStore((s) => s.init);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [params] = useSearchParams();
  // The `next` query param is preserved by LoginPage when it crafted the
  // magic-link redirectTo. After auth succeeds we land back on the original
  // deep link (e.g. /extension-link) instead of always bouncing to /.
  const next = params.get('next') || '/';

  useEffect(() => {
    // Surface any hash-level error the redirect carries.
    const hash = window.location.hash.replace(/^#/, '');
    const params = new URLSearchParams(hash);
    const err = params.get('error_description') ?? params.get('error');
    if (err) {
      setErrorMsg(err);
      return;
    }

    // Subscribe the auth store to Supabase's onAuthStateChange BEFORE the
    // PKCE exchange completes. Without this the SIGNED_IN event fires into
    // the void and `status` stays 'loading' until the 5s fallback, which
    // bounces the user to /login with a misleading "link expired" error.
    void init();

    // Fallback — if the session doesn't appear within 5s, treat it as a
    // failed callback rather than spinning forever.
    const t = window.setTimeout(() => setTimedOut(true), 5000);
    return () => window.clearTimeout(t);
  }, [init]);

  if (errorMsg) {
    return <Navigate to={`/login?error=${encodeURIComponent(errorMsg)}`} replace />;
  }

  if (status === 'authed') {
    // On mobile viewports the dashboard is inaccessible — redirect to the
    // mobile companion app instead. `next` is dashboard-only so it is ignored.
    if (window.matchMedia('(max-width: 1023px)').matches) {
      window.location.replace('/mobile/');
      return null;
    }
    return <Navigate to={next} replace />;
  }

  if (status === 'anon' || timedOut) {
    return (
      <Navigate
        to="/login?error=Sign-in+link+expired+or+was+already+used"
        replace
      />
    );
  }

  // status === 'loading'
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg">
      <div className="flex items-center gap-3 text-sm text-ink-muted">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        Signing you in…
      </div>
    </div>
  );
}
