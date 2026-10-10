import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Fill from link: the dashboard's call to read-link, and what each way it can
// fail says to the person. The words come from the shared fill-form module, so
// the real one is loaded; only the network is stubbed. The function is not
// deployed yet, so a platform 404 has to read as an ordinary failure too.

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke } } }));

import { LinkReadError, linkReadApi } from '@/lib/api/linkReadApi';

type Requirer = (id: string) => unknown;

function loadShared(path: string, req?: Requirer): unknown {
  const src = readFileSync(path, 'utf8');
  const mod = { exports: {} as unknown };
  const run = new Function('module', 'exports', 'require', src) as (
    m: typeof mod,
    e: unknown,
    r: Requirer,
  ) => void;
  run(mod, mod.exports, req ?? (() => ({})));
  return mod.exports;
}

const engine = loadShared(resolve(process.cwd(), '..', 'extension', 'formula-engine.js'));
const fillForm = loadShared(
  resolve(process.cwd(), '..', 'extension', 'shared', 'fill-form.js'),
  (id) => {
    if (id === '../formula-engine.js') return engine;
    throw new Error(`fill-form.js asked for an unexpected module: ${id}`);
  },
) as { linkText: (key: string) => string; LINK_TEXT: Record<string, string> };

const scope = globalThis as unknown as { window?: unknown };
const LINK = 'https://example.com/order/7?key=private-token';

beforeAll(() => {
  scope.window = { SBFillForm: fillForm, SBFormulaEngine: engine };
});

afterAll(() => {
  delete scope.window;
});

afterEach(() => {
  invoke.mockReset();
  vi.restoreAllMocks();
});

function httpError(status: number, body: unknown): FunctionsHttpError {
  return new FunctionsHttpError(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

async function failure(error: unknown): Promise<LinkReadError> {
  invoke.mockResolvedValueOnce({ data: null, error });
  try {
    await linkReadApi.readLink(LINK, 'en-GB');
  } catch (err) {
    expect(err).toBeInstanceOf(LinkReadError);
    return err as LinkReadError;
  }
  throw new Error('readLink resolved where it should have failed');
}

describe('linkReadApi.readLink', () => {
  it('asks read-link for the page, in the browser language', async () => {
    invoke.mockResolvedValueOnce({
      data: { ok: true, host: 'example.com', pieces: ['Order number', 'A-4471'] },
      error: null,
    });
    await expect(linkReadApi.readLink(LINK, 'en-GB')).resolves.toEqual({
      host: 'example.com',
      pieces: ['Order number', 'A-4471'],
    });
    expect(invoke).toHaveBeenCalledWith('read-link', { body: { url: LINK, lang: 'en-GB' } });
  });

  it('keeps only the text pieces of an answer', async () => {
    invoke.mockResolvedValueOnce({
      data: { ok: true, host: 'example.com', pieces: ['A', 7, null, 'B'] },
      error: null,
    });
    await expect(linkReadApi.readLink(LINK, '')).resolves.toEqual({
      host: 'example.com',
      pieces: ['A', 'B'],
    });
  });

  it.each([
    ['rate_limited', 429],
    ['link_not_allowed', 400],
    ['invalid_link', 400],
    ['link_unreachable', 502],
    ['link_timeout', 504],
    ['link_status', 502],
    ['link_not_page', 415],
    ['link_too_large', 413],
  ])('says what %s means, in the shared words', async (code, status) => {
    const err = await failure(httpError(status, { error: code }));
    expect(err.code).toBe(code);
    expect(err.message).toBe(fillForm.linkText(code));
    expect(err.message).not.toBe(fillForm.linkText('failed'));
  });

  it('says a code the shared words gain in those words, with no list of its own to update', async () => {
    fillForm.LINK_TEXT.link_made_up = 'A made-up sentence for a made-up code.';
    try {
      const err = await failure(httpError(400, { error: 'link_made_up' }));
      expect(err.code).toBe('link_made_up');
      expect(err.message).toBe('A made-up sentence for a made-up code.');
    } finally {
      delete fillForm.LINK_TEXT.link_made_up;
    }
  });

  it('reads an ended session from the status, whatever the body says', async () => {
    const err = await failure(httpError(401, { msg: 'Invalid JWT' }));
    expect(err.code).toBe('unauthorized');
    expect(err.message).toBe('Your session has ended. Sign in again, then retry.');
  });

  it('tells being offline apart from a page that failed', async () => {
    const err = await failure(new FunctionsFetchError(new TypeError('Failed to fetch')));
    expect(err.code).toBe('offline');
    expect(err.message).toBe(fillForm.linkText('offline'));
  });

  it.each([
    ['a platform 404 while the function is not deployed', httpError(404, { code: 'NOT_FOUND', message: 'Requested function was not found' })],
    ['a code with no words of its own', httpError(400, { error: 'invalid_json' })],
    ['a body that is not JSON', httpError(500, 'Internal Server Error')],
    ['a relay failure', new FunctionsRelayError(new Response('', { status: 502 }))],
  ])('reads %s as the generic failure, and logs it without the link', async (_case, error) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = await failure(error);
    expect(err.code).toBe('failed');
    expect(err.message).toBe(fillForm.linkText('failed'));
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-token');
  });

  it('refuses an answer that is not a page', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const data of [{ ok: false }, { ok: true }, 'text', null]) {
      invoke.mockResolvedValueOnce({ data, error: null });
      await expect(linkReadApi.readLink(LINK, '')).rejects.toMatchObject({ code: 'failed' });
    }
    expect(log).toHaveBeenCalled();
  });
});
