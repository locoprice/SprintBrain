import {
  Book,
  Brain,
  Briefcase,
  FileText,
  FlaskConical,
  Gavel,
  Stethoscope,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Icon vocabulary for memory spaces (MEMORY-002).
//
// Separate from FOLDER_ICON_KEYS on purpose. That vocabulary is projected into
// three surfaces by hand (dashboard resolver, extension popup and mobile
// `_FOLDER_SVGS`), so adding one key there means editing three files in sync.
// Spaces are dashboard-only for now, so their vocabulary stays here until a
// second surface actually needs it. `memory_spaces.ico` stores the key, never
// markup, which is the same contract folders.ico and labels.color hold.
//
// The set is deliberately industry-neutral in aggregate: a clinic, a firm, a
// workshop and a lab each find something that fits, and none of them is the
// default.

export const SPACE_ICON_KEYS = [
  'brain',
  'book',
  'file-text',
  'briefcase',
  'flask',
  'wrench',
  'gavel',
  'stethoscope',
] as const;

export type SpaceIconKey = (typeof SPACE_ICON_KEYS)[number];

/** Matches the `ico` column default in the MEMORY-002 migration. */
export const DEFAULT_SPACE_ICON: SpaceIconKey = 'brain';

const ICON_BY_KEY: Record<SpaceIconKey, LucideIcon> = {
  brain: Brain,
  book: Book,
  'file-text': FileText,
  briefcase: Briefcase,
  flask: FlaskConical,
  wrench: Wrench,
  gavel: Gavel,
  stethoscope: Stethoscope,
};

function isSpaceIconKey(value: string): value is SpaceIconKey {
  return (SPACE_ICON_KEYS as readonly string[]).includes(value);
}

export function resolveSpaceIconKey(raw: string | null | undefined): SpaceIconKey {
  if (!raw || !isSpaceIconKey(raw)) return DEFAULT_SPACE_ICON;
  return raw;
}

interface SpaceIconProps {
  icon: string | null | undefined;
  className?: string;
}

/** Inherits colour through Lucide's `currentColor` stroke, like FolderIcon. */
export function SpaceIcon({ icon, className }: SpaceIconProps) {
  const Glyph = ICON_BY_KEY[resolveSpaceIconKey(icon)];
  return <Glyph className={cn('h-4 w-4 shrink-0', className)} aria-hidden="true" />;
}
