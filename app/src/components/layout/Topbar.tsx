import { CheckCircle2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useSettingsStore } from '@/stores/settingsStore';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { UserDropdown } from '@/components/layout/UserDropdown';
import { MasterSearch } from '@/features/search/MasterSearch';

/**
 * Top bar — design system v1.1.
 * Spans the dashboard width at 60px; brand sits on the left (mirrors the
 * mockup at design_handoff_design_system/mockups/harmonized-final.html),
 * search anchors the middle, and the sync pill + theme + bell stay on the right.
 */
export function Topbar() {
  const notionSync = useSettingsStore((s) => s.notionSync);
  const profile = useSettingsStore((s) => s.profile);
  const companyName = profile?.company_name ?? '';
  const companyLogo = profile?.company_logo_url ?? null;
  const lastSyncLabel = notionSync?.last_sync_at
    ? `Notion · synced ${formatDistanceToNow(new Date(notionSync.last_sync_at), { addSuffix: true })}`
    : 'Notion · never synced';

  return (
    <header className="flex h-[60px] shrink-0 items-center gap-4 border-b border-line bg-card px-6">
      {/* Brand — small azure square + wordmark, co-branded with the user's
          company mark (Settings → Company branding) when one is set. */}
      <div className="flex shrink-0 items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-primary text-sm font-extrabold text-white">
          S
        </div>
        <span className="text-[15px] font-bold tracking-tight text-ink">SprintBrain</span>
        {(companyLogo || companyName) && (
          <>
            <span className="h-[3px] w-[3px] shrink-0 rounded-full bg-ink-subtle" aria-hidden="true" />
            {companyLogo ? (
              <span
                className="flex items-center rounded-[8px] bg-white px-1.5 py-1"
                title={companyName || undefined}
              >
                <img
                  src={companyLogo}
                  alt={companyName || 'Company logo'}
                  draggable={false}
                  className="max-h-6 max-w-[160px] object-contain"
                />
              </span>
            ) : (
              <span className="max-w-[200px] truncate text-[15px] font-bold tracking-tight text-ink">
                {companyName}
              </span>
            )}
          </>
        )}
      </div>

      <MasterSearch />

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {/* Notion mirror status pill — distinct from team sharing */}
        <div
          title="Status of the optional Notion mirror. Team sharing is separate — share a folder from the Team page."
          className="inline-flex items-center gap-1.5 rounded-full border border-success/20 bg-success/10 px-2.5 py-1 text-xs font-medium text-success"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          {lastSyncLabel}
        </div>

        <ThemeToggle />

        <UserDropdown />
      </div>
    </header>
  );
}
