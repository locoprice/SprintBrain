// SprintBrain Supabase schema mirrors.
// Shapes match PROJECT_CONTEXT.md §4 and CLAUDE.md §3 so the follow-up ticket
// (auth + live reads) only needs to swap the mock implementation.

export type Uuid = string;
export type IsoDateTime = string;

export interface Profile {
  id: Uuid;
  email: string;
  display_name: string;
  shortcut_prefix: '/' | '::' | ';';
  created_at: IsoDateTime;
}

export interface Folder {
  id: Uuid;
  user_id: Uuid;
  name: string;
  icon: string; // emoji
  sort_order: number;
  updated_at: IsoDateTime;
}

export interface Snippet {
  id: Uuid;
  user_id: Uuid;
  name: string;
  content: string;
  triggers: string[];
  tags: string[];
  is_formula: boolean;
  formula: string | null;
  variables: Record<string, unknown>;
  folder_id: Uuid | null;
  language: 'EN' | 'IT' | 'ES' | 'FR' | 'MULTI';
  is_shared: boolean;
  notion_page_id: string | null;
  updated_at: IsoDateTime;
}

export interface SnippetStat {
  snippet_id: Uuid;
  trigger: string;
  used_at: IsoDateTime;
}

export interface Prompt {
  id: Uuid;
  user_id: Uuid;
  name: string;
  content: string;
  type: 'one-shot' | 'few-shot';
  tags: string[];
  updated_at: IsoDateTime;
  last_used_at: IsoDateTime | null;
}

export interface NotionSyncState {
  database_id: string;
  last_sync_at: IsoDateTime | null;
  status: 'idle' | 'syncing' | 'error';
  last_error: string | null;
}

// Derived view models used by feature components.

export interface SnippetRow extends Snippet {
  folder_name: string | null;
  usage_count: number;
}

export interface UsagePoint {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface TopTrigger {
  trigger: string;
  count: number;
  trend: number[]; // last 14 days, normalized counts
}

export interface AnalyticsSummary {
  total_snippets: number;
  triggers_this_week: number;
  estimated_seconds_saved: number;
  top_trigger: string;
  daily_usage: UsagePoint[];
  top_triggers: TopTrigger[];
}
