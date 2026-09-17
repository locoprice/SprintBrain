import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { PageBanner } from '@/components/layout/PageBanner';
import { Button } from '@/components/ui/button';
import {
  findInactive,
  keepAsset,
  message,
  pruneKept,
  readKept,
  type InactivityCandidate,
} from '@/lib/inactivity';

interface InactiveAssetBannerProps {
  /** Everything the section can currently see, already flattened by the caller. */
  items: InactivityCandidate[];
  /** The word the sentence and the heading use. */
  noun: 'snippet' | 'prompt';
  /** Calendar months of silence before an asset is called unused. */
  months: number;
  /** Open the editor on this asset. Omit where the section is read-only. */
  onModify?: (id: string) => void;
  /** Delete it. Omit where the section is read-only. The caller confirms. */
  onDelete?: (id: string) => void;
}

/**
 * The unused-asset notice, shared by snippets and prompts (INACTIVE-001).
 *
 * One component for both sections because the Tripartite rule makes a generic
 * capability identical everywhere: same shape, same wording pattern, same
 * controls, only the noun changes. It renders through PageBanner, in the slot
 * both pages already reserve for page-level state, so the shell stays identical.
 *
 * Memory has no notice, and deliberately: nothing records when a shard was last
 * used, so every shard would be flagged from the day it was written. Closing
 * that needs a usage column and MCP instrumentation first.
 *
 * One asset at a time, oldest first, with arrows for the rest. A list of twelve
 * would be a chore rather than a prompt, and the oldest is the one worth
 * deciding about.
 */
export function InactiveAssetBanner({
  items,
  noun,
  months,
  onModify,
  onDelete,
}: InactiveAssetBannerProps) {
  const [kept, setKept] = useState<Record<string, number>>(() => readKept());
  const [index, setIndex] = useState(0);
  // Two-click delete, matching the row menu's gesture (SnippetRowActions): the
  // first click arms, the second removes. No window.confirm anywhere in the
  // dashboard, and a destructive action in a banner needs the same guard the
  // same action has in the table.
  const [confirming, setConfirming] = useState(false);

  // Snoozes for assets that are gone, or whose 90 days have lapsed, are dropped
  // once per library change so the map cannot grow without bound and a reused
  // id cannot inherit a stranger's snooze.
  const ids = useMemo(() => items.map((i) => i.id).join('|'), [items]);
  useEffect(() => {
    if (!items.length) return;
    setKept(pruneKept(items.map((i) => i.id), Date.now()));
  }, [ids, items]);

  const stale = useMemo(
    () => findInactive(items, kept, months, Date.now()),
    [items, kept, months],
  );

  // Deleting or keeping the last one shrinks the list under the cursor.
  useEffect(() => {
    if (index > 0 && index >= stale.length) setIndex(Math.max(0, stale.length - 1));
  }, [index, stale.length]);

  const handleKeep = useCallback(() => {
    const entry = stale[index];
    if (!entry) return;
    // Keep does NOT write a usage event. The event log is what Analytics and
    // the top-snippet badge read, and inventing an expansion there would make
    // both of them lie. A local snooze answers the same question honestly.
    setKept(keepAsset(entry.id, Date.now()));
    setIndex(0);
    setConfirming(false);
  }, [stale, index]);

  const entry = stale[index];
  // Arming belongs to one asset: moving to the next must not carry a primed
  // Delete onto a different snippet.
  useEffect(() => {
    setConfirming(false);
  }, [entry?.id]);

  if (!entry) return null;

  const canEdit = Boolean(onModify || onDelete);

  return (
    <PageBanner
      tone="warning"
      actions={
        <>
          {onDelete ? (
            <Button
              variant="ghost"
              size="sm"
              className="border-danger/30 text-danger hover:border-danger hover:bg-danger/5"
              onClick={() => {
                if (!confirming) {
                  setConfirming(true);
                  return;
                }
                onDelete(entry.id);
                setConfirming(false);
                setIndex(0);
              }}
            >
              {confirming ? 'Confirm delete' : 'Delete'}
            </Button>
          ) : null}
          {onModify ? (
            <Button variant="ghost" size="sm" onClick={() => onModify(entry.id)}>
              Modify
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="border-warning-deep/40 text-warning-deep hover:bg-warning-bg"
            onClick={handleKeep}
          >
            Keep
          </Button>
          {stale.length > 1 ? (
            <span className="flex items-center gap-1 pl-1">
              <button
                type="button"
                onClick={() => setIndex((i) => i - 1)}
                disabled={index === 0}
                aria-label={`Previous unused ${noun}`}
                className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-warning-deep/30 text-warning-deep transition-colors hover:bg-warning-bg disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              </button>
              <span className="tabular-nums text-[11px] text-warning-deep/80">
                {index + 1} of {stale.length}
              </span>
              <button
                type="button"
                onClick={() => setIndex((i) => i + 1)}
                disabled={index === stale.length - 1}
                aria-label={`Next unused ${noun}`}
                className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-warning-deep/30 text-warning-deep transition-colors hover:bg-warning-bg disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            </span>
          ) : null}
        </>
      }
    >
      <span className="font-semibold">Unused {noun}</span>
      <span className="px-1.5 text-warning-deep/60">·</span>
      {message(entry)}
      {!canEdit ? (
        <span className="text-warning-deep/70"> Open the dashboard to change it.</span>
      ) : null}
    </PageBanner>
  );
}
