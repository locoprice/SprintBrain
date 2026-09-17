import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { clampMonths, DEFAULT_MONTHS } from '@/lib/inactivity';

/**
 * Calendar months of silence before the unused-asset banner names an asset
 * (INACTIVE-001).
 *
 * Reads the live session's `user_metadata`, which `authStore` already holds, so
 * a page that shows the banner costs no extra request. The settings store is
 * consulted first only because it is the copy the Settings page has just
 * written: `updateUser` returns the new metadata to that store immediately,
 * while the session object refreshes on its own schedule, and without this the
 * control would appear to do nothing until a reload.
 *
 * user_metadata is also where the extension reads it from, which is what keeps
 * the popup, the web app and this dashboard measuring staleness the same way.
 */
export function useInactivityMonths(): number {
  const fromSettings = useSettingsStore((s) => s.profile?.inactivity_months);
  const fromSession = useAuthStore((s) => s.user?.user_metadata?.['inactivity_months']);

  if (fromSettings !== undefined) return clampMonths(fromSettings);
  if (fromSession !== undefined && fromSession !== null) return clampMonths(fromSession);
  return DEFAULT_MONTHS;
}
