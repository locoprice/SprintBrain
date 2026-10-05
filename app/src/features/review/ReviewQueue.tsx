import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Brain, Check, Sparkles, Type } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ReviewStatusBadge } from '@/components/shared/ReviewStatusBadge';
import { ReviewStatusMenu } from '@/components/shared/ReviewStatusMenu';
import type { ReviewItem, ReviewKind } from '@/lib/api/reviewApi';
import { WAITING_STATUSES, type ReviewStatus } from '@/lib/reviewStatus';
import { useReviewApprover } from '@/lib/useReviewApprover';
import { useUserNameResolver } from '@/lib/useUserNames';
import { useReviewStore } from '@/stores/reviewStore';
import { useUiStore } from '@/stores/uiStore';
import { cn } from '@/lib/utils';

/**
 * "Waiting for approval" (AI-KNOWLEDGE P2): every snippet, prompt and Brain
 * item that is not approved, in one list. This is where status is filtered: the
 * three sections keep the same toolbar, and the question "what needs a person"
 * spans all three anyway.
 */

type StatusChip = 'waiting' | 'deprecated' | 'archived';
type KindChip = 'all' | ReviewKind;

const STATUS_CHIPS: Array<{ value: StatusChip; label: string }> = [
  { value: 'waiting', label: 'Waiting' },
  { value: 'deprecated', label: 'Deprecated' },
  { value: 'archived', label: 'Archived' },
];

const KIND_CHIPS: Array<{ value: KindChip; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'snippet', label: 'Snippets' },
  { value: 'prompt', label: 'Prompts' },
  { value: 'memory', label: 'Brains' },
];

const KIND_ICON = { snippet: Type, prompt: Sparkles, memory: Brain } as const;
const KIND_NOUN = { snippet: 'snippet', prompt: 'prompt', memory: 'item' } as const;

function matchesStatus(status: ReviewStatus, chip: StatusChip): boolean {
  if (chip === 'waiting') return WAITING_STATUSES.includes(status);
  return status === chip;
}

const EMPTY: Record<StatusChip, string> = {
  waiting: 'Nothing is waiting for approval.',
  deprecated: 'Nothing is deprecated.',
  archived: 'Nothing is archived.',
};

function Chip({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors',
        on ? 'bg-primary text-white' : 'text-ink-muted hover:bg-bg-alt',
      )}
    >
      {label}
    </button>
  );
}

export function ReviewQueue() {
  const items = useReviewStore((s) => s.items);
  const loaded = useReviewStore((s) => s.loaded);
  const loading = useReviewStore((s) => s.loading);
  const error = useReviewStore((s) => s.error);
  const load = useReviewStore((s) => s.load);
  const setStatus = useReviewStore((s) => s.setStatus);
  const isApprover = useReviewApprover();
  const resolveUserName = useUserNameResolver();
  const showToast = useUiStore((s) => s.showToast);
  const openEditSnippet = useUiStore((s) => s.openEditSnippet);
  const openEditPrompt = useUiStore((s) => s.openEditPrompt);
  const navigate = useNavigate();

  const [statusChip, setStatusChip] = useState<StatusChip>('waiting');
  const [kindChip, setKindChip] = useState<KindChip>('all');
  const [approving, setApproving] = useState<string | null>(null);

  // Fresh on every visit: what waits changes whenever someone edits.
  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const out: Record<StatusChip, number> = { waiting: 0, deprecated: 0, archived: 0 };
    for (const item of items) {
      if (kindChip !== 'all' && item.kind !== kindChip) continue;
      for (const chip of STATUS_CHIPS) if (matchesStatus(item.review_status, chip.value)) out[chip.value] += 1;
    }
    return out;
  }, [items, kindChip]);

  const shown = useMemo(
    () =>
      items.filter(
        (item) => matchesStatus(item.review_status, statusChip) && (kindChip === 'all' || item.kind === kindChip),
      ),
    [items, statusChip, kindChip],
  );

  function open(item: ReviewItem) {
    if (item.kind === 'snippet') {
      navigate('/');
      openEditSnippet(item.id);
    } else if (item.kind === 'prompt') {
      navigate('/prompts');
      openEditPrompt(item.id);
    } else {
      navigate(item.spaceId ? `/memory/${item.spaceId}?item=${item.id}` : '/memory');
    }
  }

  async function approve(item: ReviewItem) {
    setApproving(`${item.kind}:${item.id}`);
    try {
      await setStatus(item, 'approved');
      showToast(`Approved “${item.title}”`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not approve. Try again.', 'error');
    } finally {
      setApproving(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Waiting for approval</CardTitle>
        <CardDescription>
          Snippets, prompts and Brain items that are not approved yet. Team admins approve team
          content; you approve your own personal content. Ask SprintBrain prefers approved items.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-card px-3 py-2">
          <div className="flex items-center gap-1">
            {STATUS_CHIPS.map((chip) => (
              <Chip
                key={chip.value}
                on={statusChip === chip.value}
                label={`${chip.label}${loaded ? ` (${counts[chip.value]})` : ''}`}
                onClick={() => setStatusChip(chip.value)}
              />
            ))}
          </div>
          <span className="h-5 w-px shrink-0 bg-line" aria-hidden="true" />
          <div className="flex items-center gap-1">
            {KIND_CHIPS.map((chip) => (
              <Chip
                key={chip.value}
                on={kindChip === chip.value}
                label={chip.label}
                onClick={() => setKindChip(chip.value)}
              />
            ))}
          </div>
        </div>

        {!loaded && loading ? (
          <p className="py-4 text-sm text-ink-subtle" role="status">Loading…</p>
        ) : error ? (
          <p className="py-4 text-sm text-danger" role="alert">{error}</p>
        ) : shown.length === 0 ? (
          <p className="py-4 text-sm text-ink-subtle">{EMPTY[statusChip]}</p>
        ) : (
          <ul className="divide-y divide-line rounded-[12px] border border-line">
            {shown.map((item) => {
              const Icon = KIND_ICON[item.kind];
              const approver = isApprover(item.organizationId, item.ownerId);
              const key = `${item.kind}:${item.id}`;
              return (
                <li key={key} className="flex items-center gap-3 px-4 py-3">
                  <Icon className="h-4 w-4 shrink-0 text-ink-subtle" aria-hidden />
                  <button
                    type="button"
                    onClick={() => open(item)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink hover:text-primary">{item.title}</span>
                      <ReviewStatusBadge status={item.review_status} />
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-subtle">
                      Changed by {resolveUserName(item.updatedBy)},{' '}
                      {formatDistanceToNow(new Date(item.updatedAt), { addSuffix: true })}
                    </span>
                  </button>
                  {approver && WAITING_STATUSES.includes(item.review_status) ? (
                    <button
                      type="button"
                      disabled={approving === key}
                      onClick={() => void approve(item)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-[8px] bg-primary px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Approve
                    </button>
                  ) : null}
                  <ReviewStatusMenu
                    noun={KIND_NOUN[item.kind]}
                    status={item.review_status}
                    reviewedBy={item.reviewed_by}
                    reviewedAt={item.reviewed_at}
                    approver={approver}
                    onChange={(next) => setStatus(item, next)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
