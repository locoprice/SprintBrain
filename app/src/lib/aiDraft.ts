import { z } from 'zod';
import { deriveTriggerFromName, TRIGGER_MAX_LENGTH } from '@/lib/triggerUtils';
import type { MemoryItemKind, PromptBlock, SnippetLanguage } from '@/types/database';

// Draft with AI (AI-KNOWLEDGE P3, docs/AI_KNOWLEDGE_PLAN.md).
//
// The draft-with-ai edge function turns pasted text into a draft snippet,
// prompt or Brain item. This module reads its reply and turns a draft into the
// values an editor holds. Nothing here saves: the editor shows the draft, and
// a person saves it or not.

export type DraftKind = 'snippet' | 'prompt' | 'memory';
export type DraftMode = 'new' | 'update';

/** Mirrors MIN_TEXT_CHARS / MAX_TEXT_CHARS in the edge function. */
export const DRAFT_TEXT_MIN = 20;
export const DRAFT_TEXT_MAX = 20000;

/** Mirrors the memory_shards name check and ItemEditor's NAME_MAX. */
const MEMORY_NAME_MAX = 64;

const LANGUAGES = ['EN', 'IT', 'ES', 'FR', 'MULTI'] as const;
const MEMORY_KINDS = ['fact', 'note', 'conversation'] as const;

const snippetDraftSchema = z.object({
  title: z.string().min(1),
  trigger: z.string().default(''),
  language: z.enum(LANGUAGES).catch('EN'),
  body: z.string().min(1),
  folder: z.string().default(''),
  labels: z.array(z.string()).default([]),
});

const promptDraftSchema = z.object({
  name: z.string().min(1),
  shortcut: z.string().default(''),
  role: z.string().default(''),
  objective: z.string().default(''),
  context: z.string().default(''),
  examples: z.string().default(''),
  constraints: z.string().default(''),
  folder: z.string().default(''),
  labels: z.array(z.string()).default([]),
});

const memoryDraftSchema = z.object({
  name: z.string().min(1),
  summary: z.string().default(''),
  body: z.string().min(1),
  kind: z.enum(MEMORY_KINDS).catch('note'),
});

export type SnippetDraft = z.infer<typeof snippetDraftSchema>;
export type PromptDraft = z.infer<typeof promptDraftSchema>;
export type MemoryDraft = z.infer<typeof memoryDraftSchema>;

interface DraftEnvelope<K extends DraftKind, D> {
  kind: K;
  mode: DraftMode;
  draft: D;
  /** What an update changed, in a sentence or two. '' for a new draft. */
  changes: string;
}

export type DraftResult =
  | DraftEnvelope<'snippet', SnippetDraft>
  | DraftEnvelope<'prompt', PromptDraft>
  | DraftEnvelope<'memory', MemoryDraft>;

const envelopeSchema = z.object({
  ok: z.literal(true),
  mode: z.enum(['new', 'update']),
  draft: z.unknown(),
  changes: z.string().default(''),
});

/** Reads the edge function's reply for the kind that was asked for. Null when it is not one. */
export function parseDraftResponse(kind: DraftKind, raw: unknown): DraftResult | null {
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) return null;
  const { mode, draft, changes } = envelope.data;
  if (kind === 'snippet') {
    const parsed = snippetDraftSchema.safeParse(draft);
    return parsed.success ? { kind, mode, draft: parsed.data, changes } : null;
  }
  if (kind === 'prompt') {
    const parsed = promptDraftSchema.safeParse(draft);
    return parsed.success ? { kind, mode, draft: parsed.data, changes } : null;
  }
  const parsed = memoryDraftSchema.safeParse(draft);
  return parsed.success ? { kind, mode, draft: parsed.data, changes } : null;
}

/**
 * A trigger or shortcut no other item uses: `welcome`, then `welcome_2`,
 * `welcome_3`… Two snippets on one trigger would leave the extension to pick
 * one, so a draft never takes a token that is already in use.
 */
export function uniqueToken(base: string, taken: Iterable<string>): string {
  const clean = deriveTriggerFromName(base);
  if (clean === '') return '';
  const used = new Set<string>();
  for (const t of taken) used.add(t.trim().toLowerCase());
  if (!used.has(clean)) return clean;
  for (let n = 2; ; n++) {
    const suffix = `_${n}`;
    const candidate = `${clean.slice(0, TRIGGER_MAX_LENGTH - suffix.length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * A Brain item name no other live item uses: names are unique per person, so
 * a taken one would only fail at save. `Opening hours`, then `Opening hours (2)`.
 */
export function uniqueName(base: string, taken: Iterable<string>, max = MEMORY_NAME_MAX): string {
  const clean = base.trim().slice(0, max).trim();
  const used = new Set<string>();
  for (const t of taken) used.add(t.trim().toLowerCase());
  if (!used.has(clean.toLowerCase())) return clean;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate = `${clean.slice(0, max - suffix.length).trim()}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

interface Named {
  id: string;
  name: string;
}

/** The id of the offered folder or label the draft named, matched without case. */
export function idByName(name: string, list: readonly Named[]): string | null {
  const key = name.trim().toLowerCase();
  if (key === '') return null;
  return list.find((item) => item.name.trim().toLowerCase() === key)?.id ?? null;
}

export function idsByName(names: readonly string[], list: readonly Named[]): string[] {
  const ids: string[] = [];
  for (const name of names) {
    const id = idByName(name, list);
    if (id !== null && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export interface SnippetDraftFields {
  name: string;
  trigger: string;
  content: string;
  language: SnippetLanguage;
  folderId: string | null;
  labelIds: string[];
}

export interface SnippetDraftContext {
  folders: readonly Named[];
  labels: readonly Named[];
  /** Triggers already in use, the item being updated excluded. */
  takenTriggers: Iterable<string>;
}

export function snippetDraftFields(draft: SnippetDraft, ctx: SnippetDraftContext): SnippetDraftFields {
  return {
    name: draft.title,
    trigger: uniqueToken(draft.trigger || draft.title, ctx.takenTriggers),
    content: draft.body,
    language: draft.language,
    folderId: idByName(draft.folder, ctx.folders),
    labelIds: idsByName(draft.labels, ctx.labels),
  };
}

/**
 * The five editor blocks a prompt draft fills. Role and Objective stay on, as
 * in a new prompt; the optional three switch on only when the draft wrote them.
 */
export function promptDraftBlocks(draft: PromptDraft): PromptBlock[] {
  return [
    { type: 'role', content: draft.role, enabled: true },
    { type: 'objective', content: draft.objective, enabled: true },
    { type: 'context', content: draft.context, enabled: draft.context.trim() !== '' },
    { type: 'examples', content: draft.examples, enabled: draft.examples.trim() !== '' },
    { type: 'constraints', content: draft.constraints, enabled: draft.constraints.trim() !== '' },
  ];
}

export interface MemoryDraftFields {
  name: string;
  summary: string;
  body: string;
  kind: MemoryItemKind;
}

export function memoryDraftFields(draft: MemoryDraft, takenNames: Iterable<string>): MemoryDraftFields {
  return {
    name: uniqueName(draft.name, takenNames),
    summary: draft.summary,
    body: draft.body,
    kind: draft.kind,
  };
}
