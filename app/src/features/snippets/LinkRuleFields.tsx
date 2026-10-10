import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { LinkMode, LinkRuleDraft } from '@/lib/linkRule';

/**
 * The "Fill from a pasted link" controls every field builder shares: Text,
 * Number, Choice in their dialogs, Date/Time in the rail. One component, so
 * the four ask the same question in the same words and write the same rule.
 *
 * The rule itself (`link=` on the token) is written by the field's own writer
 * from `linkFromDraft`, and read by the fill form on every surface. Nothing is
 * written while the box is unticked or the words are empty, so a field nobody
 * points at a page is exactly the field it always was.
 */

interface ModeText {
  label: string;
  /**
   * What the mode does to a made-up page, shown under the choice. Only the
   * Number builder offers a choice of modes, so both samples are numbers.
   */
  sample: string;
  input: string;
  placeholder: string;
  hint: string;
}

const MODE_TEXT: Record<LinkMode, ModeText> = {
  after: {
    label: 'Text after a label',
    sample: 'Total: 158 → 158',
    input: 'Label on the page',
    placeholder: 'e.g. Start date',
    hint: "As the page shows it; capitals and accents don't matter. The field takes what comes right after it. Separate other spellings with |, e.g. Start date|Starts.",
  },
  before: {
    label: 'Number before a word, added up',
    sample: '2 Boxes and 1 Box → 3',
    input: 'Word after the number',
    placeholder: 'e.g. Box|Boxes',
    hint: "As the page shows it; capitals and accents don't matter. Every number right before it is added up. Separate other spellings with |, e.g. Box|Boxes. Where the page shows none, the field keeps its default.",
  },
};

const OFF_HINT =
  'Paste a link to a web page in the fill form and this field fills itself from what the page says. You check it before inserting.';

const STYLES = {
  dialog: {
    toggle: 'text-sm',
    box: 'h-4 w-4',
    label: 'block text-xs font-medium text-ink-muted mb-1.5',
    input: 'h-10 rounded-[10px]',
    hint: 'text-[11px] text-ink-subtle mt-1.5',
    radio: 'text-sm',
    gap: 'mt-3 gap-3',
  },
  rail: {
    toggle: 'text-[11px] font-medium',
    box: 'h-3.5 w-3.5',
    label: 'block text-[11px] font-medium text-ink-muted mb-1',
    input: 'h-8 rounded-[10px] px-2 text-[11px]',
    hint: 'text-[11px] text-ink-subtle leading-tight mt-1',
    radio: 'text-[11px]',
    gap: 'mt-2 gap-2',
  },
} as const;

/** `;` `{` `}` and line breaks would end or split the token, so they never get in. */
function cleanWords(raw: string): string {
  return raw.replace(/[;{}\r\n]/g, '');
}

interface LinkRuleFieldsProps {
  /** Prefix for the controls' ids, unique on the page. */
  id: string;
  value: LinkRuleDraft;
  onChange: (next: LinkRuleDraft) => void;
  /**
   * The ways this kind of field can be read. A date or a choice is only ever
   * the text after a label; a number or a text can also be a count.
   */
  modes: readonly LinkMode[];
  /** `rail` for the 260px insert rail, `dialog` for a builder window. */
  size?: 'dialog' | 'rail';
  disabled?: boolean;
  /** Enter in the words box. The dialogs insert on Enter; the rail does not. */
  onEnter?: () => void;
  /** What the unticked box says it would do, where "this field" is not the right noun. */
  offHint?: string;
}

export function LinkRuleFields({
  id,
  value,
  onChange,
  modes,
  size = 'dialog',
  disabled = false,
  onEnter,
  offHint = OFF_HINT,
}: LinkRuleFieldsProps) {
  const s = STYLES[size];
  // A rule written by hand in a mode this builder does not offer stays on
  // screen, so editing the field keeps it rather than quietly rewriting it.
  const offered = modes.includes(value.mode) ? modes : [...modes, value.mode];
  const text = MODE_TEXT[value.mode];

  return (
    <div>
      <label
        className={cn(
          'flex items-center gap-2 text-ink',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          s.toggle,
        )}
      >
        <input
          type="checkbox"
          checked={value.enabled}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
          className={cn('shrink-0 accent-primary', s.box)}
        />
        Fill from a pasted link
      </label>
      {!value.enabled && <p className={s.hint}>{offHint}</p>}

      {value.enabled && (
        <div className={cn('flex flex-col', s.gap)}>
          {/* Only where there is a choice to make: a date or a choice field is
              always read after a label, and a lone radio reads as a question. */}
          {offered.length > 1 && (
            <div role="radiogroup" aria-label="How the page is read" className="flex flex-col gap-1.5">
              {offered.map((mode) => (
                <label
                  key={mode}
                  className={cn('flex cursor-pointer items-start gap-2 text-ink', s.radio)}
                >
                  <input
                    type="radio"
                    name={`${id}-mode`}
                    checked={value.mode === mode}
                    disabled={disabled}
                    onChange={() => onChange({ ...value, mode })}
                    className={cn('mt-0.5 shrink-0 accent-primary', s.box)}
                  />
                  <span>
                    {MODE_TEXT[mode].label}
                    <span className={cn(s.hint, 'mt-0.5 block font-mono')}>
                      {MODE_TEXT[mode].sample}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}

          <div>
            <label htmlFor={`${id}-words`} className={s.label}>
              {text.input}
            </label>
            <Input
              id={`${id}-words`}
              value={value.words}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, words: cleanWords(e.target.value) })}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                // Never the snippet form's own submit: the rail sits inside it.
                e.preventDefault();
                onEnter?.();
              }}
              placeholder={text.placeholder}
              autoComplete="off"
              spellCheck={false}
              aria-describedby={`${id}-hint`}
              className={s.input}
            />
            <p id={`${id}-hint`} className={s.hint}>
              {text.hint}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
