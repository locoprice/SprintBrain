import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { analytics } from '@/lib/analytics';
import { checkRateLimit } from '@/lib/rateLimiter';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { AuthBrandPanel } from '@/components/auth/AuthBrandPanel';
import { ErrorBanner } from '@/components/auth/ErrorBanner';
import { OtpInput, OTP_LENGTH } from '@/components/auth/OtpInput';
import { RecentSignups } from '@/components/auth/RecentSignups';

// ─── Page ─────────────────────────────────────────────────────────────────────

type SignupView = 'email' | 'sent';

export function SignupPage() {
  const status = useAuthStore((s) => s.status);
  const init = useAuthStore((s) => s.init);

  const [view, setView] = useState<SignupView>('email');
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void init();
  }, [init]);

  // Already-authed users skip the page entirely
  if (status === 'authed') {
    return <Navigate to="/" replace />;
  }

  // Show a neutral spinner while the session check is in flight
  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg-alt">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  async function handleSubmitEmail(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();

    const { allowed } = checkRateLimit(`magic:${trimmed}`);
    if (!allowed) {
      setError('Too many requests — please wait a few minutes and try again.');
      return;
    }

    analytics.track('auth_method_selected', { method: 'magic_link', source: 'signup_page' });
    analytics.track('signup_started', { method: 'magic_link' });
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
      setView('sent');
    }
    setLoading(false);
  }

  async function handleVerifyOtp(e: FormEvent) {
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
        err.message.toLowerCase().includes('expired') || err.message.toLowerCase().includes('invalid')
          ? 'That code is incorrect or has expired. Request a new one.'
          : err.message,
      );
      setLoading(false);
    }
    // On success: onAuthStateChange fires → status becomes 'authed' → Navigate fires above.
  }

  function handleBackToEmail() {
    setView('email');
    setOtpCode('');
    setError(null);
  }

  return (
    <div className="flex min-h-dvh">
      <AuthBrandPanel />

      {/* ── Form panel ──────────────────────────────────────────────────── */}
      <main className="flex flex-1 flex-col items-center justify-center bg-card px-6 py-12">

        {/* Mobile logo — hidden when the brand panel is visible */}
        <div className="mb-8 flex items-center gap-2 lg:hidden">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-primary text-[15px] font-extrabold text-white">
            S
          </div>
          <span className="text-[16px] font-bold tracking-tight text-ink">
            SprintBrain
          </span>
        </div>

        <div key={view} className="w-full max-w-[400px] animate-fade-in">

          {/* ── Step 1: Email ──────────────────────────────────────────── */}
          {view === 'email' && (
            <form onSubmit={handleSubmitEmail} noValidate className="space-y-5">
              <div className="space-y-1.5">
                <h1 className="text-[26px] font-bold tracking-tight text-ink">
                  Create your account
                </h1>
                <p className="text-sm text-ink-muted">
                  Enter your work email. We'll send a sign-in link and a one-time code.
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

              <RecentSignups />

              <p className="text-center text-[11px] text-ink-subtle">
                By continuing you agree to our{' '}
                <a
                  href="https://sprintbrain.com/legal/terms-and-conditions.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline-offset-2 hover:underline"
                >
                  Terms of Service
                </a>{' '}
                and{' '}
                <a
                  href="https://sprintbrain.com/legal/privacy-policy.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline-offset-2 hover:underline"
                >
                  Privacy Policy
                </a>
                .
              </p>

              <p className="text-center text-sm text-ink-muted">
                Already have an account?{' '}
                <Link
                  to="/login"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  Sign in
                </Link>
              </p>
            </form>
          )}

          {/* ── Step 2: OTP verification ───────────────────────────────── */}
          {view === 'sent' && (
            <form onSubmit={handleVerifyOtp} noValidate className="space-y-6">
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
                  <span className="font-medium text-ink">
                    click the link in the email
                  </span>{' '}
                  to sign in instantly.
                </p>
                <p>
                  Wrong email?{' '}
                  <button
                    type="button"
                    className="font-medium text-primary underline-offset-2 hover:underline"
                    onClick={handleBackToEmail}
                  >
                    Try a different address
                  </button>
                  {' · '}
                  Check your spam folder.
                </p>
              </div>
            </form>
          )}

        </div>
      </main>
    </div>
  );
}
