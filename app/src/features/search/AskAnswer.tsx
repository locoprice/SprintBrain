import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, ArrowLeft, Brain, Check, Copy, Loader2, Type } from 'lucide-react';
import { askApi } from '@/lib/api/askApi';
import {
  ASK_VERDICTS,
  answerPlainText,
  splitCitations,
  type AskResult,
  type AskSource,
  type AskVerdict,
} from '@/lib/askKnowledge';
import { useOrgStore } from '@/stores/orgStore';
import { useUiStore } from '@/stores/uiStore';
import { ReviewStatusBadge } from '@/components/shared/ReviewStatusBadge';
import { cn } from '@/lib/utils';

// Ask SprintBrain inside the search panel (AI-KNOWLEDGE P1).
//
// The answer is built only from the reader's own snippets and Brains. Every
// claim carries a numbered citation that opens its source, and when nothing in
// SprintBrain covers the question the panel says so instead of answering.

type AskState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'done'; result: AskResult };

interface AskAnswerProps {
  question: string;
  onBack: () => void;
  onOpenSource: (source: AskSource) => void;
}

function sourceDate(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : `Updated ${format(date, 'd MMM yyyy')}`;
}

export function AskAnswer({ question, onBack, onOpenSource }: AskAnswerProps) {
  const [state, setState] = useState<AskState>({ phase: 'loading' });
  const [sentVerdict, setSentVerdict] = useState<AskVerdict | null>(null);
  const [sending, setSending] = useState(false);
  const showToast = useUiStore((s) => s.showToast);
  const organizationId = useOrgStore((s) => s.activeOrg?.id ?? null);

  const run = useCallback(async () => {
    setState({ phase: 'loading' });
    setSentVerdict(null);
    try {
      const result = await askApi.ask(question);
      setState({ phase: 'done', result });
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : 'Could not reach Ask SprintBrain. Try again.' });
    }
  }, [question]);

  useEffect(() => {
    void run();
  }, [run]);

  async function copyAnswer(answer: string) {
    try {
      await navigator.clipboard.writeText(answerPlainText(answer));
      showToast('Answer copied');
    } catch {
      showToast('Could not copy. Select the text and copy it instead.', 'error');
    }
  }

  async function sendFeedback(verdict: AskVerdict, result: AskResult) {
    if (sending || sentVerdict) return;
    setSending(true);
    try {
      await askApi.sendFeedback({
        question,
        answer: result.answer,
        verdict,
        sources: result.sources,
        organizationId,
      });
      setSentVerdict(verdict);
      showToast(verdict === 'useful' ? 'Thanks for the feedback' : 'Thanks. Sent for review');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not send feedback. Try again.', 'error');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex max-h-[min(70vh,560px)] flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-[6px] px-1.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-bg-alt hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to results
        </button>
      </div>

      <div className="overflow-y-auto px-4 py-3">
        <p className="mb-3 text-sm font-semibold text-ink">{question}</p>

        {state.phase === 'loading' ? (
          <p className="flex items-center gap-2 py-6 text-sm text-ink-subtle" role="status">
            <Loader2 className="h-4 w-4 animate-spin" />
            Searching your snippets and Brains…
          </p>
        ) : state.phase === 'error' ? (
          <div className="py-4">
            <p className="text-sm text-danger" role="alert">{state.message}</p>
            <button
              type="button"
              onClick={() => void run()}
              className="mt-2 rounded-[6px] px-2 py-1 text-xs font-medium text-primary hover:bg-primary-light"
            >
              Try again
            </button>
          </div>
        ) : (
          <AskResultView
            result={state.result}
            onOpenSource={onOpenSource}
            onCopy={(answer) => void copyAnswer(answer)}
            sentVerdict={sentVerdict}
            sending={sending}
            onFeedback={(verdict) => void sendFeedback(verdict, state.result)}
          />
        )}
      </div>
    </div>
  );
}

interface AskResultViewProps {
  result: AskResult;
  onOpenSource: (source: AskSource) => void;
  onCopy: (answer: string) => void;
  sentVerdict: AskVerdict | null;
  sending: boolean;
  onFeedback: (verdict: AskVerdict) => void;
}

function AskResultView({ result, onOpenSource, onCopy, sentVerdict, sending, onFeedback }: AskResultViewProps) {
  if (result.status === 'no_sources') {
    return (
      <div className="py-4">
        <p className="text-sm font-medium text-ink">Nothing in SprintBrain covers this yet.</p>
        <p className="mt-1 text-xs text-ink-subtle">
          Try other words, or save the answer as a snippet or a Brain item so the next person finds it.
        </p>
      </div>
    );
  }

  const bySource = new Map(result.sources.map((s) => [s.ref, s]));
  const answered = result.status === 'answered';

  return (
    <div className="space-y-3">
      {answered ? (
        <>
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary-light px-2 py-0.5 text-[11px] font-semibold text-primary">
            <Check className="h-3 w-3" />
            From your SprintBrain
          </span>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
            {splitCitations(result.answer, result.sources).map((part, i) => {
              if (part.type === 'text') return <span key={i}>{part.text}</span>;
              const source = bySource.get(part.ref);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => source && onOpenSource(source)}
                  title={source?.title}
                  className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-[4px] bg-primary-light px-1 align-text-top text-[10px] font-semibold text-primary hover:bg-primary hover:text-white"
                >
                  {part.ref.slice(1)}
                </button>
              );
            })}
          </p>
        </>
      ) : (
        <p className="text-sm font-medium text-ink">
          Your SprintBrain has related items, but none of them answers this.
        </p>
      )}

      {result.missing ? (
        <div className="rounded-[10px] border border-line bg-warning-bg px-3 py-2 text-xs text-ink">
          <span className="font-semibold text-warning-deep">Not in SprintBrain: </span>
          {result.missing}
        </div>
      ) : null}

      {result.conflicts ? (
        <div className="flex gap-2 rounded-[10px] border border-line bg-danger-bg px-3 py-2 text-xs text-ink">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
          <span>
            <span className="font-semibold text-danger">Sources disagree: </span>
            {result.conflicts}
          </span>
        </div>
      ) : null}

      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
          {answered ? 'Sources' : 'Related items'}
        </p>
        <ul className="divide-y divide-line rounded-[10px] border border-line">
          {result.sources.map((source) => {
            const Icon = source.kind === 'snippet' ? Type : Brain;
            return (
              <li key={source.ref}>
                <button
                  type="button"
                  onClick={() => onOpenSource(source)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-bg-alt"
                >
                  {answered ? (
                    <span
                      className={cn(
                        'inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[4px] px-1 text-[10px] font-semibold',
                        source.used ? 'bg-primary-light text-primary' : 'bg-bg-alt text-ink-subtle',
                      )}
                    >
                      {source.ref.slice(1)}
                    </span>
                  ) : null}
                  <Icon className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{source.title}</span>
                  <ReviewStatusBadge status={source.review_status} />
                  <span className="shrink-0 text-[11px] text-ink-subtle">
                    {source.kind === 'snippet' ? 'Snippet' : 'Brain'}
                    {sourceDate(source.updated_at) ? ` · ${sourceDate(source.updated_at)}` : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
        {answered ? (
          <button
            type="button"
            onClick={() => onCopy(result.answer)}
            className="mr-2 inline-flex items-center gap-1 rounded-[6px] bg-primary px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-primary-dark"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy answer
          </button>
        ) : null}
        <span className="text-[11px] text-ink-subtle">{sentVerdict ? 'Feedback sent' : 'Was this right?'}</span>
        {ASK_VERDICTS.map((verdict) => (
          <button
            key={verdict.value}
            type="button"
            disabled={sending || sentVerdict !== null}
            onClick={() => onFeedback(verdict.value)}
            aria-pressed={sentVerdict === verdict.value}
            className={cn(
              'rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors disabled:cursor-default',
              sentVerdict === verdict.value
                ? 'border-primary bg-primary text-white'
                : 'border-line text-ink-muted enabled:hover:bg-bg-alt disabled:opacity-50',
            )}
          >
            {verdict.label}
          </button>
        ))}
      </div>
    </div>
  );
}
