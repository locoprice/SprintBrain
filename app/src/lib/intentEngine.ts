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
  /** 0–1. Values below LLM_THRESHOLD would route to Layer 2. */
  confidence: number;
}

const LLM_THRESHOLD = 0.6;

interface IntentRule {
  intent: IntentCategory;
  keywords: string[];
  strategies: StrategyType[];
  executionType: ExecutionType;
  preferredModel: PreferredModel;
  thinkingMode: ThinkingMode;
}

const INTENT_RULES: IntentRule[] = [
  {
    intent: 'Coding',
    keywords: [
      'code', 'debug', 'function', 'bug', 'implement', 'refactor', 'test',
      'api', 'algorithm', 'typescript', 'javascript', 'python', 'class',
      'error', 'fix', 'compile', 'syntax', 'component', 'hook', 'async',
    ],
    strategies: ['CoT', 'ToT'],
    executionType: 'Generate',
    preferredModel: 'claude-opus-4-7',
    thinkingMode: 'deep',
  },
  {
    intent: 'Writing',
    keywords: [
      'write', 'blog', 'article', 'email', 'copy', 'essay', 'draft',
      'content', 'tone', 'formal', 'casual', 'newsletter', 'social', 'post',
      'prose', 'paragraph', 'sentence', 'story', 'narrative',
    ],
    strategies: ['One-shot', 'Few-shot'],
    executionType: 'Generate',
    preferredModel: 'claude-sonnet-4-6',
    thinkingMode: 'balanced',
  },
  {
    intent: 'SEO',
    keywords: [
      'seo', 'keyword', 'meta', 'rank', 'search', 'traffic', 'optimize',
      'backlink', 'title tag', 'description', 'serp', 'organic', 'index',
      'crawl', 'sitemap',
    ],
    strategies: ['Few-shot', 'One-shot'],
    executionType: 'Generate',
    preferredModel: 'claude-sonnet-4-6',
    thinkingMode: 'balanced',
  },
  {
    intent: 'Support',
    keywords: [
      'support', 'help', 'customer', 'ticket', 'issue', 'complaint',
      'respond', 'resolution', 'answer', 'faq', 'reply', 'service',
      'escalate', 'refund', 'satisfaction',
    ],
    strategies: ['Few-shot', 'One-shot'],
    executionType: 'Generate',
    preferredModel: 'claude-haiku-4-5',
    thinkingMode: 'fast',
  },
  {
    intent: 'Analysis',
    keywords: [
      'analyze', 'analyse', 'review', 'evaluate', 'assess', 'compare',
      'critique', 'data', 'report', 'insight', 'metrics', 'performance',
      'benchmark', 'audit', 'findings',
    ],
    strategies: ['CoT', 'RAG'],
    executionType: 'Analyze',
    preferredModel: 'claude-opus-4-7',
    thinkingMode: 'deep',
  },
  {
    intent: 'Planning',
    keywords: [
      'plan', 'roadmap', 'strategy', 'outline', 'steps', 'project',
      'schedule', 'milestone', 'goal', 'task', 'workflow', 'sprint',
      'backlog', 'prioritize', 'timeline',
    ],
    strategies: ['ToT', 'CoT'],
    executionType: 'Plan',
    preferredModel: 'claude-sonnet-4-6',
    thinkingMode: 'deep',
  },
  {
    intent: 'Research',
    keywords: [
      'research', 'find', 'gather', 'collect', 'sources', 'information',
      'study', 'explore', 'survey', 'literature', 'summarize', 'curate',
      'compile', 'overview', 'background',
    ],
    strategies: ['RAG', 'Agentic'],
    executionType: 'Summarize',
    preferredModel: 'claude-opus-4-7',
    thinkingMode: 'balanced',
  },
  {
    intent: 'Teaching',
    keywords: [
      'teach', 'explain', 'tutor', 'lesson', 'course', 'example',
      'demonstrate', 'simplify', 'understand', 'quiz', 'learn', 'concept',
      'beginner', 'step by step', 'guide',
    ],
    strategies: ['Few-shot', 'CoT'],
    executionType: 'Generate',
    preferredModel: 'claude-sonnet-4-6',
    thinkingMode: 'balanced',
  },
];

/**
 * Layer 1: deterministic keyword classifier.
 * Returns null when no keywords match (confidence = 0).
 */
export function classifyPromptText(text: string): ClassificationResult | null {
  if (!text.trim()) return null;

  const lower = text.toLowerCase();

  let bestRuleIndex = 0;
  let bestScore = 0;

  for (let i = 0; i < INTENT_RULES.length; i++) {
    const score = INTENT_RULES[i]!.keywords.reduce(
      (acc, kw) => acc + (lower.includes(kw) ? 1 : 0),
      0,
    );
    if (score > bestScore) {
      bestScore = score;
      bestRuleIndex = i;
    }
  }

  if (bestScore === 0) return null;

  const bestRule = INTENT_RULES[bestRuleIndex]!;
  const confidence = Math.min(0.35 + bestScore * 0.12, 0.95);

  return {
    intent: bestRule.intent,
    strategies: bestRule.strategies,
    executionType: bestRule.executionType,
    thinkingMode: bestRule.thinkingMode,
    preferredModel: bestRule.preferredModel,
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

/**
 * Assembles enabled prompt blocks into a plain-text prompt string.
 * Block headers follow the ## Markdown convention used by Claude.
 */
export function assembleBlocks(
  blocks: Array<{ type: string; content: string; enabled: boolean }>,
): string {
  return blocks
    .filter((b) => b.enabled && b.content.trim())
    .map(
      (b) =>
        `## ${b.type.charAt(0).toUpperCase()}${b.type.slice(1)}\n${b.content.trim()}`,
    )
    .join('\n\n');
}
