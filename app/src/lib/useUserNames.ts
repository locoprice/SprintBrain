import { useEffect } from 'react';
import { format } from 'date-fns';
import { useAuthStore } from '@/stores/authStore';
import { useOrgStore } from '@/stores/orgStore';

// Attribution helpers — resolve the user ids behind "Created by" (user_id) and
// "Last modified by" (updated_by, DB-stamped by app.stamp_asset_audit) into
// display names. Sources, in order: the signed-in user's own metadata, then the
// org member directory (lazily loaded, cached in orgStore). Ids outside both —
// e.g. a teammate who has left the org — resolve to "Unknown".

const ATTRIBUTION_DATE_FORMAT = 'd MMM yyyy, HH:mm';

export function useUserNameResolver(): (userId: string | null) => string {
  const user = useAuthStore((s) => s.user);
  const members = useOrgStore((s) => s.members);
  const load = useOrgStore((s) => s.load);

  // Idempotent: no-ops once the directory is loaded (org-less users pay one
  // cheap membership lookup, then it stays cached).
  useEffect(() => {
    void load();
  }, [load]);

  return (userId) => {
    if (!userId) return 'Unknown';
    if (user && userId === user.id) {
      // Mirrors revisionsApi.currentEditorDisplay: display_name → email.
      return (
        (user.user_metadata?.display_name as string | undefined) ||
        user.email ||
        'You'
      );
    }
    const member = members.find((m) => m.user_id === userId);
    return member?.display_name ?? 'Unknown';
  };
}

/** The three attribution lines as a multi-line tooltip string (list surfaces). */
export function attributionTitle(
  resolveUserName: (id: string | null) => string,
  createdBy: string,
  updatedBy: string | null,
  updatedAt: string,
): string {
  return [
    `Created by: ${resolveUserName(createdBy)}`,
    `Last modified by: ${resolveUserName(updatedBy)}`,
    `Last update: ${format(new Date(updatedAt), ATTRIBUTION_DATE_FORMAT)}`,
  ].join('\n');
}

/** "18 Jul 2026, 14:32" — the attribution timestamp format. */
export function formatAttributionDate(iso: string): string {
  return format(new Date(iso), ATTRIBUTION_DATE_FORMAT);
}
