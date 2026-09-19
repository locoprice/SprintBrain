// The /auth/callback round trip: where a provider sends the browser back, and
// how a failed return is reported on /login.
//
// Failures travel to /login as a short code, never as free text. The page only
// shows wording it owns, so a crafted link cannot put arbitrary text on the
// sign-in screen.

export type AuthErrorCode = 'google_cancelled' | 'google_failed' | 'link_expired';

const MESSAGES: Record<AuthErrorCode, string> = {
  google_cancelled: 'Google sign-in was cancelled. Try again, or continue with your email.',
  google_failed: "Google sign-in didn't finish. Try again, or continue with your email.",
  link_expired: 'That sign-in link has expired or was already used. Request a new one.',
};

/** The message for a code read from the URL; null for no code or an unknown one. */
export function authErrorMessage(code: string | null): string | null {
  if (!code || !Object.prototype.hasOwnProperty.call(MESSAGES, code)) return null;
  return MESSAGES[code as AuthErrorCode];
}

/**
 * Where Google sends the browser back. `provider` tells the callback which
 * method it is finishing; `next` carries a deep link (extension link, team
 * invite) through the round trip.
 */
export function googleRedirectUrl(origin: string, next: string): string {
  const url = new URL('/auth/callback', origin);
  url.searchParams.set('provider', 'google');
  if (next && next !== '/') url.searchParams.set('next', next);
  return url.toString();
}

/**
 * The error a redirect carries, as a code. GoTrue puts it in the query string
 * on PKCE redirects and in the hash on implicit ones, so both are read.
 * `access_denied` from Google means the person closed or declined the consent
 * screen.
 */
export function callbackErrorCode(
  search: string,
  hash: string,
  provider: string | null,
): AuthErrorCode | null {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  const error = query.get('error') || fragment.get('error');
  const description = query.get('error_description') || fragment.get('error_description');
  if (!error && !description) return null;
  if (provider === 'google') {
    return error === 'access_denied' ? 'google_cancelled' : 'google_failed';
  }
  return 'link_expired';
}

/** /login with the error to show, keeping the deep link the person was headed to. */
export function loginErrorPath(code: AuthErrorCode, next: string): string {
  const params = new URLSearchParams({ error: code });
  if (next && next !== '/') params.set('next', next);
  return `/login?${params.toString()}`;
}
