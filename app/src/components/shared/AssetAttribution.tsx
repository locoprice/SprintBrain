import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatAttributionDate, useUserNameResolver } from '@/lib/useUserNames';

// Inline hex OK per CLAUDE.md — the dark tone mirrors the PromptBlockEditor
// drawer palette (labels #7A7A85, values #CACAD4).
const TONE = {
  light: { label: 'text-ink-subtle', value: 'text-ink-muted' },
  dark: { label: 'text-[#7A7A85]', value: 'text-[#CACAD4]' },
} as const;

interface AssetAttributionProps {
  /** The owner — snippets/prompts user_id, immutable since insert. */
  createdBy: string;
  /** The last modifier — updated_by, stamped in the DB on every content write. */
  updatedBy: string | null;
  updatedAt: string;
  /**
   * The row's primary key. Rendered as a copyable line so a teammate can be
   * pointed at this exact record: a translated snippet is several rows sharing
   * one trigger, so the title alone never identifies which one is meant.
   */
  assetId?: string;
  /** 'dark' matches the PromptBlockEditor drawer; default fits light dialogs. */
  tone?: 'light' | 'dark';
}

/**
 * The three attribution labels every snippet and prompt carries:
 * Created by / Last modified by / Last update, plus the record's ID.
 */
export function AssetAttribution({
  createdBy,
  updatedBy,
  updatedAt,
  assetId,
  tone = 'light',
}: AssetAttributionProps) {
  const resolveUserName = useUserNameResolver();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  async function handleCopyId() {
    if (assetId === undefined) return;
    try {
      await navigator.clipboard.writeText(assetId);
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard denied — silent.
    }
  }

  const rows = [
    { label: 'Created by', value: resolveUserName(createdBy) },
    { label: 'Last modified by', value: resolveUserName(updatedBy) },
    { label: 'Last update', value: formatAttributionDate(updatedAt) },
  ];

  return (
    <dl className="space-y-1.5">
      {assetId !== undefined && (
        <div className="flex items-baseline justify-between gap-3 text-[11px]">
          <dt className={cn('shrink-0', TONE[tone].label)}>ID</dt>
          <dd className="min-w-0">
            {/* type="button" — this sits inside the snippet <form>; a default
                submit button here would save the dialog on every copy. */}
            <button
              type="button"
              onClick={handleCopyId}
              title={copied ? 'Copied' : `Copy ID — ${assetId}`}
              aria-label={copied ? 'ID copied' : `Copy ID ${assetId}`}
              className={cn(
                'flex w-full min-w-0 items-baseline justify-end gap-1.5',
                'font-mono font-medium transition-opacity hover:opacity-70',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-[4px]',
                TONE[tone].value,
              )}
            >
              <span className="truncate">{assetId}</span>
              {copied ? (
                <Check className="h-3 w-3 shrink-0 self-center" aria-hidden />
              ) : (
                <Copy className="h-3 w-3 shrink-0 self-center" aria-hidden />
              )}
            </button>
          </dd>
        </div>
      )}
      {rows.map((r) => (
        <div
          key={r.label}
          className="flex items-baseline justify-between gap-3 text-[11px]"
        >
          <dt className={cn('shrink-0', TONE[tone].label)}>{r.label}</dt>
          <dd
            className={cn('min-w-0 truncate text-right font-medium', TONE[tone].value)}
            title={r.value}
          >
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
