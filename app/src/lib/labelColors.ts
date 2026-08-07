import type { LabelColor } from '@/types/database';

/**
 * Label palette (LABELS-001). The DB stores a key, never a hex — this module is
 * the dashboard's resolver, the same contract `folderIcons.tsx` has for
 * `folders.ico`. Values are registered in docs/DESIGN_SYSTEM.md ("Label
 * palette"); this is the only file in `app/` allowed to spell them out.
 *
 * Badges keep their light tints in dark mode, matching every other chip on the
 * dashboard (language pills, strategy chips, Badge variant="primary").
 */
export interface LabelSwatch {
  /** Menu label in the color picker. */
  name: string;
  /** Badge classes: tint ground, border, and AA-safe text. */
  chip: string;
  /** Text colour alone, for a control that carries the label's identity without the chip. */
  text: string;
  /** Solid fill for the picker swatch and the filter menu dot. */
  dot: string;
}

export const LABEL_COLORS: Record<LabelColor, LabelSwatch> = {
  azure:  { name: 'Azure',  chip: 'bg-[#EEF2FF] text-[#1B4FD8] border-[#BED0FF]', text: 'text-[#1B4FD8]', dot: 'bg-[#1B4FD8]' },
  violet: { name: 'Violet', chip: 'bg-[#F5F3FF] text-[#7C3AED] border-[#DDD6FE]', text: 'text-[#7C3AED]', dot: 'bg-[#7C3AED]' },
  green:  { name: 'Green',  chip: 'bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0]', text: 'text-[#15803D]', dot: 'bg-[#15803D]' },
  orange: { name: 'Orange', chip: 'bg-[#FFF7ED] text-[#C2410C] border-[#FED7AA]', text: 'text-[#C2410C]', dot: 'bg-[#C2410C]' },
  teal:   { name: 'Teal',   chip: 'bg-[#F0FDFA] text-[#0F766E] border-[#99F6E4]', text: 'text-[#0F766E]', dot: 'bg-[#0F766E]' },
  rose:   { name: 'Rose',   chip: 'bg-[#FFF1F2] text-[#BE123C] border-[#FECDD3]', text: 'text-[#BE123C]', dot: 'bg-[#BE123C]' },
  amber:  { name: 'Amber',  chip: 'bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]', text: 'text-[#D97706]', dot: 'bg-[#D97706]' },
  slate:  { name: 'Slate',  chip: 'bg-[#F1F5F9] text-[#475569] border-[#CBD5E1]', text: 'text-[#475569]', dot: 'bg-[#CBD5E1]' },
};

/** Picker order — brand first, neutral last. */
export const LABEL_COLOR_KEYS = Object.keys(LABEL_COLORS) as LabelColor[];

export const DEFAULT_LABEL_COLOR: LabelColor = 'azure';

/**
 * Resolve a stored key. A row written by a future surface (or hand-edited in
 * SQL) that carries an unknown key still renders — as the default swatch —
 * rather than crashing the list it appears in.
 */
export function labelSwatch(color: string): LabelSwatch {
  return LABEL_COLORS[color as LabelColor] ?? LABEL_COLORS[DEFAULT_LABEL_COLOR];
}
