import type { FolderPermission, FolderShareInfo } from '@/types/database';

/**
 * Derive per-folder sharing status from the `folder_permissions` grants the
 * signed-in user can read. Pure + side-effect-free so it's unit-testable and
 * cheap to recompute on every load.
 *
 * Classification (the folder is the permission boundary; assets inherit it):
 *   - any `organization` grant         → 'team'   (visible to the whole team)
 *   - any `user`/`team` grant (no org) → 'shared' (specific teammates/teams)
 *   - no grant at all                  → omitted  (caller treats as 'private')
 *
 * `memberCount` counts distinct non-org principals — it drives the
 * "Shared with N teammates" tooltip and is 0 for team-wide folders.
 */
export function buildFolderShares(
  grants: FolderPermission[],
): Map<string, FolderShareInfo> {
  const byFolder = new Map<string, FolderPermission[]>();
  for (const g of grants) {
    const rows = byFolder.get(g.folder_id);
    if (rows) rows.push(g);
    else byFolder.set(g.folder_id, [g]);
  }

  const out = new Map<string, FolderShareInfo>();
  for (const [folderId, rows] of byFolder) {
    const isTeam = rows.some((r) => r.principal_type === 'organization');
    if (isTeam) {
      out.set(folderId, { scope: 'team', memberCount: 0 });
      continue;
    }
    const principals = new Set(
      rows
        .filter((r) => r.principal_type !== 'organization')
        .map((r) => r.principal_id),
    );
    out.set(folderId, { scope: 'shared', memberCount: principals.size });
  }
  return out;
}
