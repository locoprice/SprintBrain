import { useEffect, useMemo, useState } from 'react';
import { FileText, Globe, Share2, Sparkles, Users } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/layout/EmptyState';
import { FolderShareModal } from '@/features/org/FolderShareModal';
import { useSnippetStore } from '@/stores/snippetStore';
import { usePromptStore } from '@/stores/promptStore';
import type { Folder, FolderShareInfo } from '@/types/database';

/**
 * Team hub — a read-at-a-glance view of every folder shared with the team,
 * with the snippets and prompts inside each. Sharing itself stays folder-level
 * (Phase B org ACL); this page aggregates what's already shared and reuses the
 * existing FolderShareModal to manage access. No new sharing model is introduced.
 */
export function TeamPage() {
  const folders = useSnippetStore((s) => s.folders);
  const folderShares = useSnippetStore((s) => s.folderShares);
  const snippets = useSnippetStore((s) => s.snippets);
  const loadSnippets = useSnippetStore((s) => s.load);

  const prompts = usePromptStore((s) => s.prompts);
  const loadPrompts = usePromptStore((s) => s.load);

  const [shareFolder, setShareFolder] = useState<Folder | null>(null);

  // Both stores own a load() that fetches folders + folderShares + their assets.
  // Fetch whichever hasn't been visited yet so the hub works on a cold open.
  useEffect(() => {
    if (snippets.length === 0 && folders.length === 0) void loadSnippets();
  }, [loadSnippets, snippets.length, folders.length]);

  useEffect(() => {
    if (prompts.length === 0) void loadPrompts();
  }, [loadPrompts, prompts.length]);

  const sharedFolders = useMemo(
    () =>
      folders
        .filter((f) => folderShares.has(f.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [folders, folderShares],
  );

  function reload() {
    void loadSnippets();
    void loadPrompts();
  }

  return (
    <>
      <PageHeader
        title="Team"
        description="Snippets and prompts shared across your team, grouped by folder."
      />

      {sharedFolders.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nothing shared with the team yet"
          description="Share a folder from Snippets or Prompts (right-click a folder → “Share with team…”) to make its contents available here."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {sharedFolders.map((folder) => {
            const share = folderShares.get(folder.id) ?? null;
            const folderSnippets = snippets.filter((s) => s.folder_id === folder.id);
            const folderPrompts = prompts.filter((p) => p.folder_id === folder.id);
            return (
              <section
                key={folder.id}
                className="rounded-[16px] border border-line bg-card p-5"
              >
                {/* Folder header */}
                <div className="flex items-center gap-3 border-b border-line pb-3">
                  <span className="text-lg leading-none">{folder.icon}</span>
                  <h2 className="text-sm font-semibold text-ink">{folder.name}</h2>
                  {share && <ShareBadge info={share} />}
                  <button
                    type="button"
                    onClick={() => setShareFolder(folder)}
                    className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-card px-3 text-xs font-medium text-ink-muted transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    Manage sharing
                  </button>
                </div>

                {/* Two columns: snippets + prompts */}
                <div className="grid grid-cols-2 gap-6 pt-4">
                  <AssetColumn
                    icon={<FileText className="h-3.5 w-3.5" />}
                    label="Snippets"
                    count={folderSnippets.length}
                  >
                    {folderSnippets.length === 0 ? (
                      <EmptyRow text="No snippets in this folder" />
                    ) : (
                      folderSnippets.map((s) => (
                        <div
                          key={s.id}
                          className="flex items-center justify-between gap-3 rounded-[8px] px-2 py-1.5 hover:bg-bg-alt"
                        >
                          <span className="truncate text-sm text-ink">{s.name}</span>
                          {s.triggers[0] && (
                            <span className="shrink-0 rounded-full border border-primary/20 bg-primary-light px-2 py-0.5 font-mono text-[11px] font-semibold text-primary">
                              {s.triggers[0]}
                            </span>
                          )}
                        </div>
                      ))
                    )}
                  </AssetColumn>

                  <AssetColumn
                    icon={<Sparkles className="h-3.5 w-3.5" />}
                    label="Prompts"
                    count={folderPrompts.length}
                  >
                    {folderPrompts.length === 0 ? (
                      <EmptyRow text="No prompts in this folder" />
                    ) : (
                      folderPrompts.map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between gap-3 rounded-[8px] px-2 py-1.5 hover:bg-bg-alt"
                        >
                          <span className="truncate text-sm text-ink">{p.name}</span>
                          <span className="shrink-0 rounded-full bg-bg-alt px-2 py-0.5 text-[11px] font-medium text-ink-subtle">
                            {p.type}
                          </span>
                        </div>
                      ))
                    )}
                  </AssetColumn>
                </div>
              </section>
            );
          })}
        </div>
      )}

      <FolderShareModal
        folder={shareFolder}
        onClose={() => setShareFolder(null)}
        onShared={reload}
      />
    </>
  );
}

interface AssetColumnProps {
  icon: React.ReactNode;
  label: string;
  count: number;
  children: React.ReactNode;
}

function AssetColumn({ icon, label, count, children }: AssetColumnProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
        {icon}
        {label}
        <span className="text-ink-subtle/70">· {count}</span>
      </div>
      {children}
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="px-2 py-1.5 text-sm italic text-ink-subtle">{text}</p>;
}

/** Inline folder share badge (team-wide globe, or shared-with-N people). */
function ShareBadge({ info }: { info: FolderShareInfo }) {
  if (info.scope === 'team') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-primary-light px-2 py-0.5 text-[11px] font-semibold text-primary">
        <Globe className="h-3 w-3" />
        Whole team
      </span>
    );
  }
  const label =
    info.memberCount === 1 ? 'Shared with 1' : `Shared with ${info.memberCount}`;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-bg-alt px-2 py-0.5 text-[11px] font-medium text-ink-muted">
      <Users className="h-3 w-3" />
      {label}
    </span>
  );
}
