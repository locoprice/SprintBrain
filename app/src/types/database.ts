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
  /** Company branding (BRANDING-001) — persisted in auth.users.user_metadata. */
  company_name: string;
  company_logo_url: string | null;
  /** Profile picture (ACCOUNT-PROFILE-001) — GoTrue-conventional metadata key. */
  avatar_url: string | null;
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
  /**
   * Curated cross-language grouping key (nullable in DB). Variants that share
   * it are one logical snippet. The extension and mobile app group on this key;
   * the dashboard table currently groups by base trigger only (snippetGrouping.ts)
   * and does not read this field — honoring it for full cross-surface parity is a
   * tracked follow-up.
   */
  lang_group_id?: string | null;
  notion_page_id: string | null;
  pinned: boolean;
  /**
   * Soft-disable flag (SNIPPET-DISABLE-001). When false the extension hides
   * the snippet from the context menu and refuses to expand its trigger; the
   * dashboard still displays it so it can be re-enabled.
   */
  is_active: boolean;
  /** Keyword synonyms for context-based snippet matching (ALTERNATIVE-QUERIES-001). */
  alternative_queries: string[];
  enable_urgency_timer: boolean;
  timer_duration_ms: number;
  scarcity_count: number;
  updated_at: IsoDateTime;
  /**
   * Last modifier — stamped in the DB by app.stamp_asset_audit whenever a
   * write bumps updated_at ("Created by" is user_id, immutable since insert).
   * Null only after that user's auth account is deleted.
   */
  updated_by: Uuid | null;
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
  /** Optional direct-expansion trigger (e.g. "followup" → type ::followup). Null = menu-only. */
  shortcut: string | null;
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
  folder_id: Uuid | null;
  notion_page_id: string | null;
  updated_at: IsoDateTime;
  /** Last modifier — same DB-stamped semantics as Snippet.updated_by. */
  updated_by: Uuid | null;
  last_used_at: IsoDateTime | null;
}

export interface NotionSyncState {
  database_id: string;
  api_key: string;
  last_sync_at: IsoDateTime | null;
  status: 'idle' | 'syncing' | 'error';
  last_error: string | null;
}

// ── Version history ───────────────────────────────────────────────────────────

/**
 * One immutable snapshot of a snippet's content (title + body + bodies) saved
 * by a team member. Rows are append-only; version_number is 1-indexed and
 * strictly increases per snippet (SNIPPET-REVISIONS-001).
 */
export interface SnippetRevision {
  id: Uuid;
  snippet_id: Uuid;
  version_number: number;
  editor_id: Uuid;
  /** Denormalized display string (email or display_name) captured at save time. */
  editor_display: string;
  title: string;
  body: string;
  bodies: SnippetBodies;
  edit_note: string | null;
  created_at: IsoDateTime;
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

/** One calendar day in the Activity Overview heatmap (local timezone). */
export interface ActivityDay {
  date: string; // YYYY-MM-DD
  count: number;
}

/** One spoke of the "Activity overview" radar (adapted from GitHub's kite). */
export interface ActivityAxis {
  key: string;
  label: string;
  count: number;
}

/** A single bar inside a "Contribution activity" month group. */
export interface ActivityBar {
  label: string;
  count: number;
}

/** One month group in the "Contribution activity" timeline. */
export interface ActivityMonth {
  key: string; // YYYY-MM
  label: string; // e.g. "June 2026"
  total: number; // expansions that month
  items: ActivityBar[]; // top folders that month
}

/** GitHub-style "Activity overview" + "Contribution activity", on snippet data. */
export interface ActivityOverview {
  axes: ActivityAxis[]; // Snippets / Prompts / Folders / Notion syncs
  activeFolders: string[]; // top folders by usage — the "Contributed to" line
  timeline: ActivityMonth[]; // most-recent month first
}

/** Year-long snippet-activity series powering the contribution heatmap. */
export interface ActivityData {
  /** Dense, ascending — one entry per day from `start` (a Sunday) to `end` (today). */
  days: ActivityDay[];
  total: number; // sum of expansions across the window
  start: string; // YYYY-MM-DD — first cell (Sunday)
  end: string; // YYYY-MM-DD — today
  overview: ActivityOverview;
}

// ── Organizations & folder permissions (Phase B — folder sharing) ─────────────

/** RBAC role within an organization. Gates management actions. */
export type OrgRole = 'admin' | 'manager' | 'member';

/** Folder ACL level. Gates asset access; assets inherit from their folder. */
export type PermissionLevel = 'view' | 'edit' | 'owner';

/** What a folder permission is granted to. */
export type PrincipalType = 'user' | 'team' | 'organization';

/** The active organization plus the signed-in user's role within it. */
export interface OrganizationSummary {
  id: Uuid;
  name: string;
  slug: string | null;
  myRole: OrgRole;
  /** Team-page cover (TEAM-COVER-001): a preset key, an https image URL, or null. */
  cover: string | null;
}

/** A teammate, resolved via the `org_member_directory` RPC. */
export interface OrgMember {
  user_id: Uuid;
  email: string;
  display_name: string;
  role: OrgRole;
}

/** A single grant row from `folder_permissions`. */
export interface FolderPermission {
  id: Uuid;
  folder_id: string;
  principal_type: PrincipalType;
  principal_id: Uuid;
  level: PermissionLevel;
  created_at: IsoDateTime;
  /** The user who created the grant. Null on legacy grants predating the column. */
  granted_by: Uuid | null;
}

/** Derived sharing status for a folder, computed from its `folder_permissions`. */
export type FolderShareScope = 'private' | 'shared' | 'team';

/** Per-folder sharing summary that drives the folder-tree badges. */
export interface FolderShareInfo {
  scope: FolderShareScope;
  /** Distinct user/team grantees — drives the "Shared with N" tooltip. 0 for team-wide. */
  memberCount: number;
}
