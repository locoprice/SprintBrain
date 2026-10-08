import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { fillFormApi, loadFillFormEngine } from '@/lib/fillFormEngine';
import { insideCondition } from '@/lib/formulaToken';
import {
  buildRuleToken,
  defaultOperator,
  getRuleOperator,
  isValidRule,
  operatorsFor,
  relocateRule,
  ruleFieldKind,
  rulesInBody,
  ruleTextError,
  ruleValueError,
  summarizeEntry,
  summarizeRule,
  summaryText,
  type ConditionRule,
  type RuleAction,
  type RuleFieldKind,
  type RuleInBody,
  type RuleOperator,
  type RuleSummaryPart,
} from '@/lib/conditionRule';
import { cn } from '@/lib/utils';
import {
  BodyListSection,
  ERROR,
  FormulaDialogFrame,
  HINT,
  InsertsBox,
  SECTION_LABEL,
  SELECT,
  type BodyListItem,
} from '@/features/snippets/formulaDialogParts';

/** A field a rule can check, as the shared fill-form decider reads the body. */
interface RuleField {
  key: string;
  label: string;
  kind: RuleFieldKind;
  options: string[];
  multiple: boolean;
}

/** What the window holds while a rule is built. `operator` null means the field's own default. */
interface RuleDraft {
  field: string;
  operator: RuleOperator | null;
  value: string;
  action: RuleAction;
  content: string;
  otherwise: string;
}

const EMPTY_DRAFT: RuleDraft = {
  field: '',
  operator: null,
  value: '',
  action: 'show',
  content: '',
  otherwise: '',
};

function draftOf(rule: ConditionRule | null): RuleDraft {
  return rule ? { ...rule } : EMPTY_DRAFT;
}

const ACTION_OPTIONS: readonly { value: RuleAction; label: string }[] = [
  { value: 'show', label: 'Show' },
  { value: 'hide', label: 'Hide' },
];

const RULE_NOUN = { one: 'rule', many: 'rules' };

const TEXTAREA =
  'w-full resize-y rounded-[10px] border border-line bg-card px-3 py-2 font-mono text-sm leading-relaxed text-ink placeholder:text-ink-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';
const INVALID = 'border-danger focus:border-danger focus:ring-danger/20';

const PART_CLASS: Record<RuleSummaryPart['kind'], string> = {
  keyword: 'rounded-[4px] bg-primary px-1 py-px text-[10px] font-semibold tracking-wider text-white',
  field: 'break-all rounded-[4px] bg-bg-alt px-1 font-mono text-[11px] text-ink',
  value: 'break-all font-mono text-[11px] font-semibold text-primary',
  text: 'text-ink-muted',
};

/**
 * A rule in plain words, `IF PLAN equals "annual" THEN show "…" ELSE hide it`,
 * with the three keywords as tags so the flow reads at a glance. Used by the
 * window and by the editor's sidebar, so a rule reads the same in both.
 */
export function RuleSummary({
  parts,
  className,
}: {
  parts: readonly RuleSummaryPart[];
  className?: string;
}) {
  return (
    <p className={cn('flex flex-wrap items-baseline gap-x-1 gap-y-0.5 text-xs leading-relaxed', className)}>
      {/* Read as one sentence; the tags are drawn for the eye only. */}
      <span className="sr-only">{summaryText(parts)}</span>
      {parts.map((part, i) => (
        <span key={i} aria-hidden className={PART_CLASS[part.kind]}>
          {part.text}
        </span>
      ))}
    </p>
  );
}

/** One of the three steps of a rule, boxed under its keyword. */
function RuleStep({
  keyword,
  caption,
  children,
}: {
  keyword: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={keyword} className="rounded-[10px] border border-line bg-card p-3">
      <div className="mb-2.5 flex items-center gap-2">
        <span className={PART_CLASS.keyword}>{keyword}</span>
        <span className="text-[11px] text-ink-subtle">{caption}</span>
      </div>
      {children}
    </section>
  );
}

interface FormConditionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The body being edited: its fields fill the picker, its rules fill the list. */
  body: string;
  /** Where a new rule goes. Inside another condition it cannot go at all. */
  caret: number;
  /** The rule the cursor sat in when the window opened, edited in place. */
  initial: RuleInBody | null;
  onInsert: (token: string) => void;
  /** Swaps a range of the body: a saved edit, a removal, an undo. */
  onReplace: (start: number, end: number, text: string) => void;
}

/**
 * Builds a show or hide rule: IF a field's answer meets a check, THEN a text
 * shows or hides, ELSE the opposite. Every rule already in the snippet is listed
 * above the form in plain words, each with Edit and Remove.
 *
 * The rule is an ordinary `{if:}` block (`@/lib/conditionRule`), which every
 * expansion surface already resolves.
 */
export function FormConditionDialog({
  open,
  onOpenChange,
  body,
  caret,
  initial,
  onInsert,
  onReplace,
}: FormConditionDialogProps) {
  const [engineReady, setEngineReady] = useState(() => fillFormApi() !== null);
  const [fieldsFailed, setFieldsFailed] = useState(false);
  const [fields, setFields] = useState<RuleField[]>([]);
  // The rule being changed, or null while a new one is built.
  const [editing, setEditing] = useState<RuleInBody | null>(null);
  const [draft, setDraft] = useState<RuleDraft>(EMPTY_DRAFT);

  // Every opening starts clean, or on the rule the cursor sat in: a half-built
  // rule carried over from a cancelled insert would ship into the next snippet.
  useEffect(() => {
    if (!open) return;
    setFieldsFailed(false);
    const start = initial?.rule ? initial : null;
    setEditing(start);
    setDraft(draftOf(start?.rule ?? null));
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    if (fillFormApi()) {
      setEngineReady(true);
      return;
    }
    let alive = true;
    loadFillFormEngine()
      .then(() => {
        if (alive) setEngineReady(true);
      })
      .catch(() => {
        if (alive) setFieldsFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  // The fields the body has, read by the same decider every fill surface uses,
  // so the picker offers exactly the boxes the fill form will ask for.
  useEffect(() => {
    if (!open || !engineReady) return;
    const api = fillFormApi();
    if (!api) return;
    const next: RuleField[] = [];
    for (const f of api.fillForm(body, {}, {}).fields) {
      const kind = ruleFieldKind(f.type);
      if (kind) next.push({ key: f.key, label: f.label, kind, options: f.options, multiple: f.multiple });
    }
    setFields(next);
  }, [open, engineReady, body]);

  // ── The IF ──
  const fieldSel = draft.field !== '' ? draft.field : (fields[0]?.key ?? '');
  const fieldInfo = fields.find((f) => f.key === fieldSel) ?? null;
  // A rule being edited can name a field the body no longer has.
  const fieldMissing = fieldSel !== '' && fieldInfo === null;
  const kind: RuleFieldKind = fieldInfo?.kind ?? 'text';
  const allowed = operatorsFor(kind);
  const operator =
    draft.operator && allowed.some((op) => op.id === draft.operator)
      ? draft.operator
      : defaultOperator(kind, fieldInfo?.multiple ?? false);
  const spec = getRuleOperator(operator);

  // A choice compares against one of its own options, picked rather than typed.
  // A stored value no longer among them stays listed, so opening a rule never
  // quietly changes what it checks.
  const choiceValues = useMemo(() => {
    if (kind !== 'choice' || !fieldInfo) return [];
    const opts = fieldInfo.options;
    return draft.value === '' || opts.includes(draft.value) ? opts : [draft.value, ...opts];
  }, [kind, fieldInfo, draft.value]);
  const pickValue = kind === 'choice' && choiceValues.length > 0;
  const value = pickValue
    ? (choiceValues.includes(draft.value) ? draft.value : (choiceValues[0] ?? ''))
    : draft.value;

  const rule: ConditionRule = {
    field: fieldSel,
    operator,
    value,
    action: draft.action,
    content: draft.content,
    otherwise: draft.action === 'show' ? draft.otherwise : '',
  };

  const valueError = spec.needsValue && value.trim() !== '' ? ruleValueError(operator, value, kind) : '';
  const contentError = ruleTextError(draft.content, false);
  const otherwiseError = draft.action === 'show' ? ruleTextError(draft.otherwise, false) : '';

  // A new block cannot open inside another: the engine would close the outer
  // one at the new block's {endif} and print the rest unconditionally.
  const insideOther = useMemo(
    () => editing === null && insideCondition(body.slice(0, caret)),
    [editing, body, caret],
  );

  const valid =
    engineReady && !fieldsFailed && fieldInfo !== null && !insideOther && isValidRule(rule, kind);
  const token = valid ? buildRuleToken(rule, kind) : '';

  const note = valid
    ? ''
    : fieldsFailed
      ? 'Could not read the fields in this snippet.'
      : !engineReady
        ? ''
        : fields.length === 0 && !fieldMissing
          ? 'Add a field to the snippet first.'
          : fieldMissing
            ? `${fieldSel} is no longer in this snippet. Pick another field.`
            : insideOther
              ? 'The cursor is inside another condition. Move it outside, then build the rule.'
              : spec.needsValue && value.trim() === ''
                ? 'Type the value to compare with.'
                : valueError !== ''
                  ? 'Check the value.'
                  : draft.content.trim() === ''
                    ? `Type the text to ${draft.action}.`
                    : 'Check the text marked in red.';

  // The plain-words line, readable before the rule is finished: a blank shows
  // as an ellipsis rather than hiding the sentence until the end.
  const preview = fieldSel !== ''
    ? summarizeRule({
        ...rule,
        value: rule.value.trim() === '' ? '…' : rule.value,
        content: rule.content.trim() === '' ? '…' : rule.content,
      })
    : null;

  // ── The rules already there ──
  const entries = useMemo(() => rulesInBody(body), [body]);
  const items: BodyListItem[] = entries.map((entry) => {
    const parts = summarizeEntry(entry);
    const isEditing =
      editing !== null && entry.start === editing.start && entry.raw === editing.raw;
    return {
      key: entry.start,
      removeStart: entry.start,
      removeEnd: entry.end,
      description: summaryText(parts),
      content: (
        <RuleSummary parts={parts} className={cn(isEditing && 'rounded-[4px] bg-primary-light px-1')} />
      ),
      onEdit: entry.rule ? () => startEditing(entry) : undefined,
    };
  });

  function startEditing(entry: RuleInBody) {
    setEditing(entry);
    setDraft(draftOf(entry.rule));
  }

  function startNew() {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
  }

  function update(patch: Partial<RuleDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function handleSubmit() {
    if (!valid) return;
    // Removing another rule while the window is open moves this one; find it
    // again by its text. Gone altogether, the edit goes in as a new rule.
    const target = editing ? relocateRule(body, editing) : null;
    if (target) onReplace(target.start, target.end, token);
    else onInsert(token);
    onOpenChange(false);
  }

  function submitOnEnter(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <FormulaDialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title="Show or hide"
      description="Text that prints only when an answer calls for it. Every rule in this snippet is listed here in plain words."
      body={body}
      onReplace={onReplace}
      list={
        <BodyListSection
          body={body}
          onReplace={onReplace}
          items={items}
          noun={RULE_NOUN}
          defaultExpanded
        />
      }
      note={note}
      canInsert={valid}
      onInsert={handleSubmit}
      insertLabel={editing ? 'Save rule' : 'Insert'}
    >
      {fieldsFailed ? (
        <p className={ERROR}>Could not read the fields in this snippet. Reload the page and try again.</p>
      ) : !engineReady ? (
        <p className={HINT}>Loading…</p>
      ) : fields.length === 0 && !fieldMissing ? (
        <div className="rounded-[10px] border border-line bg-bg-alt px-3 py-2.5">
          <p className="text-xs font-medium text-ink">No field to check yet</p>
          <p className={HINT}>
            A rule checks an answer, so the snippet needs a Text, Number or Choice field first.
            Add one from Fields, then come back.
          </p>
        </div>
      ) : (
        <>
          {editing && (
            <p className="flex items-center justify-between gap-2 rounded-[10px] border border-primary/25 bg-primary-light px-3 py-2 text-xs text-ink">
              Editing a rule. Save puts it back where it was.
              <button
                type="button"
                onClick={startNew}
                className="shrink-0 font-medium text-primary hover:underline"
              >
                New rule instead
              </button>
            </p>
          )}

          <div className="flex flex-col gap-2">
            <RuleStep keyword="IF" caption="The answer the rule checks.">
              <label htmlFor="rule-field" className={SECTION_LABEL}>
                Field
              </label>
              <select
                id="rule-field"
                value={fieldSel}
                onChange={(e) => update({ field: e.target.value, operator: null, value: '' })}
                className={cn(SELECT, fieldMissing && INVALID)}
              >
                {fieldMissing && <option value={fieldSel}>{fieldSel} (not in the snippet)</option>}
                {fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label !== '' && f.label !== f.key ? `${f.key} · ${f.label}` : f.key}
                  </option>
                ))}
              </select>
              <p className={HINT}>Text, Number and Choice fields. Dates and times cannot be checked.</p>

              <div className={cn('mt-3 grid gap-2', spec.needsValue ? 'grid-cols-2' : 'grid-cols-1')}>
                <div>
                  <label htmlFor="rule-check" className={SECTION_LABEL}>
                    Check
                  </label>
                  <select
                    id="rule-check"
                    value={operator}
                    onChange={(e) => update({ operator: e.target.value as RuleOperator })}
                    className={cn(SELECT, 'font-sans')}
                  >
                    {allowed.map((op) => (
                      <option key={op.id} value={op.id}>
                        {op.label}
                      </option>
                    ))}
                  </select>
                </div>
                {spec.needsValue && (
                  <div>
                    <label htmlFor="rule-value" className={SECTION_LABEL}>
                      Value
                    </label>
                    {pickValue ? (
                      <select
                        id="rule-value"
                        value={value}
                        onChange={(e) => update({ value: e.target.value })}
                        className={SELECT}
                      >
                        {choiceValues.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        id="rule-value"
                        value={value}
                        inputMode={spec.numeric || kind === 'number' ? 'decimal' : 'text'}
                        placeholder={spec.numeric || kind === 'number' ? '10' : 'Type a value'}
                        onChange={(e) => update({ value: e.target.value })}
                        onKeyDown={submitOnEnter}
                        aria-invalid={valueError !== ''}
                        className={cn('h-10 rounded-[10px] font-mono', valueError !== '' && INVALID)}
                      />
                    )}
                  </div>
                )}
              </div>
              {valueError !== '' ? (
                <p className={ERROR}>{valueError}</p>
              ) : spec.needsValue && !spec.numeric && kind !== 'number' ? (
                <p className={HINT}>Capitals do not matter: annual matches Annual.</p>
              ) : !spec.needsValue ? (
                <p className={HINT}>True once anything is typed or picked.</p>
              ) : (
                <p className={HINT}>An empty box counts as 0.</p>
              )}
            </RuleStep>

            <RuleStep keyword="THEN" caption="What happens when it is true.">
              <Segmented
                options={ACTION_OPTIONS}
                value={draft.action}
                onChange={(next) => update({ action: next })}
                ariaLabel="Show or hide the text"
                className="mb-2 w-full [&>button]:flex-1"
              />
              <label htmlFor="rule-content" className="sr-only">
                The text to {draft.action}
              </label>
              <textarea
                id="rule-content"
                rows={3}
                value={draft.content}
                onChange={(e) => update({ content: e.target.value })}
                placeholder={`The text to ${draft.action}. Fields work here too, like {NAME}.`}
                aria-invalid={contentError !== ''}
                className={cn(TEXTAREA, contentError !== '' && INVALID)}
              />
              {contentError !== '' ? (
                <p className={ERROR}>{contentError}</p>
              ) : (
                <p className={HINT}>Prints exactly as typed, spaces and line breaks included.</p>
              )}
            </RuleStep>

            <RuleStep keyword="ELSE" caption="What happens when it is not.">
              {draft.action === 'hide' ? (
                <p className="text-xs text-ink">The text shows.</p>
              ) : (
                <>
                  <label htmlFor="rule-otherwise" className={SECTION_LABEL}>
                    Print instead (optional)
                  </label>
                  <textarea
                    id="rule-otherwise"
                    rows={2}
                    value={draft.otherwise}
                    onChange={(e) => update({ otherwise: e.target.value })}
                    placeholder="Left empty, the text is hidden."
                    aria-invalid={otherwiseError !== ''}
                    className={cn(TEXTAREA, otherwiseError !== '' && INVALID)}
                  />
                  {otherwiseError !== '' && <p className={ERROR}>{otherwiseError}</p>}
                </>
              )}
            </RuleStep>
          </div>

          {preview && (
            <div className="rounded-[10px] border border-primary/25 bg-primary-light px-3 py-2.5">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-ink-muted">
                In plain words
              </p>
              <RuleSummary parts={preview} />
            </div>
          )}

          {valid && <InsertsBox token={token} />}
        </>
      )}
    </FormulaDialogFrame>
  );
}
