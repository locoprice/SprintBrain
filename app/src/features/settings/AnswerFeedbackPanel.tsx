import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Brain, MessageCircleQuestion, Type } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Segmented } from '@/components/ui/segmented';
import { askApi, type FeedbackRow } from '@/lib/api/askApi';
import { answerPlainText, verdictLabel, type FeedbackSource } from '@/lib/askKnowledge';
import { useAuthStore } from '@/stores/authStore';
import { useOrgStore } from '@/stores/orgStore';
import { useUiStore } from '@/stores/uiStore';
import { cn } from '@/lib/utils';

/**
 * "Answer feedback" (AI-KNOWLEDGE P1).
 *
 * The review list behind the Was this right? buttons on Ask SprintBrain. You
 * see your own feedback; a team admin also sees what the team filed. Opening a
 * source is how it gets fixed: nothing here edits content, and resolving a row
 * only closes it.
 */

type Filter = 'open' | 'resolved';

const FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
] as const;

export function AnswerFeedbackPanel() {
  const [filter, setFilter] = useState<Filter>('open');
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const members = useOrgStore((s) => s.members);
  const showToast = useUiStore((s) => s.showToast);
  const openEditSnippet = useUiStore((s) => s.openEditSnippet);
  const navigate = useNavigate();

  const load = useCallback(async (which: Filter) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      setRows(await askApi.listFeedback(which));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not load feedback.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  async function toggle(row: FeedbackRow) {
    const next: Filter = row.status === 'open' ? 'resolved' : 'open';
    setBusyId(row.id);
    try {
      await askApi.setFeedbackStatus(row.id, next);
      setRows((current) => current.filter((r) => r.id !== row.id));
      showToast(next === 'resolved' ? 'Marked as resolved' : 'Reopened');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update. Try again.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  function author(row: FeedbackRow): string {
    if (row.user_id === userId) return 'You';
    return members.find((m) => m.user_id === row.user_id)?.display_name || 'A teammate';
  }

  function openSource(source: FeedbackSource) {
    if (source.kind === 'snippet') {
      navigate('/');
      openEditSnippet(source.id);
    } else {
      // An item that sits in no Brain has no space_id: land on the Brains list.
      navigate(source.space_id ? `/memory/${source.space_id}` : '/memory');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircleQuestion className="h-4 w-4 text-primary" aria-hidden />
          Answer feedback
        </CardTitle>
        <CardDescription>
          What people said about Ask SprintBrain answers. Open a source to fix it, then mark the
          feedback resolved. Feedback never changes a snippet or a Brain by itself. Team admins see
          their whole team&rsquo;s feedback; everyone else sees their own.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Segmented
          options={FILTERS}
          value={filter}
          onChange={setFilter}
          ariaLabel="Which feedback to show"
          className="w-fit"
        />

        {loading ? (
          <p className="py-4 text-sm text-ink-subtle" role="status">Loading feedback…</p>
        ) : errorMsg ? (
          <p className="py-4 text-sm text-danger" role="alert">{errorMsg}</p>
        ) : rows.length === 0 ? (
          <p className="py-4 text-sm text-ink-subtle">
            {filter === 'open' ? 'No open feedback.' : 'Nothing resolved yet.'}
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-[12px] border border-line">
            {rows.map((row) => (
              <li key={row.id} className="grid gap-1.5 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                      row.verdict === 'useful'
                        ? 'bg-primary-light text-primary'
                        : 'bg-warning-bg text-warning-deep',
                    )}
                  >
                    {verdictLabel(row.verdict)}
                  </span>
                  <span className="text-xs text-ink-subtle">
                    {author(row)} · {format(new Date(row.created_at), 'd MMM yyyy, HH:mm')}
                  </span>
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => void toggle(row)}
                    className="ml-auto rounded-[6px] px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary-light disabled:opacity-50"
                  >
                    {row.status === 'open' ? 'Mark resolved' : 'Reopen'}
                  </button>
                </div>
                <p className="text-sm font-medium text-ink">{row.question}</p>
                {row.answer ? (
                  <p className="line-clamp-2 text-xs text-ink-muted">{answerPlainText(row.answer)}</p>
                ) : null}
                {row.sources.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {row.sources.map((source) => {
                      const Icon = source.kind === 'snippet' ? Type : Brain;
                      return (
                        <button
                          key={`${source.kind}-${source.id}`}
                          type="button"
                          onClick={() => openSource(source)}
                          className="inline-flex max-w-[260px] items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-muted transition-colors hover:bg-bg-alt"
                        >
                          <Icon className="h-3 w-3 shrink-0" />
                          <span className="truncate">{source.title}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
