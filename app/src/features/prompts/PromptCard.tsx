import { memo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Brain, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { Prompt } from '@/types/database';
import { useUiStore } from '@/stores/uiStore';
import { usePromptStore } from '@/stores/promptStore';
import { assembleBlocks } from '@/lib/intentEngine';

interface PromptCardProps {
  prompt: Prompt;
}

const STRATEGY_COLORS: Record<string, string> = {
  CoT: 'bg-[#EEF2FF] text-[#1B4FD8] border-[#BED0FF]',
  ToT: 'bg-[#F5F3FF] text-[#7C3AED] border-[#DDD6FE]',
  'Few-shot': 'bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0]',
  'One-shot': 'bg-[#FFF7ED] text-[#C2410C] border-[#FED7AA]',
  RAG: 'bg-[#FFF1F2] text-[#BE123C] border-[#FECDD3]',
  Agentic: 'bg-[#0A0A0B] text-[#F5F5F5] border-[#2A2A2E]',
};

const MODEL_LABELS: Record<string, string> = {
  'claude-opus-4-7': 'Opus',
  'claude-sonnet-4-6': 'Sonnet',
  'claude-haiku-4-5': 'Haiku',
};

const COMPLEXITY_COLORS: Record<string, string> = {
  simple: 'text-success',
  medium: 'text-warning',
  complex: 'text-primary',
};

const PREVIEW_LIMIT = 130;

function getPreviewText(prompt: Prompt): string {
  if (prompt.blocks) {
    const assembled = assembleBlocks(prompt.blocks);
    if (assembled) {
      // Strip markdown headers for the card preview
      const stripped = assembled.replace(/^##\s+\w+\n/gm, '').trim();
      return stripped.length > PREVIEW_LIMIT
        ? `${stripped.slice(0, PREVIEW_LIMIT).trim()}…`
        : stripped;
    }
  }
  return prompt.content.length > PREVIEW_LIMIT
    ? `${prompt.content.slice(0, PREVIEW_LIMIT).trim()}…`
    : prompt.content;
}

export const PromptCard = memo(function PromptCard({ prompt }: PromptCardProps) {
  const openEditPrompt = useUiStore((s) => s.openEditPrompt);
  const openPromptPreview = useUiStore((s) => s.openPromptPreview);
  const markUsed = usePromptStore((s) => s.markUsed);

  const preview = getPreviewText(prompt);
  const strategyColor = prompt.strategy_type
    ? (STRATEGY_COLORS[prompt.strategy_type] ?? 'bg-bg-alt text-ink-muted border-line')
    : null;
  const modelLabel = prompt.preferred_model ? MODEL_LABELS[prompt.preferred_model] : null;
  const complexityColor = prompt.complexity_level
    ? (COMPLEXITY_COLORS[prompt.complexity_level] ?? 'text-ink-muted')
    : null;

  const lastUsed = prompt.last_used_at
    ? `Used ${formatDistanceToNow(new Date(prompt.last_used_at), { addSuffix: true })}`
    : 'Never used';

  function handleUse(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    markUsed(prompt.id);
    openPromptPreview(prompt.id);
  }

  return (
    <Card
      onClick={() => openEditPrompt(prompt.id)}
      className="flex h-full cursor-pointer flex-col p-5 transition-all hover:border-primary/30 hover:shadow-md"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-primary-light text-primary">
            <Brain className="h-4 w-4" />
          </div>
          <h3 className="truncate text-sm font-semibold text-ink">{prompt.name}</h3>
        </div>
        {prompt.strategy_type && strategyColor && (
          <span
            className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-mono text-[11px] font-semibold ${strategyColor}`}
          >
            {prompt.strategy_type}
          </span>
        )}
      </div>

      {/* Meta pills */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {prompt.intent_category && (
          <Badge variant="neutral" className="text-[11px]">
            {prompt.intent_category}
          </Badge>
        )}
        {modelLabel && (
          <span className="text-[11px] font-medium text-ink-subtle">{modelLabel}</span>
        )}
        {prompt.complexity_level && complexityColor && (
          <span className={`text-[11px] font-medium ${complexityColor}`}>
            {prompt.complexity_level}
          </span>
        )}
        {prompt.output_type && (
          <Badge variant="outline" className="text-[11px]">
            {prompt.output_type}
          </Badge>
        )}
      </div>

      <CardContent className="flex flex-1 flex-col px-0 pb-0 pt-3">
        {/* Content preview */}
        <p className="line-clamp-3 flex-1 text-sm leading-relaxed text-ink-muted">
          {preview || (
            <span className="italic text-ink-subtle">No content yet — click to edit.</span>
          )}
        </p>

        {/* Footer */}
        <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
          <span className="text-xs text-ink-subtle">{lastUsed}</span>
          <button
            type="button"
            onClick={handleUse}
            className="inline-flex h-7 items-center gap-1.5 rounded-[8px] bg-primary px-3 text-xs font-semibold text-white transition-colors hover:bg-primary-dark"
          >
            <Zap className="h-3 w-3" />
            Use
          </button>
        </div>
      </CardContent>
    </Card>
  );
});
