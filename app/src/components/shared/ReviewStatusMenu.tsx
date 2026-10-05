import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, ShieldCheck } from 'lucide-react';
import {
  allowedStatuses,
  reviewStatusHint,
  reviewStatusLabel,
  REVIEW_STATUSES,
  type ReviewStatus,
} from '@/lib/reviewStatus';
import { formatAttributionDate, useUserNameResolver } from '@/lib/useUserNames';
import { useReviewStore } from '@/stores/reviewStore';
import { useUiStore } from '@/stores/uiStore';
import { cn } from '@/lib/utils';

// Inline hex OK per docs/DESIGN_SYSTEM.md: the dark tone mirrors the
// PromptBlockEditor drawer palette, the same pair AssetAboutButton uses.
const TRIGGER_TONE = {
  light: 'border-line bg-card text-ink-muted hover:border-primary/30 hover:text-primary',
  dark: 'border-[#2E2E35] bg-transparent text-[#CACAD4] hover:bg-[#222227] hover:text-[#F5F5FA]',
} as const;

interface ReviewStatusMenuProps {
  status: ReviewStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  /** Whether the signed-in user approves this item. Decides what is offered. */
  approver: boolean;
  /** Saves the new status. Rejects with a sentence a person can read. */
  onChange: (next: ReviewStatus) => Promise<void>;
  /** The noun used in the wording: 'snippet', 'prompt' or 'item'. */
  noun: string;
  tone?: 'light' | 'dark';
}

/**
 * The review status of one item, and the way to change it (AI-KNOWLEDGE P2).
 *
 * One control in all three editors (snippet, prompt, Brain item), beside the
 * About button. It saves on its own, the moment a status is picked, so it never
 * mixes with the editor's unsaved fields: a status is a decision about the item,
 * not part of its text.
 */
export function ReviewStatusMenu({
  status,
  reviewedBy,
  reviewedAt,
  approver,
  onChange,
  noun,
  tone = 'light',
}: ReviewStatusMenuProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const resolveUserName = useUserNameResolver();
  const showToast = useUiStore((s) => s.showToast);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const allowed = allowedStatuses(status, approver);

  async function pick(next: ReviewStatus) {
    if (next === status || saving) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      await onChange(next);
      setOpen(false);
      // The sidebar's waiting count and the Review page read their own list.
      void useReviewStore.getState().refreshIfLoaded();
      showToast(`Marked as ${reviewStatusLabel(next).toLowerCase()}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not change the status. Try again.', 'error');
    } finally {
      setSaving(false);
    }
  }

  const reviewedLine =
    reviewedBy && reviewedAt && (status === 'approved' || status === 'deprecated' || status === 'archived')
      ? `${reviewStatusLabel(status)} by ${resolveUserName(reviewedBy)}, ${formatAttributionDate(reviewedAt)}`
      : status === 'approved'
        ? 'In use before review started. Nobody has reviewed it yet.'
        : null;

  return (
    <div ref={ref} className="relative flex shrink-0 items-center self-center">
      {/* type="button": the snippet editor renders this inside its <form>. */}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Review status: ${reviewStatusLabel(status)}`}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex h-7 items-center gap-1 rounded-[8px] border px-2 text-xs font-medium transition-colors',
          TRIGGER_TONE[tone],
        )}
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
        {reviewStatusLabel(status)}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-72 animate-fade-in rounded-[12px] border border-line bg-card p-1.5 text-ink shadow-md"
        >
          <p className="px-2.5 pb-1.5 pt-1 text-xs text-ink-muted">{reviewStatusHint(status)}</p>
          <div className="border-t border-line pt-1">
            {REVIEW_STATUSES.filter((s) => allowed.includes(s.value)).map((s) => (
              <button
                key={s.value}
                type="button"
                role="menuitemradio"
                aria-checked={s.value === status}
                disabled={saving}
                onClick={() => void pick(s.value)}
                className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-bg-alt disabled:opacity-60"
              >
                <span className="min-w-0 flex-1">{s.label}</span>
                {s.value === status && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
              </button>
            ))}
          </div>
          {(reviewedLine || !approver) && (
            <div className="mt-1 space-y-1 border-t border-line px-2.5 pb-1 pt-1.5 text-[11px] text-ink-subtle">
              {reviewedLine && <p>{reviewedLine}</p>}
              {!approver && (
                <p>Only a team admin can approve, deprecate or archive this {noun}.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
