import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { ChangelogModal } from '@/components/layout/ChangelogModal';
import { Toast } from '@/components/ui/Toast';
import { useSettingsStore } from '@/stores/settingsStore';
import { APP_VERSION, RELEASE_DATE } from '@/lib/appInfo';

/**
 * Dashboard shell — design system v1.1.
 * Topbar spans the full width above both the sidebar and the main canvas
 * (mirrors the mockup's grid `[topbar / sidebar | main]`). The sidebar
 * starts directly under the topbar; main owns the scroll.
 */
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
    <div className="flex h-screen min-w-[1024px] flex-col bg-bg text-ink">
      <Topbar />
      <div className="flex min-h-0 min-w-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <main className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
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
            <div className="flex items-center gap-3">
              <a
                href="https://sprintbrain.com/legal/privacy-policy.html"
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[10px] text-ink-subtle transition-colors hover:text-primary"
              >
                Privacy
              </a>
              <a
                href="https://sprintbrain.com/legal/terms-and-conditions.html"
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[10px] text-ink-subtle transition-colors hover:text-primary"
              >
                Terms
              </a>
              <a
                href="https://sprintbrain.com/legal/cookie-policy.html"
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[10px] text-ink-subtle transition-colors hover:text-primary"
              >
                Cookies
              </a>
            </div>
            <span className="font-mono text-[10px] text-ink-subtle">{RELEASE_DATE}</span>
          </footer>
        </div>
      </div>
      <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />
      <Toast />
    </div>
  );
}
