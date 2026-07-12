import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { RotateCcw, X, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OnboardingAnimation } from '@/features/onboarding/anim/OnboardingAnimation';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * "Getting Started" modal — plays the SprintBrain onboarding animation
 * (install → mobile companion → trigger expansion → outro). Follows the
 * ChangelogModal pattern: scrim + Escape-to-close + click-outside. The
 * animation autoplays and loops; "Replay" remounts it from the first frame.
 */
export function OnboardingModal({ open, onClose }: Props): ReactElement | null {
  const [replayKey, setReplayKey] = useState(0);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-[960px] max-w-[96vw] animate-fade-in flex-col overflow-hidden rounded-lg bg-card shadow-md">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-card px-5 py-4">
          <Zap className="h-4 w-4 shrink-0 text-primary" />
          <span className="flex-1 text-[15px] font-bold text-ink">
            Getting started with SprintBrain
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-[8px] text-ink-subtle transition-colors hover:bg-bg-alt hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Animation */}
        <div className="overflow-y-auto px-5 py-5">
          <OnboardingAnimation key={replayKey} />
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-line bg-bg-alt px-5 py-3">
          <span className="text-xs text-ink-subtle">Install → sign in → expand. Loops automatically.</span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setReplayKey((k) => k + 1)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Replay
            </Button>
            <Button size="sm" onClick={onClose}>
              Got it
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
