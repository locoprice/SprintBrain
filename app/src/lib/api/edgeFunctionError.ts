/**
 * The `error` code an edge function sent back with a failed response.
 *
 * supabase-js leaves `message` generic ("Edge Function returned a non-2xx
 * status code") and puts the failed Response on `context`, so the code has to
 * be read from the body. Returns '' when there is none.
 */
export async function readEdgeErrorCode(error: unknown): Promise<string> {
  const context = (error as { context?: Response }).context;
  if (!context || typeof context.json !== 'function') return '';
  try {
    const body = (await context.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : '';
  } catch {
    return '';
  }
}
