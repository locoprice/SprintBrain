// Small user-agent reader for the Security tab — turns a raw UA string into
// "Chrome on Windows" plus a device kind for icon selection. Deliberately not
// a full parser (no versions, no bots): sessions here were created by real
// browsers signing in to SprintBrain, so a handful of ordered checks covers
// the population. Order matters — Edge/Opera embed "Chrome", Chrome embeds
// "Safari", iOS Chrome is "CriOS".

export interface DeviceInfo {
  browser: string | null;
  os: string | null;
  label: string;
  kind: 'desktop' | 'mobile' | 'unknown';
}

export function parseUserAgent(ua: string | null | undefined): DeviceInfo {
  const s = ua ?? '';

  let browser: string | null = null;
  if (s.includes('Edg/') || s.includes('EdgiOS') || s.includes('EdgA')) browser = 'Edge';
  else if (s.includes('OPR/') || s.includes('Opera')) browser = 'Opera';
  else if (s.includes('Firefox/') || s.includes('FxiOS')) browser = 'Firefox';
  else if (s.includes('CriOS') || s.includes('Chrome/')) browser = 'Chrome';
  else if (s.includes('Safari/') && s.includes('Version/')) browser = 'Safari';

  let os: string | null = null;
  let kind: DeviceInfo['kind'] = 'unknown';
  if (/iPhone|iPad|iPod/.test(s)) {
    os = 'iOS';
    kind = 'mobile';
  } else if (s.includes('Android')) {
    os = 'Android';
    kind = 'mobile';
  } else if (s.includes('Windows NT')) {
    os = 'Windows';
    kind = 'desktop';
  } else if (s.includes('Mac OS X') || s.includes('Macintosh')) {
    os = 'macOS';
    kind = 'desktop';
  } else if (s.includes('CrOS')) {
    os = 'ChromeOS';
    kind = 'desktop';
  } else if (s.includes('Linux')) {
    os = 'Linux';
    kind = 'desktop';
  }

  let label: string;
  if (browser && os) label = `${browser} on ${os}`;
  else if (browser) label = browser;
  else if (os) label = os;
  else label = 'Unknown device';

  return { browser, os, label, kind };
}

/**
 * "Italy" from an ISO country code, the raw IP when no country was captured,
 * or a neutral fallback. Codes come from Cloudflare's cf-ipcountry header
 * (two letters), but guard against anything unexpected.
 */
export function formatLocation(
  country: string | null | undefined,
  ip: string | null | undefined,
): string {
  if (country) {
    const code = country.toUpperCase();
    try {
      const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(code);
      if (name) return name;
    } catch {
      // Malformed code — fall through to the raw value.
    }
    return code;
  }
  if (ip) return ip;
  return 'Unknown location';
}
