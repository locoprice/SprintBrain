import { useState, useRef, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Briefcase,
  Bug,
  FlaskConical,
  Github,
  LogOut,
  PlayCircle,
  Settings,
  Sparkles,
  Type,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { RESOURCE_LINKS } from '@/lib/links';
import { useAuthStore } from '@/stores/authStore';
import { useSnippetStore } from '@/stores/snippetStore';
import { usePromptStore } from '@/stores/promptStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUiStore } from '@/stores/uiStore';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Type;
  end?: boolean;
  /** When provided, renders a count pill — filled (primary) when active, muted otherwise. */
  count?: number;
}

function navClass({ isActive }: { isActive: boolean }): string {
  return cn(
    'group relative flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm font-medium transition-colors',
    "before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-[3px] before:content-['']",
    isActive
      ? 'bg-primary-light text-primary before:bg-primary'
      : 'text-ink-muted before:bg-transparent hover:bg-bg-alt hover:text-ink',
  );
}

/** Filled count pill (active) or muted bg-alt pill (inactive). Used on nav rows. */
function NavCountPill({ count, active }: { count: number; active: boolean }) {
  return (
    <span
      className={cn(
        'ml-auto inline-flex min-w-[20px] items-center justify-center rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums',
        active ? 'bg-primary text-white' : 'bg-bg-alt text-ink-subtle',
      )}
    >
      {count}
    </span>
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

const MENU_ITEM =
  'flex w-full items-center gap-3 px-3 py-2.5 text-sm text-white transition-colors hover:bg-white/[0.06] disabled:opacity-50';

export function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const snippetCount = useSnippetStore((s) => s.snippets.length);
  const promptCount = usePromptStore((s) => s.prompts.length);
  const sharedFolderCount = useSnippetStore((s) => s.folderShares.size);
  const companyLogoUrl = useSettingsStore((s) => s.profile?.company_logo_url ?? null);
  const openOnboarding = useUiStore((s) => s.openOnboarding);
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();

  const email = user?.email ?? '';
  const displayName = pickDisplayName(user?.user_metadata, email);
  const initial = displayName.slice(0, 1).toUpperCase();

  const PRIMARY: NavItem[] = [
    { to: '/', label: 'Snippets', icon: Type, end: true, count: snippetCount },
    { to: '/prompts', label: 'Prompts', icon: Sparkles, count: promptCount },
    { to: '/team', label: 'Team', icon: Users, count: sharedFolderCount },
    { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  ];

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
    } finally {
      setSigningOut(false);
      setMenuOpen(false);
    }
  }

  function onSettings() {
    setMenuOpen(false);
    navigate('/settings');
  }

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-line bg-bg-alt">
      <nav className="shrink-0 px-3 pt-5 pb-4">
        <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
          Workspace
        </div>
        <div className="flex flex-col gap-0.5">
          {PRIMARY.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
              {({ isActive }) => (
                <>
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                  {typeof item.count === 'number' && item.count > 0 ? (
                    <NavCountPill count={item.count} active={isActive} />
                  ) : null}
                </>
              )}
            </NavLink>
          ))}

          {/* Composer lives in the native dashboard (Sprintbrain.html) on the shared
              formula engine — link out rather than duplicate it into React. */}
          <a
            href="/Sprintbrain.html#composer"
            target="_blank"
            rel="noopener noreferrer"
            className={navClass({ isActive: false })}
          >
            <FlaskConical className="h-4 w-4" />
            <span>Composer</span>
            <ArrowUpRight className="ml-auto h-3.5 w-3.5 text-ink-subtle" />
          </a>

          {/* Getting Started — replays the onboarding animation on demand */}
          <button
            type="button"
            onClick={openOnboarding}
            className={cn(navClass({ isActive: false }), 'w-full text-left')}
          >
            <PlayCircle className="h-4 w-4" />
            <span>Getting Started</span>
          </button>
        </div>
      </nav>

      {/* Company watermark — the user's own logo (Settings → Company branding).
          The flex-1 spacer stays even when no logo is set. */}
      <div className="flex flex-1 items-center justify-center">
        {companyLogoUrl && (
          <img
            src={companyLogoUrl}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="w-24 select-none opacity-[0.10] grayscale"
          />
        )}
      </div>

      {/* User block — click to open menu */}
      <div ref={menuRef} className="relative border-t border-line p-3">
        {menuOpen && (
          <div className="absolute bottom-full left-3 right-3 mb-2 overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#1C1C1E] shadow-[0_8px_32px_rgba(0,0,0,0.45)]">
            {/* Email header */}
            <div className="px-3 py-2.5 text-xs text-[#8E8E93]">{email}</div>

            {/* Settings */}
            <div className="border-t border-white/[0.08]">
              <button type="button" onClick={onSettings} className={MENU_ITEM}>
                <Settings className="h-4 w-4 text-[#8E8E93]" />
                Settings
              </button>
            </div>

            {/* Resource links */}
            <div className="border-t border-white/[0.08]">
              {RESOURCE_LINKS.investors && (
                <a
                  href={RESOURCE_LINKS.investors}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMenuOpen(false)}
                  className={MENU_ITEM}
                >
                  <Briefcase className="h-4 w-4 text-[#8E8E93]" />
                  Investor relations
                  <ArrowUpRight className="ml-auto h-3.5 w-3.5 text-[#9B9BA1]" />
                </a>
              )}
              {RESOURCE_LINKS.bugs && (
                <a
                  href={RESOURCE_LINKS.bugs}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMenuOpen(false)}
                  className={MENU_ITEM}
                >
                  <Bug className="h-4 w-4 text-[#8E8E93]" />
                  Report a bug
                  <ArrowUpRight className="ml-auto h-3.5 w-3.5 text-[#9B9BA1]" />
                </a>
              )}
              {RESOURCE_LINKS.github && (
                <a
                  href={RESOURCE_LINKS.github}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMenuOpen(false)}
                  className={MENU_ITEM}
                >
                  <Github className="h-4 w-4 text-[#8E8E93]" />
                  GitHub
                  <ArrowUpRight className="ml-auto h-3.5 w-3.5 text-[#9B9BA1]" />
                </a>
              )}
              {RESOURCE_LINKS.status && (
                <a
                  href={RESOURCE_LINKS.status}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMenuOpen(false)}
                  className={MENU_ITEM}
                >
                  <Activity className="h-4 w-4 text-[#8E8E93]" />
                  System status
                  <ArrowUpRight className="ml-auto h-3.5 w-3.5 text-[#9B9BA1]" />
                </a>
              )}
            </div>

            {/* Sign out */}
            <div className="border-t border-white/[0.08]">
              <button
                type="button"
                onClick={onSignOut}
                disabled={signingOut}
                className={MENU_ITEM}
              >
                <LogOut className="h-4 w-4 text-[#8E8E93]" />
                {signingOut ? 'Signing out…' : 'Log out'}
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          className="flex w-full items-center gap-3 rounded-[10px] p-2 text-left hover:bg-card"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-light text-xs font-bold text-primary">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-ink">{displayName}</div>
            <div className="truncate text-xs text-ink-subtle">{email}</div>
          </div>
        </button>
      </div>
    </aside>
  );
}
