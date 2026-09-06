import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The one item-actions menu for snippets, prompts and memory.
 *
 * Same trigger, same popup, same rows on all three: parity is the point, so
 * nothing here takes a styling prop. The popup is portalled so it escapes a
 * table's `overflow-clip` and a card grid alike, right-aligned under its
 * trigger with viewport clamping and a flip when the bottom edge runs out.
 *
 * Contents are a render prop taking `close`, so an item that dismisses the
 * menu says so itself and a drill-down can keep it open.
 */

const PAD = 8;

interface ActionMenuProps {
  /** Accessible name for the trigger, e.g. `Actions for ${name}`. */
  label: string;
  children: (close: () => void) => ReactNode;
  /** Told when the menu closes, so callers can reset confirm latches. */
  onOpenChange?: (open: boolean) => void;
}

export function ActionMenu({ label, children, onOpenChange }: ActionMenuProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    onOpenChange?.(open);
    // Firing on `open` alone: a caller passing a fresh closure each render
    // would otherwise re-notify on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setAnchor({ x: rect.right, y: rect.bottom + 4 });
  }, [open]);

  // Placement re-runs whenever the menu's own box changes, so drilling into a
  // taller view re-clamps instead of running off the bottom of the viewport.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!open || !el || anchor === null) return;

    function place() {
      const node = menuRef.current;
      if (!node || anchor === null) return;
      const rect = node.getBoundingClientRect();
      let nextX = anchor.x - rect.width;
      let nextY = anchor.y;
      const maxX = window.innerWidth - rect.width - PAD;
      if (nextX > maxX) nextX = maxX;
      if (nextX < PAD) nextX = PAD;
      if (nextY + rect.height + PAD > window.innerHeight) {
        nextY = Math.max(PAD, anchor.y - rect.height - 8 - 32);
      }
      node.style.left = `${nextX}px`;
      node.style.top = `${nextY}px`;
    }

    place();
    const observer = new ResizeObserver(place);
    observer.observe(el);
    return () => observer.disconnect();
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onReflow() {
      setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More actions"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((v) => !v);
        }}
        className={cn(
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-ink-subtle transition-colors',
          'hover:bg-primary-light hover:text-primary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          open && 'bg-primary-light text-primary',
        )}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open &&
        anchor !== null &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            className="fixed z-[60] min-w-[200px] overflow-hidden rounded-[12px] border border-line bg-card p-1.5 shadow-lg"
            style={{ left: anchor.x, top: anchor.y }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </>
  );
}

interface ActionMenuItemProps {
  icon: ReactNode;
  label: string;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  danger?: boolean;
  /** Right-aligned adornment: a count, a chevron into a sub-view. */
  trailing?: ReactNode;
  /** Hover hint, typically the reason a disabled item is disabled. */
  title?: string;
}

export function ActionMenuItem({
  icon,
  label,
  onClick,
  disabled,
  danger,
  trailing,
  title,
}: ActionMenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={title}
      onClick={() => void onClick()}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-left text-[13px] transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        danger ? 'text-danger hover:bg-danger/10' : 'text-ink hover:bg-bg-alt',
      )}
    >
      <span className={cn('shrink-0', danger ? 'text-danger' : 'text-ink-subtle')}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {trailing !== undefined && <span className="shrink-0">{trailing}</span>}
    </button>
  );
}

export function ActionMenuSeparator() {
  return <div className="my-1 h-px bg-line" aria-hidden="true" />;
}
