// notion-prompt-push — Supabase Edge Function (Deno)
// Pushes a single prompt to the shared team Notion database.
// Called by dashboard via supabase.functions.invoke.
//
// Environment secrets required (set via `supabase secrets set`):
//   NOTION_API_KEY         — team Notion integration token (ntn_...)
//   NOTION_PROMPTS_DB_ID   — Notion database ID for prompts (distinct from snippets DB)
//   SUPABASE_URL           — injected automatically by the runtime
//   SUPABASE_ANON_KEY      — injected automatically by the runtime
//   SUPABASE_SERVICE_ROLE_KEY — injected automatically by the runtime

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NOTION_API_KEY = Deno.env.get('NOTION_API_KEY') ?? '';
const NOTION_DB_ID = Deno.env.get('NOTION_PROMPTS_DB_ID') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

type PromptRow = {
  id: string;
  name: string;
  content: string;
  type: string | null;
  strategy_type: string | null;
  intent_category: string | null;
  tags: string[] | null;
  notion_page_id: string | null;
};

function buildNotionProps(prompt: PromptRow): Record<string, unknown> {
  const contentText = (prompt.content ?? '').slice(0, 2000);

  const props: Record<string, unknown> = {
    'Nome Prompt': {
      title: [{ text: { content: prompt.name ?? '' } }],
    },
    'Content': {
      rich_text: [{ text: { content: contentText } }],
    },
  };

  if (prompt.type) {
    props['Type'] = { select: { name: prompt.type } };
  }
  if (prompt.strategy_type) {
    props['Strategy'] = { select: { name: prompt.strategy_type } };
  }
  if (prompt.intent_category) {
    props['Intent'] = { select: { name: prompt.intent_category } };
  }

  return props;
}

Deno.serve(async (req: Request) => {
  // CORS pre-flight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // ── Auth: validate the caller's JWT ──────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();

  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // ── Parse body ───────────────────────────────────────────────────
  let promptId: string | undefined;
  try {
    const body = await req.json();
    promptId = body?.prompt_id as string | undefined;
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  if (!promptId) {
    return new Response(JSON.stringify({ error: 'prompt_id required' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // ── Fetch prompt using service role (bypasses RLS safely) ────────
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: prompt, error: fetchError } = await serviceClient
    .from('prompts')
    .select('id, name, content, type, strategy_type, intent_category, tags, notion_page_id')
    .eq('id', promptId)
    .eq('user_id', user.id) // ownership check
    .single();

  if (fetchError || !prompt) {
    return new Response(
      JSON.stringify({ error: 'prompt_not_found', detail: fetchError?.message }),
      {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      },
    );
  }

  const row = prompt as unknown as PromptRow;

  // ── Notion API guard ─────────────────────────────────────────────
  if (!NOTION_API_KEY || !NOTION_DB_ID) {
    return new Response(
      JSON.stringify({
        error: 'notion_not_configured',
        detail: 'NOTION_API_KEY or NOTION_PROMPTS_DB_ID secret not set',
      }),
      {
        status: 503,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      },
    );
  }

  const notionHeaders: Record<string, string> = {
    Authorization: `Bearer ${NOTION_API_KEY}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28',
  };

  const props = buildNotionProps(row);
  let notionPageId = row.notion_page_id;

  // ── Idempotent upsert: PATCH if page exists, CREATE otherwise ────
  if (notionPageId) {
    const patchRes = await fetch(`https://api.notion.com/v1/pages/${notionPageId}`, {
      method: 'PATCH',
      headers: notionHeaders,
      body: JSON.stringify({ properties: props }),
    });

    if (!patchRes.ok) {
      // Page was deleted or is unreachable — fall through to CREATE
      notionPageId = null;
    }
  }

  if (!notionPageId) {
    const createRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: notionHeaders,
      body: JSON.stringify({
        parent: { database_id: NOTION_DB_ID },
        properties: props,
      }),
    });

    if (!createRes.ok) {
      const detail = await createRes.text();
      return new Response(
        JSON.stringify({ error: 'notion_create_failed', detail }),
        {
          status: 502,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        },
      );
    }

    const page = (await createRes.json()) as { id: string };
    notionPageId = page.id;
  }

  // ── Write notion_page_id back to Supabase ────────────────────────
  const { error: updateError } = await serviceClient
    .from('prompts')
    .update({ notion_page_id: notionPageId })
    .eq('id', promptId)
    .eq('user_id', user.id);

  if (updateError) {
    return new Response(
      JSON.stringify({ error: 'db_update_failed', detail: updateError.message }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      },
    );
  }

  return new Response(
    JSON.stringify({ ok: true, notion_page_id: notionPageId }),
    {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    },
  );
});
