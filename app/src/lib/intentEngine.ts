import type {
  IntentCategory,
  StrategyType,
  ExecutionType,
  ThinkingMode,
  PreferredModel,
} from '@/types/database';

export interface ClassificationResult {
  intent: IntentCategory;
  strategies: StrategyType[];
  executionType: ExecutionType;
  thinkingMode: ThinkingMode;
  preferredModel: PreferredModel;
  /** 0-1. Values below LLM_THRESHOLD would route to Layer 2. */
  confidence: number;
}

const LLM_THRESHOLD = 0.6;

/** Match weights. Phrases are the strongest, then specific terms, then generic. */
const PHRASE_WEIGHT = 4;
const PRIMARY_WEIGHT = 3;
const SECONDARY_WEIGHT = 1;

/** Score at which absolute signal strength saturates to 1. */
const STRENGTH_SATURATION = 10;

interface IntentRule {
  intent: IntentCategory;
  /** High-signal, specific single-word terms (weight PRIMARY_WEIGHT). */
  primary: string[];
  /** Supporting, more generic single-word terms (weight SECONDARY_WEIGHT). */
  secondary: string[];
  /** Unambiguous multi-word phrases matched on the raw text (weight PHRASE_WEIGHT). */
  phrases: string[];
  strategies: StrategyType[];
  executionType: ExecutionType;
  preferredModel: PreferredModel;
  thinkingMode: ThinkingMode;
}

const INTENT_RULES: IntentRule[] = [
  {
    intent: 'Coding',
    primary: [
      'code', 'coding', 'debug', 'function', 'refactor', 'api', 'algorithm',
      'typescript', 'javascript', 'python', 'compile', 'syntax', 'component',
      'hook', 'async', 'regex', 'runtime', 'variable', 'exception', 'sql',
    ],
    secondary: ['bug', 'implement', 'test', 'class', 'error', 'fix', 'deploy', 'build'],
    phrases: ['pull request', 'unit test', 'type error', 'stack trace', 'code review', 'edge case'],
    strategies: ['CoT', 'ToT'],
    executionType: 'Generate',
    preferredModel: 'claude-opus-4-7',
    thinkingMode: 'deep',
  },
  {
    intent: 'Writing',
    primary: [
      'write', 'blog', 'article', 'essay', 'copywriting', 'newsletter',
      'prose', 'narrative', 'storytelling', 'headline', 'tagline', 'screenplay', 'poem',
    ],
    secondary: ['email', 'draft', 'content', 'tone', 'formal', 'casual', 'social', 'post', 'paragraph', 'sentence', 'story'],
    phrases: ['blog post', 'cover letter', 'product description', 'social media'],
    strategies: ['One-shot', 'Few-shot'],
    executionType: 'Generate',
    preferredModel: 'claude-sonnet-4-6',
    thinkingMode: 'balanced',
  },
  {
    intent: 'SEO',
    primary: ['seo', 'keyword', 'backlink', 'serp', 'sitemap', 'permalink'],
    secondary: ['meta', 'rank', 'ranking', 'search', 'traffic', 'optimize', 'organic', 'index', 'crawl'],
    phrases: ['title tag', 'meta description', 'search engine', 'keyword research', 'on page', 'link building'],
    strategies: ['Few-shot', 'One-shot'],
    executionType: 'Generate',
    preferredModel: 'claude-sonnet-4-6',
    thinkingMode: 'balanced',
  },
  {
    intent: 'Support',
    primary: ['customer', 'ticket', 'complaint', 'refund', 'escalate', 'faq', 'helpdesk'],
    secondary: ['support', 'help', 'issue', 'respond', 'resolution', 'answer', 'reply', 'service', 'satisfaction', 'apologize'],
    phrases: ['customer service', 'support ticket', 'help desk', 'angry customer'],
    strategies: ['Few-shot', 'One-shot'],
    executionType: 'Generate',
    preferredModel: 'claude-haiku-4-5',
    thinkingMode: 'fast',
  },
  {
    intent: 'Analysis',
    primary: ['analyze', 'analyse', 'analysis', 'evaluate', 'assess', 'benchmark', 'audit', 'metrics', 'correlation', 'dataset'],
    secondary: ['review', 'compare', 'critique', 'data', 'report', 'insight', 'performance', 'findings', 'trend', 'statistics'],
    phrases: ['root cause', 'data analysis', 'pros and cons', 'swot analysis'],
    strategies: ['CoT', 'RAG'],
    executionType: 'Analyze',
    preferredModel: 'claude-opus-4-7',
    thinkingMode: 'deep',
  },
  {
    intent: 'Planning',
    primary: ['roadmap', 'strategy', 'milestone', 'sprint', 'backlog', 'prioritize', 'timeline', 'gantt', 'okr'],
    secondary: ['plan', 'outline', 'steps', 'project', 'schedule', 'goal', 'task', 'workflow', 'agenda', 'phases'],
    phrases: ['project plan', 'action plan', 'go to market', 'step plan'],
    strategies: ['ToT', 'CoT'],
    executionType: 'Plan',
    preferredModel: 'claude-sonnet-4-6',
    thinkingMode: 'deep',
  },
  {
    intent: 'Research',
    primary: ['research', 'sources', 'literature', 'survey', 'citation', 'hypothesis', 'methodology', 'bibliography'],
    secondary: ['find', 'gather', 'collect', 'information', 'study', 'explore', 'compile', 'overview', 'background', 'investigate'],
    phrases: ['literature review', 'market research', 'gather sources', 'state of the art'],
    strategies: ['RAG', 'Agentic'],
    executionType: 'Summarize',
    preferredModel: 'claude-opus-4-7',
    thinkingMode: 'balanced',
  },
  {
    intent: 'Teaching',
    primary: ['teach', 'explain', 'tutor', 'lesson', 'curriculum', 'tutorial', 'quiz', 'flashcard', 'pedagogy'],
    secondary: ['course', 'example', 'demonstrate', 'simplify', 'understand', 'learn', 'concept', 'beginner', 'guide'],
    phrases: ['step by step', 'explain like', 'for beginners', 'walk through', 'in simple terms'],
    strategies: ['Few-shot', 'CoT'],
    executionType: 'Generate',
    preferredModel: 'claude-sonnet-4-6',
    thinkingMode: 'balanced',
  },
];

/**
 * Lightweight stemmer: collapses common English inflections so that
 * "functions", "debugging", "planned" reduce to the same root as their
 * base keyword. Intentionally conservative to limit over-stemming.
 */
export function stem(word: string): string {
  let w = word;
  if (w.length <= 3) return w;

  if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith('ied') && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('ies') && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (w.endsWith('es') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) w = w.slice(0, -1);

  // Collapse a doubled final consonant: planning -> plann -> plan.
  if (w.length > 3 && /([bcdfghjklmnpqrstvwxz])\1$/.test(w)) w = w.slice(0, -1);

  // Drop a trailing silent 'e' so code/coding and analyze/analyzing unify.
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);

  return w;
}

/** Build the set of raw tokens and their stems from the input text. */
function buildTokenSet(lower: string): Set<string> {
  const set = new Set<string>();
  const tokens = lower.match(/[a-z0-9]+/g) ?? [];
  for (const t of tokens) {
    set.add(t);
    set.add(stem(t));
  }
  return set;
}

/** A single-word keyword matches if its raw or stemmed form is present. */
function keywordMatches(keyword: string, tokens: Set<string>): boolean {
  return tokens.has(keyword) || tokens.has(stem(keyword));
}

function scoreRule(rule: IntentRule, tokens: Set<string>, lower: string): number {
  let score = 0;
  for (const phrase of rule.phrases) {
    if (lower.includes(phrase)) score += PHRASE_WEIGHT;
  }
  for (const kw of rule.primary) {
    if (keywordMatches(kw, tokens)) score += PRIMARY_WEIGHT;
  }
  for (const kw of rule.secondary) {
    if (keywordMatches(kw, tokens)) score += SECONDARY_WEIGHT;
  }
  return score;
}

/**
 * Layer 1: deterministic token classifier.
 * Returns null when nothing matches (confidence = 0).
 *
 * Confidence blends absolute signal strength with the margin over the
 * runner-up intent, so a dominant single-intent match scores higher than
 * an ambiguous near-tie of equal raw strength.
 */
export function classifyPromptText(text: string): ClassificationResult | null {
  if (!text.trim()) return null;

  const lower = text.toLowerCase();
  const tokens = buildTokenSet(lower);

  // Stable sort preserves INTENT_RULES order on ties (deterministic).
  const scored = INTENT_RULES.map((rule) => ({ rule, score: scoreRule(rule, tokens, lower) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score === 0) return null;

  const secondScore = scored[1]?.score ?? 0;
  const strength = Math.min(best.score / STRENGTH_SATURATION, 1);
  const margin = (best.score - secondScore) / best.score;
  const confidence = Math.max(0.3, Math.min(0.3 + 0.5 * strength + 0.2 * margin, 0.98));

  return {
    intent: best.rule.intent,
    strategies: best.rule.strategies,
    executionType: best.rule.executionType,
    thinkingMode: best.rule.thinkingMode,
    preferredModel: best.rule.preferredModel,
    confidence,
  };
}

/**
 * Layer 2: LLM-backed strategy selector.
 * Activated when Layer 1 confidence is below LLM_THRESHOLD.
 *
 * Currently returns a deterministic result (stub).
 * Replace the stub body with a Claude API call once CLAUDE_API_KEY is wired:
 *   const anthropic = new Anthropic({ apiKey: import.meta.env.VITE_CLAUDE_API_KEY });
 *   const response = await anthropic.messages.create({ ... });
 */
async function classifyWithLLM(
  _text: string,
  layer1: ClassificationResult,
): Promise<ClassificationResult> {
  // Stub: boost confidence slightly to signal Layer 2 ran.
  return { ...layer1, confidence: Math.max(layer1.confidence, 0.72) };
}

/**
 * Full two-layer classifier. Use this in UI components.
 * Always fast (Layer 2 stub is synchronous in practice).
 */
export async function classifyPrompt(text: string): Promise<ClassificationResult | null> {
  const layer1 = classifyPromptText(text);
  if (!layer1) return null;
  if (layer1.confidence >= LLM_THRESHOLD) return layer1;
  return classifyWithLLM(text, layer1);
}

export { assembleBlocks } from '@/lib/promptUtils';
