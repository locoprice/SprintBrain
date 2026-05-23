import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
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

// ─── Brand icons (inlined SVG — no external deps) ─────────────────────────────

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0"
      aria-hidden="true"
      fill="currentColor"
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0"
      aria-hidden="true"
      fill="currentColor"
    >
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11" />
    </svg>
  );
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

function OrDivider() {
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1 bg-line" />
      <span className="text-xs font-medium text-ink-subtle">or</span>
      <div className="h-px flex-1 bg-line" />
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

function LandingView({
  loading,
  error,
  onGoTo,
  onSocialAuth,
}: BaseViewProps & {
  onSocialAuth: (provider: 'google' | 'github' | 'apple') => void;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-[22px] font-bold tracking-tight text-ink">
          Continue to SprintBrain
        </h2>
        <p className="text-sm text-ink-muted">Sign up or log in to your account</p>
      </div>

      <div className="space-y-2.5">
        <SocialButton
          icon={<GoogleIcon />}
          label="Continue with Google"
          onClick={() => onSocialAuth('google')}
          disabled={loading}
        />
        <SocialButton
          icon={<GitHubIcon />}
          label="Continue with GitHub"
          onClick={() => onSocialAuth('github')}
          disabled={loading}
        />
        <SocialButton
          icon={<AppleIcon />}
          label="Continue with Apple"
          onClick={() => onSocialAuth('apple')}
          disabled={loading}
        />
      </div>

      <OrDivider />

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
          We'll send you a passwordless sign-in link.
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
        {loading ? 'Sending…' : 'Send magic link →'}
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
          We emailed you a secure sign-in link.
        </h2>
        <p className="text-sm text-ink-muted">
          Click the link in the email we sent to{' '}
          <span className="font-medium text-ink">{email}</span>. It expires in
          1 hour.
        </p>
      </div>

      <p className="text-xs text-ink-subtle">
        Wrong email?{' '}
        <button
          type="button"
          className="font-medium text-primary underline-offset-2 hover:underline"
          onClick={() => onGoTo('email')}
        >
          Try again
        </button>
        {' · '}
        Not there? Check your spam folder.
      </p>
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
          Use Google or magic link
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

const VIEWS_WITH_BACK: AuthModalView[] = ['email', 'password', 'recovery'];

function backDestination(view: AuthModalView): AuthModalView {
  if (view === 'email' || view === 'password') return 'landing';
  if (view === 'recovery') return 'password';
  return 'landing';
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export function AuthModal({ isOpen, onClose, initialView }: AuthModalProps) {
  const status = useAuthStore((s) => s.status);

  const [view, setView] = useState<AuthModalView>(initialView);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset all state each time the modal opens
  useEffect(() => {
    if (isOpen) {
      setView(initialView);
      setEmail('');
      setPassword('');
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

  async function onSocialAuth(provider: 'google' | 'github' | 'apple') {
    analytics.track('auth_method_selected', { method: provider });
    analytics.track('signup_started', { method: provider });
    setLoading(true);
    setError(null);

    const { error: err } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });

    if (err) {
      analytics.track('auth_failed', { method: provider, error: err.message });
      setError(err.message);
      setLoading(false);
    }
    // On success the browser navigates to the OAuth provider — loading stays true.
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
            'fixed left-1/2 top-1/2 z-50 w-full max-w-[440px]',
            '-translate-x-1/2 -translate-y-1/2',
            'rounded-[20px] border border-line bg-card p-7 shadow-md',
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
                onSocialAuth={onSocialAuth}
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
            {view === 'sent' && <SentView email={email} onGoTo={goTo} />}
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
