import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

/**
 * Wraps the protected dashboard routes. On first mount it hydrates the
 * auth store from persisted storage. While hydrating, it renders a centered
 * spinner so the dashboard chrome never flashes for logged-out users.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const init = useAuthStore((s) => s.init);
  const location = useLocation();

  useEffect(() => {
    void init();
  }, [init]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <div className="flex items-center gap-3 text-sm text-ink-muted">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Checking your session…
        </div>
      </div>
    );
  }

  if (status === 'anon') {
    // Preserve the originally requested path so post-login we land back here
    // (rather than always bouncing to "/"). Required for /extension-link.
    const next = location.pathname + location.search;
    const target = next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login';
    return <Navigate to={target} replace />;
  }

  return <>{children}</>;
}
