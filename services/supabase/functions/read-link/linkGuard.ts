// linkGuard.ts — which links read-link may open.
//
// Pure: no Deno APIs, no network, no imports, so the app's test runner can load
// it by relative path (app/src/__tests__/readLink.test.ts), the same way it
// loads translate-body/tokenMask.ts.
//
// read-link fetches a page somebody pasted, from SprintBrain's own servers. A
// link that names a machine inside a private network, or the server itself,
// would turn that into a way to reach things the person could never reach
// from their own browser. So a link is refused unless it is plainly a public
// web page: https, the standard port, a real domain name, no user name or
// password in it, and no bare IP address. Names that resolve to a private
// address are refused after the lookup too (isPrivateAddress), where the
// runtime offers one.

/** Longest link accepted. Real page links are far shorter. */
export const MAX_LINK_LENGTH = 2048;

/** Name endings that only ever point inside a private network. */
const PRIVATE_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan', '.intranet'];

/**
 * Why a link may not be read, or '' when it may.
 * Codes are the ones read-link answers with: invalid_link, link_not_allowed.
 */
export function linkProblem(raw: string): '' | 'invalid_link' | 'link_not_allowed' {
  if (typeof raw !== 'string') return 'invalid_link';
  const s = raw.trim();
  if (s === '' || s.length > MAX_LINK_LENGTH) return 'invalid_link';
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return 'invalid_link';
  }
  if (url.protocol !== 'https:') return 'link_not_allowed';
  if (url.username !== '' || url.password !== '') return 'link_not_allowed';
  if (url.port !== '' && url.port !== '443') return 'link_not_allowed';
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === '' || host === 'localhost') return 'link_not_allowed';
  // A bracketed IPv6 address, or any IPv4 address. The URL parser has already
  // turned decimal, hex and octal spellings (https://2130706433/) into dotted
  // form, so one pattern catches all of them.
  if (host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return 'link_not_allowed';
  if (!host.includes('.')) return 'link_not_allowed';
  for (const suffix of PRIVATE_SUFFIXES) {
    if (host.endsWith(suffix)) return 'link_not_allowed';
  }
  return '';
}

type V4 = [number, number, number, number];

function v4Parts(ip: string): V4 | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts: V4 = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  return parts.every((n) => n >= 0 && n <= 255) ? parts : null;
}

function privateV4([a, b]: V4): boolean {
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // shared carrier space
    (a === 169 && b === 254) ||          // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224                              // multicast and reserved
  );
}

/**
 * Whether a resolved address is one a public web page cannot live at:
 * private, loopback, link-local, carrier-shared, multicast or reserved,
 * IPv4 or IPv6 (including IPv4 written inside IPv6).
 */
export function isPrivateAddress(ip: string): boolean {
  const s = String(ip).trim().toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = v4Parts(s);
  if (v4) return privateV4(v4);
  if (!s.includes(':')) return true;
  if (s === '::' || s === '::1') return true;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (mapped) {
    const inner = v4Parts(mapped[1] ?? '');
    return inner ? privateV4(inner) : true;
  }
  const first = parseInt(s.split(':')[0] || '0', 16);
  if (Number.isNaN(first)) return true;
  return (
    (first & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (first & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (first & 0xff00) === 0xff00 || // multicast
    s.startsWith('64:ff9b:')       // IPv4 translated
  );
}
