import { useState, useRef, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  BarChart3,
  HelpCircle,
  LifeBuoy,
  LogOut,
  MessageSquareText,
  Settings,
  Type,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Type;
  end?: boolean;
}

const PRIMARY: NavItem[] = [
  { to: '/', label: 'Snippets', icon: Type, end: true },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/prompts', label: 'Prompts', icon: MessageSquareText },
  { to: '/settings', label: 'Settings', icon: Settings },
];

const SECONDARY: NavItem[] = [
  { to: '/help', label: 'Help', icon: HelpCircle },
  { to: '/feedback', label: 'Feedback', icon: LifeBuoy },
];

function navClass({ isActive }: { isActive: boolean }): string {
  return cn(
    'flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-primary-light text-primary'
      : 'text-ink-muted hover:bg-bg-alt hover:text-ink',
  );
}

/** Derive a friendly display name from the Supabase user object. */
function pickDisplayName(
  metadata: Record<string, unknown> | undefined,
  email: string | undefined,
): string {
  const name = metadata?.['full_name'] ?? metadata?.['name'];
  if (typeof name === 'string' && name.trim()) return name;
  if (email) return email.split('@')[0] ?? email;
  return 'Account';
}

export function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const email = user?.email ?? '';
  const displayName = pickDisplayName(user?.user_metadata, email);
  const initial = displayName.slice(0, 1).toUpperCase();

  // Close the dropdown on any outside click.
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  async function onSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      // onAuthStateChange flips status to 'anon' → AuthGate redirects to /login.
    } finally {
      setSigningOut(false);
      setMenuOpen(false);
    }
  }

  return (
    <aside className="flex h-screen w-[260px] shrink-0 flex-col border-r border-line bg-card">
      {/* Brand */}
      <div className="flex h-14 items-center gap-2.5 border-b border-line px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-primary text-sm font-extrabold text-white">
          S
        </div>
        <span className="text-[15px] font-bold tracking-tight text-ink">SprintBrain</span>
      </div>

      {/* Primary nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
          Workspace
        </div>
        <div className="flex flex-col gap-0.5">
          {PRIMARY.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </div>

        <div className="mb-1 mt-6 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
          Resources
        </div>
        <div className="flex flex-col gap-0.5">
          {SECONDARY.map((item) => (
            <a
              key={item.to}
              href="#"
              onClick={(e) => e.preventDefault()}
              className={cn(
                'flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm font-medium text-ink-muted hover:bg-bg-alt hover:text-ink',
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </a>
          ))}
        </div>
      </nav>

      {/* User block — click to open sign-out menu */}
      <div ref={menuRef} className="relative border-t border-line p-3">
        {menuOpen && (
          <div className="absolute bottom-full left-3 right-3 mb-2 overflow-hidden rounded-[10px] border border-line bg-card shadow-lg">
            <button
              type="button"
              onClick={onSignOut}
              disabled={signingOut}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-sm font-medium text-ink hover:bg-bg-alt disabled:opacity-50"
            >
              <LogOut className="h-4 w-4 text-ink-muted" />
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          className="flex w-full items-center gap-3 rounded-[10px] p-2 text-left hover:bg-bg-alt"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-light text-xs font-bold text-primary">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-ink">
              {displayName}
            </div>
            <div className="truncate text-xs text-ink-subtle">{email}</div>
          </div>
        </button>
      </div>
    </aside>
  );
}
