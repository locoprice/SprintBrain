import { Trophy, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { BadgeStatus } from '@/lib/statusSignals';
import { cn } from '@/lib/utils';

/**
 * Animated status badge (STATUS-ICONS-001) — one component for both asset
 * types so snippets and prompts speak the same visual language. The extension
 * popup renders the same glyphs from the same tokens and the same keyframe
 * timings; see `.sb-stat` in extension/popup/popup.html.
 *
 * Motion is transform/opacity only and lives in tailwind.config.ts, so frames
 * stay on the compositor and never trigger layout. Every animation is dropped
 * under `prefers-reduced-motion`, leaving the static icon in place — the badge
 * occupies the same box in both modes, so nothing reflows either way.
 */

interface StatusSpec {
  Icon: LucideIcon;
  label: string;
  tint: string;
  /**
   * Whether the icon keeps moving at rest. Faults nag until they are fixed;
   * the trophy pops once and then sits still, so a mature library doesn't turn
   * into a wall of twitching icons.
   */
  restless: boolean;
}

const SPECS: Record<BadgeStatus, StatusSpec> = {
  top: {
    Icon: Trophy,
    label: 'Top performer',
    tint: 'bg-primary-light text-primary',
    restless: false,
  },
  broken: {
    Icon: Wrench,
    label: 'Broken template',
    tint: 'bg-danger-bg text-danger',
    restless: true,
  },
  weak: {
    Icon: Wrench,
    label: 'Needs work',
    tint: 'bg-warning-bg text-warning-deep',
    restless: true,
  },
};

interface StatusBadgeProps {
  status: BadgeStatus;
  /** Appended to the tooltip — the reason behind the badge. */
  detail?: string;
  /**
   * Forces the static fallback. Leave unset in normal use: the CSS
   * `prefers-reduced-motion` variant already covers the OS-level preference
   * without a JS media-query listener. This is the explicit override for
   * callers that track the preference themselves.
   */
  reducedMotion?: boolean;
  className?: string;
}

export function StatusBadge({ status, detail, reducedMotion, className }: StatusBadgeProps) {
  const { Icon, label, tint, restless } = SPECS[status];
  const title = detail ? `${label} — ${detail}` : label;
  const animated = reducedMotion !== true;

  return (
    <span
      title={title}
      className={cn(
        'group/badge inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
        animated && 'animate-status-pop motion-reduce:animate-none',
        tint,
        className,
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          'h-3 w-3',
          animated && 'group-hover/badge:animate-status-cheer motion-reduce:animate-none',
          animated && restless && 'animate-status-wobble',
        )}
      />
      <span className="sr-only">{title}</span>
    </span>
  );
}
