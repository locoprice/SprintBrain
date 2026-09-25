import { Fragment, useState, useRef, useEffect, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Brain,
  Briefcase,
  Bug,
  Github,
  Lightbulb,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  PlayCircle,
  Settings,
  Sparkles,
  Type,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { pickHttpsUrl } from '@/lib/branding';
import { RESOURCE_LINKS } from '@/lib/links';
import { JotFormModal } from '@/components/layout/JotFormModal';
import { Separator } from '@/components/ui/separator';
import { Tooltip } from '@/components/ui/tooltip';
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
  /** Renders a hairline above this item, splitting the content trio from the rest. */
  dividerBefore?: boolean;
}

function navClass({ isActive, collapsed }: { isActive: boolean; collapsed: boolean }): string {
  return cn(
    'group relative flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm font-medium transition-colors',
    "before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-[3px] before:content-['']",
    // The rail is too narrow for the label and the count, so they clip rather
    // than unmount: the row keeps its height and no icon moves on toggle.
    collapsed && 'overflow-hidden whitespace-nowrap',
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

/**
 * Collapsed, the sidebar is a rail of icons, so each one names itself on hover.
 * Expanded, the label is already on screen and the row renders bare.
 */
function RailTooltip({
  collapsed,
  label,
  children,
}: {
  collapsed: boolean;
  label: string;
  children: ReactNode;
}) {
  if (!collapsed) return <>{children}</>;
  return (
    <Tooltip label={label} placement="right" className="block">
      {children}
    </Tooltip>
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
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useUiStore((s) => s.setSidebarCollapsed);
  const [menuOpen, setMenuOpen] = useState(false);
  // Owned here rather than lifted: the trigger lives in this menu and nothing
  // else opens it. The dialog is fixed-position, so it still covers the app.
  const [bugOpen, setBugOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();

  const email = user?.email ?? '';
  const displayName = pickDisplayName(user?.user_metadata, email);
  const initial = displayName.slice(0, 1).toUpperCase();
  const avatarUrl = pickHttpsUrl(user?.user_metadata, 'avatar_url');

  const PRIMARY: NavItem[] = [
    { to: '/', label: 'Snippets', icon: Type, end: true, count: snippetCount },
    { to: '/prompts', label: 'Prompts', icon: Sparkles, count: promptCount },
    // No count pill: the spaces list is loaded by the Memory page itself, and
    // pulling that store into the sidebar would make every page fetch it.
    { to: '/memory', label: 'Brains', icon: Brain },
    { to: '/team', label: 'Team', icon: Users, count: sharedFolderCount, dividerBefore: true },
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
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-line bg-bg-alt',
        // Collapsed: a 64px rail plus its 1px border, so the icons and the
        // avatar centre on whole pixels.
        collapsed ? 'w-[65px]' : 'w-[260px]',
      )}
    >
      <nav className="shrink-0 px-3 pt-5 pb-4">
        {/* The collapse control sits on this row, flush with the right edge of
            the nav count pills. Collapsed, the sidebar narrows to a rail of
            icons and the control is all that is left on the row. */}
        <div
          className={cn(
            'mb-1 flex items-center gap-2',
            collapsed ? 'justify-center' : 'justify-between px-3',
          )}
        >
          {!collapsed && (
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
              Workspace
            </span>
          )}
          <button
            type="button"
            onClick={() => setSidebarCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-ink-subtle transition-colors hover:bg-card hover:text-ink"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" aria-hidden />
            ) : (
              <PanelLeftClose className="h-4 w-4" aria-hidden />
            )}
          </button>
        </div>
        <div className="flex flex-col gap-0.5">
          {PRIMARY.map((item) => (
            <Fragment key={item.to}>
              {item.dividerBefore && <Separator className="my-2" />}
              <RailTooltip collapsed={collapsed} label={item.label}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => navClass({ isActive, collapsed })}
                >
                  {({ isActive }) => (
                    <>
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                      {typeof item.count === 'number' && item.count > 0 ? (
                        <NavCountPill count={item.count} active={isActive} />
                      ) : null}
                    </>
                  )}
                </NavLink>
              </RailTooltip>
            </Fragment>
          ))}

          {/* Getting Started — replays the onboarding animation on demand */}
          <RailTooltip collapsed={collapsed} label="Getting Started">
            <button
              type="button"
              onClick={openOnboarding}
              className={cn(navClass({ isActive: false, collapsed }), 'w-full text-left')}
            >
              <PlayCircle className="h-4 w-4 shrink-0" />
              <span>Getting Started</span>
            </button>
          </RailTooltip>
        </div>
      </nav>

      {/* Company watermark: the user's own logo (Settings → Company branding).
          Wider than the collapsed rail, so it only shows while the sidebar is
          open. The flex-1 spacer stays either way. */}
      <div className="flex flex-1 items-center justify-center">
        {companyLogoUrl && !collapsed && (
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
      <div
        ref={menuRef}
        className={cn(
          'relative border-t border-line',
          // Collapsed, the side padding narrows so the avatar centres in the rail.
          collapsed ? 'px-2 py-3' : 'p-3',
        )}
      >
        {menuOpen && (
          <div
            className={cn(
              'absolute bottom-full left-3 mb-2 overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#1C1C1E] shadow-[0_8px_32px_rgba(0,0,0,0.45)]',
              // The rail is narrower than the menu, so collapsed it keeps its
              // open width and sits over the canvas.
              collapsed ? 'z-40 w-[236px]' : 'right-3',
            )}
          >
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
              {RESOURCE_LINKS.docs && (
                <a
                  href={RESOURCE_LINKS.docs}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMenuOpen(false)}
                  className={MENU_ITEM}
                >
                  <BookOpen className="h-4 w-4 text-[#8E8E93]" />
                  Documentation
                  <ArrowUpRight className="ml-auto h-3.5 w-3.5 text-[#9B9BA1]" />
                </a>
              )}
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
              {/* A form, not a destination: it opens in a modal, so this row
                  carries no arrow. The arrow on its siblings is what tells you
                  which rows actually leave the app. */}
              {RESOURCE_LINKS.bugs && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setBugOpen(true);
                  }}
                  className={MENU_ITEM}
                >
                  <Bug className="h-4 w-4 text-[#8E8E93]" />
                  Report a bug
                </button>
              )}
              {RESOURCE_LINKS.discussions && (
                <a
                  href={RESOURCE_LINKS.discussions}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMenuOpen(false)}
                  className={MENU_ITEM}
                >
                  <Lightbulb className="h-4 w-4 text-[#8E8E93]" />
                  Feature requests
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

        <RailTooltip collapsed={collapsed} label={displayName}>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className={cn(
              'flex w-full items-center gap-3 rounded-[10px] p-2 text-left hover:bg-card',
              collapsed && 'overflow-hidden',
            )}
          >
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
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-ink">{displayName}</div>
              <div className="truncate text-xs text-ink-subtle">{email}</div>
            </div>
          </button>
        </RailTooltip>
      </div>
      <JotFormModal
        open={bugOpen}
        onClose={() => setBugOpen(false)}
        src={RESOURCE_LINKS.bugs ?? ''}
        title="Report a bug"
      />
    </aside>
  );
}
