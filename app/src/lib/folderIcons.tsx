import {
  Clipboard,
  Cpu,
  DollarSign,
  FileText,
  Folder,
  Globe,
  Home,
  Key,
  MessageSquare,
  Star,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Canonical folder-icon vocabulary, shared across all three surfaces. The value
// persisted in `folders.ico` is one of these keyword keys (NOT an emoji), so the
// dashboard, the Chrome extension, and the mobile companion all resolve the same
// glyph. Keep this list and its order in parity with the three other projections
// of the same vocabulary: the extension popup + mobile `_FOLDER_SVGS`
// (extension/popup/popup.js, app/public/mobile/index.html) and the native
// context-menu emoji map `FOLDER_ICON_EMOJI` (extension/background/background.js).
export const FOLDER_ICON_KEYS = [
  'folder',
  'clipboard',
  'home',
  'message',
  'cpu',
  'star',
  'key',
  'dollar',
  'file-text',
  'globe',
] as const;

export type FolderIconKey = (typeof FOLDER_ICON_KEYS)[number];

export const DEFAULT_FOLDER_ICON: FolderIconKey = 'folder';

const ICON_BY_KEY: Record<FolderIconKey, LucideIcon> = {
  folder: Folder,
  clipboard: Clipboard,
  home: Home,
  message: MessageSquare,
  cpu: Cpu,
  star: Star,
  key: Key,
  dollar: DollarSign,
  'file-text': FileText,
  globe: Globe,
};

// Best-effort map from the legacy dashboard emoji set to the canonical keys, so
// folders created before the vocabulary was unified keep a meaningful glyph.
// Emoji with no close equivalent fall back to the default folder glyph.
const LEGACY_EMOJI_TO_KEY: Record<string, FolderIconKey> = {
  '🏠': 'home',
  '🌍': 'globe',
  '🏢': 'folder',
  '📋': 'clipboard',
  '📊': 'folder',
  '💬': 'message',
  '✈️': 'folder',
  '🔧': 'key',
  '📝': 'file-text',
  '⭐': 'star',
};

function isFolderIconKey(value: string): value is FolderIconKey {
  return (FOLDER_ICON_KEYS as readonly string[]).includes(value);
}

// Resolve any stored `folders.ico` value to a canonical key: a known keyword
// maps to itself, a legacy emoji maps to its nearest key, anything else falls
// back to the default folder glyph.
export function resolveFolderIconKey(raw: string | null | undefined): FolderIconKey {
  if (!raw) return DEFAULT_FOLDER_ICON;
  if (isFolderIconKey(raw)) return raw;
  return LEGACY_EMOJI_TO_KEY[raw] ?? DEFAULT_FOLDER_ICON;
}

interface FolderIconProps {
  /** The stored `folders.ico` value (keyword key or legacy emoji). */
  icon: string | null | undefined;
  className?: string;
}

/**
 * Renders the folder glyph for a stored icon value. Inherits text color via
 * Lucide's `currentColor` stroke, so it follows the surrounding palette.
 */
export function FolderIcon({ icon, className }: FolderIconProps) {
  const Glyph = ICON_BY_KEY[resolveFolderIconKey(icon)];
  return <Glyph className={cn('h-4 w-4 shrink-0', className)} aria-hidden="true" />;
}
