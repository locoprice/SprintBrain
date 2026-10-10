// read-link — Supabase Edge Function (Deno)
// Fill from link: a person pastes a link to a public web page (an order, a
// ticket, a confirmation, a form receipt) into a snippet's fill form, and the
// form fills itself from what the page says.
//
//   link → the page → its visible text, as an ordered list of pieces
//
// Which piece fills which field is decided by the fill form itself
// (extension/shared/fill-form.js, readFromPage), on every surface, from the
// rules the snippet's author wrote. This function only fetches and reads: it
// returns text and never interprets it, so the same page can never be read
// two ways.
//
// Why a server at all: a phone browser may not read another site's page, so
// the four places a form is filled (the extension's overlay and popup, the
// dashboard preview and the phone) all come here, and all get the same text.
//
// Guarantees, each enforced here:
//
// 1. Only a signed-in caller can use it: the JWT is checked first, and there
//    is no service-role client in this file.
// 2. A per-person limit (link_read_allow, see the migration
//    20261008120000_link_reads.sql): 20 pages a minute and 300 a day.
// 3. Only public web pages: https on the standard port, a domain name rather
//    than an address, nothing private or internal before or after the name is
//    looked up, every redirect checked again, never a step down to http.
// 4. Bounded: 10 seconds for the whole fetch, 3 MB read at most, HTML only.
// 5. Nothing is stored and nothing of the page is logged. A link can work like
//    a password to the page it opens, so the logs carry its host only, never
//    its path or query, and never the text read.
//
// Environment (injected automatically by the runtime):
//   SUPABASE_URL, SUPABASE_ANON_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isPrivateAddress, linkProblem } from './linkGuard.ts';
import { declaredCharset, pageText } from './pageText.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

/** The whole fetch, redirects included. */
const TIMEOUT_MS = 10_000;
/** Bytes read from one page before giving up on it. */
const MAX_PAGE_BYTES = 3 * 1024 * 1024;
/** Redirects followed before giving up. */
const MAX_REDIRECTS = 3;
/** What the page is told is reading it. */
const USER_AGENT = 'Mozilla/5.0 (compatible; SprintBrain-LinkReader/1.0; +https://sprintbrain.com)';

const PAGE_TYPES = ['text/html', 'application/xhtml+xml'];

type Failure = { code: string; status: number; upstream?: number };

class ReadFailure extends Error {
  constructor(readonly failure: Failure) {
    super(failure.code);
  }
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function fail(code: string, status: number, upstream?: number): never {
  throw new ReadFailure({ code, status, upstream });
}

/** A language tag safe to forward as Accept-Language, or ''. */
function cleanLang(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/.test(s) ? s : '';
}

/**
 * Refuses a host whose name is looked up to a private address. The runtime
 * may not offer a lookup; then the name rules in linkGuard are the floor.
 */
async function checkResolved(host: string): Promise<void> {
  const resolve = (Deno as unknown as {
    resolveDns?: (name: string, type: 'A' | 'AAAA') => Promise<string[]>;
  }).resolveDns;
  if (typeof resolve !== 'function') return;
  const found: string[] = [];
  for (const type of ['A', 'AAAA'] as const) {
    try {
      found.push(...(await resolve(host, type)));
    } catch {
      // No record of this type; the other may still answer.
    }
  }
  if (found.length === 0) fail('link_unreachable', 502);
  if (found.some(isPrivateAddress)) fail('link_not_allowed', 400);
}

/** Reads at most MAX_PAGE_BYTES of a body, then stops. */
async function readCapped(res: Response): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > MAX_PAGE_BYTES) fail('link_too_large', 413);
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_PAGE_BYTES) {
      await reader.cancel();
      fail('link_too_large', 413);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

function decode(bytes: Uint8Array, contentType: string): string {
  const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 4096));
  const charset = declaredCharset(contentType, head) || 'utf-8';
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** Fetches the page, following redirects only to links that pass the same checks. */
async function fetchPage(link: string, lang: string, signal: AbortSignal): Promise<{ html: string; host: string }> {
  let current = link;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const problem = linkProblem(current);
    if (problem) fail(problem, 400);
    const host = new URL(current).hostname;
    await checkResolved(host);

    let res: Response;
    try {
      res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
          ...(lang ? { 'Accept-Language': `${lang}, *;q=0.5` } : {}),
        },
      });
    } catch (err) {
      if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        fail('link_timeout', 504);
      }
      fail('link_unreachable', 502);
    }

    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      await res.body?.cancel();
      if (!next) fail('link_status', 502, res.status);
      // Relative locations resolve against the page that sent them; the next
      // turn of the loop checks the result like any pasted link.
      current = new URL(next, current).toString();
      continue;
    }
    if (res.type === 'opaqueredirect') fail('link_unreachable', 502);
    if (res.status < 200 || res.status >= 300) {
      await res.body?.cancel();
      fail('link_status', 502, res.status);
    }
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    if (!PAGE_TYPES.some((t) => contentType.startsWith(t))) {
      await res.body?.cancel();
      fail('link_not_page', 415);
    }
    const bytes = await readCapped(res);
    return { html: decode(bytes, contentType), host };
  }
  fail('link_status', 502, 310);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  // ── Auth: validate the caller's JWT ──────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: 'unauthorized' }, 401);

  // ── Parse the request ────────────────────────────────────────────
  // The link travels in the body, never in the query string, so it stays out
  // of the platform's request logs.
  let payload: { url?: unknown; lang?: unknown };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const link = typeof payload.url === 'string' ? payload.url.trim() : '';
  const problem = linkProblem(link);
  if (problem) return json({ error: problem }, 400);

  // ── Per-person limit ─────────────────────────────────────────────
  const { data: allowed, error: limitError } = await userClient.rpc('link_read_allow');
  if (limitError) {
    console.error('read-link: rate limit check failed', JSON.stringify({ code: limitError.code ?? null }));
    return json({ error: 'failed' }, 503);
  }
  if (allowed !== true) {
    return new Response(JSON.stringify({ error: 'rate_limited' }), {
      status: 429,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Retry-After': '60' },
    });
  }

  // ── Fetch and read ───────────────────────────────────────────────
  const started = Date.now();
  const host = new URL(link).hostname;
  try {
    const page = await fetchPage(link, cleanLang(payload.lang), AbortSignal.timeout(TIMEOUT_MS));
    const pieces = pageText(page.html);
    return json({ ok: true, host: page.host, pieces }, 200);
  } catch (err) {
    const failure: Failure = err instanceof ReadFailure
      ? err.failure
      : { code: 'link_unreachable', status: 502 };
    console.error('read-link: page not read', JSON.stringify({
      code: failure.code,
      upstream: failure.upstream ?? null,
      host,
      ms: Date.now() - started,
      cause: err instanceof ReadFailure ? null : (err instanceof Error ? err.name : 'unknown'),
    }));
    return json(failure.upstream ? { error: failure.code, status: failure.upstream } : { error: failure.code },
      failure.status);
  }
});
