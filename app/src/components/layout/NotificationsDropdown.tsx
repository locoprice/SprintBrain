import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Bell, Sparkles, Wrench } from 'lucide-react';
import type { ChangelogEntry } from '@/lib/changelog';
import { cn } from '@/lib/utils';
import { useSnippetStore } from '@/stores/snippetStore';
import { usePromptStore } from '@/stores/promptStore';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { ChangelogModal } from '@/components/layout/ChangelogModal';

const CHANGELOG: ChangelogEntry[] = __APP_CHANGELOG__;

const FEATURE_TYPES = new Set(['feat', 'new']);
const FIX_TYPES = new Set(['fix']);

interface ReleaseSummary {
  version: string;
  date: string;
  features: number;
  fixes: number;
}

function summarizeLatestRelease(): ReleaseSummary | null {
  const latest = CHANGELOG.find((e) => e.version !== 'Unreleased' && e.version);
  if (!latest) return null;
  const changes = latest.changes ?? [];
  return {
    version: latest.version,
    date: latest.date,
    features: changes.filter((c) => FEATURE_TYPES.has(c.type)).length,
    fixes:    changes.filter((c) => FIX_TYPES.has(c.type)).length,
  };
}

function buildReleaseHeadline(summary: ReleaseSummary): string {
  const parts: string[] = [];
  if (summary.features > 0) {
    parts.push(`${summary.features} new feature${summary.features === 1 ? '' : 's'}`);
  }
  if (summary.fixes > 0) {
    parts.push(`${summary.fixes} bug fix${summary.fixes === 1 ? '' : 'es'}`);
  }
  if (parts.length === 0) return `Release ${summary.version} is live`;
  return parts.join(' · ');
}

export function NotificationsDropdown() {
  const snippets = useSnippetStore((s) => s.snippets);
  const snippetsLoading = useSnippetStore((s) => s.loading);
  const prompts = usePromptStore((s) => s.prompts);
  const promptsLoading = usePromptStore((s) => s.loading);
  const seenSnippetIds = useNotificationsStore((s) => s.seenSnippetIds);
  const seenPromptIds  = useNotificationsStore((s) => s.seenPromptIds);
  const seenVersion    = useNotificationsStore((s) => s.seenVersion);
  const initialize     = useNotificationsStore((s) => s.initialize);
  const markAllSeen    = useNotificationsStore((s) => s.markAllSeen);
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const initializedRef = useRef(false);
  const ref = useRef<HTMLDivElement>(null);

  // Seed seen-state once both stores have finished their first load. Without
  // this gate, an empty pre-load state would mark the user's pre-existing
  // content as "new" the moment the API returns data.
  useEffect(() => {
    if (initializedRef.current) return;
    if (snippetsLoading || promptsLoading) return;
    initializedRef.current = true;
    initialize(snippets.map((s) => s.id), prompts.map((p) => p.id));
  }, [snippetsLoading, promptsLoading, snippets, prompts, initialize]);

  const release = useMemo(summarizeLatestRelease, []);

  const newSnippetCount = useMemo(
    () => snippets.reduce((n, s) => (seenSnippetIds.has(s.id) ? n : n + 1), 0),
    [snippets, seenSnippetIds],
  );
  const newPromptCount = useMemo(
    () => prompts.reduce((n, p) => (seenPromptIds.has(p.id) ? n : n + 1), 0),
    [prompts, seenPromptIds],
  );
  const hasReleaseUpdate = Boolean(release) && release!.version !== seenVersion && seenVersion !== '';

  const totalUnread = newSnippetCount + newPromptCount + (hasReleaseUpdate ? 1 : 0);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function handleToggle() {
    const next = !open;
    setOpen(next);
    if (next && totalUnread > 0) {
      markAllSeen(snippets.map((s) => s.id), prompts.map((p) => p.id));
    }
  }

  function handleOpenChangelog() {
    setChangelogOpen(true);
    setOpen(false);
  }

  function handleViewWorkspace() {
    navigate(newPromptCount > 0 && newSnippetCount === 0 ? '/prompts' : '/');
    setOpen(false);
  }

  const workspaceLine = buildWorkspaceLine(newSnippetCount, newPromptCount);

  return (
    <>
      <div ref={ref} className="relative">
        <button
          type="button"
          aria-label={totalUnread > 0 ? `${totalUnread} new notifications` : 'Notifications'}
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={handleToggle}
          className={cn(
            'relative flex h-9 w-9 items-center justify-center rounded-[10px] text-ink-muted',
            'hover:bg-bg-alt hover:text-ink transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
            open && 'bg-bg-alt text-ink',
          )}
        >
          <Bell className={cn('h-4 w-4', totalUnread > 0 && 'text-primary')} />
          {totalUnread > 0 && (
            <span
              className={cn(
                'absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[16px] items-center justify-center',
                'rounded-full bg-primary px-1 text-[10px] font-bold text-white shadow-sm',
              )}
            >
              {totalUnread > 99 ? '99+' : totalUnread}
            </span>
          )}
        </button>

        {open && (
          <div
            role="menu"
            className={cn(
              'absolute right-0 top-full z-40 mt-2 w-[340px]',
              'rounded-[12px] border border-line bg-card shadow-md',
              'animate-fade-in overflow-hidden',
            )}
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="text-sm font-semibold text-ink">What's new</p>
              {totalUnread > 0 && (
                <span className="rounded-full bg-primary-bg px-2 py-0.5 text-[11px] font-semibold text-primary">
                  {totalUnread} new
                </span>
              )}
            </div>

            <div className="flex flex-col gap-2 p-3">
              {totalUnread === 0 && (
                <div className="px-2 py-6 text-center text-xs text-ink-muted">
                  You're all caught up.
                </div>
              )}

              {hasReleaseUpdate && release && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleOpenChangelog}
                  className={cn(
                    'group flex flex-col gap-2 rounded-[10px] border border-primary/20 p-3 text-left',
                    'bg-gradient-to-br from-primary-bg to-card',
                    'transition-all hover:border-primary/40 hover:shadow-sm',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                  )}
                >
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                    <Sparkles className="h-3 w-3" />
                    Release {release.version} · {release.date}
                  </div>
                  <p className="text-sm font-semibold leading-snug text-ink">
                    {buildReleaseHeadline(release)}
                  </p>
                  <p className="text-xs text-ink-muted">
                    Faster, sharper, more delightful.
                  </p>
                  <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                    See what's new
                    <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </button>
              )}

              {workspaceLine && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleViewWorkspace}
                  className={cn(
                    'group flex items-center justify-between gap-2 rounded-[10px] border border-line p-3 text-left',
                    'transition-colors hover:bg-bg-alt',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <Wrench className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
                    <span className="text-sm font-medium text-ink">{workspaceLine}</span>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-ink-subtle transition-transform group-hover:translate-x-0.5" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />
    </>
  );
}

function buildWorkspaceLine(newSnippets: number, newPrompts: number): string | null {
  if (newSnippets === 0 && newPrompts === 0) return null;
  const parts: string[] = [];
  if (newSnippets > 0) {
    parts.push(`${newSnippets} new snippet${newSnippets === 1 ? '' : 's'}`);
  }
  if (newPrompts > 0) {
    parts.push(`${newPrompts} new prompt${newPrompts === 1 ? '' : 's'}`);
  }
  return `${parts.join(' · ')} added`;
}
