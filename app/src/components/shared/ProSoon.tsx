import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { Tooltip, type TooltipPlacement } from '@/components/ui/tooltip';
import { PRO_SOON_LABEL } from '@/lib/proFeatures';
import { cn } from '@/lib/utils';

// A feature that needs Pro, shown where it will live: dimmed, with a lock, and
// the tooltip "Available to Pro users soon" (lib/proFeatures.ts). The same
// three pieces on every locked control, so a person who has seen one knows all.

/** Classes for a control that is shown but switched off. */
export const PRO_SOON_CONTROL = 'cursor-not-allowed opacity-60';

/**
 * The lock. The label is read out for screen readers; everyone else gets it as
 * the tooltip, so it never takes room in the layout.
 */
export function ProSoonLock({ className }: { className?: string }) {
  return (
    <>
      <Lock className={cn('h-3 w-3 shrink-0', className)} aria-hidden />
      <span className="sr-only">{PRO_SOON_LABEL}</span>
    </>
  );
}

interface ProSoonProps {
  children: ReactNode;
  /** Classes for the wrapper, for a control that has to fill its row. */
  className?: string;
  placement?: TooltipPlacement;
}

/**
 * Shows the label when the locked control beneath is hovered or focused. The
 * control inside uses aria-disabled rather than disabled: a disabled button
 * gets no pointer or focus events in some browsers, and the tooltip would
 * never open.
 */
export function ProSoon({ children, className, placement = 'top' }: ProSoonProps) {
  return (
    <Tooltip label={PRO_SOON_LABEL} placement={placement} className={className}>
      {children}
    </Tooltip>
  );
}
