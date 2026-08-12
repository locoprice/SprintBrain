import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Standard shadcn helper: merge conditional classes and dedupe Tailwind utilities.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// Format seconds as "Xh Ym" — used in the analytics "time saved" KPI.
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

/**
 * Words in a snippet body, counted the way a word processor counts them:
 * whitespace-separated tokens, nothing else.
 *
 * Template syntax is deliberately NOT stripped — `{guest_name}` counts as one
 * word. It resolves to roughly one word when the snippet expands, and a counter
 * that silently ignored parts of what is on screen would be unexplainable. The
 * number means "words as written", not "words the guest receives".
 *
 * (lib/languageDetect.ts has an extractProse() that does strip placeholders and
 * digits. That serves language detection, where template tokens are noise; it
 * would undercount here.)
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

// Compact integer formatter for KPI cards (1.4k, 12k, 1.2M).
export function formatCompact(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) {
    const v = value / 1000;
    return `${v < 10 ? v.toFixed(1) : Math.round(v)}k`;
  }
  return `${(value / 1_000_000).toFixed(1)}M`;
}
