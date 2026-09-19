import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authErrorMessage,
  callbackErrorCode,
  googleRedirectUrl,
  loginErrorPath,
} from '@/lib/authCallback';
import { isAuthProviderEnabled } from '@/lib/supabase';

// Only isAuthProviderEnabled is used from the client module; no real client.
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }));

// The /auth/callback round trip for Google sign-in and email links: where
// Google sends the browser back, how a failed return is classified, and how
// /login turns the code into wording it owns. Plus the pre-flight check that
// keeps a switched-off provider from showing Supabase's raw error page.

describe('isAuthProviderEnabled', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubSettings(response: Response | Error) {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response))),
    );
  }

  it('is false only when Supabase says the provider is off', async () => {
    stubSettings(new Response(JSON.stringify({ external: { google: false, email: true } })));
    expect(await isAuthProviderEnabled('google')).toBe(false);
  });

  it('is true when the provider is on', async () => {
    stubSettings(new Response(JSON.stringify({ external: { google: true } })));
    expect(await isAuthProviderEnabled('google')).toBe(true);
  });

  it('fails open on an error status, a network failure or an unexpected body', async () => {
    stubSettings(new Response('nope', { status: 503 }));
    expect(await isAuthProviderEnabled('google')).toBe(true);
    stubSettings(new Error('offline'));
    expect(await isAuthProviderEnabled('google')).toBe(true);
    stubSettings(new Response('{}'));
    expect(await isAuthProviderEnabled('google')).toBe(true);
  });
});

describe('googleRedirectUrl', () => {
  it('returns to /auth/callback marked as a Google sign-in', () => {
    expect(googleRedirectUrl('https://app.sprintbrain.com', '/')).toBe(
      'https://app.sprintbrain.com/auth/callback?provider=google',
    );
  });

  it('carries a deep link through the round trip', () => {
    const url = new URL(googleRedirectUrl('https://app.sprintbrain.com', '/invite?org=1'));
    expect(url.pathname).toBe('/auth/callback');
    expect(url.searchParams.get('provider')).toBe('google');
    expect(url.searchParams.get('next')).toBe('/invite?org=1');
  });
});

describe('callbackErrorCode', () => {
  it('is null on a clean return', () => {
    expect(callbackErrorCode('?provider=google&code=abc', '', 'google')).toBeNull();
    expect(callbackErrorCode('?code=abc', '', null)).toBeNull();
  });

  it('reads a cancelled Google consent screen from the query string (PKCE)', () => {
    expect(
      callbackErrorCode('?provider=google&error=access_denied&error_description=', '', 'google'),
    ).toBe('google_cancelled');
  });

  it('reads the same error from the hash', () => {
    expect(callbackErrorCode('?provider=google', '#error=access_denied', 'google')).toBe(
      'google_cancelled',
    );
  });

  it('treats any other Google error as a failure', () => {
    expect(
      callbackErrorCode(
        '?provider=google&error=server_error&error_description=Unable+to+exchange+external+code',
        '',
        'google',
      ),
    ).toBe('google_failed');
  });

  it('keeps email-link errors on the expired-link message', () => {
    expect(
      callbackErrorCode(
        '',
        '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
        null,
      ),
    ).toBe('link_expired');
  });
});

describe('loginErrorPath', () => {
  it('sends the code to /login', () => {
    expect(loginErrorPath('google_cancelled', '/')).toBe('/login?error=google_cancelled');
  });

  it('keeps the deep link so a retry still lands there', () => {
    const url = new URL(loginErrorPath('google_failed', '/extension-link'), 'https://x.test');
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('error')).toBe('google_failed');
    expect(url.searchParams.get('next')).toBe('/extension-link');
  });
});

describe('authErrorMessage', () => {
  it('maps each code to its own wording', () => {
    expect(authErrorMessage('google_cancelled')).toMatch(/cancelled/);
    expect(authErrorMessage('google_failed')).toMatch(/didn't finish/);
    expect(authErrorMessage('link_expired')).toMatch(/expired/);
  });

  it('shows nothing for a missing, unknown or crafted code', () => {
    expect(authErrorMessage(null)).toBeNull();
    expect(authErrorMessage('')).toBeNull();
    expect(authErrorMessage('Call this number to recover your account')).toBeNull();
    expect(authErrorMessage('toString')).toBeNull();
  });
});
