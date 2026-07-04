import { describe, expect, it } from 'vitest';
import { formatLocation, parseUserAgent } from '@/lib/deviceInfo';

// UA parsing for the Security tab's device rows. Ordering is the whole game:
// Edge/Opera embed "Chrome", Chrome embeds "Safari", iOS UAs claim
// "like Mac OS X", Android UAs contain "Linux".

const UA = {
  chromeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.87',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
};

describe('parseUserAgent', () => {
  it('labels Chrome on Windows as a desktop device', () => {
    expect(parseUserAgent(UA.chromeWindows)).toEqual({
      browser: 'Chrome',
      os: 'Windows',
      label: 'Chrome on Windows',
      kind: 'desktop',
    });
  });

  it('does not misread Edge as Chrome', () => {
    const info = parseUserAgent(UA.edgeWindows);
    expect(info.browser).toBe('Edge');
    expect(info.label).toBe('Edge on Windows');
  });

  it('labels Safari on macOS', () => {
    expect(parseUserAgent(UA.safariMac).label).toBe('Safari on macOS');
  });

  it('labels Firefox on Linux', () => {
    expect(parseUserAgent(UA.firefoxLinux).label).toBe('Firefox on Linux');
  });

  it('classifies Android Chrome as mobile (Android wins over the embedded "Linux")', () => {
    expect(parseUserAgent(UA.chromeAndroid)).toEqual({
      browser: 'Chrome',
      os: 'Android',
      label: 'Chrome on Android',
      kind: 'mobile',
    });
  });

  it('classifies iPhone Safari as mobile (iOS wins over "like Mac OS X")', () => {
    expect(parseUserAgent(UA.safariIphone)).toEqual({
      browser: 'Safari',
      os: 'iOS',
      label: 'Safari on iOS',
      kind: 'mobile',
    });
  });

  it('falls back to "Unknown device" for null, empty and garbage input', () => {
    for (const ua of [null, undefined, '', 'curl/8.18.0']) {
      const info = parseUserAgent(ua);
      expect(info.label).toBe('Unknown device');
      expect(info.kind).toBe('unknown');
    }
  });
});

describe('formatLocation', () => {
  it('resolves an ISO country code to its English name', () => {
    expect(formatLocation('IT', '1.2.3.4')).toBe('Italy');
    expect(formatLocation('es', null)).toBe('Spain');
  });

  it('falls back to the IP when no country was captured', () => {
    expect(formatLocation(null, '88.18.132.160')).toBe('88.18.132.160');
  });

  it('falls back to a neutral label when nothing was captured', () => {
    expect(formatLocation(null, null)).toBe('Unknown location');
    expect(formatLocation(undefined, undefined)).toBe('Unknown location');
  });

  it('never throws on malformed codes', () => {
    expect(formatLocation('not a code!', null)).toBe('NOT A CODE!');
  });
});
