// Team-cover presets (TEAM-COVER-001). The `organizations.cover` column holds
// either one of these preset keys (rendered as a CSS gradient — the artwork
// lives in index.css as `.team-cover-<key>`) or the https URL of an uploaded
// image. Pure module so the picker list and the preset/URL discrimination stay
// unit-testable.

export const TEAM_COVER_PRESETS = [
  { key: 'azure', label: 'Azure' },
  { key: 'dusk', label: 'Ibiza dusk' },
  { key: 'sea', label: 'Sea' },
  { key: 'sand', label: 'Sand' },
  { key: 'night', label: 'Night' },
  { key: 'paper', label: 'Paper' },
] as const;

export type TeamCoverPresetKey = (typeof TEAM_COVER_PRESETS)[number]['key'];

const PRESET_KEYS: readonly string[] = TEAM_COVER_PRESETS.map((p) => p.key);

/** A cover value is an uploaded image when it's an https URL. */
export function isImageCover(cover: string | null | undefined): cover is string {
  return typeof cover === 'string' && cover.startsWith('https://');
}

/** A cover value is a preset when it matches one of the known keys. */
export function isPresetCover(cover: string | null | undefined): cover is TeamCoverPresetKey {
  return typeof cover === 'string' && PRESET_KEYS.includes(cover);
}

/** CSS class carrying a preset's gradient artwork (defined in index.css). */
export function coverPresetClass(key: string): string {
  return `team-cover-${key}`;
}

/** Default preset applied by "Add cover" when none is set. */
export const DEFAULT_COVER_PRESET: TeamCoverPresetKey = 'azure';
