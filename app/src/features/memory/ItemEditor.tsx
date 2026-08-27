import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertCircle, Pin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { estimateTokens } from '@/lib/memory/engine';
import type { MemoryItem, MemoryItemKind } from '@/types/database';
import type { SaveMemoryItemInput } from '@/lib/api/memoryApi';

// Create or edit one memory item.
//
// The token count is computed with estimateTokens from the engine rather than a
// local formula. It is the same arithmetic the database generates and the same
// number a budget is measured against, so a number shown here has to come from
// that function or it is a fourth implementation of a rule that already exists
// three times.

/** Mirrors the memory_shards_name_length CHECK. */
const NAME_MAX = 64;
/** Mirrors memory_shards_summary_length. */
const SUMMARY_MAX = 280;
/** Mirrors memory_shards_body_length. Anything larger is a document, not a fact. */
const BODY_MAX = 20000;

const KIND_LABELS: Record<MemoryItemKind, string> = {
  fact: 'Fact',
  note: 'Note',
  document: 'Document',
  conversation: 'Conversation',
};

/** Document chunks are produced by an upload, so the editor does not offer that kind. */
const AUTHORABLE_KINDS: MemoryItemKind[] = ['fact', 'note', 'conversation'];

interface ItemEditorProps {
  /** 'new' creates in `spaceId`; an item edits it; null is closed. */
  target: 'new' | MemoryItem | null;
  spaceId: string;
  onClose: () => void;
  onSave: (input: SaveMemoryItemInput) => Promise<unknown>;
}

export function ItemEditor({ target, spaceId, onClose, onSave }: ItemEditorProps) {
  const editing = target !== null && target !== 'new' ? target : null;

  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<MemoryItemKind>('fact');
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target === null) return;
    setName(editing?.name ?? '');
    setSummary(editing?.summary ?? '');
    setBody(editing?.body ?? '');
    setKind(editing?.kind ?? 'fact');
    setPinned(editing?.pinned ?? false);
    setError(null);
    setSaving(false);
  }, [target, editing]);

  const tokens = useMemo(() => estimateTokens(body), [body]);
  const trimmedName = name.trim();
  const overLength = body.length > BODY_MAX;
  const canSave = trimmedName.length > 0 && body.length > 0 && !overLength && !saving;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        id: editing?.id ?? null,
        space_id: spaceId,
        name: trimmedName,
        summary,
        body,
        kind,
        pinned,
        priority: editing?.priority ?? 0,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this item.');
      setSaving(false);
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit item' : 'Add text'}</DialogTitle>
          <DialogDescription>
            One item, one fact. The summary is what gets listed when an agent decides
            what is worth reading, so it earns its place more than the body does.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="item-name" className="text-xs font-medium text-ink-muted">
                Name
              </label>
              <Input
                id="item-name"
                value={name}
                maxLength={NAME_MAX}
                autoFocus
                placeholder="house-style"
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="item-kind" className="text-xs font-medium text-ink-muted">
                Kind
              </label>
              <select
                id="item-kind"
                value={kind}
                onChange={(event) => setKind(event.target.value as MemoryItemKind)}
                className="h-10 rounded-[12px] border border-line bg-card px-3 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                {AUTHORABLE_KINDS.map((value) => (
                  <option key={value} value={value}>
                    {KIND_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="item-summary" className="text-xs font-medium text-ink-muted">
              Summary <span className="text-ink-subtle">(one line)</span>
            </label>
            <Input
              id="item-summary"
              value={summary}
              maxLength={SUMMARY_MAX}
              placeholder="How output should be written"
              onChange={(event) => setSummary(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <label htmlFor="item-body" className="text-xs font-medium text-ink-muted">
                Body
              </label>
              <span
                className={cn(
                  'font-mono text-[11px] tabular-nums',
                  overLength ? 'text-danger' : 'text-ink-subtle',
                )}
              >
                {tokens} tokens · {body.length}/{BODY_MAX}
              </span>
            </div>
            <textarea
              id="item-body"
              value={body}
              rows={10}
              placeholder="Short sentences. No filler."
              onChange={(event) => setBody(event.target.value)}
              className="w-full resize-y rounded-[12px] border border-line bg-card px-3 py-2 font-mono text-sm leading-relaxed text-ink placeholder:text-ink-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            {overLength ? (
              <p className="text-xs text-danger">
                Over the limit by {body.length - BODY_MAX} characters. Something this long
                is a document: split it into separate items so a budget can still hold one.
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setPinned((value) => !value)}
            aria-pressed={pinned}
            className={cn(
              'flex items-center gap-2 self-start rounded-[10px] border px-3 py-1.5 text-xs font-medium transition-colors',
              pinned
                ? 'border-primary-bdr bg-primary-bg text-primary'
                : 'border-line bg-card text-ink-muted hover:bg-bg-alt',
            )}
          >
            <Pin className={cn('h-3.5 w-3.5', pinned && 'fill-current')} />
            {pinned ? 'Always attached' : 'Attach only when a step asks'}
          </button>

          {error ? (
            <div className="flex items-start gap-2 rounded-[10px] bg-danger-bg px-3 py-2 text-sm text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add item'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
