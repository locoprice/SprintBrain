import { describe, expect, it } from 'vitest';
import {
  buildLogoPath,
  COMPANY_NAME_MAX,
  LOGO_INPUT_ACCEPT,
  LOGO_MAX_BYTES,
  logoPathFromPublicUrl,
  validateLogoFile,
} from '@/lib/branding';

// Upload rules for the Company branding card. The bucket enforces the same
// limits server-side (file_size_limit + allowed_mime_types); these helpers
// exist so the UI can reject bad files before any network call.

describe('validateLogoFile', () => {
  it('accepts every allowed MIME type at a normal size', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']) {
      expect(validateLogoFile({ type, size: 50_000 })).toBeNull();
    }
  });

  it('accepts a file exactly at the 1 MB cap', () => {
    expect(validateLogoFile({ type: 'image/png', size: LOGO_MAX_BYTES })).toBeNull();
  });

  it('rejects a file over the cap', () => {
    expect(validateLogoFile({ type: 'image/png', size: LOGO_MAX_BYTES + 1 })).toMatch(/1 MB/);
  });

  it('rejects unsupported types (gif, pdf, empty string)', () => {
    for (const type of ['image/gif', 'application/pdf', '']) {
      expect(validateLogoFile({ type, size: 1_000 })).toMatch(/PNG, JPG, WebP, or SVG/);
    }
  });

  it('rejects an empty file', () => {
    expect(validateLogoFile({ type: 'image/png', size: 0 })).toMatch(/empty/);
  });
});

describe('buildLogoPath', () => {
  it('keys the object under the user folder with a timestamped name', () => {
    expect(buildLogoPath('user-1', 'image/png', 1720900000000)).toBe(
      'user-1/logo-1720900000000.png',
    );
    expect(buildLogoPath('user-1', 'image/svg+xml', 1)).toBe('user-1/logo-1.svg');
    expect(buildLogoPath('user-1', 'image/jpeg', 2)).toBe('user-1/logo-2.jpg');
  });

  it('throws on a MIME type that validateLogoFile would reject', () => {
    expect(() => buildLogoPath('user-1', 'image/gif', 1)).toThrow(/Unsupported/);
  });
});

describe('logoPathFromPublicUrl', () => {
  const base =
    'https://eyowustlbqujaimaxggt.supabase.co/storage/v1/object/public/company-logos/';

  it('extracts the object key from a public bucket URL', () => {
    expect(logoPathFromPublicUrl(`${base}uid-123/logo-17.png`)).toBe('uid-123/logo-17.png');
  });

  it('returns null for URLs outside the company-logos bucket', () => {
    expect(logoPathFromPublicUrl('https://example.com/logo.png')).toBeNull();
    expect(
      logoPathFromPublicUrl(
        'https://x.supabase.co/storage/v1/object/public/other-bucket/a/logo.png',
      ),
    ).toBeNull();
  });

  it('returns null when the key is missing', () => {
    expect(logoPathFromPublicUrl(base)).toBeNull();
  });
});

describe('constants', () => {
  it('accept attribute lists exactly the allowed MIME types', () => {
    expect(LOGO_INPUT_ACCEPT.split(',')).toEqual([
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
