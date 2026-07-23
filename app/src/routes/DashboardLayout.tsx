import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { ChangelogModal } from '@/components/layout/ChangelogModal';
import { OnboardingModal } from '@/features/onboarding/OnboardingModal';
import { Toast } from '@/components/ui/Toast';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUiStore } from '@/stores/uiStore';
import { useCompanyFavicon } from '@/lib/useCompanyFavicon';
import { APP_VERSION, RELEASE_DATE } from '@/lib/appInfo';

const ONBOARDING_SEEN_KEY = 'sb_onboarding_seen';

/**
 * Dashboard shell — design system v1.1.
 * Topbar spans the full width above both the sidebar and the main canvas
 * (mirrors the mockup's grid `[topbar / sidebar | main]`). The sidebar
 * starts directly under the topbar; main owns the scroll.
 */
export function DashboardLayout() {
  const loadSettings = useSettingsStore((s) => s.load);
  const profile = useSettingsStore((s) => s.profile);
  const onboardingOpen = useUiStore((s) => s.onboardingOpen);
  const openOnboarding = useUiStore((s) => s.openOnboarding);
  const closeOnboarding = useUiStore((s) => s.closeOnboarding);
  const [changelogOpen, setChangelogOpen] = useState(false);

  // Reflect the company logo (Settings → Branding) as the browser-tab favicon,
  // matching the extension toolbar + Sprintbrain.html; brand mark when unset.
  useCompanyFavicon(profile?.company_logo_url ?? null);

  // Settings drives the user block in the sidebar and the sync pill in the
  // topbar. Loaded once at mount; per-page stores hydrate themselves.
  useEffect(() => {
    if (!profile) {
      void loadSettings();
    }
  }, [loadSettings, profile]);

  // Auto-show the onboarding once per browser. The sidebar's "Getting Started"
  // button replays it any time afterward.
  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(ONBOARDING_SEEN_KEY) === '1';
    } catch {
      seen = true; // storage blocked — don't nag on every load
    }
    if (!seen) {
      openOnboarding();
      try {
        localStorage.setItem(ONBOARDING_SEEN_KEY, '1');
      } catch {
        // ignore — best-effort persistence
      }
    }
  }, [openOnboarding]);

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
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setChangelogOpen(true)}
                className="font-mono text-[10px] text-ink-subtle transition-colors hover:text-primary"
              >
                {APP_VERSION}
              </button>
              {/* Netlify deploy status — live badge served by Netlify. */}
              <a
                href="https://app.netlify.com/projects/sprintbrain/deploys"
                target="_blank"
                rel="noopener noreferrer"
                title="Netlify deploy status"
                className="inline-flex items-center"
              >
                <img
                  src="https://api.netlify.com/api/v1/badges/ec845afc-6f50-49de-bbb2-7b6ca1ba2db2/deploy-status"
                  alt="Netlify Status"
                  className="h-4 w-auto"
                />
              </a>
            </div>
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
      <OnboardingModal open={onboardingOpen} onClose={closeOnboarding} />
      <Toast />
    </div>
  );
}
