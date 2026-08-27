import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Plus, Users } from 'lucide-react';
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
 * the team you are looking at is also the control that changes it — the same
 * place Drive puts its drive picker.
 *
 * Renders as plain text when there is nothing to choose between and no reason
 * to offer a menu, so a one-team user never sees a control that does nothing.
 */
export function TeamSwitcher({ name }: { name: string }) {
  const orgs = useOrgStore((s) => s.orgs);
  const activeOrg = useOrgStore((s) => s.activeOrg);
  const setActiveOrg = useOrgStore((s) => s.setActiveOrg);

  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click + Escape. pointerdown on capture so the menu is gone
  // before any synthetic click behind it fires.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function choose(orgId: string) {
    setOpen(false);
    void setActiveOrg(orgId);
  }

  function openCreate() {
    setOpen(false);
    setCreateOpen(true);
  }

  return (
    <>
      <div ref={wrapRef} className="relative inline-block max-w-full">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn(
            'group flex max-w-full items-center gap-1.5 rounded-[8px] text-left transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
            '-mx-1.5 px-1.5 hover:bg-bg-alt',
          )}
        >
          <span className="truncate text-2xl font-bold tracking-tight text-ink">{name}</span>
          <ChevronDown
            className={cn(
              'h-5 w-5 shrink-0 text-ink-subtle transition-transform group-hover:text-ink-muted',
              open && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </button>

        {open && (
          <div
            role="menu"
            aria-label="Switch team"
            className="absolute left-0 top-full z-50 mt-1 min-w-[260px] max-w-[320px] overflow-hidden rounded-[12px] border border-line bg-card p-1.5 shadow-lg"
          >
            <div className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
              Your teams · {orgs.length}
            </div>

            {orgs.map((org) => {
              const isActive = org.id === activeOrg?.id;
              return (
                <button
                  key={org.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  onClick={() => choose(org.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left transition-colors',
                    isActive ? 'bg-primary-light' : 'hover:bg-bg-alt',
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
              type="button"
              role="menuitem"
              onClick={openCreate}
              className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[13px] font-medium text-ink transition-colors hover:bg-bg-alt"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-bg-alt text-ink-muted">
                <Plus className="h-3.5 w-3.5" />
              </span>
              Create team
            </button>
          </div>
        )}
      </div>

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
