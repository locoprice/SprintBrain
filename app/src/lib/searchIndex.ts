import { groupSnippetsByLanguage } from '@/lib/snippetGrouping';
import type {
  Label,
  LabelAssignments,
  MemoryItem,
  MemorySpace,
  Prompt,
  SnippetRow,
} from '@/types/database';

// What the one search bar matches, and how it ranks (SEARCH-001).
//
// Pure on purpose: the header bar, each page's filtered list and the aggregated
// panel all read the same rules from here, so "does this match?" has exactly one
// answer per asset no matter who is asking. It also means the rules are testable
// without rendering anything, which the store-backed lists are not.
//
// One scorer serves both readings. A page filter asks "is this above zero?" and
// the panel asks "how far above?", so there is no second implementation to keep
// in step.

export type SearchKind = 'snippet' | 'prompt' | 'memory';

export interface SearchHit {
  kind: SearchKind;
  id: string;
  name: string;
  /** The second line: a trigger, a shortcut, or the space an item sits in. */
  detail: string;
  score: number;
  /** Memory items only: the space to open to reach the result. */
  spaceId?: string;
}

export interface SearchLibrary {
  snippets: SnippetRow[];
  prompts: Prompt[];
  spaces: MemorySpace[];
  /** Items across every space. Empty until the panel has loaded them. */
  items: MemoryItem[];
  /** Label names assigned to a snippet id. */
  snippetLabels: (id: string) => string[];
  /** Label names assigned to a prompt id. */
  promptLabels: (id: string) => string[];
}

export interface SearchResults {
  snippets: SearchHit[];
  prompts: SearchHit[];
  memory: SearchHit[];
  total: number;
}

/**
 * Field weights. A name beats a trigger, a trigger beats a label, and body text
 * comes last: matching a word buried in a body is useful, but it must never
 * outrank the snippet actually called that.
 */
const W_NAME = 8;
const W_KEY = 6;
const W_TAG = 3;
const W_SUMMARY = 4;
const W_BODY = 1;

/** Collapse a typed query to what the matchers compare against. */
export function normalizeQuery(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Which of the three a route belongs to, or null on a page that holds none of
 * them (analytics, team, settings).
 *
 * One rule, read by the bar to word its placeholder and by the panel to scope
 * results to "this section". A second copy would let the two disagree about
 * where the user is.
 */
export function sectionForPath(pathname: string): SearchKind | null {
  if (pathname === '/') return 'snippet';
  if (pathname.startsWith('/prompts')) return 'prompt';
  if (pathname.startsWith('/memory')) return 'memory';
  return null;
}

/** The space being viewed, for scoping memory results to it. Null elsewhere. */
export function spaceForPath(pathname: string): string | null {
  const match = /^\/memory\/([^/]+)/.exec(pathname);
  return match ? (match[1] ?? null) : null;
}

/**
 * Resolve an asset id to the names of its labels.
 *
 * The id-to-name map is built once per call rather than per asset, because the
 * snippets list runs this across every row on every keystroke.
 */
export function labelNameLookup(
  catalog: readonly Label[],
  assignments: LabelAssignments,
): (assetId: string) => string[] {
  const names = new Map(catalog.map((label) => [label.id, label.name]));
  return (assetId) => {
    const ids = assignments.get(assetId);
    if (ids === undefined || ids.length === 0) return [];
    return ids
      .map((id) => names.get(id))
      .filter((name): name is string => name !== undefined);
  };
}

/**
 * Score one field. A prefix match counts double, so typing "inv" puts "Invoice"
 * above a note that merely mentions invoices halfway down.
 */
function scoreField(text: string | null | undefined, query: string, weight: number): number {
  if (!text) return 0;
  const haystack = text.toLowerCase();
  if (haystack.startsWith(query)) return weight * 2;
  return haystack.includes(query) ? weight : 0;
}

function scoreList(texts: readonly string[], query: string, weight: number): number {
  let best = 0;
  for (const text of texts) {
    const score = scoreField(text, query, weight);
    if (score > best) best = score;
  }
  return best;
}

/**
 * Snippets match on name, trigger, keyword synonyms, labels and body text.
 * Body text was added with the one search bar: a prompt already searched its
 * content, and the two behaving differently was the kind of difference a user
 * reads as a bug.
 */
export function scoreSnippet(
  snippet: SnippetRow,
  query: string,
  labelNames: readonly string[] = [],
): number {
  if (query === '') return 0;
  // Every language variant's body, not just the master's: a Spanish body is
  // still this snippet's text.
  const bodies = Object.values(snippet.bodies).filter(
    (body): body is string => typeof body === 'string',
  );
  return Math.max(
    scoreField(snippet.name, query, W_NAME),
    scoreList(snippet.triggers, query, W_KEY),
    scoreList(snippet.alternative_queries, query, W_SUMMARY),
    scoreList(labelNames, query, W_TAG),
    scoreField(snippet.content, query, W_BODY),
    scoreList(bodies, query, W_BODY),
  );
}

/** Prompts match on name, shortcut, intent, labels and content. */
export function scorePrompt(
  prompt: Prompt,
  query: string,
  labelNames: readonly string[] = [],
): number {
  if (query === '') return 0;
  return Math.max(
    scoreField(prompt.name, query, W_NAME),
    scoreField(prompt.shortcut, query, W_KEY),
    scoreField(prompt.intent_category, query, W_SUMMARY),
    scoreList(labelNames, query, W_TAG),
    scoreField(prompt.content, query, W_BODY),
  );
}

/**
 * Memory items match on name, summary, body and the name of the space holding
 * them. The space name is in there because "everything in Clients" is how people
 * describe what they are looking for; memory items carry no labels.
 */
export function scoreMemoryItem(
  item: MemoryItem,
  query: string,
  spaceName: string | null = null,
): number {
  if (query === '') return 0;
  return Math.max(
    scoreField(item.name, query, W_NAME),
    scoreField(item.summary, query, W_SUMMARY),
    scoreField(spaceName, query, W_TAG),
    scoreField(item.body, query, W_BODY),
  );
}

/** Spaces match on their own name and description. */
export function scoreSpace(space: MemorySpace, query: string): number {
  if (query === '') return 0;
  return Math.max(
    scoreField(space.name, query, W_NAME),
    scoreField(space.description, query, W_SUMMARY),
  );
}

function byScoreThenName(a: SearchHit, b: SearchHit): number {
  if (a.score !== b.score) return b.score - a.score;
  return a.name.localeCompare(b.name);
}

/**
 * Every match across the three libraries, grouped by type.
 *
 * Language variants collapse to one hit through the same grouping rule the
 * snippets table uses, so a snippet written in four languages is one result
 * rather than four, and it is scored by whichever variant matched best.
 */
export function searchAll(library: SearchLibrary, rawQuery: string): SearchResults {
  const query = normalizeQuery(rawQuery);
  const empty: SearchResults = { snippets: [], prompts: [], memory: [], total: 0 };
  if (query === '') return empty;

  const snippets: SearchHit[] = [];
  for (const group of groupSnippetsByLanguage(library.snippets)) {
    let best = 0;
    for (const variant of group.variants) {
      const score = scoreSnippet(variant, query, library.snippetLabels(variant.id));
      if (score > best) best = score;
    }
    if (best > 0) {
      snippets.push({
        kind: 'snippet',
        id: group.master.id,
        name: group.master.name,
        detail: group.master.triggers[0] ?? '',
        score: best,
      });
    }
  }

  const prompts: SearchHit[] = [];
  for (const prompt of library.prompts) {
    const score = scorePrompt(prompt, query, library.promptLabels(prompt.id));
    if (score > 0) {
      prompts.push({
        kind: 'prompt',
        id: prompt.id,
        name: prompt.name,
        detail: prompt.shortcut ?? prompt.intent_category ?? '',
        score,
      });
    }
  }

  const spaceNames = new Map(library.spaces.map((space) => [space.id, space.name]));
  const memory: SearchHit[] = [];
  for (const space of library.spaces) {
    const score = scoreSpace(space, query);
    if (score > 0) {
      memory.push({
        kind: 'memory',
        id: space.id,
        name: space.name,
        detail: 'Space',
        score,
        spaceId: space.id,
      });
    }
  }
  for (const item of library.items) {
    if (item.deleted_at !== null) continue;
    const spaceName = spaceNames.get(item.space_id) ?? null;
    const score = scoreMemoryItem(item, query, spaceName);
    if (score > 0) {
      memory.push({
        kind: 'memory',
        id: item.id,
        name: item.name,
        detail: spaceName ?? '',
        score,
        spaceId: item.space_id,
      });
    }
  }

  snippets.sort(byScoreThenName);
  prompts.sort(byScoreThenName);
  memory.sort(byScoreThenName);

  return {
    snippets,
    prompts,
    memory,
    total: snippets.length + prompts.length + memory.length,
  };
}
