import type { OrganizationSummary } from '@/types/database';

/**
 * Which team the user last had selected (TEAM-SWITCHER-001).
 *
 * Keyed per user id: two accounts on one browser must not inherit each other's
 * choice. The value is only a team the caller already belongs to, and it is
 * useless without a session, so it carries nothing sensitive.
 *
 * Every read and write is guarded. A browser with site data blocked, a private
 * window, or a storage quota error must cost the user their remembered choice
 * and nothing else — never a dashboard that fails to render. This mirrors how
 * the theme preference is read (v2.170.0).
 */
const KEY_PREFIX = 'sb_active_org_';

export function activeOrgKey(userId: string): string {
  return KEY_PREFIX + userId;
}

export function readStoredOrgId(userId: string): string | null {
  try {
    return localStorage.getItem(activeOrgKey(userId));
  } catch {
    return null;
  }
}

export function writeStoredOrgId(userId: string, orgId: string): void {
  try {
    localStorage.setItem(activeOrgKey(userId), orgId);
  } catch {
    // Blocked storage: the choice holds for this session and is simply not
    // remembered for the next one.
  }
}

export function clearStoredOrgId(userId: string): void {
  try {
    localStorage.removeItem(activeOrgKey(userId));
  } catch {
    // Same as above: nothing to recover from.
  }
}

/**
 * Resolve which org should be active, given everything the user belongs to and
 * whatever id was last stored.
 *
 * The stored id goes stale on its own: a team can be left, removed, or deleted
 * between sessions. Falling back to the oldest membership keeps the dashboard
 * on a real team instead of rendering as teamless, which is what a naive
 * `orgs.find(stored)` would do.
 */
export function pickActiveOrg(
  orgs: OrganizationSummary[],
  storedId: string | null,
): OrganizationSummary | null {
  if (orgs.length === 0) return null;
  if (storedId !== null) {
    const match = orgs.find((o) => o.id === storedId);
    if (match) return match;
  }
  return orgs[0] ?? null;
}
