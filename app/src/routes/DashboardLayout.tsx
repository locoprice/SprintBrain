import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { ChangelogModal } from '@/components/layout/ChangelogModal';
import { useSettingsStore } from '@/stores/settingsStore';
import { APP_VERSION, RELEASE_DATE } from '@/lib/appInfo';

export function DashboardLayout() {
  const loadSettings = useSettingsStore((s) => s.load);
  const profile = useSettingsStore((s) => s.profile);
  const [changelogOpen, setChangelogOpen] = useState(false);

  // Settings drives the user block in the sidebar and the sync pill in the
  // topbar. Loaded once at mount; per-page stores hydrate themselves.
  useEffect(() => {
    if (!profile) {
      void loadSettings();
    }
  }, [loadSettings, profile]);

  return (
    <div className="flex h-screen min-w-[1024px] bg-bg text-ink">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-content px-8 py-8">
            <Outlet />
          </div>
        </main>
        <footer className="flex items-center justify-between border-t border-line bg-bg-alt px-4 py-1">
          <button
            type="button"
            onClick={() => setChangelogOpen(true)}
            className="font-mono text-[10px] text-ink-subtle transition-colors hover:text-primary"
          >
            {APP_VERSION}
          </button>
          <span className="font-mono text-[10px] text-ink-subtle">{RELEASE_DATE}</span>
        </footer>
      </div>
      <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />
    </div>
  );
}
