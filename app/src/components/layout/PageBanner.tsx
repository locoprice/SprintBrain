import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Clock, X } from 'lucide-react';

type BannerTone = 'error' | 'success' | 'warning';

interface PageBannerProps {
  tone: BannerTone;
  children: ReactNode;
  onDismiss?: () => void;
  /** Buttons rendered on the trailing edge, before the dismiss control. */
  actions?: ReactNode;
}

/**
 * The page-level feedback strip for snippets, prompts and memory. One shape,
 * three tones. One-shot confirmations belong in the toast; this is for state the
 * page is holding, such as a store error, an import result, or an asset nobody
 * has used in months.
 *
 * `warning` arrived with INACTIVE-001 and uses the canonical amber pair
 * (warning-deep on warning-bg, docs/DESIGN_SYSTEM.md §Semantic) rather than a
 * tint of danger: an unused snippet is a suggestion, not a fault, and it must
 * not read like the broken-template badge.
 */
const TONES: Record<BannerTone, { box: string; dismiss: string; role: 'alert' | 'status'; Icon: typeof AlertCircle }> = {
  error: {
    box: 'border-danger/30 bg-danger/5 text-danger',
    dismiss: 'text-danger/60 hover:text-danger',
    role: 'alert',
    Icon: AlertCircle,
  },
  success: {
    box: 'border-success/30 bg-success/5 text-success',
    dismiss: 'text-success/60 hover:text-success',
    role: 'status',
    Icon: CheckCircle2,
  },
  warning: {
    box: 'border-warning-deep/30 bg-warning-bg text-warning-deep',
    dismiss: 'text-warning-deep/60 hover:text-warning-deep',
    role: 'status',
    Icon: Clock,
  },
};

export function PageBanner({ tone, children, onDismiss, actions }: PageBannerProps) {
  const { box, dismiss, role, Icon } = TONES[tone];

  return (
    <div role={role} className={'mb-4 flex items-start gap-2 rounded-[12px] border p-3 text-xs ' + box}>
      <Icon className="mt-px h-4 w-4 shrink-0" />
      <span className="flex-1">{children}</span>
      {actions ? <span className="flex shrink-0 items-center gap-2">{actions}</span> : null}
      {onDismiss ? (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className={dismiss}>
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
