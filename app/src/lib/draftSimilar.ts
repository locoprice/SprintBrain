import { snippetGroupKey } from '@/lib/snippetGrouping';
import type { MemoryItem, Prompt, SnippetRow } from '@/types/database';

// "A similar one already exists" (AI-KNOWLEDGE P3).
//
// Before a drafted snippet, prompt or Brain item is saved, the editor lists the
// items already in the library that look like it, so the person can update one
// of those instead of adding a near-duplicate. The check runs in the browser,
// over what the dashboard has already loaded, the same way for all three kinds.
//
// Words are compared, not meanings: accents folded, short and common words
// dropped (English, Italian, Spanish and French), fill-in fields ignored, and
// each word cut to its first six letters so "payment" and "payments", or
// "pagamento" and "pagamenti", count as one.

export interface SimilarCandidate {
  id: string;
  title: string;
  /** The words to compare: body, summary, prompt text. */
  text: string;
  /** Trigger or shortcut. Two items on one token always count as similar. */
  token?: string | null;
}

export type SimilarReason = 'token' | 'title' | 'content';

export interface SimilarMatch {
  id: string;
  title: string;
  reason: SimilarReason;
  score: number;
}

export interface SimilarDraft {
  title: string;
  text: string;
  token?: string | null;
}

/** Titles this close are the same subject. */
const TITLE_THRESHOLD = 0.75;
/** Texts this close say much the same thing. */
const CONTENT_THRESHOLD = 0.45;
/** …and share at least this many words, so two short texts are not matched on one word. */
const CONTENT_MIN_SHARED = 4;
/** Long documents are compared on their opening, which says what they are about. */
const TEXT_SCAN_CHARS = 4000;
const STEM_LENGTH = 6;

const STOPWORDS = new Set(
  (
    // English
    'the and for are but not you all any can had her was one our out has have him his how its may new now old see two way who did get let put say she too use that this with from they will would there their what about which when your them then than been were said each into more some could other these only also very after most over such here just like make well back much even want because does good where those come thank thanks please regards dear hello best ' +
    // Italian
    'che non per una con del della dei delle gli alla alle allo nel nella nei sono sei siamo hai hanno questo questa questi queste quello quella come anche più dove quando perché grazie cordiali saluti salve buongiorno buonasera ciao essere fare stato loro nostro nostra vostro vostra tutto tutti molto' +
    ' ' +
    // Spanish
    'los las una unos unas por con del para que como pero más sus este esta estos estas ese esa eso muy todo todos también donde cuando porque gracias saludos hola buenos buenas estimado estimada ser estar hay nos les ' +
    // French
    'les des une pour avec dans sur par pas que qui est sont vous nous mais plus ses ces cette tout tous aussi comme quand où bonjour merci cordialement salutations être avoir fait leur leurs notre votre'
  )
    .split(/\s+/)
    .filter((w) => w !== '')
    .map(fold),
);

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** The distinct word stems of a text, fill-in fields and numbers left out. */
export function wordStems(text: string): Set<string> {
  const out = new Set<string>();
  const clean = fold(text.slice(0, TEXT_SCAN_CHARS).replace(/\{[^{}]*\}/g, ' '));
  for (const word of clean.split(/[^\p{L}\p{N}]+/u)) {
    if (word.length < 3 || /^\d+$/.test(word) || STOPWORDS.has(word)) continue;
    out.add(word.slice(0, STEM_LENGTH));
  }
  return out;
}

function shared(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}

/** Dice coefficient: 1 when the two sets are the same, 0 when they share nothing. */
function dice(a: Set<string>, b: Set<string>, common: number): number {
  return a.size + b.size === 0 ? 0 : (2 * common) / (a.size + b.size);
}

/** The items most like the draft, closest first. Empty when none is close. */
export function findSimilar(
  draft: SimilarDraft,
  candidates: readonly SimilarCandidate[],
  limit = 3,
): SimilarMatch[] {
  const token = (draft.token ?? '').trim().toLowerCase();
  const draftTitle = wordStems(draft.title);
  const draftWords = wordStems(`${draft.title} ${draft.text}`);

  const matches: SimilarMatch[] = [];
  for (const c of candidates) {
    if (token !== '' && (c.token ?? '').trim().toLowerCase() === token) {
      matches.push({ id: c.id, title: c.title, reason: 'token', score: 1 });
      continue;
    }
    const title = wordStems(c.title);
    const titleScore = dice(draftTitle, title, shared(draftTitle, title));
    const words = wordStems(`${c.title} ${c.text}`);
    const common = shared(draftWords, words);
    const contentScore = common >= CONTENT_MIN_SHARED ? dice(draftWords, words, common) : 0;

    if (titleScore >= TITLE_THRESHOLD && titleScore >= contentScore) {
      matches.push({ id: c.id, title: c.title, reason: 'title', score: titleScore });
    } else if (contentScore >= CONTENT_THRESHOLD) {
      matches.push({ id: c.id, title: c.title, reason: 'content', score: contentScore });
    }
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ── What each section compares against ─────────────────────────────────────
// Archived items are left out: they are switched off, and "update it instead"
// should point at something people still use.

/** One candidate per snippet group, so a translated snippet is listed once. */
export function snippetCandidates(snippets: readonly SnippetRow[]): SimilarCandidate[] {
  const seen = new Set<string>();
  const out: SimilarCandidate[] = [];
  for (const s of snippets) {
    if (s.review_status === 'archived') continue;
    const key = snippetGroupKey(s);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: s.id, title: s.name, text: s.content, token: s.triggers[0] ?? null });
  }
  return out;
}

export function promptCandidates(prompts: readonly Prompt[]): SimilarCandidate[] {
  return prompts
    .filter((p) => p.review_status !== 'archived')
    .map((p) => ({ id: p.id, title: p.name, text: p.content, token: p.shortcut }));
}

export function memoryCandidates(items: readonly MemoryItem[]): SimilarCandidate[] {
  return items
    .filter((m) => m.review_status !== 'archived' && m.deleted_at === null)
    .map((m) => ({ id: m.id, title: m.name, text: `${m.summary} ${m.body}`, token: null }));
}
