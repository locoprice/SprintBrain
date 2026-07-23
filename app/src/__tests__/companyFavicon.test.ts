import { describe, expect, it } from 'vitest';
import { BRAND_FAVICON, resolveFaviconHref } from '@/lib/useCompanyFavicon';

// The dashboard tab favicon (v2.119.0) mirrors the extension toolbar + Sprintbrain.html:
// a valid company logo (https) wins, everything else falls back to the brand mark.
describe('resolveFaviconHref', () => {
  it('uses the company logo when it is an https URL', () => {
    const url = 'https://x.supabase.co/storage/v1/object/public/company-logos/u/logo-1.png';
    expect(resolveFaviconHref(url)).toBe(url);
  });

  it('falls back to the brand mark for null, empty, or non-https values', () => {
    for (const v of [null, '', 'http://insecure.example/logo.png', 'ftp://x/y.png', 'logo.png']) {
      expect(resolveFaviconHref(v as string | null)).toBe(BRAND_FAVICON);
    }
  });
});
