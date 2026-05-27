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
  is_formula: z.boolean(),
  formula: z.string().nullable(),
  variables: z.record(z.unknown()),
  folder_id: z.string().uuid().nullable(),
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
    .regex(/^[a-zA-Z0-9_-]+$/, 'Letters, numbers, hyphens, and underscores only'),
  content: z.string().min(1, 'Content is required'),
  bodies: snippetBodiesSchema,
  folder_id: z.string().uuid().nullable(),
  language: languageEnum,
  pinned: z.boolean().default(false),
  is_shared: z.boolean().default(false),
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
});

export type PromptFormValues = z.infer<typeof promptFormSchema>;
