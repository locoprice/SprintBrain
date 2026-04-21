import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { MailCheck, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Phase = 'idle' | 'sending' | 'sent' | 'error';

const DOMAIN_RE = /^[^@\s]+@leibtour\.com$/i;

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

  // If an authed user lands here (e.g. via the back button), bounce them home.
  if (status === 'authed') {
    return <Navigate to="/" replace />;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMsg(null);

    const trimmed = email.trim();
    if (!DOMAIN_RE.test(trimmed)) {
      setErrorMsg('Only @leibtour.com addresses can access SprintBrain.');
      setPhase('error');
      return;
    }

    setPhase('sending');
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) {
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
    <div className="flex min-h-screen items-center justify-center bg-bg-alt p-6">
      <div className="w-full max-w-md rounded-[16px] border border-line bg-card p-10 shadow-sm">
        {/* Brand */}
        <div className="mb-8 flex items-center gap-2.5">
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
            <div className="space-y-1.5">
              <h1 className="text-xl font-bold tracking-tight text-ink">
                Sign in to SprintBrain
              </h1>
              <p className="text-sm text-ink-muted">
                Enter your <span className="font-medium">@leibtour.com</span>{' '}
                email and we will send you a sign-in link.
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
                autoFocus
                required
                placeholder="you@leibtour.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (phase === 'error') setPhase('idle');
                }}
                disabled={phase === 'sending'}
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
              size="md"
              className="w-full"
              disabled={phase === 'sending'}
            >
              {phase === 'sending' ? 'Sending…' : 'Send magic link'}
            </Button>
          </form>
        )}

        <div className="mt-8 border-t border-line pt-5 text-center text-xs text-ink-subtle">
          Not a LeibTour team member?{' '}
          <a
            href="/landing/"
            className="font-medium text-primary hover:underline"
          >
            Learn more about SprintBrain
          </a>
        </div>
      </div>
    </div>
  );
}
