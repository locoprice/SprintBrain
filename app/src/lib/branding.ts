// Company-branding upload rules (BRANDING-001), shared by the Branding
// settings card and settingsApi. Pure module — no Supabase imports — so the
// validation and URL/path mapping stay unit-testable.

/** Storage bucket for per-user company logos (public read, owner-scoped writes). */
export const LOGO_BUCKET = 'company-logos';

/** Mirrors the bucket's server-side file_size_limit for instant client feedback. */
export const LOGO_MAX_BYTES = 1_048_576;

/** Accepted upload MIME types mapped to the object-key extension. */
export const LOGO_MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

/** `accept` attribute for the logo file input. */
export const LOGO_INPUT_ACCEPT = Object.keys(LOGO_MIME_TO_EXT).join(',');

export const COMPANY_NAME_MAX = 60;

/** Validate a candidate logo file. Returns a user-facing error, or null when valid. */
export function validateLogoFile(file: { type: string; size: number }): string | null {
  if (!(file.type in LOGO_MIME_TO_EXT)) return 'Use a PNG, JPG, WebP, or SVG image.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > LOGO_MAX_BYTES) return 'Logo must be 1 MB or smaller.';
  return null;
}

/** Object key for a user's logo. Timestamped so a replacement never serves a stale cache hit. */
export function buildLogoPath(userId: string, mime: string, now: number): string {
  const ext = LOGO_MIME_TO_EXT[mime];
  if (!ext) throw new Error(`Unsupported logo type: ${mime}`);
  return `${userId}/logo-${now}.${ext}`;
}

/**
 * Extract the object key from a public-bucket URL
 * (…/storage/v1/object/public/company-logos/<key>). Returns null for any
 * other URL so cleanup never touches foreign paths.
 */
export function logoPathFromPublicUrl(url: string): string | null {
  const marker = `/storage/v1/object/public/${LOGO_BUCKET}/`;
  const i = url.indexOf(marker);
  if (i === -1) return null;
  const path = url.slice(i + marker.length);
  return path.length > 0 ? path : null;
}
