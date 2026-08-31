import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Set by `ToggleGroup`. Its presence is what turns a stack of independent
 * toggles into an accordion: the group owns the one open id, so a toggle
 * opening is the same event as every sibling closing.
 */
const ToggleGroupContext = React.createContext<{
  openId: string | null;
  setOpenId: (next: string | null) => void;
} | null>(null);

export interface ToggleGroupProps {
  className?: string;
  children: React.ReactNode;
}

/**
 * Makes every `Toggle` inside it mutually exclusive: opening one closes
 * whichever was open. Toggles used outside a group keep their own state and
 * open independently.
 */
export function ToggleGroup({ className, children }: ToggleGroupProps) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const value = React.useMemo(() => ({ openId, setOpenId }), [openId]);

  return (
    <ToggleGroupContext.Provider value={value}>
      {className ? <div className={className}>{children}</div> : children}
    </ToggleGroupContext.Provider>
  );
}

export interface ToggleProps {
  /** Button face. Stays visible whether the panel is open or shut. */
  label: string;
  /**
   * Open on first render. Inside a `ToggleGroup` it claims the group's one
   * open slot, so at most one toggle per group should set it.
   */
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
  /**
   * Pinned to the bottom of the panel behind its own hairline, so a call
   * to action reads as the step you take after the text above it rather
   * than as one more paragraph.
   */
  footer?: React.ReactNode;
}

/**
 * A bordered button that swings open to reveal a panel beneath it, in the
 * shape Avada gives its Toggles element: boxed, one clickable row, an arrow
 * on the left that turns as the panel opens.
 *
 * Not to be confused with `Switch`, which carries an on/off value. This one
 * only shows and hides content.
 *
 * The animation runs on grid-template-rows (0fr to 1fr), so the panel slides
 * to whatever height its content actually needs. No measuring in JS, and no
 * fixed max-height to guess wrong.
 */
export function Toggle({ label, defaultOpen = false, className, children, footer }: ToggleProps) {
  const id = React.useId();
  const contentId = `${id}-panel`;
  const group = React.useContext(ToggleGroupContext);

  // Only the ungrouped case needs local state; in a group the open panel is
  // the group's to know, or two of them could believe they are open at once.
  const [selfOpen, setSelfOpen] = React.useState(defaultOpen);
  const open = group ? group.openId === id : selfOpen;

  const { setOpenId } = group ?? {};
  React.useEffect(() => {
    if (defaultOpen && setOpenId) setOpenId(id);
    // Claiming the slot is a mount-time act. Re-running it on every render
    // would fight the user every time they closed the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleClick() {
    if (group) group.setOpenId(open ? null : id);
    else setSelfOpen((prev) => !prev);
  }

  return (
    <div className={cn('overflow-hidden rounded-[10px] border border-line bg-card', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={handleClick}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30',
          // The open row keeps the hover fill so the button reads as attached
          // to the panel it opened rather than floating above it.
          open ? 'bg-bg-alt' : 'hover:bg-bg-alt',
        )}
      >
        <ChevronRight
          aria-hidden
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-ink-subtle transition-transform duration-200 ease-out',
            open && 'rotate-90',
          )}
        />
        <span className="flex-1 text-xs font-semibold text-ink">{label}</span>
      </button>

      <div
        id={contentId}
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        {/* The 0fr row only collapses if the child it clips cannot push back,
            so the overflow wrapper is load-bearing, not decoration. */}
        <div className="overflow-hidden">
          <div className="border-t border-line px-3 py-2.5">{children}</div>
          {footer && (
            <div className="border-t border-line bg-bg-alt px-3 py-2.5">{footer}</div>
          )}
        </div>
      </div>
    </div>
  );
}
