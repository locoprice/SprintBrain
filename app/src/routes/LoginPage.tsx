import { useEffect, useRef } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useAuthModal } from '@/context/AuthModalContext';

export function LoginPage() {
  const status = useAuthStore((s) => s.status);
  const init = useAuthStore((s) => s.init);
  const { openModal } = useAuthModal();
  const [params] = useSearchParams();

  // Only ever open the modal once per mount, not every time status re-evaluates.
  const hasOpened = useRef(false);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (status === 'anon' && !hasOpened.current) {
      hasOpened.current = true;
      openModal('landing');
    }
  }, [status, openModal]);

  const next = params.get('next') || '/';

  if (status === 'authed') {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 1023px)').matches
    ) {
      window.location.replace('/mobile/');
      return null;
    }
    return <Navigate to={next} replace />;
  }

  // Minimal branded background behind the modal.
  // The "Sign in" button re-opens the modal if the user dismissed it.
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg-alt">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-primary text-sm font-extrabold text-white">
          S
        </div>
        <span className="text-[15px] font-bold tracking-tight text-ink">
          SprintBrain
        </span>
      </div>
      <button
        type="button"
        className="text-sm font-medium text-primary underline-offset-2 hover:underline"
        onClick={() => openModal('landing')}
      >
        Sign in
      </button>
    </div>
  );
}
