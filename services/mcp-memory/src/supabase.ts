// PostgREST calls for the working-memory MCP server (MEMORY-001).
//
// Plain fetch rather than @supabase/supabase-js. There is no session to manage,
// no realtime channel and no storage bucket here: three RPCs authenticated by a
// token in the request body. The SDK would add a dependency tree to save four
// lines.
//
// Every function targets a SECURITY DEFINER function that derives identity from
// the token alone. See the MCP read surface section in
// services/supabase/migrations/20260822000000_working_memory.sql.

/** The anon key is publishable, and already embedded in the dashboard bundle and background.js. RLS is the real boundary. */
const DEFAULT_SUPABASE_URL = 'https://eyowustlbqujaimaxggt.supabase.co';
const DEFAULT_ANON_KEY = 'sb_publishable_F_8LSMkr9ZK-9v50sPzXbQ_zjA0D_O0';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  token: string;
}

export function configFromEnv(env: NodeJS.ProcessEnv): SupabaseConfig {
  const token = env.SPRINTBRAIN_MEMORY_TOKEN;
  if (!token) {
    throw new Error(
      'SPRINTBRAIN_MEMORY_TOKEN is not set. Issue one from the dashboard (Settings, Memory) and put it in the MCP client config.',
    );
  }
  return {
    url: (env.SPRINTBRAIN_SUPABASE_URL ?? DEFAULT_SUPABASE_URL).replace(/\/+$/, ''),
    anonKey: env.SPRINTBRAIN_SUPABASE_ANON_KEY ?? DEFAULT_ANON_KEY,
    token,
  };
}

async function call(config: SupabaseConfig, fn: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${config.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`${fn} failed: ${response.status} ${response.statusText}${detail ? `: ${detail}` : ''}`);
  }

  return response.json();
}

async function rpc<T>(config: SupabaseConfig, fn: string, body: Record<string, unknown>): Promise<T[]> {
  const parsed = await call(config, fn, body);
  // A set-returning function always yields an array. Anything else means the
  // migration was applied with a different signature than this client expects.
  if (!Array.isArray(parsed)) {
    throw new Error(`${fn} returned ${typeof parsed}, expected an array. Check that the MEMORY-001 migration is applied.`);
  }
  return parsed as T[];
}

/** A function returning a single value rather than a set: PostgREST answers with the bare value. */
async function rpcScalar<T>(config: SupabaseConfig, fn: string, body: Record<string, unknown>): Promise<T> {
  const parsed = await call(config, fn, body);
  if (Array.isArray(parsed)) {
    throw new Error(`${fn} returned an array, expected a single value. Check which migration is applied.`);
  }
  return parsed as T;
}

export interface ManifestRow {
  step_key: string;
  step_name: string;
  description: string;
  token_budget: number;
  sort_order: number;
  label_id: string | null;
  label_name: string | null;
  weight: number | null;
}

export interface IndexRow {
  id: string;
  name: string;
  summary: string;
  token_estimate: number;
  pinned: boolean;
  priority: number;
  label_ids: string[];
}

export interface BodyRow {
  id: string;
  name: string;
  summary: string;
  body: string;
  token_estimate: number;
}

export function fetchManifest(config: SupabaseConfig): Promise<ManifestRow[]> {
  return rpc<ManifestRow>(config, 'memory_mcp_manifest', { p_token: config.token });
}

export function fetchIndex(config: SupabaseConfig): Promise<IndexRow[]> {
  return rpc<IndexRow>(config, 'memory_mcp_index', { p_token: config.token });
}

export function fetchBodies(config: SupabaseConfig, ids: readonly string[]): Promise<BodyRow[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return rpc<BodyRow>(config, 'memory_mcp_bodies', { p_token: config.token, p_ids: ids });
}

export interface SaveInput {
  name: string;
  body: string;
  summary?: string;
  spaceId?: string;
  kind?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Create one memory item.
 *
 * Resolves to the new shard's id, or null when the token cannot write: unknown,
 * revoked, expired or read-only, which the function deliberately does not
 * distinguish. The caller turns that into an explanation.
 */
export function saveShard(config: SupabaseConfig, input: SaveInput): Promise<string | null> {
  return rpcScalar<string | null>(config, 'memory_mcp_save', {
    p_token: config.token,
    p_name: input.name,
    p_body: input.body,
    p_summary: input.summary ?? null,
    p_space_id: input.spaceId ?? null,
    p_kind: input.kind ?? 'fact',
    p_metadata: input.metadata ?? {},
  });
}
