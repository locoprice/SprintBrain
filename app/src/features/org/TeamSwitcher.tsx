import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronsUpDown, Plus, Users } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CreateTeamPanel } from '@/features/org/CreateTeamPanel';
import { useOrgStore } from '@/stores/orgStore';
import { cn } from '@/lib/utils';

/**
 * Team switcher (TEAM-SWITCHER-001). Wraps the Team page title, so the name of
 * the team you are looking at is also the control that changes it.
 *
 * The menu is PORTALLED to the body rather than positioned inside the trigger.
 * It lives inside an `<h1>` in a header that has clipped it once already: any
 * ancestor with `overflow: hidden` cuts off an absolutely positioned child, and
 * headers acquire truncation as layouts change. A portal is immune to that.
 *
 * The glyph is `ChevronsUpDown`, not a plain chevron: a single down arrow reads
 * as "expand this", while the paired arrows are the conventional "swap between
 * these" affordance.
 */

const MENU_WIDTH = 288;
const VIEWPORT_PADDING = 8;
const GAP = 6;

interface MenuPos {
  left: number;
  top: number;
  /** Set when the menu had to open upward for lack of room below. */
  flipped: boolean;
}

export function TeamSwitcher({ name }: { name: string }) {
  const orgs = useOrgStore((s) => s.orgs);
  const activeOrg = useOrgStore((s) => s.activeOrg);
  const setActiveOrg = useOrgStore((s) => s.setActiveOrg);

  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos>({ left: 0, top: 0, flipped: false });
  /** Keyboard cursor. Runs over the teams, then the Create team row. */
  const [activeIndex, setActiveIndex] = useState(0);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const itemCount = orgs.length + 1; // teams, then "Create team"
  const createIndex = orgs.length;

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const menuH = menuRef.current?.offsetHeight ?? 0;

    const spaceBelow = window.innerHeight - r.bottom - VIEWPORT_PADDING;
    const flipped = menuH > 0 && spaceBelow < menuH && r.top > spaceBelow;

    const left = Math.min(
      Math.max(VIEWPORT_PADDING, r.left),
      Math.max(VIEWPORT_PADDING, window.innerWidth - MENU_WIDTH - VIEWPORT_PADDING),
    );
    const top = flipped ? Math.max(VIEWPORT_PADDING, r.top - menuH - GAP) : r.bottom + GAP;
    setPos({ left, top, flipped });
  }, []);

  // Place before paint so the menu never flashes at the wrong spot, then again
  // once its height is known (the first pass measures 0 on the opening frame).
  useLayoutEffect(() => {
    if (!open) return;
    place();
    const id = requestAnimationFrame(place);
    return () => cancelAnimationFrame(id);
  }, [open, place]);

  // The page scrolls under a fixed menu, so follow the trigger while open.
  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, place]);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Dismiss on outside pointerdown (capture, so we close before any click
  // behind the menu lands) and on Escape.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(true);
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  // Move real DOM focus with the cursor, so screen readers follow along.
  useEffect(() => {
    if (!open) return;
    itemRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  function openMenu() {
    // Start on the team already selected, the way a radio group opens.
    const current = orgs.findIndex((o) => o.id === activeOrg?.id);
    setActiveIndex(current >= 0 ? current : 0);
    setOpen(true);
  }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % itemCount);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + itemCount) % itemCount);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIndex(itemCount - 1);
    } else if (e.key === 'Tab') {
      close(false);
    }
  }

  function choose(orgId: string) {
    close(true);
    void setActiveOrg(orgId);
  }

  function openCreate() {
    close(false);
    setCreateOpen(true);
  }

  const menu = (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Switch team"
      onKeyDown={onMenuKeyDown}
      style={{ left: pos.left, top: pos.top, width: MENU_WIDTH }}
      className="fixed z-[70] overflow-hidden rounded-[12px] border border-line bg-card p-1.5 shadow-lg"
    >
      <div className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
        Your teams · {orgs.length}
      </div>

      {orgs.map((org, i) => {
        const isActive = org.id === activeOrg?.id;
        return (
          <button
            key={org.id}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            type="button"
            role="menuitemradio"
            aria-checked={isActive}
            tabIndex={activeIndex === i ? 0 : -1}
            onClick={() => choose(org.id)}
            onMouseEnter={() => setActiveIndex(i)}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left transition-colors',
              'focus-visible:outline-none',
              isActive ? 'bg-primary-light' : activeIndex === i ? 'bg-bg-alt' : '',
            )}
          >
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-xs font-bold',
                isActive ? 'bg-primary text-white' : 'bg-bg-alt text-ink-muted',
              )}
            >
              {org.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span
                className={cn(
                  'truncate text-[13px] font-medium',
                  isActive ? 'text-primary' : 'text-ink',
                )}
              >
                {org.name}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-ink-subtle">
                {org.myRole}
              </span>
            </span>
            {isActive && <Check className="h-4 w-4 shrink-0 text-primary" />}
          </button>
        );
      })}

      <div className="my-1 h-px bg-line" />

      <button
        ref={(el) => {
          itemRefs.current[createIndex] = el;
        }}
        type="button"
        role="menuitem"
        tabIndex={activeIndex === createIndex ? 0 : -1}
        onClick={openCreate}
        onMouseEnter={() => setActiveIndex(createIndex)}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[13px] font-medium text-ink transition-colors',
          'focus-visible:outline-none',
          activeIndex === createIndex && 'bg-bg-alt',
        )}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-bg-alt text-ink-muted">
          <Plus className="h-3.5 w-3.5" />
        </span>
        Create team
      </button>
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            openMenu();
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch team"
        className={cn(
          'group flex max-w-full items-center gap-2 rounded-[10px] border py-1 pl-2.5 pr-2 text-left transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          // A control at rest, not only on hover: a hairline and a faint ground
          // are what separate "this is clickable" from "this is a heading".
          open
            ? 'border-primary/40 bg-primary-light'
            : 'border-line bg-bg-alt/40 hover:border-primary/40 hover:bg-bg-alt',
        )}
      >
        <span className="truncate text-2xl font-bold tracking-tight text-ink">{name}</span>

        {orgs.length > 1 && (
          <span className="shrink-0 rounded-full bg-card px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
            {orgs.length} teams
          </span>
        )}

        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] transition-colors',
            open
              ? 'bg-primary text-white'
              : 'bg-card text-ink-subtle group-hover:bg-primary-light group-hover:text-primary',
          )}
        >
          <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </button>

      {open && createPortal(menu, document.body)}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Create a team
            </DialogTitle>
          </DialogHeader>
          {/* The panel adopts the new team as active on success, so closing
              here lands the user on the team they just made. */}
          <CreateTeamPanel
            compact
            blurb="Your other teams stay exactly as they are. You can switch between them any time."
            onCreated={() => setCreateOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
