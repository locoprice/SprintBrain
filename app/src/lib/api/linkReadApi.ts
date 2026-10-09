import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { readEdgeErrorCode } from '@/lib/api/edgeFunctionError';
import { linkText } from '@/lib/fillFormEngine';

// Fill from link.
//
// Calls the read-link edge function, which opens the page somebody pasted from
// SprintBrain's servers and hands back its visible text as ordered pieces. What
// those pieces put in the form is decided by shared/fill-form.js
// (readFromPage), never here. Every sentence shown for a failure comes from
// the same module (linkText), so the four fill surfaces word it identically.

const EDGE_FN_READ_LINK = 'read-link';

/**
 * Whether the shared words have a sentence of their own for a server code.
 * Decided by `linkText` itself, as the overlay and the phone do by handing the
 * code straight to it, so a code the shared module gains reads the same on
 * every surface. Anything else (invalid_json, method_not_allowed, a platform
 * 404 while the function is not deployed) reads as the generic failure.
 */
function hasOwnWords(code: string): boolean {
  return code !== '' && linkText(code) !== linkText('failed');
}

/** A page read: where it came from and its text, in reading order. */
export interface LinkPage {
  host: string;
  pieces: string[];
}

/** A read that did not happen, with the `linkText` key that says why. */
export class LinkReadError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(linkText(code));
    this.name = 'LinkReadError';
    this.code = code;
  }
}

export interface LinkReadApi {
  /**
   * Reads a page for Fill from link. `url` has already passed `linkUrl`; `lang`
   * is the browser's language, which the server sends on as the page's
   * preferred language. Rejects with a LinkReadError.
   */
  readLink(url: string, lang: string): Promise<LinkPage>;
}

function parsePage(data: unknown): LinkPage | null {
  if (!data || typeof data !== 'object') return null;
  const body = data as { ok?: unknown; host?: unknown; pieces?: unknown };
  if (body.ok !== true || !Array.isArray(body.pieces)) return null;
  const pieces = body.pieces.filter((p): p is string => typeof p === 'string');
  return { host: typeof body.host === 'string' ? body.host : '', pieces };
}

/** The `linkText` key for a failed call. */
async function failureCode(error: unknown): Promise<string> {
  // The request never reached SprintBrain: the person is offline, or a
  // network in between refused it.
  if (error instanceof FunctionsFetchError) return 'offline';
  if (error instanceof FunctionsHttpError) {
    const status = (error.context as { status?: unknown } | undefined)?.status;
    // A session that ended is a 401 whatever the body says.
    if (status === 401) return 'unauthorized';
    const code = await readEdgeErrorCode(error);
    if (hasOwnWords(code)) return code;
    // Never the link itself: its path and query can carry someone's details.
    console.error('read-link: unexpected answer', { status, code });
    return 'failed';
  }
  console.error('read-link: the call failed', error instanceof Error ? error.name : typeof error);
  return 'failed';
}

export const linkReadApi: LinkReadApi = {
  async readLink(url, lang) {
    const { data, error } = await supabase.functions.invoke<unknown>(EDGE_FN_READ_LINK, {
      body: { url, lang },
    });
    if (error) throw new LinkReadError(await failureCode(error));
    const page = parsePage(data);
    if (!page) {
      console.error('read-link: the answer was not a page');
      throw new LinkReadError('failed');
    }
    return page;
  },
};
