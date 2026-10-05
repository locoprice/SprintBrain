import { useCallback, useEffect, useMemo } from 'react';
import { isApprover } from '@/lib/reviewStatus';
import { useAuthStore } from '@/stores/authStore';
import { useOrgStore } from '@/stores/orgStore';

/**
 * Whether the signed-in user approves a given item (AI-KNOWLEDGE P2): an admin
 * of its team for team content, its owner for personal content. The database
 * decides the same way, so this only decides what the dashboard offers.
 *
 * Loads the user's teams on first use; until they arrive, team content reads
 * as not approvable, which only hides a choice the user cannot be sure of yet.
 */
export function useReviewApprover(): (organizationId: string | null, ownerId: string) => boolean {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const orgs = useOrgStore((s) => s.orgs);
  const load = useOrgStore((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  const rolesByOrg = useMemo(() => new Map(orgs.map((o) => [o.id, o.myRole as string])), [orgs]);

  return useCallback(
    (organizationId: string | null, ownerId: string) =>
      isApprover({ organizationId, ownerId, userId, rolesByOrg }),
    [userId, rolesByOrg],
  );
}
