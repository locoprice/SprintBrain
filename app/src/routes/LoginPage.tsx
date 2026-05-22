import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { MailCheck, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Phase = 'idle' | 'sending' | 'sent' | 'error';

export function LoginPage() {
  const status = useAuthStore((s) => s.status);
  const init = useAuthStore((s) => s.init);
  const [params] = useSearchParams();

  const [email, setEmail] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(
    params.get('error'),
  );

  useEffect(() => {
    void init();
  }, [init]);

  // Preserve the deep-link the AuthGate stashed on us (e.g. /extension-link).
  // Falls back to "/" when absent so the existing behavior is unchanged.
  const next = params.get('next') || '/';

  // If an authed user lands here (e.g. via the back button), respect ?next=.
  if (status === 'authed') {
    // On mobile viewports the dashboard is inaccessible — hard-redirect to
    // the static /mobile/ companion app. React Router cannot reach /mobile/
    // because it lives outside the SPA route tree.
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 1023px)').matches
    ) {
      window.location.replace('/mobile/');
      return null;
    }
    return <Navigate to={next} replace />;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMsg(null);

    const trimmed = email.trim();
    setPhase('sending');
    try {
      // Forward `next` through the magic link so AuthCallback can land
      // the user on /extension-link (or wherever they came from).
      const callback =
        next === '/'
          ? `${window.location.origin}/auth/callback`
          : `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: { emailRedirectTo: callback },
      });
      if (error) {
        console.error('[SprintBrain] signInWithOtp failed:', error.message, error);
        setErrorMsg(error.message);
        setPhase('error');
      } else {
        setPhase('sent');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unknown error');
      setPhase('error');
    }
  }

  return (
    <div className="flex min-h-dvh flex-col sm:items-center sm:justify-center sm:overflow-y-auto sm:bg-bg-alt sm:px-4 sm:py-8">

      {/* ── Mobile-only: gradient hero ── */}
      <div className="flex flex-1 flex-col bg-gradient-to-br from-primary to-primary-dark px-6 pb-10 pt-16 sm:hidden">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-white/20 text-sm font-extrabold text-white">
            S
          </div>
          <span className="text-base font-bold tracking-tight text-white">
            SprintBrain
          </span>
        </div>
        {phase !== 'sent' && (
          <div className="mt-auto">
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Sign in to SprintBrain
            </h1>
            <p className="mt-2 text-sm text-white/75">
              Enter your email and we'll send you a sign-in link.
            </p>
          </div>
        )}
      </div>

      {/* ── Form card ── */}
      <div className="rounded-t-[24px] bg-card px-6 py-8 sm:w-full sm:max-w-md sm:rounded-[16px] sm:border sm:border-line sm:p-10 sm:shadow-sm">

        {/* Brand — desktop only */}
        <div className="mb-8 hidden items-center gap-2.5 sm:flex">
          <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-primary text-sm font-extrabold text-white">
            S
          </div>
          <span className="text-base font-bold tracking-tight text-ink">
            SprintBrain
          </span>
        </div>

        {phase === 'sent' ? (
          <div className="space-y-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-light text-primary">
              <MailCheck className="h-5 w-5" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-ink">
              Check your inbox
            </h1>
            <p className="text-sm text-ink-muted">
              We just sent a magic link to{' '}
              <span className="font-medium text-ink">{email.trim()}</span>.
              Click the link to sign in. The link expires in 1 hour.
            </p>
            <button
              type="button"
              className="text-xs font-medium text-primary hover:underline"
              onClick={() => {
                setPhase('idle');
                setErrorMsg(null);
              }}
            >
              Wrong email? Try again
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5">
            {/* Heading — desktop only (shown in gradient hero on mobile) */}
            <div className="hidden space-y-1.5 sm:block">
              <h1 className="text-xl font-bold tracking-tight text-ink">
                Sign in to SprintBrain
              </h1>
              <p className="text-sm text-ink-muted">
                Enter your email and we'll send you a sign-in link.
              </p>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="email"
                className="block text-xs font-medium text-ink"
              >
                Work email
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                required
                placeholder="you@company.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (phase === 'error') setPhase('idle');
                }}
                disabled={phase === 'sending'}
                className="min-h-[44px]"
              />
            </div>

            {errorMsg && (
              <div className="flex items-start gap-2 rounded-[10px] border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
              disabled={phase === 'sending'}
            >
              {phase === 'sending' ? 'Sending…' : 'Send magic link'}
            </Button>
          </form>
        )}

        <div className="mt-8 border-t border-line pt-5 text-center text-xs text-ink-subtle">
          New to SprintBrain?{' '}
          <a
            href="/landing/"
            className="font-medium text-primary hover:underline"
          >
            Learn more
          </a>
        </div>
      </div>
    </div>
  );
}
