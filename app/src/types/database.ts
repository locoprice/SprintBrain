// SprintBrain Supabase schema mirrors.
// Shapes match PROJECT_CONTEXT.md §4 and CLAUDE.md §3 so the follow-up ticket
// (auth + live reads) only needs to swap the mock implementation.

export type Uuid = string;
export type IsoDateTime = string;

/** Activation key used to confirm an inline trigger expansion. */
export type ActivationKey = 'Tab' | 'Enter';

export interface Profile {
  id: Uuid;
  email: string;
  display_name: string;
  shortcut_prefix: '/' | '::' | ';';
  created_at: IsoDateTime;
  /** Inline trigger sequences — persisted in auth.users.user_metadata. */
  trigger_snippet_seq: string;
  trigger_prompt_seq: string;
  trigger_snippet_key: ActivationKey;
  trigger_prompt_key: ActivationKey;
}

export interface Folder {
  id: Uuid;
  user_id: Uuid;
  name: string;
  icon: string; // emoji
  sort_order: number;
  updated_at: IsoDateTime;
}

export type SnippetLanguage = 'EN' | 'IT' | 'ES' | 'FR' | 'MULTI';

/**
 * Per-language body slots. Each key holds the body the user typed while that
 * language pill was active. `content` is a denormalized mirror of
 * `bodies[language]` so the Chrome extension (which reads `body` directly
 * from the snippets table) keeps working unchanged.
 */
export type SnippetBodies = Partial<Record<SnippetLanguage, string>>;

export interface Snippet {
  id: Uuid;
  user_id: Uuid;
  name: string;
  content: string;
  bodies: SnippetBodies;
  triggers: string[];
  tags: string[];
  is_formula: boolean;
  formula: string | null;
  variables: Record<string, unknown>;
  folder_id: Uuid | null;
  language: SnippetLanguage;
  is_shared: boolean;
  notion_page_id: string | null;
  pinned: boolean;
  /**
   * Soft-disable flag (SNIPPET-DISABLE-001). When false the extension hides
   * the snippet from the context menu and refuses to expand its trigger; the
   * dashboard still displays it so it can be re-enabled.
   */
  is_active: boolean;
  enable_urgency_timer: boolean;
  timer_duration_ms: number;
  scarcity_count: number;
  updated_at: IsoDateTime;
}

export interface SnippetStat {
  snippet_id: Uuid;
  trigger: string;
  used_at: IsoDateTime;
}

// ── Prompt v2 enum types ──────────────────────────────────────────────────────

export type StrategyType = 'CoT' | 'ToT' | 'Few-shot' | 'One-shot' | 'RAG' | 'Agentic';
export type ThinkingMode = 'fast' | 'balanced' | 'deep';
export type PreferredModel = 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'claude-haiku-4-5';
export type ComplexityLevel = 'simple' | 'medium' | 'complex';
export type ExecutionType = 'Generate' | 'Analyze' | 'Plan' | 'Critique' | 'Summarize' | 'Transform';
export type IntentCategory = 'Writing' | 'Coding' | 'Support' | 'SEO' | 'Analysis' | 'Planning' | 'Research' | 'Teaching';
export type OutputType = 'JSON' | 'Markdown' | 'SOP' | 'Plain';

export type PromptBlockType = 'role' | 'objective' | 'context' | 'examples' | 'reasoning' | 'constraints';

export interface PromptBlock {
  type: PromptBlockType;
  content: string;
  enabled: boolean;
}

export interface Prompt {
  id: Uuid;
  user_id: Uuid;
  name: string;
  content: string;
  type: 'one-shot' | 'few-shot';
  tags: string[];
  strategy_type: StrategyType | null;
  thinking_mode: ThinkingMode | null;
  preferred_model: PreferredModel | null;
  complexity_level: ComplexityLevel | null;
  execution_type: ExecutionType | null;
  intent_category: IntentCategory | null;
  output_type: OutputType | null;
  blocks: PromptBlock[] | null;
  updated_at: IsoDateTime;
  last_used_at: IsoDateTime | null;
}

export interface NotionSyncState {
  database_id: string;
  api_key: string;
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
