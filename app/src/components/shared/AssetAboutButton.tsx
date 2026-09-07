import { useState } from 'react';
import { Info } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tooltip } from '@/components/ui/tooltip';
import { AssetAttribution } from '@/components/shared/AssetAttribution';
import { cn } from '@/lib/utils';

// Inline hex OK per CLAUDE.md — the dark tone mirrors the PromptBlockEditor
// drawer palette, the same pair AssetAttribution carries.
const TRIGGER_TONE = {
  light: 'text-ink-subtle hover:text-ink hover:bg-bg-alt',
  dark: 'text-[#9C9CA6] hover:text-[#E0E0E8] hover:bg-[#222227]',
} as const;

interface AssetAboutButtonProps {
  /** The row's primary key, shown as the copyable ID line. */
  assetId: string;
  /** The owner — user_id, immutable since insert. */
  createdBy: string;
  /** The last modifier — updated_by, stamped in the DB on every content write. */
  updatedBy: string | null;
  updatedAt: string;
  /** The noun the modal names: 'snippet' or 'prompt'. */
  noun: string;
  /** Matches the host chrome. The modal itself is identical either way. */
  tone?: 'light' | 'dark';
}

/**
 * The About panel, behind an info icon.
 *
 * Attribution is read once in a while and took a permanent block in both
 * editors — a quarter of the snippet rail and a band across the prompt drawer.
 * Behind an icon it costs a click and returns that space to the controls that
 * are used on every edit.
 *
 * Shared on purpose: snippets and prompts get the same icon, the same tooltip
 * and the same modal, so the two editors stay one interface.
 */
export function AssetAboutButton({
  assetId,
  createdBy,
  updatedBy,
  updatedAt,
  noun,
  tone = 'light',
}: AssetAboutButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Tooltip label="About" placement="bottom" className="flex shrink-0 items-center self-center">
        {/* type="button" — the snippet editor renders this inside its <form>,
            where a default submit button would save the dialog on every click. */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`About this ${noun}`}
          className={cn(
            'inline-flex h-7 w-7 items-center justify-center rounded-[6px] transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
            TRIGGER_TONE[tone],
          )}
        >
          <Info className="h-4 w-4" aria-hidden />
        </button>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[420px] gap-0 p-0">
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle>About</DialogTitle>
            <DialogDescription>
              Who made this {noun}, who changed it last, and when.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-6">
            <AssetAttribution
              assetId={assetId}
              createdBy={createdBy}
              updatedBy={updatedBy}
              updatedAt={updatedAt}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
