import { useEffect } from 'react';
import { X, Zap } from 'lucide-react';
import type { ChangelogEntry } from '@/lib/changelog';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
}

// Populated at build time from git history — see vite.config.ts
const CHANGELOG: ChangelogEntry[] = __APP_CHANGELOG__;

const BADGE: Record<string, string> = {
  new:      'bg-success/10 text-success border-success/30',
  feat:     'bg-primary-light text-primary border-primary/30',
  fix:      'bg-warning/10 text-ink-muted border-warning/30',
  refactor: 'bg-bg-alt text-ink-muted border-line',
};

export function ChangelogModal({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const latest = CHANGELOG.find((e) => e.version !== 'Unreleased') ?? CHANGELOG[0] ?? { version: '', date: '' };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[85vh] w-[480px] max-w-[96vw] animate-fade-in flex-col overflow-hidden rounded-lg bg-card shadow-md">

        {/* Header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-card px-5 py-4">
          <Zap className="h-4 w-4 shrink-0 text-primary" />
          <span className="flex-1 text-[15px] font-bold text-ink">SprintBrain — Changelog</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close changelog"
            className="flex h-7 w-7 items-center justify-center rounded-[8px] text-ink-subtle transition-colors hover:bg-bg-alt hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable entries */}
        <div className="flex flex-col gap-4 overflow-y-auto p-5">
          {CHANGELOG.map((rel, idx) => (
            <div
              key={`${rel.version}-${idx}`}
              className={cn(
                'border-l-2 pl-3',
                idx === 0 ? 'border-primary' : 'border-line',
              )}
            >
              <div className="mb-2 flex items-baseline gap-2">
                <span className={cn(
                  'font-mono text-[13px] font-bold',
                  idx === 0 ? 'text-primary' : 'text-ink-muted',
                )}>
                  {rel.version}
                </span>
                <span className="text-[11px] font-semibold text-ink-muted">{rel.label}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-subtle">{rel.date}</span>
              </div>
              <div className="flex flex-col gap-1">
                {(rel.changes ?? []).map((c, ci) => (
                  <div key={ci} className="flex items-start gap-2 text-[11px] leading-relaxed text-ink-muted">
                    <span className={cn(
                      'mt-px shrink-0 rounded-full border px-1.5 py-px text-[9px] font-bold uppercase',
                      BADGE[c.type] ?? BADGE['refactor'],
                    )}>
                      {c.type}
                    </span>
                    <span>{c.text}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-line bg-bg-alt px-5 py-2.5 font-mono text-[10px] text-ink-subtle">
          <span>Ver. <strong className="font-bold text-primary">{latest.version}</strong></span>
          <span>Last Update: <strong className="font-bold text-primary">{latest.date}</strong></span>
        </div>

      </div>
    </div>
  );
}
