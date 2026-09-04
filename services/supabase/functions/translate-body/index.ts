// translate-body — Supabase Edge Function (Deno)
// Translates a snippet body from English into IT, ES or FR (TRANSLATE-001).
// Called by the dashboard (supabase.functions.invoke) and by Sprintbrain.html
// (plain fetch), which are the two surfaces carrying a body editor.
//
// It takes draft TEXT, not a snippet_id: translation happens in the editor,
// before anything is saved, and nothing here writes to the database.
//
// The model never sees SprintBrain syntax. Every token is masked before the
// request and restored after it (tokenMask.ts), and a reply that lost, doubled
// or invented a placeholder is rejected rather than returned. That check is the
// feature's whole safety story: a corrupted body would still look valid to
// every reader downstream, so it must never leave this function.
//
// Environment secrets required (set via `supabase secrets set`):
//   ANTHROPIC_API_KEY  — Anthropic API key (already set for suggest-labels)
//   SUPABASE_URL       — injected automatically by the runtime
//   SUPABASE_ANON_KEY  — injected automatically by the runtime

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.110.0';
import { maskTokens, unmaskTokens } from './tokenMask.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

/** Caps token spend on a pathological paste. */
const MAX_BODY_CHARS = 8000;
/** Below this there is nothing to translate. */
const MIN_BODY_CHARS = 2;

/** The languages a body can be translated INTO. English is the source. */
const TARGETS = { IT: 'Italian', ES: 'Spanish', FR: 'French' } as const;
type Target = keyof typeof TARGETS;

function isTarget(value: unknown): value is Target {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TARGETS, value);
}

const SYSTEM_PROMPT = `You translate reusable message templates from English into a target language.

These templates are sent to customers, clients and partners, so the translation must read as natural, professional writing in the target language — not as translated English. Match the register of the source: a formal source stays formal, a direct one stays direct.

The text contains opaque placeholders written as [[0]], [[1]], [[2]] and so on.

Rules for placeholders, which override everything else:
- Reproduce every placeholder exactly as written, including the brackets and the number.
- Never translate, renumber, reword, split, merge, add or remove a placeholder.
- Move a placeholder to wherever the target language's grammar needs it. Word order differs between languages and a placeholder travels with the phrase it belongs to.
- Every placeholder in the source must appear exactly once in your translation.

A placeholder stands for a value filled in later — a name, a date, a quantity, a calculated total, or a piece of template machinery. Translate the words around it, never the placeholder itself.

Preserve the layout of the source: line breaks, blank lines, bullet characters, and leading or trailing whitespace.

Return only the translated text. No preamble, no explanation, no quotation marks around it.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    translation: { type: 'string' },
  },
  required: ['translation'],
  additionalProperties: false,
} as const;

type TranslatePayload = {
  body?: unknown;
  target?: unknown;
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
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
  let payload: TranslatePayload;
  try {
    payload = (await req.json()) as TranslatePayload;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  if (!isTarget(payload.target)) {
    return json({ error: 'invalid_target' }, 400);
  }
  const target = payload.target;

  const body = typeof payload.body === 'string' ? payload.body : '';
  if (body.trim().length < MIN_BODY_CHARS) {
    return json({ error: 'empty_source' }, 400);
  }
  if (body.length > MAX_BODY_CHARS) {
    return json({ error: 'source_too_long' }, 400);
  }

  if (!ANTHROPIC_API_KEY) {
    return json(
      { error: 'anthropic_not_configured', detail: 'ANTHROPIC_API_KEY secret not set' },
      503,
    );
  }

  // ── Hide the machinery ───────────────────────────────────────────
  const { masked, tokens } = maskTokens(body);

  // A body that is nothing but tokens has no prose to translate. Returning it
  // unchanged is the honest answer and costs no model call.
  if (masked.replace(/\[\[\d+\]\]/g, '').trim().length === 0) {
    return json({ ok: true, translation: body, unchanged: true }, 200);
  }

  // ── Translate ────────────────────────────────────────────────────
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  let raw: string;
  try {
    const message = await anthropic.messages.create({
      model: 'claude-opus-5',
      // Thinking is on by default on Opus 5 and shares this budget with the
      // response, so it is sized well above the longest body we accept.
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
      },
      messages: [
        {
          role: 'user',
          content: 'Translate into ' + TARGETS[target] + '.\n\n"""\n' + masked + '\n"""',
        },
      ],
      // `output_config` shapes lag the published SDK types; the wire format is
      // the contract here, so the cast keeps Deno from rejecting a valid body.
    } as unknown as Anthropic.MessageCreateParamsNonStreaming);

    if (message.stop_reason === 'refusal') {
      return json({ error: 'translation_refused' }, 422);
    }

    const block = message.content.find((b) => b.type === 'text');
    raw = block && block.type === 'text' ? block.text : '';
  } catch (err) {
    return json(
      { error: 'anthropic_request_failed', detail: err instanceof Error ? err.message : 'unknown' },
      502,
    );
  }

  // ── Put the machinery back, or refuse ────────────────────────────
  let translated: string;
  try {
    const parsed = JSON.parse(raw) as { translation?: unknown };
    translated = typeof parsed.translation === 'string' ? parsed.translation : '';
  } catch {
    return json({ error: 'anthropic_bad_output' }, 502);
  }
  if (translated.trim().length === 0) {
    return json({ error: 'anthropic_bad_output' }, 502);
  }

  const restored = unmaskTokens(translated, tokens);
  if (!restored.ok) {
    // The model altered the machinery. Returning this would write a snippet
    // whose fields silently stop filling in, so it does not leave the function.
    return json({ error: 'placeholders_corrupted', detail: restored.reason }, 422);
  }

  return json({ ok: true, translation: restored.text, unchanged: false }, 200);
});
