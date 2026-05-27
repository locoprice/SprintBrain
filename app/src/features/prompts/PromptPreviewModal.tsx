import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useUiStore } from '@/stores/uiStore';
import { usePromptStore } from '@/stores/promptStore';
import { assembleBlocks } from '@/lib/promptUtils';

const MODEL_LABELS: Record<string, string> = {
  'claude-opus-4-7': 'Opus 4',
  'claude-sonnet-4-6': 'Sonnet 4',
  'claude-haiku-4-5': 'Haiku 4',
};

export function PromptPreviewModal() {
  const promptPreviewId = useUiStore((s) => s.promptPreviewId);
  const closePromptPreview = useUiStore((s) => s.closePromptPreview);
  const promptDraftContent = useUiStore((s) => s.promptDraftContent);
  const closePromptDraftPreview = useUiStore((s) => s.closePromptDraftPreview);
  const prompts = usePromptStore((s) => s.prompts);

  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  const prompt = promptPreviewId
    ? (prompts.find((p) => p.id === promptPreviewId) ?? null)
    : null;

  const isDraftMode = promptPreviewId === null && promptDraftContent !== null;
  const isOpen = !!prompt || isDraftMode;

  const assembled: string = isDraftMode
    ? (promptDraftContent ?? '')
    : prompt
      ? (prompt.blocks && prompt.blocks.length > 0
          ? assembleBlocks(prompt.blocks)
          : prompt.content)
      : '';

  useEffect(() => {
    setCopied(false);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [prompt, promptDraftContent]);

  function handleOpenChange(open: boolean) {
    if (!open) {
      if (isDraftMode) closePromptDraftPreview();
      else closePromptPreview();
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(assembled);
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard denied — silent.
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      {/* pr-10 makes room for the built-in DialogContent close button (absolute right-4 top-4) */}
      <DialogContent className="max-w-2xl overflow-hidden p-0">
        {/* Header */}
        <DialogHeader className="border-b border-line px-6 pb-4 pt-6 pr-10">
          <DialogTitle className="text-base font-semibold text-ink">
            {isDraftMode ? 'Draft preview' : (prompt?.name ?? '')}
          </DialogTitle>
          {!isDraftMode && prompt && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {prompt.strategy_type && (
                <Badge variant="primary">{prompt.strategy_type}</Badge>
              )}
              {prompt.intent_category && (
                <Badge variant="neutral">{prompt.intent_category}</Badge>
              )}
              {prompt.preferred_model && (
                <Badge variant="outline">
                  {MODEL_LABELS[prompt.preferred_model] ?? prompt.preferred_model}
                </Badge>
              )}
              {prompt.thinking_mode && (
                <Badge variant="outline">{prompt.thinking_mode}</Badge>
              )}
            </div>
          )}
        </DialogHeader>

        {/* Assembled prompt text */}
        <div className="max-h-[420px] overflow-y-auto px-6 py-5">
          {assembled ? (
            <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-ink">
              {assembled}
            </pre>
          ) : (
            <p className="text-sm italic text-ink-subtle">
              {isDraftMode
                ? 'No content yet — enable at least one block and add text.'
                : 'This prompt has no content yet. Open the editor to add blocks.'}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line px-6 py-4">
          <p className="text-xs text-ink-subtle">
            {assembled.length > 0
              ? `${assembled.length.toLocaleString()} characters`
              : isDraftMode ? 'Empty draft' : 'Empty prompt'}
          </p>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!assembled}
            className="inline-flex h-9 items-center gap-2 rounded-[10px] bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-40"
          >
            {copied ? (
              <>
                <Check className="h-4 w-4" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" />
                Copy to clipboard
              </>
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
