import { supabase } from '@/lib/supabase';

// Machine translation for a snippet body (TRANSLATE-001).
//
// The edge function masks every SprintBrain token before the model sees the
// text and refuses any reply that altered one, so what comes back here either
// carries the original machinery intact or is an error. There is no partial
// success to reconcile — which is why this wrapper is as thin as it is.

const EDGE_FN_TRANSLATE = 'translate-body';

/** The languages a body can be translated into. English is always the source. */
export type TranslateTarget = 'IT' | 'ES' | 'FR';

export interface TranslateApi {
  /**
   * Translate `body` from English into `target`.
   *
   * Throws with a sentence the user can act on. Never returns a body whose
   * placeholders were changed.
   */
  translateBody(body: string, target: TranslateTarget): Promise<string>;
}

/**
 * Turn an edge-function failure into something worth reading.
 *
 * The distinctions here are the ones that change what the user does next:
 * a corrupted-placeholder refusal means "try again, it may well work", while
 * a missing key means "nothing you do in this dialog will help".
 */
function translateError(detail: string | undefined): Error {
  if (detail?.includes('anthropic_not_configured')) {
    return new Error('Translation is not configured yet.');
  }
  if (detail?.includes('placeholders_corrupted')) {
    return new Error('The translation changed a field, so it was discarded. Try again.');
  }
  if (detail?.includes('translation_refused')) {
    return new Error('This text could not be translated.');
  }
  if (detail?.includes('source_too_long')) {
    return new Error('This body is too long to translate.');
  }
  if (detail?.includes('empty_source')) {
    return new Error('There is no English text to translate.');
  }
  return new Error('Could not reach the translation service. Try again.');
}

export const translateApi: TranslateApi = {
  async translateBody(body, target) {
    const { data, error } = await supabase.functions.invoke<{
      ok: boolean;
      translation: string;
    }>(EDGE_FN_TRANSLATE, {
      body: { body, target },
    });

    if (error) throw translateError(error.message);
    if (!data?.ok || typeof data.translation !== 'string') throw translateError(undefined);

    return data.translation;
  },
};
