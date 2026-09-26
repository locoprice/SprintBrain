import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// How a database failure reaches a screen.
//
// A prompt save the database rejected showed only "Save failed". supabase-js
// returns a failed query's error as a plain object, and every catch site reads
// `.message` only from a real Error, so the screen fell back to its generic text
// and the reason was neither shown nor logged. `toApiError` is the one place
// that turns the object into an Error. Three things are pinned here:
// 1. The wording: Postgres's own text is reworded, our functions' own messages
//    are kept.
// 2. The technical side survives: code, server message and details stay on the
//    error and go to the console.
// 3. Snippets, prompts and Brain items surface a failure the same way.

const sb = vi.hoisted(() => ({
  result: { data: null as unknown, error: null as unknown },
}));

vi.mock('@/lib/supabase', () => {
  // A query builder in miniature: every method returns the same object, and
  // awaiting it yields the configured result, as the real one does.
  const builder: unknown = new Proxy(() => undefined, {
    get: (_target, prop) =>
      prop === 'then'
        ? (resolve: (value: unknown) => unknown) => resolve(sb.result)
        : () => builder,
  });
  return {
    supabase: {
      auth: {
        getUser: () =>
          Promise.resolve({
            data: { user: { id: 'user-1', email: 'v@example.com', user_metadata: {} } },
            error: null,
          }),
      },
      from: () => builder,
      rpc: () => builder,
    },
  };
});

import { ApiError, plainMessage, toApiError } from '@/lib/api/apiError';
import { memoryApi } from '@/lib/api/memoryApi';
import { promptsApi } from '@/lib/api/promptsApi';
import { revisionsApi } from '@/lib/api/revisionsApi';
import { snippetsApi } from '@/lib/api/snippetsApi';
import type { PromptFormValues } from '@/types/schemas';

/** What PostgREST returns for a rejected request. */
function dbError(code: string | null, message: string, details: string | null = null) {
  return { code, message, details, hint: null };
}

function failWith(error: unknown): void {
  sb.result = { data: null, error };
}

beforeEach(() => {
  sb.result = { data: null, error: null };
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('toApiError', () => {
  it('hands a real Error back untouched and logs nothing', () => {
    const offline = new Error('offline');
    expect(toApiError(offline)).toBe(offline);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('turns the plain object into an Error that keeps the technical side', () => {
    const error = toApiError(
      dbError('22P02', 'invalid input syntax for type uuid: "leibtour_team_shared"', 'row 3'),
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ApiError);
    const api = error as ApiError;
    expect(api.name).toBe('ApiError');
    expect(api.message).toBe("One of the values isn't in the expected format.");
    expect(api.code).toBe('22P02');
    expect(api.serverMessage).toBe('invalid input syntax for type uuid: "leibtour_team_shared"');
    expect(api.details).toBe('row 3');
  });

  it('logs the server text once, so a developer sees what was refused', () => {
    toApiError(dbError('22P02', 'invalid input syntax for type uuid: "x"', 'row 3'));

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      'Database request failed (22P02): invalid input syntax for type uuid: "x"',
      { details: 'row 3', hint: null },
    );
  });

  it('lets the caller supply the wording and still keeps the server text', () => {
    const error = toApiError(
      dbError('23505', 'duplicate key value violates unique constraint "labels_name_key"'),
      '"Invoices" already exists',
    ) as ApiError;

    expect(error.message).toBe('"Invoices" already exists');
    expect(error.code).toBe('23505');
    expect(error.serverMessage).toBe('duplicate key value violates unique constraint "labels_name_key"');
  });

  it('copes with a bare string and with nothing at all', () => {
    expect(toApiError('boom').message).toBe('Boom');
    expect(toApiError(null).message).toBe('Something went wrong. Try again.');
    expect(toApiError(undefined).message).toBe('Something went wrong. Try again.');
    expect((toApiError({}) as ApiError).code).toBeNull();
  });
});

describe('plainMessage: what Postgres words itself is reworded', () => {
  it.each<[string | null, string, string]>([
    ['23505', 'duplicate key value violates unique constraint "prompts_shortcut_key"', 'That already exists. Change the name or shortcut and try again.'],
    ['23503', 'insert or update on table "prompts" violates foreign key constraint "prompts_folder_id_fkey"', "That change conflicts with something it's linked to."],
    ['23502', 'null value in column "name" of relation "prompts" violates not-null constraint', 'A required field is empty.'],
    ['23514', 'new row for relation "labels" violates check constraint "labels_name_check"', "One of the values isn't allowed. Check the fields and try again."],
    ['22P02', 'invalid input syntax for type uuid: "leibtour_team_shared"', "One of the values isn't in the expected format."],
    ['22001', 'value too long for type character varying(60)', 'One of the values is too long.'],
    ['42501', 'new row violates row-level security policy for table "prompts"', "You don't have permission to do that."],
    ['42501', 'permission denied for table prompt_versions', "You don't have permission to do that."],
    ['PGRST116', 'Cannot coerce the result to a single JSON object', "That item no longer exists, or you don't have access to it."],
    ['PGRST301', 'JWT expired', 'Your session has expired. Sign in again.'],
    ['57014', 'canceling statement due to statement timeout', 'That took too long. Try again.'],
    ['40001', 'could not serialize access due to concurrent update', 'Someone changed this at the same time. Try again.'],
    ['40P01', 'deadlock detected', 'Someone changed this at the same time. Try again.'],
    [null, 'TypeError: Failed to fetch', "Can't reach the server. Check your connection and try again."],
  ])('%s: %s', (code, message, expected) => {
    expect(plainMessage({ code, message, details: null, hint: null })).toBe(expected);
  });
});

describe('plainMessage: what our own functions raise on purpose is kept', () => {
  // These share error codes with the cases above (22023 is a whole class of
  // "data exception", 42501 and 23514 are also raised by hand). Mapping by code
  // alone would replace a sentence written for the person with a vaguer one.
  it.each<[string, string, string]>([
    ['22023', 'Give your team a name', 'Give your team a name'],
    ['22023', 'Team names are 60 characters or fewer', 'Team names are 60 characters or fewer'],
    ['P0002', 'This invitation is no longer open', 'This invitation is no longer open'],
    ['P0001', 'Label nesting is limited to 2 levels', 'Label nesting is limited to 2 levels'],
    ['23514', 'tenancy: only the folder owner or an org admin may move this asset out of its organization', 'Only the folder owner or an org admin may move this asset out of its organization'],
    ['42501', 'save_prompt_with_version: prompt not found', 'Prompt not found'],
  ])('%s: %s', (code, message, expected) => {
    expect(plainMessage({ code, message, details: null, hint: null })).toBe(expected);
  });
});

describe('snippets, prompts and Brain items surface a failure the same way', () => {
  const promptValues: PromptFormValues = {
    name: 'RECENSIONE OSPITE',
    content: 'text',
    shortcut: '',
    strategy_type: null,
    thinking_mode: null,
    preferred_model: null,
    complexity_level: null,
    intent_category: null,
    output_type: null,
    blocks: null,
    ask_user_questions: false,
    folder_id: 'leibtour_team_shared',
  };

  const saves: Array<[string, () => Promise<unknown>]> = [
    [
      'snippet save',
      () =>
        revisionsApi.saveWithRevision('s1', {
          title: 'Quote',
          shortcut: '::quote',
          body: 'body',
          bodies: {},
          lang: 'EN',
          folder_id: 'leibtour_team_shared',
          pinned: false,
          alternative_queries: [],
        }),
    ],
    ['prompt save', () => promptsApi.saveWithVersion('p1', promptValues)],
    ['Brain item save', () => memoryApi.saveItem({ name: 'Rates', summary: '', body: 'body' })],
  ];

  const pins: Array<[string, () => Promise<unknown>]> = [
    ['snippet pin', () => snippetsApi.setPinned(['s1'], true)],
    ['prompt pin', () => promptsApi.setPinned('p1', true)],
    ['Brain item trash', () => memoryApi.trashItem('m1')],
  ];

  it.each(saves)('%s: a rejected request reads as a sentence, with the code kept', async (_name, run) => {
    failWith(dbError('22P02', 'invalid input syntax for type uuid: "leibtour_team_shared"'));

    const rejection = await run().catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as ApiError).message).toBe("One of the values isn't in the expected format.");
    expect((rejection as ApiError).code).toBe('22P02');
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it.each(pins)('%s: a query that matched nothing reads as a sentence', async (_name, run) => {
    failWith(dbError('PGRST116', 'Cannot coerce the result to a single JSON object', 'The result contains 0 rows'));

    const rejection = await run().catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as ApiError).message).toBe("That item no longer exists, or you don't have access to it.");
    expect((rejection as ApiError).code).toBe('PGRST116');
  });

  it.each([...saves, ...pins])('%s: a real Error is thrown as it came', async (_name, run) => {
    const offline = new Error('offline');
    failWith(offline);

    await expect(run()).rejects.toBe(offline);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('Brain items keep their own wording for a refused save', async () => {
    failWith(dbError('42501', 'memory_write_shard: shard not found'));

    await expect(memoryApi.saveItem({ name: 'Rates', summary: '', body: 'body' })).rejects.toThrow(
      'You do not have access to that Brain.',
    );
  });
});
