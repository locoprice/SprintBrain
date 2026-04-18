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

// Compact integer formatter for KPI cards (1.4k, 12k, 1.2M).
export function formatCompact(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) {
    const v = value / 1000;
    return `${v < 10 ? v.toFixed(1) : Math.round(v)}k`;
  }
  return `${(value / 1_000_000).toFixed(1)}M`;
}
