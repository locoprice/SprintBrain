// Client-side UX guard — NOT a security control.
//
// This lives in a single tab's memory and resets on reload, so it cannot stop a
// determined caller. Its only job is to stop an honest user from hammering the
// auth endpoints (e.g. double-submitting the magic-link form). The real abuse
// protection is server-side: Supabase Auth rate-limits OTP, password, and
// recovery requests per-IP and per-email. Do not treat this module as the
// boundary — it's the polite first line, the server is the enforced one.

interface RateWindow {
  count: number;
  startMs: number;
}

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

const store = new Map<string, RateWindow>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

export function checkRateLimit(key: string): RateLimitResult {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now - entry.startMs > WINDOW_MS) {
    store.set(key, { count: 1, startMs: now });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (entry.count >= MAX_ATTEMPTS) {
    return { allowed: false, retryAfterMs: WINDOW_MS - (now - entry.startMs) };
  }

  entry.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

export function resetRateLimit(key: string): void {
  store.delete(key);
}
