import { CheckCircle2, Command, Search } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useSettingsStore } from '@/stores/settingsStore';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { UserDropdown } from '@/components/layout/UserDropdown';
import { NotificationsDropdown } from '@/components/layout/NotificationsDropdown';

/**
 * Top bar — design system v1.1.
 * Spans the dashboard width at 60px; brand sits on the left (mirrors the
 * mockup at design_handoff_design_system/mockups/harmonized-final.html),
 * search anchors the middle, and the sync pill + theme + bell stay on the right.
 */
export function Topbar() {
  const notionSync = useSettingsStore((s) => s.notionSync);
  const lastSyncLabel = notionSync?.last_sync_at
    ? `Notion · synced ${formatDistanceToNow(new Date(notionSync.last_sync_at), { addSuffix: true })}`
    : 'Notion · never synced';

  return (
    <header className="flex h-[60px] shrink-0 items-center gap-4 border-b border-line bg-card px-6">
      {/* Brand — small azure square + wordmark */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-primary text-sm font-extrabold text-white">
          S
        </div>
        <span className="text-[15px] font-bold tracking-tight text-ink">SprintBrain</span>
      </div>

      {/* Global search (stub) */}
      <div className="relative w-[360px]">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
        <input
          type="text"
          placeholder="Search snippets, prompts, settings…"
          className="h-9 w-full rounded-[10px] border border-line bg-bg-alt pl-9 pr-12 text-sm text-ink placeholder:text-ink-subtle focus:border-primary focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 inline-flex h-6 -translate-y-1/2 items-center gap-1 rounded-md border border-line bg-card px-1.5 text-[11px] font-medium text-ink-subtle">
          <Command className="h-3 w-3" />
          K
        </kbd>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Notion mirror status pill — distinct from team sharing */}
        <div
          title="Status of the optional Notion mirror. Team sharing is separate — share a folder from the Team page."
          className="inline-flex items-center gap-1.5 rounded-full border border-success/20 bg-success/10 px-2.5 py-1 text-xs font-medium text-success"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          {lastSyncLabel}
        </div>

        <ThemeToggle />

        <NotificationsDropdown />

        <UserDropdown />
      </div>
    </header>
  );
}
