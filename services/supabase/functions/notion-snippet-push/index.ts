// notion-snippet-push — Supabase Edge Function (Deno)
// Pushes a single snippet to the shared team Notion database.
// Called by dashboard (supabase.functions.invoke) and extension (fetch + JWT).
//
// Environment secrets required (set via `supabase secrets set`):
//   NOTION_API_KEY     — team Notion integration token (ntn_...)
//   NOTION_DB_ID       — team Notion database ID (optional, falls back to hardcoded)
//   SUPABASE_URL       — injected automatically by the runtime
//   SUPABASE_ANON_KEY  — injected automatically by the runtime
//   SUPABASE_SERVICE_ROLE_KEY — injected automatically by the runtime

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NOTION_API_KEY = Deno.env.get('NOTION_API_KEY') ?? '';
// Fallback: known team DB from PROJECT_CONTEXT.md
const NOTION_DB_ID =
  Deno.env.get('NOTION_DB_ID') ?? 'a06cac8d5e0282c28c4101e9e3ea3f88';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

type SnippetRow = {
  id: string;
  title: string;
  shortcut: string;
  body: string;
  lang: string | null;
  notion_page_id: string | null;
  folders: { name: string } | null;
};

function buildNotionProps(snippet: SnippetRow): Record<string, unknown> {
  const bodyText = (snippet.body ?? '').slice(0, 2000);
  const folderName = snippet.folders?.name ?? '';

  const props: Record<string, unknown> = {
    'Nome Snippet': {
      title: [{ text: { content: snippet.title ?? '' } }],
    },
    'Shortcut': {
      rich_text: [{ text: { content: snippet.shortcut ?? '' } }],
    },
    'Body': {
      rich_text: [{ text: { content: bodyText } }],
    },
  };

  if (folderName) {
    props['Categoria'] = { select: { name: folderName } };
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
  let snippetId: string | undefined;
  try {
    const body = await req.json();
    snippetId = body?.snippet_id as string | undefined;
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  if (!snippetId) {
    return new Response(JSON.stringify({ error: 'snippet_id required' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // ── Fetch snippet using service role (bypasses RLS safely) ───────
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: snippet, error: fetchError } = await serviceClient
    .from('snippets')
    .select('id, title, shortcut, body, lang, notion_page_id, folders(name)')
    .eq('id', snippetId)
    .eq('user_id', user.id) // ownership check — cannot push another user's snippet
    .single();

  if (fetchError || !snippet) {
    return new Response(
      JSON.stringify({ error: 'snippet_not_found', detail: fetchError?.message }),
      {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      },
    );
  }

  const row = snippet as unknown as SnippetRow;

  // ── Notion API guard ─────────────────────────────────────────────
  if (!NOTION_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'notion_not_configured', detail: 'NOTION_API_KEY secret not set' }),
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
  // Phase B (B6): the push only links the Notion page. Team visibility is
  // folder-level (RLS folder ACL) and is never changed from here.
  const { error: updateError } = await serviceClient
    .from('snippets')
    .update({ notion_page_id: notionPageId })
    .eq('id', snippetId)
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
