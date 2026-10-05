import { useState } from 'react';
import { AlertCircle, Loader2, WandSparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { draftApi } from '@/lib/api/draftApi';
import {
  DRAFT_TEXT_MAX,
  DRAFT_TEXT_MIN,
  type DraftKind,
  type DraftMode,
  type DraftResult,
} from '@/lib/aiDraft';
import type { SimilarMatch, SimilarReason } from '@/lib/draftSimilar';
import { useDraftStore } from '@/stores/draftStore';
import { cn } from '@/lib/utils';

// Draft with AI (AI-KNOWLEDGE P3, docs/AI_KNOWLEDGE_PLAN.md).
//
// The same two pieces in all three editors (snippet, prompt, Brain item):
//
//   DraftFromTextButton  beside the editor's title, on a new item: paste text,
//                        get a draft in the editor, unsaved.
//   DraftNotice          at the top of the editor once a draft is in it: what
//                        happened, what to check, and the items already in the
//                        library that look like it, each with Update it instead.

// Inline hex OK per docs/DESIGN_SYSTEM.md: the dark tone reuses the
// PromptBlockEditor drawer palette, as ReviewStatusMenu and AssetAboutButton do.
const BUTTON_TONE = {
  light: 'border-line bg-card text-ink-muted hover:border-primary/30 hover:text-primary',
  dark: 'border-[#2E2E35] bg-transparent text-[#CACAD4] hover:bg-[#222227] hover:text-[#F5F5FA]',
} as const;

const NOTICE_TONE = {
  light: {
    box: 'rounded-[12px] border border-primary/20 bg-primary-light px-3.5 py-3 text-ink',
    muted: 'text-ink-muted',
    row: 'border-primary/15 bg-card',
    action: 'border-line bg-card text-primary hover:border-primary/30',
    link: 'text-primary hover:underline',
    close: 'text-ink-muted hover:bg-card hover:text-ink',
    error: 'text-danger',
  },
  dark: {
    box: 'border-b border-[#222227] bg-[#0A1020] px-5 py-3 text-[#CACAD4]',
    muted: 'text-[#9C9CA6]',
    row: 'border-[#222227] bg-[#0B0B0E]',
    action: 'border-[#2E2E35] bg-transparent text-[#7090E0] hover:bg-[#222227]',
    link: 'text-[#7090E0] hover:underline',
    close: 'text-[#9C9CA6] hover:bg-[#222227] hover:text-[#E0E0E8]',
    error: 'text-[#FF5F57]',
  },
} as const;

type Tone = 'light' | 'dark';

interface DraftFromTextButtonProps {
  kind: DraftKind;
  /** The noun used in the wording: 'snippet', 'prompt' or 'Brain item'. */
  noun: string;
  /** Folder names a new snippet or prompt may be filed under. */
  folders?: readonly string[];
  /** Label names a new snippet or prompt may be tagged with. */
  labels?: readonly string[];
  disabled?: boolean;
  tone?: Tone;
  /** Puts the draft in the editor. The text is kept for Update it instead. */
  onDrafted: (result: DraftResult, text: string) => Promise<void> | void;
}

export function DraftFromTextButton({
  kind,
  noun,
  folders,
  labels,
  disabled = false,
  tone = 'light',
  onDrafted,
}: DraftFromTextButtonProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const length = text.trim().length;
  const tooLong = length > DRAFT_TEXT_MAX;
  const canDraft = length >= DRAFT_TEXT_MIN && !tooLong && !busy;

  function close(next: boolean) {
    if (busy) return;
    setOpen(next);
    if (!next) setError(null);
  }

  async function draft() {
    if (!canDraft) return;
    setBusy(true);
    setError(null);
    try {
      const result = await draftApi.draft({ kind, text: text.trim(), folders, labels });
      await onDrafted(result, text.trim());
      setOpen(false);
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not write the draft. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className={cn(
          'inline-flex h-8 shrink-0 items-center gap-1.5 self-center rounded-[10px] border px-2.5 text-xs font-medium transition-colors disabled:opacity-50',
          BUTTON_TONE[tone],
        )}
      >
        <WandSparkles className="h-3.5 w-3.5" aria-hidden />
        Draft from text
      </button>

      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Draft from text</DialogTitle>
            <DialogDescription>
              {kind === 'memory'
                ? 'Paste an email, a chat or a document. The AI names and describes it as a Brain item; your text is kept exactly as you pasted it.'
                : `Paste an email, a chat or a document. The AI writes a ${noun} from it for you to check.`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <label htmlFor="draft-text" className="text-xs font-medium text-ink-muted">
                Text
              </label>
              <span className={cn('font-mono text-[11px] tabular-nums', tooLong ? 'text-danger' : 'text-ink-subtle')}>
                {length.toLocaleString('en-US')}/{DRAFT_TEXT_MAX.toLocaleString('en-US')}
              </span>
            </div>
            <textarea
              id="draft-text"
              value={text}
              rows={12}
              autoFocus
              disabled={busy}
              placeholder="Paste the text here."
              onChange={(e) => setText(e.target.value)}
              className="w-full resize-y rounded-[12px] border border-line bg-card px-3 py-2 text-sm leading-relaxed text-ink placeholder:text-ink-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
            />
            {tooLong ? (
              <p className="text-xs text-danger">
                Paste {DRAFT_TEXT_MAX.toLocaleString('en-US')} characters or fewer.
              </p>
            ) : null}
            <p className="text-xs text-ink-subtle">
              Your text is sent to Claude, by Anthropic, to write the draft. Nothing is saved
              until you save it.
            </p>
          </div>

          {error ? (
            <div role="alert" className="flex items-start gap-2 rounded-[10px] bg-danger-bg px-3 py-2 text-sm text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => close(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" onClick={draft} disabled={!canDraft}>
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Writing draft…
                </>
              ) : (
                'Write draft'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** What the editor shows once a draft is in it. */
export interface DraftNoticeState {
  mode: DraftMode;
  /** What an update changed. '' for a new draft. */
  changes: string;
  /** The pasted text, so Update it instead can draft from it. '' after an update. */
  text: string;
  similar: SimilarMatch[];
}

function reasonWords(kind: DraftKind, reason: SimilarReason): string {
  if (reason === 'token') return kind === 'prompt' ? 'same shortcut' : 'same trigger';
  if (reason === 'title') return 'same name';
  return 'similar text';
}

interface DraftNoticeProps {
  notice: DraftNoticeState;
  kind: DraftKind;
  tone?: Tone;
  /** Opens an existing item's editor in place of this one. */
  onOpen: (id: string) => void;
  onDismiss: () => void;
}

export function DraftNotice({ notice, kind, tone = 'light', onOpen, onDismiss }: DraftNoticeProps) {
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = NOTICE_TONE[tone];

  async function updateInstead(id: string) {
    setUpdatingId(id);
    setError(null);
    try {
      const result = await draftApi.draft({ kind, text: notice.text, targetId: id });
      useDraftStore.getState().hand(id, result);
      onOpen(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not draft the update. Try again.');
      setUpdatingId(null);
    }
  }

  return (
    <div role="status" className={cn('flex shrink-0 flex-col gap-2 text-xs', t.box)}>
      <div className="flex items-start gap-2">
        <WandSparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1 leading-relaxed">
          {notice.mode === 'update' ? (
            <p>
              <span className="font-semibold">Updated by AI from your text.</span>{' '}
              {notice.changes ? `${notice.changes} ` : ''}
              <span className={t.muted}>Check it before you save.</span>
            </p>
          ) : (
            <p>
              <span className="font-semibold">Drafted by AI from your text.</span>{' '}
              <span className={t.muted}>
                Check every line before you save. It is saved as AI generated until it is approved.
              </span>
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className={cn('shrink-0 rounded-[6px] p-0.5 transition-colors', t.close)}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {notice.similar.length > 0 ? (
        <div className="flex flex-col gap-1.5 pl-[22px]">
          <p className="font-medium">Already in your library:</p>
          <ul className="flex flex-col gap-1">
            {notice.similar.map((match) => (
              <li
                key={match.id}
                className={cn('flex items-center gap-2 rounded-[8px] border px-2.5 py-1.5', t.row)}
              >
                <button
                  type="button"
                  onClick={() => onOpen(match.id)}
                  disabled={updatingId !== null}
                  title="Open it"
                  className={cn('min-w-0 flex-1 truncate text-left font-medium', t.link)}
                >
                  {match.title}
                </button>
                <span className={cn('shrink-0', t.muted)}>{reasonWords(kind, match.reason)}</span>
                <button
                  type="button"
                  onClick={() => updateInstead(match.id)}
                  disabled={updatingId !== null}
                  className={cn(
                    'inline-flex h-7 shrink-0 items-center gap-1 rounded-[8px] border px-2 font-medium transition-colors disabled:opacity-60',
                    t.action,
                  )}
                >
                  {updatingId === match.id ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                      Updating…
                    </>
                  ) : (
                    'Update it instead'
                  )}
                </button>
              </li>
            ))}
          </ul>
          {error ? (
            <p role="alert" className={cn('flex items-center gap-1.5', t.error)}>
              <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
