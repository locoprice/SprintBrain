import { describe, expect, it } from 'vitest';
import { COVER_MAX_WIDTH, fitWithin } from '@/lib/imageResize';
import { COVER_SOURCE_MAX_BYTES, validateCoverSource } from '@/lib/branding';

// Cover uploads downscale before hitting the 2 MB storage cap, so a normal
// phone photo is resized rather than rejected. The canvas work needs a browser;
// these cover the pure sizing maths and the pre-downscale validation.

describe('fitWithin', () => {
  it('scales a large landscape photo down to the max width, keeping aspect ratio', () => {
    expect(fitWithin(4000, 2500, COVER_MAX_WIDTH)).toEqual({ width: 2560, height: 1600 });
  });

  it('leaves an image narrower than the cap untouched (never upscales)', () => {
    expect(fitWithin(1200, 800, COVER_MAX_WIDTH)).toEqual({ width: 1200, height: 800 });
    expect(fitWithin(2560, 1440, COVER_MAX_WIDTH)).toEqual({ width: 2560, height: 1440 });
  });

  it('rounds height and never collapses a very wide panorama to zero', () => {
    const out = fitWithin(20000, 30, COVER_MAX_WIDTH);
    expect(out.width).toBe(2560);
    expect(out.height).toBeGreaterThanOrEqual(1);
  });

  it('passes through degenerate dimensions rather than dividing by zero', () => {
    expect(fitWithin(0, 0, COVER_MAX_WIDTH)).toEqual({ width: 0, height: 0 });
  });
});

describe('validateCoverSource', () => {
  it('accepts a multi-megabyte photo — downscaling handles the size', () => {
    expect(validateCoverSource({ type: 'image/jpeg', size: 9 * 1024 * 1024 })).toBeNull();
  });

  it('accepts every cover mime', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      expect(validateCoverSource({ type, size: 500_000 })).toBeNull();
    }
  });

  it('rejects SVG for covers (the bucket does too)', () => {
    expect(validateCoverSource({ type: 'image/svg+xml', size: 1000 })).toMatch(/PNG, JPG, or WebP/);
  });

  it('rejects an empty file', () => {
    expect(validateCoverSource({ type: 'image/png', size: 0 })).toMatch(/empty/);
  });

  it('rejects a source past the outer ceiling', () => {
    expect(
      validateCoverSource({ type: 'image/jpeg', size: COVER_SOURCE_MAX_BYTES + 1 }),
    ).toMatch(/20 MB/);
  });
});
