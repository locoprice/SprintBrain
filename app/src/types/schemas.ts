import { z } from 'zod';

// Zod schemas. Used at the boundary when the follow-up ticket wires Supabase;
// today they validate mock fixtures so drift is caught at build time.

export const profileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  display_name: z.string().min(1),
  shortcut_prefix: z.enum(['/', '::', ';']),
  created_at: z.string(),
});

export const folderSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  name: z.string().min(1),
  icon: z.string(),
  sort_order: z.number().int().nonnegative(),
});

const languageEnum = z.enum(['EN', 'IT', 'ES', 'FR', 'MULTI']);

// Bodies keyed by language. Every key is optional — only languages the user
// has actually typed into will be present after a save.
export const snippetBodiesSchema = z.record(languageEnum, z.string()).default({});

export const snippetSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  name: z.string().min(1),
  content: z.string(),
  bodies: snippetBodiesSchema,
  triggers: z.array(z.string()),
  tags: z.array(z.string()),
  alternative_queries: z.array(z.string()),
  is_formula: z.boolean(),
  formula: z.string().nullable(),
  variables: z.record(z.unknown()),
  // Folder ids are TEXT in the schema (legacy client-generated + org folders),
  // not necessarily UUIDs — don't over-constrain.
  folder_id: z.string().nullable(),
  language: languageEnum,
  updated_at: z.string(),
});

const promptBlockSchema = z.object({
  type: z.enum(['role', 'objective', 'context', 'examples', 'reasoning', 'constraints']),
  content: z.string(),
  enabled: z.boolean(),
});

export const promptSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  name: z.string().min(1),
  content: z.string(),
  shortcut: z.string().nullable(),
  type: z.enum(['one-shot', 'few-shot']),
  tags: z.array(z.string()),
  strategy_type: z.enum(['CoT', 'ToT', 'Few-shot', 'One-shot', 'RAG', 'Agentic']).nullable(),
  thinking_mode: z.enum(['fast', 'balanced', 'deep']).nullable(),
  preferred_model: z.enum(['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5']).nullable(),
  complexity_level: z.enum(['simple', 'medium', 'complex']).nullable(),
  execution_type: z.enum(['Generate', 'Analyze', 'Plan', 'Critique', 'Summarize', 'Transform']).nullable(),
  intent_category: z.enum(['Writing', 'Coding', 'Support', 'SEO', 'Analysis', 'Planning', 'Research', 'Teaching']).nullable(),
  output_type: z.enum(['JSON', 'Markdown', 'SOP', 'Plain']).nullable(),
  blocks: z.array(promptBlockSchema).nullable(),
  updated_at: z.string(),
  last_used_at: z.string().nullable(),
});

// Form-level schemas — used for validation in CRUD dialogs.

export const snippetFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or fewer'),
  trigger: z
    .string()
    .min(1, 'Trigger is required')
    .max(60, 'Trigger must be 60 characters or fewer')
    .regex(
      /^[!/:;]*[a-zA-Z0-9_-]+$/,
      'An optional prefix (:: / ; !) followed by letters, numbers, hyphens, and underscores',
    ),
  content: z.string().min(1, 'Content is required'),
  bodies: snippetBodiesSchema,
  // Folder ids are TEXT (legacy + org folders), not necessarily UUIDs.
  folder_id: z.string().nullable(),
  language: languageEnum,
  pinned: z.boolean().default(false),
  alternative_queries: z.array(z.string()).default([]),
  enable_urgency_timer: z.boolean().default(false),
  timer_duration_ms: z.number().int().nonnegative().default(0),
  scarcity_count: z.number().int().nonnegative().default(0),
});

export type SnippetFormValues = z.infer<typeof snippetFormSchema>;

export const folderFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50, 'Name must be 50 characters or fewer'),
  icon: z.string().min(1, 'Icon is required'),
});

export type FolderFormValues = z.infer<typeof folderFormSchema>;

export const promptFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or fewer'),
  content: z.string(),
  // Optional direct-expansion trigger. Empty = menu-only. A bare token — the
  // prompt trigger (""") is prepended by the extension, so no prefix here (that
  // would conflate it with the snippet trigger).
  shortcut: z
    .union([
      z.literal(''),
      z
        .string()
        .max(60, 'Shortcut must be 60 characters or fewer')
        .regex(
          /^[a-zA-Z0-9_-]+$/,
          'Letters, numbers, hyphens, and underscores only',
        ),
    ])
    .optional(),
  type: z.enum(['one-shot', 'few-shot']),
  tags: z.array(z.string()),
  strategy_type: z.enum(['CoT', 'ToT', 'Few-shot', 'One-shot', 'RAG', 'Agentic']).nullable(),
  thinking_mode: z.enum(['fast', 'balanced', 'deep']).nullable(),
  preferred_model: z.enum(['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5']).nullable(),
  complexity_level: z.enum(['simple', 'medium', 'complex']).nullable(),
  execution_type: z.enum(['Generate', 'Analyze', 'Plan', 'Critique', 'Summarize', 'Transform']).nullable(),
  intent_category: z.enum(['Writing', 'Coding', 'Support', 'SEO', 'Analysis', 'Planning', 'Research', 'Teaching']).nullable(),
  output_type: z.enum(['JSON', 'Markdown', 'SOP', 'Plain']).nullable(),
  blocks: z
    .array(
      z.object({
        type: z.enum(['role', 'objective', 'context', 'examples', 'reasoning', 'constraints']),
        content: z.string(),
        enabled: z.boolean(),
      }),
    )
    .nullable(),
  // Folder ids are TEXT (legacy + org folders), not necessarily UUIDs.
  folder_id: z.string().nullable(),
});

export type PromptFormValues = z.infer<typeof promptFormSchema>;
