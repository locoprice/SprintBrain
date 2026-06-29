import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, Link, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, MailCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { analytics } from '@/lib/analytics';
import { checkRateLimit } from '@/lib/rateLimiter';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { AuthBrandPanel } from '@/components/auth/AuthBrandPanel';
import { ErrorBanner } from '@/components/auth/ErrorBanner';
import { OtpInput, OTP_LENGTH } from '@/components/auth/OtpInput';

type LoginView = 'email' | 'sent' | 'password' | 'recovery' | 'recovery_sent';

const TERMS_URL = 'https://sprintbrain.com/legal/terms-and-conditions.html';
const PRIVACY_URL = 'https://sprintbrain.com/legal/privacy-policy.html';

export function LoginPage() {
  const status = useAuthStore((s) => s.status);
  const init = useAuthStore((s) => s.init);
  const [params] = useSearchParams();

  const [view, setView] = useState<LoginView>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void init();
  }, [init]);

  const next = params.get('next') || '/';

  if (status === 'authed') {
    // Phones land here from a magic link — hand them to the mobile companion.
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 1023px)').matches
    ) {
      window.location.replace('/mobile/');
      return null;
    }
    return <Navigate to={next} replace />;
  }

  // Neutral spinner while the session check is in flight, so already-authed
  // users never flash the form before redirect.
  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg-alt">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  function goTo(nextView: LoginView) {
    setError(null);
    setView(nextView);
  }

  async function onMagicLink(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();

    const { allowed } = checkRateLimit(`magic:${trimmed}`);
    if (!allowed) {
      setError('Too many requests — please wait a few minutes and try again.');
      return;
    }

    analytics.track('auth_method_selected', { method: 'magic_link' });
    setLoading(true);
    setError(null);

    const { error: err } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    if (err) {
      analytics.track('auth_failed', { method: 'magic_link', error: err.message });
      setError(err.message);
    } else {
      analytics.track('magic_link_sent', { email: trimmed });
      goTo('sent');
    }
    setLoading(false);
  }

  async function onVerifyOtp(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    const token = otpCode.replace(/\s/g, '');

    setLoading(true);
    setError(null);

    const { error: err } = await supabase.auth.verifyOtp({
      email: trimmed,
      token,
      type: 'email',
    });

    if (err) {
      analytics.track('auth_failed', { method: 'otp_code', error: err.message });
      setError(
        err.message.toLowerCase().includes('expired') ||
          err.message.toLowerCase().includes('invalid')
          ? 'That code is incorrect or has expired. Request a new one.'
          : err.message,
      );
      setLoading(false);
    } else {
      analytics.track('login_completed');
    }
    // On success onAuthStateChange flips status → 'authed' → redirect above.
  }

  async function onPassword(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();

    const { allowed } = checkRateLimit(`password:${trimmed}`);
    if (!allowed) {
      setError('Too many requests — please wait a few minutes and try again.');
      return;
    }

    analytics.track('auth_method_selected', { method: 'password' });
    setLoading(true);
    setError(null);

    const { error: err } = await supabase.auth.signInWithPassword({
      email: trimmed,
      password,
    });

    if (err) {
      analytics.track('auth_failed', { method: 'password', error: err.message });
      setError(
        err.message === 'Invalid login credentials'
          ? 'Incorrect email or password. Try an email magic link instead.'
          : err.message,
      );
      setLoading(false);
    } else {
      analytics.track('login_completed');
    }
    // On success onAuthStateChange flips status → 'authed' → redirect above.
  }

  async function onRecovery(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();

    const { allowed } = checkRateLimit(`recovery:${trimmed}`);
    if (!allowed) {
      setError('Too many requests — please wait a few minutes and try again.');
      return;
    }

    // Recover via a passwordless sign-in link, consistent with magic-link-first auth.
    analytics.track('password_recovery_started', { email: trimmed });
    setLoading(true);
    setError(null);

    const { error: err } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    if (err) {
      setError(err.message);
    } else {
      goTo('recovery_sent');
    }
    setLoading(false);
  }

  return (
    <div className="flex min-h-dvh">
      <AuthBrandPanel />

      <main className="flex flex-1 flex-col items-center justify-center bg-card px-6 py-12">
        {/* Mobile logo — shown only when the brand panel is hidden */}
        <div className="mb-8 flex items-center gap-2 lg:hidden">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-primary text-[15px] font-extrabold text-white">
            S
          </div>
          <span className="text-[16px] font-bold tracking-tight text-ink">
            SprintBrain
          </span>
        </div>

        <div key={view} className="w-full max-w-[400px] animate-fade-in">
          {/* ── Email (magic link) ─────────────────────────────────────── */}
          {view === 'email' && (
            <form onSubmit={onMagicLink} noValidate className="space-y-5">
              <div className="space-y-1.5">
                <h1 className="text-[26px] font-bold tracking-tight text-ink">
                  Welcome back
                </h1>
                <p className="text-sm text-ink-muted">
                  Enter your email. We'll send a sign-in link and a one-time code.
                </p>
              </div>

              <div className="space-y-3">
                <Input
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoFocus
                  required
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  className="min-h-[46px]"
                />
                {error && <ErrorBanner message={error} />}
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  className="w-full"
                  disabled={loading || !email.trim()}
                >
                  {loading ? 'Sending…' : 'Continue →'}
                </Button>
              </div>

              <button
                type="button"
                onClick={() => goTo('password')}
                className="block w-full text-center text-sm text-ink-muted underline-offset-2 hover:underline"
              >
                Use password instead
              </button>

              <p className="text-center text-[11px] text-ink-subtle">
                By continuing you agree to our{' '}
                <a
                  href={TERMS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline-offset-2 hover:underline"
                >
                  Terms of Service
                </a>{' '}
                and{' '}
                <a
                  href={PRIVACY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline-offset-2 hover:underline"
                >
                  Privacy Policy
                </a>
                .
              </p>

              <p className="text-center text-sm text-ink-muted">
                New to SprintBrain?{' '}
                <Link
                  to="/signup"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  Create an account
                </Link>
              </p>
            </form>
          )}

          {/* ── OTP verification ───────────────────────────────────────── */}
          {view === 'sent' && (
            <form onSubmit={onVerifyOtp} noValidate className="space-y-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-light text-primary">
                <MailCheck className="h-6 w-6" aria-hidden="true" />
              </div>

              <div className="space-y-1.5">
                <h1 className="text-[26px] font-bold tracking-tight text-ink">
                  Check your email
                </h1>
                <p className="text-sm text-ink-muted">
                  Enter the 8-digit code we sent to{' '}
                  <span className="font-medium text-ink">{email}</span>.
                </p>
              </div>

              <div className="space-y-4">
                <OtpInput value={otpCode} onChange={setOtpCode} disabled={loading} />
                {error && <ErrorBanner message={error} />}
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  className="w-full"
                  disabled={loading || otpCode.replace(/\s/g, '').length < OTP_LENGTH}
                >
                  {loading ? 'Verifying…' : 'Continue →'}
                </Button>
              </div>

              <div className="space-y-1.5 text-center text-xs text-ink-subtle">
                <p>
                  Or{' '}
                  <span className="font-medium text-ink">click the link in the email</span>{' '}
                  to sign in instantly.
                </p>
                <p>
                  Wrong email?{' '}
                  <button
                    type="button"
                    className="font-medium text-primary underline-offset-2 hover:underline"
                    onClick={() => goTo('email')}
                  >
                    Try a different address
                  </button>
                  {' · '}
                  Check your spam folder.
                </p>
              </div>
            </form>
          )}

          {/* ── Password sign-in ───────────────────────────────────────── */}
          {view === 'password' && (
            <form onSubmit={onPassword} noValidate className="space-y-5">
              <div className="space-y-1.5">
                <h1 className="text-[26px] font-bold tracking-tight text-ink">
                  Sign in with password
                </h1>
                <p className="text-sm text-ink-muted">
                  Enter your email and password to continue.
                </p>
              </div>

              <div className="space-y-3">
                <Input
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoFocus
                  required
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  className="min-h-[46px]"
                />

                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    minLength={8}
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    className="min-h-[46px] pr-12"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>

                {error && <ErrorBanner message={error} />}
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  className="w-full"
                  disabled={loading || !email.trim() || !password}
                >
                  {loading ? 'Signing in…' : 'Sign in →'}
                </Button>
              </div>

              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  className="text-ink-muted underline-offset-2 hover:underline"
                  onClick={() => goTo('recovery')}
                >
                  Forgot password?
                </button>
                <button
                  type="button"
                  className="text-ink-muted underline-offset-2 hover:underline"
                  onClick={() => goTo('email')}
                >
                  Use magic link
                </button>
              </div>
            </form>
          )}

          {/* ── Recovery (passwordless link) ───────────────────────────── */}
          {view === 'recovery' && (
            <form onSubmit={onRecovery} noValidate className="space-y-5">
              <div className="space-y-1.5">
                <h1 className="text-[26px] font-bold tracking-tight text-ink">
                  Sign in with a link
                </h1>
                <p className="text-sm text-ink-muted">
                  Enter your email and we'll send a sign-in link.
                </p>
              </div>

              <div className="space-y-3">
                <Input
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoFocus
                  required
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  className="min-h-[46px]"
                />
                {error && <ErrorBanner message={error} />}
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  className="w-full"
                  disabled={loading || !email.trim()}
                >
                  {loading ? 'Sending…' : 'Send link →'}
                </Button>
              </div>

              <button
                type="button"
                className="block w-full text-center text-sm text-ink-muted underline-offset-2 hover:underline"
                onClick={() => goTo('password')}
              >
                Back to sign in
              </button>
            </form>
          )}

          {/* ── Recovery sent ──────────────────────────────────────────── */}
          {view === 'recovery_sent' && (
            <div className="space-y-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-light text-primary">
                <MailCheck className="h-6 w-6" aria-hidden="true" />
              </div>

              <div className="space-y-1.5">
                <h1 className="text-[26px] font-bold tracking-tight text-ink">
                  Access link sent
                </h1>
                <p className="text-sm text-ink-muted">
                  We sent a sign-in link to{' '}
                  <span className="font-medium text-ink">{email}</span>. Click it to
                  regain access.
                </p>
              </div>

              <button
                type="button"
                className="block w-full text-center text-sm font-medium text-primary underline-offset-2 hover:underline"
                onClick={() => goTo('email')}
              >
                Back to sign in
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
