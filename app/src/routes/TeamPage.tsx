import { Children, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, FileText, Globe, Search, Share2, Sparkles, Users } from 'lucide-react';
import { EmptyState } from '@/components/layout/EmptyState';
import { FolderShareModal } from '@/features/org/FolderShareModal';
import { TeamCover } from '@/features/org/TeamCover';
import { TeamSharingGuide } from '@/features/org/TeamSharingGuide';
import { Avatar } from '@/components/shared/Avatar';
import { AvatarStack, type StackMember } from '@/components/shared/AvatarStack';
import { useSnippetStore } from '@/stores/snippetStore';
import { usePromptStore } from '@/stores/promptStore';
import { useOrgStore } from '@/stores/orgStore';
import { useAuthStore } from '@/stores/authStore';
import { permissionsApi } from '@/lib/api/permissionsApi';
import { FolderIcon } from '@/lib/folderIcons';
import type { Folder, FolderPermission, FolderShareScope, OrgMember } from '@/types/database';

/** Resolved creator identity for a shared item. */
interface CreatorInfo {
  name: string | null;
  email: string | null;
  isYou: boolean;
  /** Human label for tooltips, e.g. "Maria" or "you". */
  label: string;
}

/**
 * Team hub — the home of SprintBrain's core feature. Shows your team roster,
 * everything shared (split by "by you" vs "with you"), who has access to each
 * folder, and a search across all shared snippets + prompts. Sharing itself
 * stays folder-level (Phase B org ACL) and is managed through FolderShareModal.
 */
export function TeamPage() {
  const folders = useSnippetStore((s) => s.folders);
  const folderShares = useSnippetStore((s) => s.folderShares);
  const snippets = useSnippetStore((s) => s.snippets);
  const loadSnippets = useSnippetStore((s) => s.load);

  const prompts = usePromptStore((s) => s.prompts);
  const loadPrompts = usePromptStore((s) => s.load);

  const members = useOrgStore((s) => s.members);
  const activeOrg = useOrgStore((s) => s.activeOrg);
  const loadOrg = useOrgStore((s) => s.load);

  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  const [shareFolder, setShareFolder] = useState<Folder | null>(null);
  const [grantsByFolder, setGrantsByFolder] = useState<Map<string, FolderPermission[]>>(new Map());
  const [query, setQuery] = useState('');

  // Per-folder grants drive the "who has access" faces. Non-fatal: a failure
  // degrades to scope-only badges (the store's folderShares stays authoritative).
  const loadGrants = useCallback(() => {
    permissionsApi
      .listAllGrants()
      .then((rows) => {
        const map = new Map<string, FolderPermission[]>();
        for (const g of rows) {
          const arr = map.get(g.folder_id) ?? [];
          arr.push(g);
          map.set(g.folder_id, arr);
        }
        setGrantsByFolder(map);
      })
      .catch(() => setGrantsByFolder(new Map()));
  }, []);

  // Cold-open hydration: fetch whichever sources haven't been visited yet.
  useEffect(() => {
    if (snippets.length === 0 && folders.length === 0) void loadSnippets();
  }, [loadSnippets, snippets.length, folders.length]);
  useEffect(() => {
    if (prompts.length === 0) void loadPrompts();
  }, [loadPrompts, prompts.length]);
  useEffect(() => {
    void loadOrg();
  }, [loadOrg]);
  useEffect(() => {
    loadGrants();
  }, [loadGrants]);

  const memberById = useMemo(() => {
    const map = new Map<string, OrgMember>();
    for (const m of members) map.set(m.user_id, m);
    return map;
  }, [members]);

  const sharedFolders = useMemo(
    () =>
      folders
        .filter((f) => folderShares.has(f.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [folders, folderShares],
  );

  const q = query.trim().toLowerCase();

  const folderMatches = useCallback(
    (folder: Folder): boolean => {
      if (q === '') return true;
      if (folder.name.toLowerCase().includes(q)) return true;
      const hitSnip = snippets.some(
        (s) =>
          s.folder_id === folder.id &&
          (s.name.toLowerCase().includes(q) || (s.triggers[0] ?? '').toLowerCase().includes(q)),
      );
      const hitPrompt = prompts.some(
        (p) => p.folder_id === folder.id && p.name.toLowerCase().includes(q),
      );
      return hitSnip || hitPrompt;
    },
    [q, snippets, prompts],
  );

  const mine = sharedFolders.filter((f) => f.user_id === currentUserId && folderMatches(f));
  const withMe = sharedFolders.filter((f) => f.user_id !== currentUserId && folderMatches(f));

  function reload() {
    void loadSnippets();
    void loadPrompts();
    loadGrants();
  }

  function accessFaces(folder: Folder): StackMember[] {
    const grants = grantsByFolder.get(folder.id) ?? [];
    const map = new Map<string, StackMember>();
    if (folder.user_id) {
      const owner = memberById.get(folder.user_id);
      map.set(folder.user_id, {
        id: folder.user_id,
        name: owner?.display_name ?? null,
        email: owner?.email ?? null,
        highlight: folder.user_id === currentUserId,
      });
    }
    for (const g of grants) {
      if (g.principal_type !== 'user') continue;
      const m = memberById.get(g.principal_id);
      map.set(g.principal_id, {
        id: g.principal_id,
        name: m?.display_name ?? null,
        email: m?.email ?? null,
        highlight: g.principal_id === currentUserId,
      });
    }
    return Array.from(map.values());
  }

  const canManage = useCallback(
    (folder: Folder) => folder.user_id === currentUserId || activeOrg?.myRole === 'admin',
    [currentUserId, activeOrg],
  );

  // Resolve an item's creator (its user_id is the original author — sharing only
  // stamps organization_id, never reassigns ownership).
  const resolveCreator = useCallback(
    (userId: string): CreatorInfo => {
      const isYou = userId === currentUserId;
      const m = memberById.get(userId);
      return {
        name: m?.display_name ?? null,
        email: m?.email ?? null,
        isYou,
        label: isYou ? 'you' : m ? m.display_name || m.email : 'a teammate',
      };
    },
    [memberById, currentUserId],
  );

  const hasShared = sharedFolders.length > 0;

  function renderCard(folder: Folder) {
    const scope = folderShares.get(folder.id)?.scope ?? 'shared';
    return (
      <SharedFolderCard
        key={folder.id}
        folder={folder}
        scope={scope}
        faces={accessFaces(folder)}
        snippets={snippets.filter((s) => s.folder_id === folder.id)}
        prompts={prompts.filter((p) => p.folder_id === folder.id)}
        query={q}
        canManage={canManage(folder)}
        onManage={() => setShareFolder(folder)}
        resolveCreator={resolveCreator}
      />
    );
  }

  return (
    <>
      <TeamCover />

      <div className="flex flex-col gap-4">
        {members.length > 0 && <TeamRoster members={members} currentUserId={currentUserId} />}

        {!hasShared ? (
          <TeamSharingGuide />
        ) : (
          <>
            {/* Search */}
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search shared snippets and prompts…"
                className="h-10 w-full rounded-[10px] border border-line bg-card pl-9 pr-3 text-sm text-ink placeholder:text-ink-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            {mine.length === 0 && withMe.length === 0 ? (
              <EmptyState
                icon={Search}
                title="No shared items match your search"
                description="Try a different name or trigger."
              />
            ) : (
              <>
                {mine.length > 0 && (
                  <Section title="Shared by you" count={mine.length}>
                    {mine.map(renderCard)}
                  </Section>
                )}
                {withMe.length > 0 && (
                  <Section title="Shared with you" count={withMe.length}>
                    {withMe.map(renderCard)}
                  </Section>
                )}
              </>
            )}
          </>
        )}
      </div>

      <FolderShareModal
        folder={shareFolder}
        onClose={() => setShareFolder(null)}
        onShared={reload}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */

function TeamRoster({
  members,
  currentUserId,
}: {
  members: OrgMember[];
  currentUserId: string | null;
}) {
  return (
    <section className="rounded-[16px] border border-line bg-card p-5">
      <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
        <Users className="h-3.5 w-3.5" />
        Your team · {members.length} {members.length === 1 ? 'person' : 'people'}
      </div>
      <div className="flex flex-wrap gap-2">
        {members.map((m) => {
          const isYou = m.user_id === currentUserId;
          const name = m.display_name || m.email;
          return (
            <div
              key={m.user_id}
              className="flex items-center gap-2 rounded-full border border-line bg-bg-alt/60 py-1 pl-1 pr-3"
            >
              <Avatar name={m.display_name} email={m.email} highlight={isYou} size="sm" />
              <span className="flex flex-col leading-tight">
                <span className="text-xs font-medium text-ink">{isYou ? `${name} (you)` : name}</span>
                <span className="text-[10px] uppercase tracking-wide text-ink-subtle">{m.role}</span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
        {title}
        <span className="text-ink-subtle/70">· {count}</span>
      </div>
      {children}
    </div>
  );
}

interface SharedFolderCardProps {
  folder: Folder;
  scope: FolderShareScope;
  faces: StackMember[];
  snippets: { id: string; name: string; triggers: string[]; user_id: string }[];
  prompts: { id: string; name: string; type: string; user_id: string }[];
  query: string;
  canManage: boolean;
  onManage: () => void;
  resolveCreator: (userId: string) => CreatorInfo;
}

/** Always-visible creator face for a shared item; hover reveals the exact name. */
function CreatorAvatar({ info }: { info: CreatorInfo }) {
  return (
    <Avatar
      name={info.name}
      email={info.email}
      highlight={info.isYou}
      size="xs"
      title={`Created by ${info.label}`}
    />
  );
}

function SharedFolderCard({
  folder,
  scope,
  faces,
  snippets,
  prompts,
  query,
  canManage,
  onManage,
  resolveCreator,
}: SharedFolderCardProps) {
  const nameHit = query !== '' && folder.name.toLowerCase().includes(query);
  const matchSnip = (s: { name: string; triggers: string[] }) =>
    s.name.toLowerCase().includes(query) || (s.triggers[0] ?? '').toLowerCase().includes(query);
  const matchPrompt = (p: { name: string }) => p.name.toLowerCase().includes(query);

  // When the folder matched only by its name, show all its items; otherwise
  // narrow to the items that matched the query.
  const showAll = query === '' || nameHit;
  const visibleSnippets = showAll ? snippets : snippets.filter(matchSnip);
  const visiblePrompts = showAll ? prompts : prompts.filter(matchPrompt);

  return (
    <section className="rounded-[16px] border border-line bg-card p-5">
      {/* Folder header */}
      <div className="flex items-center gap-3 border-b border-line pb-3">
        <FolderIcon icon={folder.icon} className="h-[18px] w-[18px]" />
        <h2 className="truncate text-sm font-semibold text-ink">{folder.name}</h2>

        {scope === 'team' ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary-light px-2 py-0.5 text-[11px] font-semibold text-primary">
            <Globe className="h-3 w-3" />
            Whole team
          </span>
        ) : (
          faces.length > 0 && <AvatarStack members={faces} className="shrink-0" />
        )}

        <button
          type="button"
          onClick={onManage}
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-card px-3 text-xs font-medium text-ink-muted transition-colors hover:border-primary/40 hover:text-primary"
        >
          <Share2 className="h-3.5 w-3.5" />
          {canManage ? 'Manage sharing' : 'View access'}
        </button>
      </div>

      {/* Two columns: snippets + prompts */}
      <div className="grid grid-cols-2 gap-6 pt-4">
        <AssetColumn
          icon={<FileText className="h-3.5 w-3.5" />}
          label="Snippets"
          count={visibleSnippets.length}
        >
          {visibleSnippets.length === 0 ? (
            <EmptyRow text="No snippets" />
          ) : (
            visibleSnippets.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-[8px] px-2 py-1.5 hover:bg-bg-alt"
              >
                <span className="truncate text-sm text-ink">{s.name}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <CreatorAvatar info={resolveCreator(s.user_id)} />
                  {s.triggers[0] && (
                    <span className="rounded-full border border-primary/20 bg-primary-light px-2 py-0.5 font-mono text-[11px] font-semibold text-primary">
                      {s.triggers[0]}
                    </span>
                  )}
                </span>
              </div>
            ))
          )}
        </AssetColumn>

        <AssetColumn
          icon={<Sparkles className="h-3.5 w-3.5" />}
          label="Prompts"
          count={visiblePrompts.length}
        >
          {visiblePrompts.length === 0 ? (
            <EmptyRow text="No prompts" />
          ) : (
            visiblePrompts.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-[8px] px-2 py-1.5 hover:bg-bg-alt"
              >
                <span className="truncate text-sm text-ink">{p.name}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <CreatorAvatar info={resolveCreator(p.user_id)} />
                  <span className="rounded-full bg-bg-alt px-2 py-0.5 text-[11px] font-medium text-ink-subtle">
                    {p.type}
                  </span>
                </span>
              </div>
            ))
          )}
        </AssetColumn>
      </div>
    </section>
  );
}

interface AssetColumnProps {
  icon: React.ReactNode;
  label: string;
  count: number;
  children: React.ReactNode;
}

/** Rows shown per column before the list collapses behind a "Show more" toggle. */
const COLUMN_COLLAPSE_LIMIT = 8;

function AssetColumn({ icon, label, count, children }: AssetColumnProps) {
  const [expanded, setExpanded] = useState(false);
  // Slice the rendered rows so a folder with dozens of shared items doesn't
  // produce an endless column. The header keeps the true total ({count}); the
  // toggle reveals the rest in place (no layout shift above the button).
  const items = Children.toArray(children);
  const overLimit = items.length > COLUMN_COLLAPSE_LIMIT;
  const visible = expanded || !overLimit ? items : items.slice(0, COLUMN_COLLAPSE_LIMIT);
  const hiddenCount = items.length - COLUMN_COLLAPSE_LIMIT;

  return (
    <div className="flex flex-col gap-1">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
        {icon}
        {label}
        <span className="text-ink-subtle/70">· {count}</span>
      </div>
      {visible}
      {overLimit && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-1 inline-flex items-center justify-center gap-1 self-start rounded-[8px] px-2 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary-light"
        >
          {expanded ? 'Show less' : `Show ${hiddenCount} more`}
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
      )}
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="px-2 py-1.5 text-sm italic text-ink-subtle">{text}</p>;
}
