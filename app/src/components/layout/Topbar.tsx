import { Bell, CheckCircle2, Command, Search } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useSettingsStore } from '@/stores/settingsStore';
import { ThemeToggle } from '@/components/ui/ThemeToggle';

export function Topbar() {
  const notionSync = useSettingsStore((s) => s.notionSync);
  const lastSyncLabel = notionSync?.last_sync_at
    ? `Synced ${formatDistanceToNow(new Date(notionSync.last_sync_at), { addSuffix: true })}`
    : 'Never synced';

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-card px-6">
      {/* Global search (stub) */}
      <div className="relative w-[420px]">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
        <input
          type="text"
          placeholder="Search snippets, prompts, settings…"
          className="h-9 w-full rounded-[10px] border border-line bg-bg-alt pl-9 pr-12 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary focus:bg-card focus:ring-2 focus:ring-primary/20"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-6 items-center gap-1 rounded-md border border-line bg-card px-1.5 text-[11px] font-medium text-ink-subtle">
          <Command className="h-3 w-3" />
          K
        </kbd>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Sync status pill */}
        <div className="inline-flex items-center gap-1.5 rounded-full border border-success/20 bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {lastSyncLabel}
        </div>

        <ThemeToggle />

        <button
          type="button"
          aria-label="Notifications"
          className="flex h-9 w-9 items-center justify-center rounded-[10px] text-ink-muted hover:bg-bg-alt hover:text-ink"
        >
          <Bell className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
