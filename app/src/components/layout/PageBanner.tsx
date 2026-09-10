import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';

interface PageBannerProps {
  tone: 'error' | 'success';
  children: ReactNode;
  onDismiss?: () => void;
}

/**
 * The page-level feedback strip for snippets, prompts and memory. One shape,
 * two tones. One-shot confirmations belong in the toast; this is for state the
 * page is holding, such as a store error or an import result.
 */
export function PageBanner({ tone, children, onDismiss }: PageBannerProps) {
  const error = tone === 'error';
  const Icon = error ? AlertCircle : CheckCircle2;

  return (
    <div
      role={error ? 'alert' : 'status'}
      className={
        'mb-4 flex items-start gap-2 rounded-[12px] border p-3 text-xs ' +
        (error
          ? 'border-danger/30 bg-danger/5 text-danger'
          : 'border-success/30 bg-success/5 text-success')
      }
    >
      <Icon className="mt-px h-4 w-4 shrink-0" />
      <span className="flex-1">{children}</span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className={error ? 'text-danger/60 hover:text-danger' : 'text-success/60 hover:text-success'}
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
