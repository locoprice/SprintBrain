import { describe, expect, it } from 'vitest';
import {
  buildTeamCoverPath,
  COVER_MAX_BYTES,
  objectPathFromPublicUrl,
  TEAM_COVER_BUCKET,
  validateImageFile,
} from '@/lib/branding';
import {
  coverPresetClass,
  isImageCover,
  isPresetCover,
  TEAM_COVER_PRESETS,
} from '@/lib/teamCoverPresets';

// Team cover (TEAM-COVER-001). The organizations.cover column holds either a
// preset key or an uploaded-image URL; these helpers decide which and build the
// per-org storage key. The bucket enforces the same 2 MB / mime limits.

describe('cover preset discrimination', () => {
  it('recognizes every shipped preset key', () => {
    for (const p of TEAM_COVER_PRESETS) {
      expect(isPresetCover(p.key)).toBe(true);
      expect(isImageCover(p.key)).toBe(false);
    }
  });

  it('treats an https URL as an image cover, not a preset', () => {
    const url = 'https://x.supabase.co/storage/v1/object/public/team-covers/o/cover-1.jpg';
    expect(isImageCover(url)).toBe(true);
    expect(isPresetCover(url)).toBe(false);
  });

  it('treats null / unknown values as neither', () => {
    for (const v of [null, undefined, '', 'chartreuse', 'http://insecure']) {
      expect(isImageCover(v)).toBe(false);
      expect(isPresetCover(v)).toBe(false);
    }
  });

  it('derives the artwork class from a preset key', () => {
    expect(coverPresetClass('azure')).toBe('team-cover-azure');
    expect(coverPresetClass('paper')).toBe('team-cover-paper');
  });

  it('ships the six approved presets', () => {
    expect(TEAM_COVER_PRESETS.map((p) => p.key)).toEqual([
      'azure',
      'dusk',
      'sea',
      'sand',
      'night',
      'paper',
    ]);
  });
});

describe('buildTeamCoverPath', () => {
  it('keys the object under the org folder with a timestamped name', () => {
    expect(buildTeamCoverPath('org-1', 'image/jpeg', 1720900000000)).toBe(
      'org-1/cover-1720900000000.jpg',
    );
    expect(buildTeamCoverPath('org-1', 'image/webp', 7)).toBe('org-1/cover-7.webp');
  });

  it('round-trips through objectPathFromPublicUrl for the team-covers bucket', () => {
    const key = buildTeamCoverPath('org-9', 'image/png', 42);
    const url = `https://x.supabase.co/storage/v1/object/public/${TEAM_COVER_BUCKET}/${key}`;
    expect(objectPathFromPublicUrl(url, TEAM_COVER_BUCKET)).toBe(key);
  });
});

describe('validateImageFile with the cover cap', () => {
  it('accepts a photo up to 2 MB', () => {
    expect(validateImageFile({ type: 'image/jpeg', size: COVER_MAX_BYTES }, COVER_MAX_BYTES)).toBeNull();
  });

  it('rejects over 2 MB with a matching message', () => {
    expect(
      validateImageFile({ type: 'image/jpeg', size: COVER_MAX_BYTES + 1 }, COVER_MAX_BYTES),
    ).toMatch(/2 MB/);
  });

  it('still enforces the 1 MB default when no cap is passed', () => {
    expect(validateImageFile({ type: 'image/png', size: 1_048_576 + 1 })).toMatch(/1 MB/);
  });
});
