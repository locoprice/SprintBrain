// suggest-labels — Supabase Edge Function (Deno)
// Suggests labels for a snippet the user is still drafting, drawn from that
// user's own label vocabulary. Called by the dashboard (supabase.functions.invoke).
//
// It takes draft CONTENT, not a snippet_id: suggestions happen in the editor,
// before the row exists.
//
// The function returns plain label NAMES — never ids. Which names are existing
// labels and which are new is decided by the caller against the live catalog
// (app/src/lib/labelSuggest.ts), so a name the model invents can only ever
// become a proposal the user must accept, never a silent write.
//
// Environment secrets required (set via `supabase secrets set`):
//   ANTHROPIC_API_KEY  — Anthropic API key
//   SUPABASE_URL       — injected automatically by the runtime
//   SUPABASE_ANON_KEY  — injected automatically by the runtime

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.110.0';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

/** Enough for any snippet; caps token spend on a pathological paste. */
const MAX_CONTENT_CHARS = 4000;
/** Below this there is no subject matter to judge. */
const MIN_CONTENT_CHARS = 12;
/** Mirrors the `labels_name_length` CHECK; the caller re-checks too. */
const LABEL_NAME_MAX = 32;
const MAX_SUGGESTIONS = 3;

const SYSTEM_PROMPT = `You label text snippets for a hospitality operations team. Snippets are reusable message templates sent to guests and partners — quotes, booking confirmations, check-in instructions, policy replies.

You receive one snippet and the user's existing label vocabulary. Return the labels that describe what the snippet is about, so the user can find it again later.

Pick from the existing vocabulary whenever a label fits — reuse is what makes a vocabulary worth having. Propose a new label only when the snippet's subject has no reasonable home among the existing ones, and name it the way this user names things: match the casing and phrasing style already in their vocabulary.

Suggest at most ${MAX_SUGGESTIONS} labels, most relevant first. Suggesting nothing is a valid answer — when a snippet's subject fits no existing label and doesn't warrant a new one, return an empty list rather than padding it.

Judge by subject matter, not by wording. The language a snippet is written in (English, Italian, Spanish, French) is not its subject: a Spanish quote and an English quote get the same label. Template placeholders like {guest_name} or {=TOTAL * 1.03} are mechanics, not subject matter.

Keep each reason to one short clause naming the evidence in the snippet.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    labels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['name', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['labels'],
  additionalProperties: false,
} as const;

type DraftPayload = {
  name?: unknown;
  body?: unknown;
  folder_name?: unknown;
  language?: unknown;
};

type Suggestion = { name: string; reason: string };

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/** The user turn: the vocabulary to reuse, then the snippet to judge. */
function buildUserMessage(draft: DraftPayload, labelNames: string[]): string {
  const parts: string[] = [];

  parts.push(
    labelNames.length > 0
      ? `Existing labels:\n${labelNames.map((n) => `- ${n}`).join('\n')}`
      : 'Existing labels: none yet — every label you suggest will be a new one.',
  );

  const meta: string[] = [];
  const name = text(draft.name);
  const folder = text(draft.folder_name);
  const language = text(draft.language);
  if (name) meta.push(`Name: ${name}`);
  if (folder) meta.push(`Folder: ${folder}`);
  if (language) meta.push(`Language: ${language}`);

  const body = text(draft.body).slice(0, MAX_CONTENT_CHARS);
  parts.push(`Snippet\n${meta.join('\n')}\nBody:\n"""\n${body}\n"""`);

  return parts.join('\n\n');
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

  // ── Parse the draft ──────────────────────────────────────────────
  let draft: DraftPayload;
  try {
    draft = (await req.json()) as DraftPayload;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  // Nothing to judge yet — answer without spending a request.
  const contentLength = text(draft.name).length + text(draft.body).length;
  if (contentLength < MIN_CONTENT_CHARS) {
    return json({ ok: true, suggestions: [] }, 200);
  }

  if (!ANTHROPIC_API_KEY) {
    return json(
      { error: 'anthropic_not_configured', detail: 'ANTHROPIC_API_KEY secret not set' },
      503,
    );
  }

  // ── The caller's own vocabulary ──────────────────────────────────
  // Read through the user client: RLS on `labels` is `user_id = auth.uid()`,
  // so this returns exactly the caller's labels with no service-role reach.
  const { data: labelRows, error: labelError } = await userClient
    .from('labels')
    .select('name')
    .order('name', { ascending: true });
  if (labelError) {
    return json({ error: 'labels_read_failed', detail: labelError.message }, 500);
  }
  const labelNames = ((labelRows ?? []) as { name: string }[])
    .map((row) => row.name)
    .filter((name) => typeof name === 'string' && name.length > 0);

  // ── Classify ─────────────────────────────────────────────────────
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  let raw: string;
  try {
    const message = await anthropic.messages.create({
      model: 'claude-opus-5',
      // Thinking is on by default on Opus 5 and shares this budget with the
      // response, so it is sized well above what the JSON itself needs.
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
      },
      messages: [{ role: 'user', content: buildUserMessage(draft, labelNames) }],
      // `output_config` shapes lag the published SDK types; the wire format is
      // the contract here, so the cast keeps Deno from rejecting a valid body.
    } as unknown as Anthropic.MessageCreateParamsNonStreaming);

    if (message.stop_reason === 'refusal') {
      return json({ ok: true, suggestions: [] }, 200);
    }

    const block = message.content.find((b) => b.type === 'text');
    raw = block && block.type === 'text' ? block.text : '';
  } catch (err) {
    return json(
      { error: 'anthropic_request_failed', detail: err instanceof Error ? err.message : 'unknown' },
      502,
    );
  }

  // ── Shape the reply ──────────────────────────────────────────────
  // Structured outputs guarantee the schema, not the semantics: trim, drop
  // blanks and over-long names, and cap the count. The caller reconciles these
  // names against the live catalog before anything reaches the UI.
  let suggestions: Suggestion[] = [];
  try {
    const parsed = JSON.parse(raw) as { labels?: { name?: unknown; reason?: unknown }[] };
    suggestions = (parsed.labels ?? [])
      .map((entry) => ({ name: text(entry.name), reason: text(entry.reason) }))
      .filter((entry) => entry.name.length > 0 && entry.name.length <= LABEL_NAME_MAX)
      .slice(0, MAX_SUGGESTIONS);
  } catch {
    return json({ error: 'anthropic_bad_output' }, 502);
  }

  return json({ ok: true, suggestions }, 200);
});
