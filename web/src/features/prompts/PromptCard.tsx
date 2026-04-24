import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Sparkles } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { Prompt } from '@/types/database';
import { useUiStore } from '@/stores/uiStore';

interface PromptCardProps {
  prompt: Prompt;
}

const PREVIEW_LIMIT = 140;

export function PromptCard({ prompt }: PromptCardProps) {
  const openEditPrompt = useUiStore((s) => s.openEditPrompt);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const preview =
    prompt.content.length > PREVIEW_LIMIT
      ? `${prompt.content.slice(0, PREVIEW_LIMIT).trim()}…`
      : prompt.content;

  const lastUsed = prompt.last_used_at
    ? `Used ${formatDistanceToNow(new Date(prompt.last_used_at), { addSuffix: true })}`
    : 'Never used';

  async function handleUse(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(prompt.content);
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard write denied — no visual change.
    }
  }

  return (
    <Card
      onClick={() => openEditPrompt(prompt.id)}
      className="flex h-full cursor-pointer flex-col p-5 transition-colors hover:bg-bg-alt/60"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-primary-light text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-semibold leading-tight text-ink">{prompt.name}</h3>
        </div>
        <Badge variant={prompt.type === 'few-shot' ? 'primary' : 'outline'}>
          {prompt.type}
        </Badge>
      </div>

      <CardContent className="flex flex-1 flex-col px-0 pb-0 pt-3">
        <p className="line-clamp-3 flex-1 text-sm leading-relaxed text-ink-muted">
          {preview}
        </p>

        <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
          <span className="text-xs text-ink-subtle">{lastUsed}</span>
          <Button variant="subtle" size="sm" onClick={handleUse}>
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Use
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
