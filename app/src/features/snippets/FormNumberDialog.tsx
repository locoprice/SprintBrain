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
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import {
  buildFormNumberToken,
  isValidFieldName,
  isValidNumberDefault,
  type NumberFormat,
} from '@/lib/formNumberToken';

const HINT = 'text-[11px] text-ink-subtle mt-1.5';
const SECTION_LABEL = 'block text-xs font-medium text-ink-muted mb-1.5';

const FORMAT_OPTIONS: readonly { value: NumberFormat; label: string }[] = [
  { value: 'plain', label: 'Plain' },
  { value: 'currency', label: 'Currency' },
  { value: 'percent', label: 'Percent' },
];

// What each format does to the value on its way out. Kept as prose next to the
// control rather than as an example number, because the currency symbol is a
// workspace setting and hard-coding one here would show every account the same
// wrong currency.
const FORMAT_HINT: Record<NumberFormat, string> = {
  plain: 'The number exactly as typed. No symbol, no grouping.',
  currency: 'Prints with the workspace currency and two decimal places.',
  percent: 'Prints with a trailing %. Typing 15 means 15 percent, so a formula reads 15.',
};

interface FormNumberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefilled field name — the next free NUM_n for the body being edited. */
  suggestedName: string;
  onInsert: (token: string) => void;
}

/**
 * Builds a number field for the snippet body: a quantity someone types in when
 * the snippet expands, which formulas can then do arithmetic on.
 *
 * Mirrors `FormTextDialog` deliberately — same layout, same name-first rule,
 * same live token preview — because Number is a peer of Text in the rail and a
 * different-shaped dialog would make it read as a variant of one.
 *
 * The token grammar is written by `@/lib/formNumberToken` and parsed back by
 * the formula engine, so what this previews is exactly what expands. That the
 * two share a `{formtext:}` spelling underneath is an engine constraint, not
 * something this dialog exposes.
 */
export function FormNumberDialog({
  open,
  onOpenChange,
  suggestedName,
  onInsert,
}: FormNumberDialogProps) {
  const [name, setName] = useState('');
  const [format, setFormat] = useState<NumberFormat>('plain');
  const [defaultValue, setDefaultValue] = useState('');

  const nameRef = useRef<HTMLInputElement | null>(null);

  // Every opening starts from a clean field — a half-built one carried over
  // from a cancelled insert would silently ship into the next snippet.
  useEffect(() => {
    if (!open) return;
    setName(suggestedName);
    setFormat('plain');
    setDefaultValue('');
  }, [open, suggestedName]);

  const nameValid = isValidFieldName(name);
  const defaultValid = isValidNumberDefault(defaultValue);
  const canInsert = nameValid && defaultValid;

  const token = useMemo(
    () => buildFormNumberToken({ name, format, default: defaultValue.trim() }),
    [name, format, defaultValue],
  );

  function handleSubmit() {
    if (!canInsert) return;
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
          <DialogTitle>Insert number field</DialogTitle>
          <DialogDescription>
            A quantity typed in when the snippet expands. Formulas can add it up.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-2 flex flex-col gap-4">
          {/* ── Field name ── */}
          <div>
            <label htmlFor="form-number-name" className={SECTION_LABEL}>
              Name
            </label>
            <Input
              id="form-number-name"
              ref={nameRef}
              value={name}
              // Disallowed characters are stripped as they're typed rather than
              // rejected after the fact — a space silently failing validation
              // with no visible cause is the worse experience.
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
                Name of the form field — a formula reads it back as{' '}
                <code className="font-mono text-primary/80">{`{=${name} * 2}`}</code>.
              </p>
            ) : (
              <p className="mt-1.5 text-[11px] text-danger">
                A number field needs a name, or it expands to nothing. Letters, numbers and
                underscore, starting with a letter — e.g. {suggestedName}.
              </p>
            )}
          </div>

          {/* ── Format ── */}
          <div>
            <span className={SECTION_LABEL}>Format</span>
            <Segmented
              options={FORMAT_OPTIONS}
              value={format}
              onChange={setFormat}
              ariaLabel="Number format"
              className="w-full [&>button]:flex-1"
            />
            <p className={HINT}>{FORMAT_HINT[format]}</p>
          </div>

          {/* ── Default ── */}
          <div>
            <label htmlFor="form-number-default" className={SECTION_LABEL}>
              Default <span className="font-normal text-ink-subtle">(optional)</span>
            </label>
            <Input
              id="form-number-default"
              value={defaultValue}
              onChange={(e) => setDefaultValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="empty"
              inputMode="decimal"
              className={cn(
                'h-10 rounded-[10px] font-mono',
                !defaultValid && 'border-danger focus:border-danger focus:ring-danger/20',
              )}
            />
            {defaultValid ? (
              <p className={HINT}>
                The value the field starts with. Left blank, it opens empty — which is not
                the same as starting at 0.
              </p>
            ) : (
              <p className="mt-1.5 text-[11px] text-danger">
                A default has to be a number. Write the digits on their own — the format
                adds the symbol.
              </p>
            )}
          </div>

          {/* ── What lands in the body ── */}
          {/* Only while both halves hold. The writer repairs an unusable name so
              it can never emit a broken token, but previewing that repair would
              show a field the author never asked for — and Insert is disabled
              anyway, so there is nothing to preview. */}
          {canInsert && (
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
          <Button type="button" variant="primary" onClick={handleSubmit} disabled={!canInsert}>
            Insert
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
