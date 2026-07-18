// Shared image-upload rules for branding assets: the company logo (Branding
// card, BRANDING-001), the profile picture (Account card, ACCOUNT-PROFILE-001),
// and the team cover (Team page, TEAM-COVER-001). Pure module — no Supabase
// imports — so validation and URL/path mapping stay unit-testable.

/** Storage buckets (public read; owner-folder or org-admin writes — see migrations). */
export const LOGO_BUCKET = 'company-logos';
export const AVATAR_BUCKET = 'avatars';
export const TEAM_COVER_BUCKET = 'team-covers';

/** Mirrors the buckets' server-side file_size_limit for instant client feedback. */
export const IMAGE_MAX_BYTES = 1_048_576;
/** Team covers are photos — a larger cap than the 1 MB logo/avatar limit. */
export const COVER_MAX_BYTES = 2_097_152;

/** Accepted upload MIME types mapped to the object-key extension. */
export const IMAGE_MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

/** `accept` attribute for image file inputs. */
export const IMAGE_INPUT_ACCEPT = Object.keys(IMAGE_MIME_TO_EXT).join(',');

/** Team covers are raster photos — the bucket rejects SVG, so the picker omits it too. */
export const COVER_INPUT_ACCEPT = 'image/png,image/jpeg,image/webp';

export const COMPANY_NAME_MAX = 60;

/**
 * Validate a candidate image file. Returns a user-facing error, or null when
 * valid. `maxBytes` defaults to the 1 MB logo/avatar cap; the team cover passes
 * COVER_MAX_BYTES.
 */
export function validateImageFile(
  file: { type: string; size: number },
  maxBytes: number = IMAGE_MAX_BYTES,
): string | null {
  if (!(file.type in IMAGE_MIME_TO_EXT)) return 'Use a PNG, JPG, WebP, or SVG image.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > maxBytes) {
    return `Image must be ${Math.round(maxBytes / 1_048_576)} MB or smaller.`;
  }
  return null;
}

/** Object key under a user or org folder. Timestamped so a replacement never serves a stale cache hit. */
function buildImagePath(
  folderId: string,
  base: 'logo' | 'avatar' | 'cover',
  mime: string,
  now: number,
): string {
  const ext = IMAGE_MIME_TO_EXT[mime];
  if (!ext) throw new Error(`Unsupported image type: ${mime}`);
  return `${folderId}/${base}-${now}.${ext}`;
}

export function buildLogoPath(userId: string, mime: string, now: number): string {
  return buildImagePath(userId, 'logo', mime, now);
}

export function buildAvatarPath(userId: string, mime: string, now: number): string {
  return buildImagePath(userId, 'avatar', mime, now);
}

export function buildTeamCoverPath(orgId: string, mime: string, now: number): string {
  return buildImagePath(orgId, 'cover', mime, now);
}

/**
 * Extract the object key from a public-bucket URL
 * (…/storage/v1/object/public/<bucket>/<key>). Returns null for any other
 * URL so cleanup never touches foreign paths.
 */
export function objectPathFromPublicUrl(url: string, bucket: string): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const i = url.indexOf(marker);
  if (i === -1) return null;
  const path = url.slice(i + marker.length);
  return path.length > 0 ? path : null;
}

/** Read an https URL string from user_metadata; anything else counts as unset. */
export function pickHttpsUrl(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const v = metadata?.[key];
  return typeof v === 'string' && v.startsWith('https://') ? v : null;
}
