import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { AlertCircle, Check, MailCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { analytics } from '@/lib/analytics';
import { checkRateLimit } from '@/lib/rateLimiter';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// ─── OTP input (8 individual digit boxes) ────────────────────────────────────

const OTP_LENGTH = 8;

function OtpInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>(Array(OTP_LENGTH).fill(null));

  function handleChange(i: number, e: React.ChangeEvent<HTMLInputElement>) {
    const digit = e.target.value.replace(/\D/g, '').slice(-1);
    const arr = Array.from({ length: OTP_LENGTH }, (_, j) => value[j] ?? '');
    arr[i] = digit;
    onChange(arr.join(''));
    if (digit && i < OTP_LENGTH - 1) refs.current[i + 1]?.focus();
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const arr = Array.from({ length: OTP_LENGTH }, (_, j) => value[j] ?? '');
      if (arr[i]) {
        arr[i] = '';
        onChange(arr.join(''));
      } else if (i > 0) {
        refs.current[i - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && i > 0) {
      e.preventDefault();
      refs.current[i - 1]?.focus();
    } else if (e.key === 'ArrowRight' && i < OTP_LENGTH - 1) {
      e.preventDefault();
      refs.current[i + 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
    onChange(pasted);
    refs.current[Math.min(pasted.length, OTP_LENGTH - 1)]?.focus();
  }

  return (
    <div className="flex justify-center gap-1.5" onPaste={handlePaste}>
      {Array.from({ length: OTP_LENGTH }, (_, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          pattern="\d"
          maxLength={2}
          autoFocus={i === 0}
          value={value[i] ?? ''}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          disabled={disabled}
          aria-label={`Digit ${i + 1} of ${OTP_LENGTH}`}
          className={cn(
            'h-12 w-10 rounded-[10px] border bg-card text-center',
            'text-lg font-bold text-ink tabular-nums',
            'transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40',
            'disabled:cursor-not-allowed disabled:opacity-50',
            value[i] ? 'border-primary/40' : 'border-line',
          )}
        />
      ))}
    </div>
  );
}

// ─── Error banner ─────────────────────────────────────────────────────────────

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-[10px] border border-danger/30 bg-danger/5 p-3 text-xs text-danger"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

// ─── Left brand panel ─────────────────────────────────────────────────────────

const BRAND_FEATURES = [
  'Smart text expansion with live formula engine',
  'Synced instantly across Chrome and mobile',
  'Works in Gmail, Notion, Slack, and your CRM',
] as const;

function BrandPanel() {
  return (
    <aside
      aria-hidden="true"
      className="hidden lg:flex lg:w-[44%] flex-col justify-between p-12 xl:p-16 bg-gradient-to-b from-primary to-primary-dark"
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-white/20 text-[15px] font-extrabold text-white">
          S
        </div>
        <span className="text-[16px] font-bold tracking-tight text-white">
          SprintBrain
        </span>
      </div>

      {/* Hero copy + feature list */}
      <div className="space-y-8">
        <div className="space-y-4">
          <h2 className="text-4xl font-extrabold leading-[1.05] tracking-tight text-white xl:text-[44px]">
            Type once.<br />
            Use it<br />
            everywhere.
          </h2>
          <p className="text-[15px] leading-relaxed text-white/70">
            The text-expansion tool built for operators who type the same things every day.
          </p>
        </div>

        <ul className="space-y-3" aria-label="Key features">
          {BRAND_FEATURES.map((feature) => (
            <li key={feature} className="flex items-start gap-3 text-sm text-white/85">
              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/20">
                <Check className="h-3 w-3 text-white" aria-hidden="true" />
              </div>
              {feature}
            </li>
          ))}
        </ul>
      </div>

      {/* Footer */}
      <p className="text-[12px] text-white/35">
        © 2026 SprintBrain
      </p>
    </aside>
  );
}

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
      <BrandPanel />

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

              <p className="text-center text-[11px] text-ink-subtle">
                By continuing you agree to our{' '}
                <a
                  href="https://www.sprintbrain.com/legal/terms-and-conditions.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline-offset-2 hover:underline"
                >
                  Terms of Service
                </a>{' '}
                and{' '}
                <a
                  href="https://www.sprintbrain.com/legal/privacy-policy.html"
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
