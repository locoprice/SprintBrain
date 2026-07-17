import { describe, expect, it } from 'vitest';
import {
  AVATAR_BUCKET,
  buildAvatarPath,
  buildLogoPath,
  COMPANY_NAME_MAX,
  IMAGE_INPUT_ACCEPT,
  IMAGE_MAX_BYTES,
  LOGO_BUCKET,
  objectPathFromPublicUrl,
  pickHttpsUrl,
  validateImageFile,
} from '@/lib/branding';

// Upload rules for the Company branding + Account profile-photo cards. The
// buckets enforce the same limits server-side (file_size_limit +
// allowed_mime_types); these helpers exist so the UI can reject bad files
// before any network call.

describe('validateImageFile', () => {
  it('accepts every allowed MIME type at a normal size', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']) {
      expect(validateImageFile({ type, size: 50_000 })).toBeNull();
    }
  });

  it('accepts a file exactly at the 1 MB cap', () => {
    expect(validateImageFile({ type: 'image/png', size: IMAGE_MAX_BYTES })).toBeNull();
  });

  it('rejects a file over the cap', () => {
    expect(validateImageFile({ type: 'image/png', size: IMAGE_MAX_BYTES + 1 })).toMatch(/1 MB/);
  });

  it('rejects unsupported types (gif, pdf, empty string)', () => {
    for (const type of ['image/gif', 'application/pdf', '']) {
      expect(validateImageFile({ type, size: 1_000 })).toMatch(/PNG, JPG, WebP, or SVG/);
    }
  });

  it('rejects an empty file', () => {
    expect(validateImageFile({ type: 'image/png', size: 0 })).toMatch(/empty/);
  });
});

describe('buildLogoPath / buildAvatarPath', () => {
  it('keys objects under the user folder with a timestamped, kind-prefixed name', () => {
    expect(buildLogoPath('user-1', 'image/png', 1720900000000)).toBe(
      'user-1/logo-1720900000000.png',
    );
    expect(buildLogoPath('user-1', 'image/svg+xml', 1)).toBe('user-1/logo-1.svg');
    expect(buildAvatarPath('user-1', 'image/jpeg', 2)).toBe('user-1/avatar-2.jpg');
    expect(buildAvatarPath('user-1', 'image/webp', 3)).toBe('user-1/avatar-3.webp');
  });

  it('throws on a MIME type that validateImageFile would reject', () => {
    expect(() => buildLogoPath('user-1', 'image/gif', 1)).toThrow(/Unsupported/);
    expect(() => buildAvatarPath('user-1', 'image/gif', 1)).toThrow(/Unsupported/);
  });
});

describe('objectPathFromPublicUrl', () => {
  const origin = 'https://eyowustlbqujaimaxggt.supabase.co';

  it('extracts the object key from a public bucket URL, per bucket', () => {
    expect(
      objectPathFromPublicUrl(
        `${origin}/storage/v1/object/public/company-logos/uid-123/logo-17.png`,
        LOGO_BUCKET,
      ),
    ).toBe('uid-123/logo-17.png');
    expect(
      objectPathFromPublicUrl(
        `${origin}/storage/v1/object/public/avatars/uid-123/avatar-17.jpg`,
        AVATAR_BUCKET,
      ),
    ).toBe('uid-123/avatar-17.jpg');
  });

  it('returns null when the URL points at a different bucket', () => {
    const logoUrl = `${origin}/storage/v1/object/public/company-logos/a/logo.png`;
    expect(objectPathFromPublicUrl(logoUrl, AVATAR_BUCKET)).toBeNull();
    expect(objectPathFromPublicUrl('https://example.com/logo.png', LOGO_BUCKET)).toBeNull();
  });

  it('returns null when the key is missing', () => {
    expect(
      objectPathFromPublicUrl(`${origin}/storage/v1/object/public/avatars/`, AVATAR_BUCKET),
    ).toBeNull();
  });
});

describe('pickHttpsUrl', () => {
  it('returns an https URL string stored under the key', () => {
    expect(pickHttpsUrl({ avatar_url: 'https://x.co/a.png' }, 'avatar_url')).toBe(
      'https://x.co/a.png',
    );
  });

  it('treats non-https and non-string values as unset', () => {
    expect(pickHttpsUrl({ avatar_url: 'http://x.co/a.png' }, 'avatar_url')).toBeNull();
    expect(pickHttpsUrl({ avatar_url: 42 }, 'avatar_url')).toBeNull();
    expect(pickHttpsUrl({ avatar_url: null }, 'avatar_url')).toBeNull();
  });

  it('handles missing keys and missing metadata', () => {
    expect(pickHttpsUrl({}, 'avatar_url')).toBeNull();
    expect(pickHttpsUrl(undefined, 'avatar_url')).toBeNull();
  });
});

describe('constants', () => {
  it('accept attribute lists exactly the allowed MIME types', () => {
    expect(IMAGE_INPUT_ACCEPT.split(',')).toEqual([
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/svg+xml',
    ]);
  });

  it('company name cap matches the settings input', () => {
    expect(COMPANY_NAME_MAX).toBe(60);
  });
});
