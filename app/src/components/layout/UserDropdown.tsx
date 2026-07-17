import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { pickHttpsUrl } from '@/lib/branding';
import { useAuthStore } from '@/stores/authStore';

function deriveDisplayName(
  metadata: Record<string, unknown> | undefined,
  email: string | undefined,
): string {
  const name = metadata?.['full_name'] ?? metadata?.['name'];
  if (typeof name === 'string' && name.trim()) return name;
  if (email) return email.split('@')[0] ?? email;
  return 'Account';
}

export function UserDropdown() {
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const email = user?.email ?? '';
  const displayName = deriveDisplayName(user?.user_metadata, email);
  const initial = displayName.slice(0, 1).toUpperCase();
  const avatarUrl = pickHttpsUrl(user?.user_metadata, 'avatar_url');

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
      setOpen(false);
    }
  }

  function handleNavigate(path: string) {
    navigate(path);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Account menu"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-8 w-8 items-center justify-center overflow-hidden rounded-full text-xs font-bold',
          'bg-primary-light text-primary transition-colors',
          'hover:bg-primary hover:text-white',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          open && 'bg-primary text-white',
        )}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" draggable={false} className="h-full w-full object-cover" />
        ) : (
          initial
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            'absolute right-0 top-full z-40 mt-2 w-[220px]',
            'rounded-[12px] border border-line bg-card shadow-md',
            'animate-fade-in',
          )}
        >
          {/* Identity header */}
          <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                draggable={false}
                className="h-8 w-8 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-light text-xs font-bold text-primary">
                {initial}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{displayName}</p>
              <p className="truncate text-xs text-ink-muted">{email}</p>
            </div>
          </div>

          {/* Navigation */}
          <div className="p-1.5">
            <button
              role="menuitem"
              type="button"
              onClick={() => handleNavigate('/settings')}
              className="flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2 text-sm font-medium text-ink hover:bg-bg-alt"
            >
              <Settings className="h-4 w-4 text-ink-muted" />
              Settings
            </button>
          </div>

          {/* Destructive actions */}
          <div className="border-t border-line p-1.5">
            <button
              role="menuitem"
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2 text-sm font-medium text-ink hover:bg-bg-alt disabled:opacity-50"
            >
              <LogOut className="h-4 w-4 text-ink-muted" />
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
