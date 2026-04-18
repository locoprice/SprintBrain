import { NavLink } from 'react-router-dom';
import {
  BarChart3,
  HelpCircle,
  LifeBuoy,
  MessageSquareText,
  Settings,
  Type,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settingsStore';

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

export function Sidebar() {
  const profile = useSettingsStore((s) => s.profile);

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

      {/* User block */}
      <div className="border-t border-line p-3">
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-[10px] p-2 text-left hover:bg-bg-alt"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-light text-xs font-bold text-primary">
            {profile?.display_name.slice(0, 1) ?? 'A'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-ink">
              {profile?.display_name ?? 'Loading…'}
            </div>
            <div className="truncate text-xs text-ink-subtle">
              {profile?.email ?? ''}
            </div>
          </div>
        </button>
      </div>
    </aside>
  );
}
