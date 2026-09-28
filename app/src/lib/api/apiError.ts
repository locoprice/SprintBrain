// Turns what the database client hands back into an Error a screen can show.
//
// supabase-js returns a failed query's `error` as a plain object with `code`,
// `message`, `details` and `hint`. It is not an Error. The data layer used to
// throw that object as it came, and every catch site reads the message only
// after `err instanceof Error`, which a plain object fails. The screen then fell
// back to its generic text ("Save failed") and the real reason was neither shown
// nor logged.
//
// Every throw in `lib/api` goes through `toApiError`, and the lint gate enforces
// it. Real Errors (sign-in, storage, our own) pass through untouched, so the one
// call is safe wherever the source of the error is not obvious.

/** The fields of a database error the wording depends on. */
export interface DbErrorSource {
  message: string;
  /** A Postgres SQLSTATE or a PostgREST code. Null when the server sent none. */
  code: string | null;
  details: string | null;
  hint: string | null;
}

/** A database failure as an Error: plain wording on top, the server's detail underneath. */
export class ApiError extends Error {
  readonly code: string | null;
  /** What the server said, before it was reworded for the screen. */
  readonly serverMessage: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(message: string, source: DbErrorSource) {
    super(message);
    this.name = 'ApiError';
    this.code = source.code;
    this.serverMessage = source.message;
    this.details = source.details;
    this.hint = source.hint;
  }
}

const FALLBACK = 'Something went wrong. Try again.';

/** The browser's own wording for a request that never reached the server. */
const NETWORK_FAILURE = /failed to fetch|networkerror|network request failed|load failed/i;

/** Our SQL functions prefix their own messages with the function name. */
const FUNCTION_PREFIX = /^[a-z][a-z0-9_]*:\s+/;

/**
 * A message a SQL function raised on purpose ("Give your team a name", "This
 * invitation is no longer open"). Those already read as sentences, so they are
 * kept, minus the function-name prefix.
 */
function authoredMessage(message: string): string {
  const text = message.trim().replace(FUNCTION_PREFIX, '');
  if (text === '') return FALLBACK;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The wording a person should read.
 *
 * Only failures Postgres or PostgREST word themselves are reworded, because
 * "invalid input syntax for type uuid" means nothing on a screen. Some codes are
 * shared with messages our own functions raise (42501, 23514), so those are told
 * apart by the shape of the message. Everything else keeps the server's text.
 */
export function plainMessage(source: DbErrorSource): string {
  const { code, message } = source;
  if (code === '23505') return 'That already exists. Change the name or shortcut and try again.';
  if (code === '23503') return "That change conflicts with something it's linked to.";
  if (code === '23502') return 'A required field is empty.';
  if (code === '23514' && /violates check constraint/i.test(message)) {
    return "One of the values isn't allowed. Check the fields and try again.";
  }
  if (code === '22P02') return "One of the values isn't in the expected format.";
  if (code === '22001') return 'One of the values is too long.';
  if (code === '42501' && /row-level security|permission denied/i.test(message)) {
    return "You don't have permission to do that.";
  }
  if (code === 'PGRST116') return "That item no longer exists, or you don't have access to it.";
  if (code === 'PGRST301' || /jwt expired/i.test(message)) {
    return 'Your session has expired. Sign in again.';
  }
  if (code === '57014') return 'That took too long. Try again.';
  if (code === '40001' || code === '40P01') return 'Someone changed this at the same time. Try again.';
  if (code === null && NETWORK_FAILURE.test(message)) {
    return "Can't reach the server. Check your connection and try again.";
  }
  return authoredMessage(message);
}

function textField(fields: Record<string, unknown>, key: string): string | null {
  const value = fields[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function readSource(error: unknown): DbErrorSource {
  if (typeof error === 'string') return { message: error, code: null, details: null, hint: null };
  if (typeof error !== 'object' || error === null) {
    return { message: '', code: null, details: null, hint: null };
  }
  const fields = error as Record<string, unknown>;
  return {
    message: textField(fields, 'message') ?? '',
    code: textField(fields, 'code'),
    details: textField(fields, 'details'),
    hint: textField(fields, 'hint'),
  };
}

/**
 * The Error to throw for whatever a Supabase call returned as its `error`.
 *
 * A real Error comes back unchanged. Anything else is a database failure: it
 * becomes an `ApiError` whose message is plain wording, whose `code`,
 * `serverMessage`, `details` and `hint` keep the technical side, and the same
 * detail goes to the console so a developer can see what the server refused.
 *
 * `message` replaces the wording when the caller knows the situation better than
 * the code does (a Brain name that was taken while the item sat in the trash).
 */
export function toApiError(error: unknown, message?: string): Error {
  if (error instanceof Error) return error;
  const source = readSource(error);
  console.error(`Database request failed (${source.code ?? 'no code'}): ${source.message}`, {
    details: source.details,
    hint: source.hint,
  });
  return new ApiError(message ?? plainMessage(source), source);
}
