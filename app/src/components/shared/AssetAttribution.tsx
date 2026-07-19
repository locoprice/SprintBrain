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
  /** 'dark' matches the PromptBlockEditor drawer; default fits light dialogs. */
  tone?: 'light' | 'dark';
}

/**
 * The three attribution labels every snippet and prompt carries:
 * Created by / Last modified by / Last update.
 */
export function AssetAttribution({
  createdBy,
  updatedBy,
  updatedAt,
  tone = 'light',
}: AssetAttributionProps) {
  const resolveUserName = useUserNameResolver();
  const rows = [
    { label: 'Created by', value: resolveUserName(createdBy) },
    { label: 'Last modified by', value: resolveUserName(updatedBy) },
    { label: 'Last update', value: formatAttributionDate(updatedAt) },
  ];
  return (
    <dl className="space-y-1.5">
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
