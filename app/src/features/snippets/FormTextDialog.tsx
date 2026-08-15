import { useEffect, useMemo, useRef, useState } from 'react';
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
import { buildFormTextToken, isValidFieldName } from '@/lib/formTextToken';

const HINT = 'text-[11px] text-ink-subtle mt-1.5';
const SECTION_LABEL = 'block text-xs font-medium text-ink-muted mb-1.5';

interface FormTextDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefilled field name — the next free TEXT_n for the body being edited. */
  suggestedName: string;
  onInsert: (token: string) => void;
}

/**
 * Builds a `{formtext:}` token for the snippet body: one line of arbitrary
 * text, typed in by whoever expands the snippet.
 *
 * The token grammar is written by `@/lib/formTextToken` and parsed back by the
 * formula engine, so what this dialog previews is exactly what expands. The
 * name arrives prefilled rather than blank — an unnamed text field is dropped
 * by the engine, so there is no useful empty state to offer.
 */
export function FormTextDialog({
  open,
  onOpenChange,
  suggestedName,
  onInsert,
}: FormTextDialogProps) {
  const [name, setName] = useState('');
  const [defaultValue, setDefaultValue] = useState('');

  const nameRef = useRef<HTMLInputElement | null>(null);

  // Every opening starts from a clean field — a half-built one carried over
  // from a cancelled insert would silently ship into the next snippet.
  useEffect(() => {
    if (!open) return;
    setName(suggestedName);
    setDefaultValue('');
  }, [open, suggestedName]);

  const nameValid = isValidFieldName(name);

  const token = useMemo(
    () => buildFormTextToken({ name, default: defaultValue }),
    [name, defaultValue],
  );

  function handleSubmit() {
    if (!nameValid) return;
    onInsert(token);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[440px] gap-0 p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          // Selected, not just focused: the name is prefilled, so typing should
          // replace the suggestion rather than append to it.
          nameRef.current?.focus();
          nameRef.current?.select();
        }}
      >
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>Insert text field</DialogTitle>
          <DialogDescription>
            One line of text, typed in when the snippet expands.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-2 flex flex-col gap-4">
          {/* ── Field name ── */}
          <div>
            <label htmlFor="form-text-name" className={SECTION_LABEL}>
              Name
            </label>
            <Input
              id="form-text-name"
              ref={nameRef}
              value={name}
              // Disallowed characters (spaces, symbols) are stripped as they're
              // typed rather than rejected after the fact — a space silently
              // failing validation with no visible cause is a worse experience
              // than the character simply not appearing.
              onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={suggestedName}
              className={cn(
                'h-10 rounded-[10px] font-mono',
                !nameValid && 'border-danger focus:border-danger focus:ring-danger/20',
              )}
            />
            {nameValid ? (
              <p className={HINT}>
                Name of the form field — the body reads it back as{' '}
                <code className="font-mono text-primary/80">{`{${name}}`}</code>.
              </p>
            ) : (
              <p className="mt-1.5 text-[11px] text-danger">
                A text field needs a name, or it expands to nothing. Letters, numbers and
                underscore, starting with a letter — e.g. {suggestedName}.
              </p>
            )}
          </div>

          {/* ── Default ── */}
          <div>
            <label htmlFor="form-text-default" className={SECTION_LABEL}>
              Default <span className="font-normal text-ink-subtle">(optional)</span>
            </label>
            <Input
              id="form-text-default"
              value={defaultValue}
              onChange={(e) => setDefaultValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="empty"
              className="h-10 rounded-[10px]"
            />
            <p className={HINT}>
              The value the field starts with. Left blank, it opens empty.
            </p>
          </div>

          {/* ── What lands in the body ── */}
          {/* Only while the name holds. The writer repairs an unusable name so
              it can never emit a broken token, but previewing that repair would
              show a field the author never asked for — and Insert is disabled
              anyway, so there is nothing to preview. */}
          {nameValid && (
            <div className="rounded-[10px] border border-line bg-bg-alt px-3 py-2.5">
              <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-widest mb-1">
                Inserts
              </p>
              <code className="block font-mono text-[11px] leading-relaxed text-ink-muted break-all">
                {token}
              </code>
            </div>
          )}
        </div>

        <div className="px-6 py-4 mt-2 border-t border-line flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={handleSubmit} disabled={!nameValid}>
            Insert
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
