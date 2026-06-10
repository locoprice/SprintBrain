import type { SnippetRow } from '@/types/database';
import type { SnippetFormValues } from '@/types/schemas';

// ─── Export ───────────────────────────────────────────────────────────────────

interface ExportEnvelope {
  version: 1;
  exported_at: string;
  snippets: ExportItem[];
}

interface ExportItem {
  name: string;
  trigger: string;
  content: string;
  bodies: SnippetRow['bodies'];
  language: SnippetRow['language'];
  folder_name: string | null;
  pinned: boolean;
  enable_urgency_timer: boolean;
  timer_duration_ms: number;
  scarcity_count: number;
}

export function exportSnippets(snippets: SnippetRow[]): void {
  const envelope: ExportEnvelope = {
    version: 1,
    exported_at: new Date().toISOString(),
    snippets: snippets.map((s) => ({
      name: s.name,
      trigger: s.triggers[0] ?? '',
      content: s.content,
      bodies: s.bodies,
      language: s.language,
      folder_name: s.folder_name,
      pinned: s.pinned,
      enable_urgency_timer: s.enable_urgency_timer,
      timer_duration_ms: s.timer_duration_ms,
      scarcity_count: s.scarcity_count,
    })),
  };

  const blob = new Blob([JSON.stringify(envelope, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `sprintbrain-snippets-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

// ─── Import ───────────────────────────────────────────────────────────────────

const VALID_LANGS = new Set<string>(['EN', 'IT', 'ES', 'FR', 'MULTI']);

// Strip common prefix markers (/, //, ::, ;;) and replace invalid chars.
function sanitizeTrigger(raw: string): string {
  let t = raw.replace(/^[/:;]+/, '').trim();
  t = t.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return t.slice(0, 60) || 'imported';
}

function normalizeLang(v: unknown): SnippetFormValues['language'] {
  const upper = String(v ?? '').toUpperCase();
  return VALID_LANGS.has(upper) ? (upper as SnippetFormValues['language']) : 'EN';
}

// Map a raw JSON object to SnippetFormValues, accepting both SprintBrain and
// third-party field names (Text Blaze uses `shortcut` + `snippet`).
function coerceItem(raw: Record<string, unknown>): SnippetFormValues | null {
  const name = String(raw['name'] ?? raw['label'] ?? raw['title'] ?? '')
    .trim()
    .slice(0, 100);
  const triggerRaw = String(
    raw['trigger'] ?? raw['shortcut'] ?? raw['abbreviation'] ?? '',
  ).trim();
  const content = String(
    raw['content'] ?? raw['snippet'] ?? raw['body'] ?? raw['text'] ?? '',
  ).trim();

  if (!name || !triggerRaw || !content) return null;

  const trigger = sanitizeTrigger(triggerRaw);
  if (!trigger) return null;

  const language = normalizeLang(raw['language'] ?? raw['lang']);
  // Pull `bodies` from native exports if present; fall back to seeding the
  // active language slot with `content` so the imported row already has a
  // valid per-language map.
  const bodies: SnippetFormValues['bodies'] = { [language]: content };
  const rawBodies = raw['bodies'];
  if (rawBodies && typeof rawBodies === 'object') {
    for (const [key, value] of Object.entries(rawBodies)) {
      const upper = key.toUpperCase();
      if (VALID_LANGS.has(upper) && typeof value === 'string' && value.length > 0) {
        bodies[upper as SnippetFormValues['language']] = value;
      }
    }
  }

  return {
    name,
    trigger,
    content,
    bodies,
    language,
    folder_id: null,
    pinned: raw['pinned'] === true,
    alternative_queries: Array.isArray(raw['alternative_queries'])
      ? (raw['alternative_queries'] as string[]).filter((q) => typeof q === 'string')
      : [],
    enable_urgency_timer: raw['enable_urgency_timer'] === true,
    timer_duration_ms:
      typeof raw['timer_duration_ms'] === 'number' ? raw['timer_duration_ms'] : 0,
    scarcity_count:
      typeof raw['scarcity_count'] === 'number' ? raw['scarcity_count'] : 0,
  };
}

export interface ParseResult {
  valid: SnippetFormValues[];
  skipped: number;
}

// Parse a JSON file in any of the supported formats:
//   • SprintBrain native: { version: 1, snippets: [...] }
//   • Text Blaze grouped:  { groups: [{ snippets: [...] }] }
//   • Flat array:          [{ name, shortcut/trigger, snippet/content, ... }]
export async function parseImportFile(file: File): Promise<ParseResult> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON file — could not parse.');
  }

  const rawItems: unknown[] = [];

  if (Array.isArray(parsed)) {
    rawItems.push(...parsed);
  } else if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj['snippets'])) {
      // SprintBrain native or any { snippets: [] } wrapper
      rawItems.push(...(obj['snippets'] as unknown[]));
    } else if (Array.isArray(obj['groups'])) {
      // Text Blaze grouped export
      for (const group of obj['groups'] as unknown[]) {
        if (typeof group === 'object' && group !== null) {
          const g = group as Record<string, unknown>;
          if (Array.isArray(g['snippets'])) {
            rawItems.push(...(g['snippets'] as unknown[]));
          }
        }
      }
    }
  }

  if (rawItems.length === 0) {
    throw new Error(
      'No snippets found in the file. Expected a SprintBrain export, a Text Blaze export, or a flat JSON array.',
    );
  }

  let skipped = 0;
  const valid: SnippetFormValues[] = [];

  for (const item of rawItems) {
    if (typeof item !== 'object' || item === null) {
      skipped++;
      continue;
    }
    const coerced = coerceItem(item as Record<string, unknown>);
    if (!coerced) {
      skipped++;
      continue;
    }
    valid.push(coerced);
  }

  return { valid, skipped };
}
