import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  AlertCircle,
  ArrowLeft,
  Eye,
  EyeOff,
  Mail,
  MailCheck,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { analytics } from '@/lib/analytics';
import { checkRateLimit } from '@/lib/rateLimiter';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// Exported so AuthModalContext can import without circular deps
export type AuthModalView =
  | 'landing'
  | 'email'
  | 'sent'
  | 'password'
  | 'recovery'
  | 'recovery_sent';

export interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialView: AuthModalView;
}

// ─── Reusable sub-components ──────────────────────────────────────────────────

function BrandMark() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-primary text-sm font-extrabold text-white">
        S
      </div>
      <span className="text-[15px] font-bold tracking-tight text-ink">
        SprintBrain
      </span>
    </div>
  );
}


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

interface SocialButtonProps {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

function SocialButton({ icon, label, onClick, disabled }: SocialButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-11 w-full items-center gap-3 rounded-[12px] border border-line bg-card px-4',
        'text-sm font-medium text-ink transition-colors',
        'hover:bg-bg-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        'disabled:pointer-events-none disabled:opacity-50',
      )}
    >
      {icon}
      <span className="flex-1 text-center">{label}</span>
    </button>
  );
}

// ─── View components ──────────────────────────────────────────────────────────

interface BaseViewProps {
  loading: boolean;
  error: string | null;
  onGoTo: (v: AuthModalView) => void;
}

interface WithEmail {
  email: string;
  setEmail: (v: string) => void;
}

interface WithPassword {
  password: string;
  setPassword: (v: string) => void;
}

function LandingView({ loading, error, onGoTo }: BaseViewProps) {
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-[22px] font-bold tracking-tight text-ink">
          Continue to SprintBrain
        </h2>
        <p className="text-sm text-ink-muted">Sign up or log in to your account</p>
      </div>

      <SocialButton
        icon={<Mail className="h-5 w-5 shrink-0" />}
        label="Continue with Email"
        onClick={() => onGoTo('email')}
        disabled={loading}
      />

      {error && <ErrorBanner message={error} />}

      <p className="text-center text-xs text-ink-subtle">
        <button
          type="button"
          className="text-ink-muted underline-offset-2 hover:underline"
          onClick={() => onGoTo('password')}
        >
          Use password instead
        </button>
      </p>
    </div>
  );
}

function EmailView({
  email,
  setEmail,
  loading,
  error,
  onGoTo,
  onMagicLink,
}: BaseViewProps & WithEmail & { onMagicLink: (e: FormEvent) => void }) {
  return (
    <form onSubmit={onMagicLink} className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-[22px] font-bold tracking-tight text-ink">
          Your email address
        </h2>
        <p className="text-sm text-ink-muted">
          We'll email you a sign-in link and a one-time code.
        </p>
      </div>

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
        className="min-h-[44px]"
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

      <p className="text-center text-xs text-ink-subtle">
        <button
          type="button"
          className="text-ink-muted underline-offset-2 hover:underline"
          onClick={() => onGoTo('password')}
        >
          Use password instead
        </button>
      </p>
    </form>
  );
}

function SentView({
  email,
  otpCode,
  setOtpCode,
  loading,
  error,
  onGoTo,
  onVerifyOtp,
}: {
  email: string;
  otpCode: string;
  setOtpCode: (v: string) => void;
  loading: boolean;
  error: string | null;
  onGoTo: (v: AuthModalView) => void;
  onVerifyOtp: (e: FormEvent) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-light text-primary">
        <MailCheck className="h-6 w-6" />
      </div>

      <div className="space-y-1">
        <h2 className="text-[22px] font-bold tracking-tight text-ink">
          Check your email
        </h2>
        <p className="text-sm text-ink-muted">
          Enter the code we sent to{' '}
          <span className="font-medium text-ink">{email}</span>.
        </p>
      </div>

      <form onSubmit={onVerifyOtp} className="space-y-4">
        <OtpCodeInput value={otpCode} onChange={setOtpCode} disabled={loading} />

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
      </form>

      <div className="space-y-1.5 text-center text-xs text-ink-subtle">
        <p>
          Or{' '}
          <span className="font-medium text-ink">click the link in the email</span>
          {' '}to sign in instantly.
        </p>
        <p>
          Wrong email?{' '}
          <button
            type="button"
            className="font-medium text-primary underline-offset-2 hover:underline"
            onClick={() => onGoTo('email')}
          >
            Try a different address
          </button>
          {' · '}
          Check your spam folder.
        </p>
      </div>
    </div>
  );
}

// ─── OTP code input (8 individual digit boxes) ───────────────────────────────

const OTP_LENGTH = 8;

function OtpCodeInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>(Array(OTP_LENGTH).fill(null));

  function handleChange(index: number, e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/\D/g, '');
    const digit = raw.slice(-1);
    const arr = Array.from({ length: OTP_LENGTH }, (_, i) => value[i] ?? '');
    arr[index] = digit;
    onChange(arr.join(''));
    if (digit && index < OTP_LENGTH - 1) inputRefs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const arr = Array.from({ length: OTP_LENGTH }, (_, i) => value[i] ?? '');
      if (arr[index]) {
        arr[index] = '';
        onChange(arr.join(''));
      } else if (index > 0) {
        inputRefs.current[index - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < OTP_LENGTH - 1) {
      e.preventDefault();
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
    onChange(pasted);
    inputRefs.current[Math.min(pasted.length, OTP_LENGTH - 1)]?.focus();
  }

  return (
    <div className="flex justify-center gap-1.5" onPaste={handlePaste}>
      {Array.from({ length: OTP_LENGTH }, (_, i) => (
        <input
          key={i}
          ref={(el) => { inputRefs.current[i] = el; }}
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
            'h-13 w-10 rounded-[10px] border bg-card text-center',
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

function PasswordView({
  email,
  setEmail,
  password,
  setPassword,
  loading,
  error,
  onGoTo,
  onPassword,
}: BaseViewProps &
  WithEmail &
  WithPassword & {
    onPassword: (e: FormEvent) => void;
  }) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form onSubmit={onPassword} className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-[22px] font-bold tracking-tight text-ink">
          Sign in with password
        </h2>
        <p className="text-sm text-ink-muted">
          Enter your email and password to continue.
        </p>
      </div>

      <div className="space-y-2.5">
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
          className="min-h-[44px]"
        />

        <div className="relative">
          <Input
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            minLength={8}
            placeholder="Password (min. 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            className="min-h-[44px] pr-12"
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

      <div className="flex items-center justify-between text-xs">
        <button
          type="button"
          className="text-ink-muted underline-offset-2 hover:underline"
          onClick={() => onGoTo('recovery')}
        >
          Forgot password?
        </button>
        <button
          type="button"
          className="text-ink-muted underline-offset-2 hover:underline"
          onClick={() => onGoTo('landing')}
        >
          Use magic link
        </button>
      </div>
    </form>
  );
}

function RecoveryView({
  email,
  setEmail,
  loading,
  error,
  onRecovery,
}: WithEmail & {
  loading: boolean;
  error: string | null;
  onRecovery: (e: FormEvent) => void;
}) {
  return (
    <form onSubmit={onRecovery} className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-[22px] font-bold tracking-tight text-ink">
          Reset your access
        </h2>
        <p className="text-sm text-ink-muted">
          Enter your email and we'll send you a secure sign-in link.
        </p>
      </div>

      <Input
        type="email"
        autoComplete="email"
        autoCapitalize="none"
        autoFocus
        required
        placeholder="you@company.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={loading}
        className="min-h-[44px]"
      />

      {error && <ErrorBanner message={error} />}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="w-full"
        disabled={loading || !email.trim()}
      >
        {loading ? 'Sending…' : 'Email me a secure access link →'}
      </Button>
    </form>
  );
}

function RecoverySentView({
  email,
  onGoTo,
}: {
  email: string;
  onGoTo: (v: AuthModalView) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-light text-primary">
        <MailCheck className="h-6 w-6" />
      </div>

      <div className="space-y-2">
        <h2 className="text-[22px] font-bold tracking-tight text-ink">
          Access link sent
        </h2>
        <p className="text-sm text-ink-muted">
          We sent a sign-in link to{' '}
          <span className="font-medium text-ink">{email}</span>. Click it to
          instantly regain access.
        </p>
      </div>

      <p className="text-xs text-ink-subtle">
        <button
          type="button"
          className="font-medium text-primary underline-offset-2 hover:underline"
          onClick={() => onGoTo('landing')}
        >
          Back to sign in
        </button>
      </p>
    </div>
  );
}

// ─── Views that display a back button ────────────────────────────────────────

const VIEWS_WITH_BACK: AuthModalView[] = ['email', 'sent', 'password', 'recovery'];

function backDestination(view: AuthModalView): AuthModalView {
  if (view === 'email' || view === 'password') return 'landing';
  if (view === 'sent') return 'email';
  if (view === 'recovery') return 'password';
  return 'landing';
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export function AuthModal({ isOpen, onClose, initialView }: AuthModalProps) {
  const status = useAuthStore((s) => s.status);

  const [view, setView] = useState<AuthModalView>(initialView);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset all state each time the modal opens
  useEffect(() => {
    if (isOpen) {
      setView(initialView);
      setEmail('');
      setPassword('');
      setOtpCode('');
      setLoading(false);
      setError(null);
    }
  }, [isOpen, initialView]);

  // Dismiss modal once a successful auth lands
  useEffect(() => {
    if (status === 'authed' && isOpen) {
      analytics.track('login_completed');
      onClose();
    }
  }, [status, isOpen, onClose]);

  function goTo(next: AuthModalView) {
    setError(null);
    setView(next);
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
      goTo('sent');
    }
    setLoading(false);
  }

  async function onVerifyOtp(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    const token = otpCode.trim();

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
    // On success onAuthStateChange fires → status becomes 'authed' → useEffect closes modal.
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
          ? 'Incorrect email or password. Try Google or an email magic link instead.'
          : err.message,
      );
      setLoading(false);
    }
    // On success onAuthStateChange fires → status becomes 'authed' → useEffect closes modal.
  }

  async function onRecovery(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();

    const { allowed } = checkRateLimit(`recovery:${trimmed}`);
    if (!allowed) {
      setError('Too many requests — please wait a few minutes and try again.');
      return;
    }

    // Send a magic sign-in link (not a password-reset form), consistent with
    // the passwordless-first philosophy.
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

  const showBack = VIEWS_WITH_BACK.includes(view);

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-fade-in" />

        <DialogPrimitive.Content
          className={cn(
            'fixed z-50',
            // Mobile: stretch to screen edges with 16px gutters, anchored near the top
            'inset-x-4 top-[8dvh] max-h-[90dvh] overflow-y-auto',
            // sm+: revert to centered floating card (original desktop behaviour)
            'sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-[440px]',
            'sm:-translate-x-1/2 sm:-translate-y-1/2 sm:overflow-visible',
            'rounded-[20px] border border-line bg-card p-5 sm:p-7 shadow-md',
            'data-[state=open]:animate-fade-in focus:outline-none',
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            Sign in to SprintBrain
          </DialogPrimitive.Title>

          {/* Header row: brand mark + back / close controls */}
          <div className="mb-6 flex items-center justify-between">
            <BrandMark />
            <div className="flex items-center gap-1">
              {showBack && (
                <button
                  type="button"
                  aria-label="Go back"
                  onClick={() => goTo(backDestination(view))}
                  className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-muted hover:bg-bg-alt hover:text-ink"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              <DialogPrimitive.Close
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-muted hover:bg-bg-alt hover:text-ink"
              >
                <X className="h-4 w-4" />
              </DialogPrimitive.Close>
            </div>
          </div>

          {/* View content — key forces remount to replay the fade-in animation */}
          <div key={view} className="animate-fade-in">
            {view === 'landing' && (
              <LandingView
                loading={loading}
                error={error}
                onGoTo={goTo}
              />
            )}
            {view === 'email' && (
              <EmailView
                email={email}
                setEmail={setEmail}
                loading={loading}
                error={error}
                onGoTo={goTo}
                onMagicLink={onMagicLink}
              />
            )}
            {view === 'sent' && (
              <SentView
                email={email}
                otpCode={otpCode}
                setOtpCode={setOtpCode}
                loading={loading}
                error={error}
                onGoTo={goTo}
                onVerifyOtp={onVerifyOtp}
              />
            )}
            {view === 'password' && (
              <PasswordView
                email={email}
                setEmail={setEmail}
                password={password}
                setPassword={setPassword}
                loading={loading}
                error={error}
                onGoTo={goTo}
                onPassword={onPassword}
              />
            )}
            {view === 'recovery' && (
              <RecoveryView
                email={email}
                setEmail={setEmail}
                loading={loading}
                error={error}
                onRecovery={onRecovery}
              />
            )}
            {view === 'recovery_sent' && (
              <RecoverySentView email={email} onGoTo={goTo} />
            )}
          </div>

          {/* Legal footer */}
          <p className="mt-6 text-center text-[11px] text-ink-subtle">
            By continuing, you agree to our{' '}
            <a
              href="/landing/#terms"
              className="underline-offset-2 hover:underline"
            >
              Terms of Service
            </a>{' '}
            and{' '}
            <a
              href="/landing/#privacy"
              className="underline-offset-2 hover:underline"
            >
              Privacy Policy
            </a>
          </p>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
