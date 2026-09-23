import { useEffect, useState } from 'react';
import { supabase, setRememberMe, isAuthProviderEnabled } from '@/lib/supabase';
import { analytics } from '@/lib/analytics';
import { googleRedirectUrl } from '@/lib/authCallback';
import { Button } from '@/components/ui/button';

interface GoogleSignInProps {
  /** Where to land after sign-in; '/' is the dashboard. */
  next: string;
  /** Same meaning as the Remember me checkbox: keep the session after the browser closes. */
  remember: boolean;
  disabled?: boolean;
  onError: (message: string) => void;
}

/**
 * The "or" divider and the Continue with Google button, shared by /login and
 * /signup so the two stay identical. A click leaves for Google; the result
 * comes back through /auth/callback, which handles success, cancel and failure.
 */
export function GoogleSignIn({ next, remember, disabled = false, onError }: GoogleSignInProps) {
  const [redirecting, setRedirecting] = useState(false);

  // The browser's Back button from Google can restore this page from the
  // back-forward cache, still showing "Opening Google".
  useEffect(() => {
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) setRedirecting(false);
    }
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  async function onClick() {
    analytics.track('auth_method_selected', { method: 'google' });
    setRedirecting(true);

    if (!(await isAuthProviderEnabled('google'))) {
      analytics.track('auth_failed', { method: 'google', error: 'provider_disabled' });
      onError("Google sign-in isn't available right now. Continue with your email.");
      setRedirecting(false);
      return;
    }

    // Read by the storage adapter when the session lands on /auth/callback.
    setRememberMe(remember);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: googleRedirectUrl(window.location.origin, next) },
    });

    if (error) {
      analytics.track('auth_failed', { method: 'google', error: error.message });
      onError("Couldn't open Google sign-in. Try again, or continue with your email.");
      setRedirecting(false);
    }
    // On success the browser is already on its way to Google.
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-xs text-ink-subtle">
        <span className="h-px flex-1 bg-line" aria-hidden="true" />
        or
        <span className="h-px flex-1 bg-line" aria-hidden="true" />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="lg"
        className="w-full"
        disabled={disabled || redirecting}
        onClick={() => void onClick()}
      >
        <GoogleMark />
        {redirecting ? 'Opening Google…' : 'Continue with Google'}
      </Button>
    </div>
  );
}

/**
 * Google's standard "G". Its four colours are fixed by Google's branding
 * guidelines, so they are brand artwork rather than design tokens.
 */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-[18px] w-[18px] shrink-0" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
