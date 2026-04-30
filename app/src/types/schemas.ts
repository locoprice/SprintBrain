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

export const snippetSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  name: z.string().min(1),
  content: z.string(),
  triggers: z.array(z.string()),
  tags: z.array(z.string()),
  is_formula: z.boolean(),
  formula: z.string().nullable(),
  variables: z.record(z.unknown()),
  folder_id: z.string().uuid().nullable(),
  language: z.enum(['EN', 'IT', 'ES', 'FR', 'MULTI']),
  updated_at: z.string(),
});

export const promptSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  name: z.string().min(1),
  content: z.string(),
  type: z.enum(['one-shot', 'few-shot']),
  tags: z.array(z.string()),
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
  folder_id: z.string().uuid().nullable(),
  language: z.enum(['EN', 'IT', 'ES', 'FR', 'MULTI']),
});

export type SnippetFormValues = z.infer<typeof snippetFormSchema>;

export const folderFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50, 'Name must be 50 characters or fewer'),
  icon: z.string().min(1, 'Icon is required'),
});

export type FolderFormValues = z.infer<typeof folderFormSchema>;

export const promptFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or fewer'),
  content: z.string().min(1, 'Content is required'),
  type: z.enum(['one-shot', 'few-shot']),
  tags: z.array(z.string()),
});

export type PromptFormValues = z.infer<typeof promptFormSchema>;
