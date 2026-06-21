import { useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Check, Globe, Loader2, Search, Share2, Trash2, Users } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/shared/Avatar';
import { cn } from '@/lib/utils';
import type { Folder, FolderPermission, OrgMember, PermissionLevel } from '@/types/database';
import { permissionsApi, type ShareTarget } from '@/lib/api/permissionsApi';
import { useOrgStore } from '@/stores/orgStore';
import { useAuthStore } from '@/stores/authStore';

interface FolderShareModalProps {
  /** The folder being shared. `null` keeps the dialog closed. */
  folder: Folder | null;
  onClose: () => void;
  /**
   * Called after a grant is added or revoked so the host surface can refresh
   * its items (snippets or prompts) — sharing may move them into the org.
   */
  onShared?: () => void | Promise<void>;
}

const LEVEL_LABEL: Record<PermissionLevel, string> = {
  view: 'Can use',
  edit: 'Can edit',
  owner: 'Full control',
};
const LEVEL_HELP: Record<PermissionLevel, string> = {
  view: 'Can use everything in this folder',
  edit: 'Can use and edit the items inside',
  owner: 'Full control, including sharing',
};

const WHOLE_TEAM = '__org__';

export function FolderShareModal({ folder, onClose, onShared }: FolderShareModalProps) {
  const activeOrg = useOrgStore((s) => s.activeOrg);
  const members = useOrgStore((s) => s.members);
  const orgLoading = useOrgStore((s) => s.loading);
  const loadOrg = useOrgStore((s) => s.load);
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  const [grants, setGrants] = useState<FolderPermission[]>([]);
  const [grantsLoading, setGrantsLoading] = useState(false);
  const [principal, setPrincipal] = useState<string>(WHOLE_TEAM);
  const [level, setLevel] = useState<PermissionLevel>('view');
  const [query, setQuery] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justShared, setJustShared] = useState<string | null>(null);

  const open = folder !== null;

  // Lazy-load the org + members the first time the modal opens.
  useEffect(() => {
    if (open) void loadOrg();
  }, [open, loadOrg]);

  // Load the folder's existing grants whenever the target folder changes.
  useEffect(() => {
    if (!folder) return;
    let cancelled = false;
    setGrantsLoading(true);
    setError(null);
    setJustShared(null);
    setQuery('');
    permissionsApi
      .listGrants(folder.id)
      .then((rows) => {
        if (!cancelled) setGrants(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load shares');
      })
      .finally(() => {
        if (!cancelled) setGrantsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [folder]);

  const memberById = useMemo(() => {
    const map = new Map<string, OrgMember>();
    for (const m of members) map.set(m.user_id, m);
    return map;
  }, [members]);

  // The whole-org grant cannot escalate to "owner" (that would make every member
  // an owner); individual members may be granted owner.
  const allowedLevels: PermissionLevel[] =
    principal === WHOLE_TEAM ? ['view', 'edit'] : ['view', 'edit', 'owner'];

  // Keep the selected level valid when switching principal type.
  useEffect(() => {
    if (!allowedLevels.includes(level)) setLevel('view');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [principal]);

  const canManage =
    !!folder && (folder.user_id === currentUserId || activeOrg?.myRole === 'admin');

  const selectableMembers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members
      .filter((m) => m.user_id !== currentUserId)
      .filter(
        (m) =>
          q === '' ||
          m.display_name.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q),
      );
  }, [members, currentUserId, query]);

  function nameFor(userId: string): string {
    if (userId === currentUserId) return 'You';
    const m = memberById.get(userId);
    return m ? m.display_name || m.email : 'A teammate';
  }

  function principalLabel(g: FolderPermission): string {
    if (g.principal_type === 'organization')
      return `Whole team${activeOrg ? ` · ${activeOrg.name}` : ''}`;
    if (g.principal_type === 'team') return 'A team';
    return nameFor(g.principal_id);
  }

  function provenance(g: FolderPermission): string {
    const when = formatDistanceToNow(new Date(g.created_at), { addSuffix: true });
    if (g.granted_by) return `Shared by ${nameFor(g.granted_by)} · ${when}`;
    return `Shared ${when}`;
  }

  async function refreshGrants() {
    if (!folder) return;
    const rows = await permissionsApi.listGrants(folder.id);
    setGrants(rows);
  }

  async function handleShare() {
    if (!folder || !activeOrg) return;
    const target: ShareTarget =
      principal === WHOLE_TEAM
        ? { principalType: 'organization', principalId: activeOrg.id, level }
        : { principalType: 'user', principalId: principal, level };
    setWorking(true);
    setError(null);
    setJustShared(null);
    try {
      await permissionsApi.shareFolder(folder.id, activeOrg.id, target);
      await refreshGrants();
      setJustShared(principal === WHOLE_TEAM ? `Whole team · ${activeOrg.name}` : nameFor(principal));
      // The folder + its assets may have just moved into the org — refresh the
      // host surface so shared rows surface immediately.
      await onShared?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to share folder');
    } finally {
      setWorking(false);
    }
  }

  async function handleChangeLevel(grantId: string, next: PermissionLevel) {
    setError(null);
    try {
      await permissionsApi.updateGrantLevel(grantId, next);
      await refreshGrants();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update access');
    }
  }

  async function handleRevoke(grantId: string) {
    setError(null);
    try {
      await permissionsApi.revokeGrant(grantId);
      await refreshGrants();
      await onShared?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove access');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4 text-primary" />
            Share “{folder?.name ?? ''}”
          </DialogTitle>
          <DialogDescription>
            Everyone you add can use everything inside this folder — instantly, in their extension.
          </DialogDescription>
        </DialogHeader>

        {!activeOrg && orgLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your team…
          </div>
        ) : !activeOrg ? (
          <div className="rounded-[12px] border border-line bg-bg-alt px-4 py-5 text-sm text-ink-muted">
            You’re not part of a team yet. Folder sharing becomes available once you belong to an
            organization.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Add people */}
            {canManage ? (
              <div className="flex flex-col gap-3 rounded-[12px] border border-line bg-bg-alt/50 p-3">
                {/* Search */}
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search teammates…"
                    className="h-9 w-full rounded-[8px] border border-line bg-card pl-8 pr-2.5 text-sm text-ink placeholder:text-ink-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  />
                </div>

                {/* Principal list: whole team pinned, then teammates */}
                <div className="flex max-h-52 flex-col gap-1 overflow-y-auto">
                  <PrincipalRow
                    selected={principal === WHOLE_TEAM}
                    onSelect={() => setPrincipal(WHOLE_TEAM)}
                    avatar={
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-light text-primary">
                        <Globe className="h-3.5 w-3.5" />
                      </span>
                    }
                    title={`Whole team · ${activeOrg.name}`}
                    subtitle="Everyone in your organization"
                  />
                  {selectableMembers.map((m) => (
                    <PrincipalRow
                      key={m.user_id}
                      selected={principal === m.user_id}
                      onSelect={() => setPrincipal(m.user_id)}
                      avatar={<Avatar name={m.display_name} email={m.email} size="sm" />}
                      title={m.display_name || m.email}
                      subtitle={m.email}
                      badge={m.role !== 'member' ? m.role : undefined}
                    />
                  ))}
                  {selectableMembers.length === 0 && query.trim() !== '' && (
                    <p className="px-2 py-3 text-center text-xs text-ink-subtle">
                      No teammates match “{query.trim()}”.
                    </p>
                  )}
                </div>

                {/* Access level */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                    Access level
                  </span>
                  <div className="flex gap-1.5">
                    {allowedLevels.map((lv) => (
                      <button
                        key={lv}
                        type="button"
                        onClick={() => setLevel(lv)}
                        className={cn(
                          'flex-1 rounded-[8px] border px-2 py-1.5 text-xs font-semibold transition-colors',
                          level === lv
                            ? 'border-primary bg-primary-light text-primary'
                            : 'border-line text-ink-muted hover:bg-bg-alt',
                        )}
                        title={LEVEL_HELP[lv]}
                      >
                        {LEVEL_LABEL[lv]}
                      </button>
                    ))}
                  </div>
                  <span className="text-[11px] text-ink-subtle">{LEVEL_HELP[level]}</span>
                </div>

                <Button size="sm" onClick={() => void handleShare()} disabled={working}>
                  {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
                  Share
                </Button>

                {justShared && !error && (
                  <p className="flex items-center gap-1.5 text-xs font-medium text-success">
                    <Check className="h-3.5 w-3.5" />
                    Shared with {justShared}. It’s in their extension now.
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-[12px] border border-line bg-bg-alt px-4 py-3 text-xs text-ink-muted">
                Only the folder owner or a team admin can change sharing.
              </div>
            )}

            {/* People with access */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                People with access
              </span>
              {grantsLoading ? (
                <div className="flex items-center gap-2 py-3 text-sm text-ink-muted">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : grants.length === 0 ? (
                <div className="flex items-center gap-2 rounded-[10px] border border-dashed border-line px-3 py-3 text-sm text-ink-subtle">
                  <Users className="h-4 w-4" /> Not shared yet — private to you.
                </div>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {grants.map((g) => (
                    <li
                      key={g.id}
                      className="flex items-center justify-between gap-2 rounded-[10px] border border-line px-3 py-2"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        {g.principal_type === 'organization' ? (
                          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-light text-primary">
                            <Globe className="h-3.5 w-3.5" />
                          </span>
                        ) : (
                          <Avatar
                            name={nameFor(g.principal_id)}
                            highlight={g.principal_id === currentUserId}
                            size="sm"
                          />
                        )}
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-sm text-ink">{principalLabel(g)}</span>
                          <span className="truncate text-[11px] text-ink-subtle">{provenance(g)}</span>
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {canManage ? (
                          <select
                            value={g.level}
                            onChange={(e) =>
                              void handleChangeLevel(g.id, e.target.value as PermissionLevel)
                            }
                            className="h-7 rounded-[6px] border border-line bg-card px-1.5 text-xs text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                            aria-label="Access level"
                          >
                            {(g.principal_type === 'organization'
                              ? (['view', 'edit'] as PermissionLevel[])
                              : (['view', 'edit', 'owner'] as PermissionLevel[])
                            ).map((lv) => (
                              <option key={lv} value={lv}>
                                {LEVEL_LABEL[lv]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs font-medium text-ink-muted">
                            {LEVEL_LABEL[g.level]}
                          </span>
                        )}
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => void handleRevoke(g.id)}
                            aria-label="Remove access"
                            title="Remove access"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-subtle transition-colors hover:bg-danger/10 hover:text-danger"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {error && <p className="text-xs text-danger">{error}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface PrincipalRowProps {
  selected: boolean;
  onSelect: () => void;
  avatar: React.ReactNode;
  title: string;
  subtitle: string;
  badge?: string;
}

function PrincipalRow({ selected, onSelect, avatar, title, subtitle, badge }: PrincipalRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex items-center gap-2.5 rounded-[8px] border px-2 py-1.5 text-left transition-colors',
        selected ? 'border-primary bg-primary-light/60' : 'border-transparent hover:bg-bg-alt',
      )}
    >
      {avatar}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-ink">{title}</span>
          {badge && (
            <span className="shrink-0 rounded-full bg-bg-alt px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
              {badge}
            </span>
          )}
        </span>
        <span className="truncate text-[11px] text-ink-subtle">{subtitle}</span>
      </span>
      {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
    </button>
  );
}
