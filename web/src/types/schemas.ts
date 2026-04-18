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
