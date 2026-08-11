import { useState } from 'react';
import { Loader2, Plus, Sparkles, X } from 'lucide-react';
import { labelSuggestApi, type SnippetDraft } from '@/lib/api/labelSuggestApi';
import { suggestionKey, type LabelSuggestion } from '@/lib/labelSuggest';
import { DEFAULT_LABEL_COLOR, labelSwatch } from '@/lib/labelColors';
import { useLabelStore } from '@/stores/labelStore';
import { cn } from '@/lib/utils';

/**
 * Ask AI which labels fit the snippet being written (LABELS-AI-001).
 *
 * Suggestions arrive as pending chips, not as assignments: clicking one adds
 * it, the × dismisses it, and ignoring them costs nothing. Nothing is written
 * until the snippet itself is saved — the one exception is a *proposed* label,
 * which has to exist as a row before it can be assigned, so accepting one
 * creates it. That only happens on an explicit click.
 *
 * Button-triggered rather than automatic: each run is a real API call, and a
 * debounce on every keystroke would spend the user's money while they type.
 */
interface LabelSuggestionsProps {
  /** The snippet as it currently stands in the editor. */
  draft: SnippetDraft;
  /** Label ids already on the draft. */
  value: string[];
  onChange: (labelIds: string[]) => void;
  disabled?: boolean;
}

/**
 * Master switch, off until a provider is chosen.
 *
 * While false the control is never mounted, and this is the only caller of
 * labelSuggestApi — so no request can be made, no snippet content leaves the
 * browser, and no usage is billed. Turning the feature on is this flag plus a
 * deployed `suggest-labels` function; nothing else here is provider-specific.
 *
 * Typed `boolean` rather than left to infer `false`, so the mount site reads as
 * a live condition instead of dead code.
 */
export const LABEL_SUGGESTIONS_ENABLED: boolean = false;

/** Below this there is nothing for the model to judge. Mirrors the edge fn. */
const MIN_CONTENT_CHARS = 12;

export function LabelSuggestions({
  draft,
  value,
  onChange,
  disabled = false,
}: LabelSuggestionsProps) {
  const labels = useLabelStore((s) => s.labels);
  const addLabel = useLabelStore((s) => s.addLabel);

  const [suggestions, setSuggestions] = useState<LabelSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Whether the last run came back empty — which is a real answer worth
  // showing. Distinct from `suggestions` being empty because the user has since
  // accepted or dismissed them all; saying "nothing to suggest" there would
  // describe their own clicks back to them.
  const [cameBackEmpty, setCameBackEmpty] = useState(false);

  const thin = draft.name.trim().length + draft.body.trim().length < MIN_CONTENT_CHARS;

  async function handleSuggest() {
    setLoading(true);
    setError(null);
    try {
      const next = await labelSuggestApi.suggestForSnippet(draft, labels, value);
      setSuggestions(next);
      setCameBackEmpty(next.length === 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suggestion failed');
      setSuggestions([]);
      setCameBackEmpty(false);
    } finally {
      setLoading(false);
    }
  }

  function dismiss(key: string) {
    setSuggestions((prev) => prev.filter((s) => suggestionKey(s) !== key));
  }

  async function accept(suggestion: LabelSuggestion) {
    const key = suggestionKey(suggestion);
    if (suggestion.kind === 'existing') {
      if (!value.includes(suggestion.label.id)) onChange([...value, suggestion.label.id]);
      dismiss(key);
      return;
    }

    // Proposed: the label has to exist before it can be assigned.
    setAccepting(key);
    setError(null);
    try {
      const created = await addLabel(suggestion.name, DEFAULT_LABEL_COLOR);
      onChange([...value, created.id]);
      dismiss(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that label');
    } finally {
      setAccepting(null);
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        disabled={disabled || loading || thin}
        onClick={() => void handleSuggest()}
        title={
          thin
            ? 'Add a name and some content first — there is nothing to read yet'
            : 'Suggest labels based on what this snippet says'
        }
        className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-line bg-card px-3 text-xs font-medium text-ink-muted transition-colors hover:border-primary/30 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        {loading ? 'Reading the snippet…' : 'Suggest labels'}
      </button>

      {error && <p className="mt-1.5 text-[11px] text-danger">{error}</p>}

      {cameBackEmpty && !loading && !error && (
        <p className="mt-1.5 text-[11px] text-ink-subtle">
          Nothing to suggest — the labels on this snippet already cover it.
        </p>
      )}

      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {suggestions.map((suggestion) => {
            const key = suggestionKey(suggestion);
            const busy = accepting === key;
            const isNew = suggestion.kind === 'proposed';
            const name = isNew ? suggestion.name : suggestion.label.name;
            const swatch = isNew ? null : labelSwatch(suggestion.label.color);

            return (
              <span
                key={key}
                title={suggestion.reason || undefined}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-4',
                  isNew
                    ? 'border-dashed border-line bg-bg-alt text-ink-muted'
                    : cn('border-dashed', swatch?.chip),
                )}
              >
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void accept(suggestion)}
                  title={isNew ? `Create "${name}" and add it` : `Add ${name}`}
                  className="inline-flex max-w-[160px] items-center gap-1 disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin" />
                  ) : (
                    <Plus className="h-2.5 w-2.5 shrink-0" />
                  )}
                  <span className="truncate">{name}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Dismiss ${name}`}
                  onClick={() => dismiss(key)}
                  className="shrink-0 rounded-full opacity-60 transition-opacity hover:opacity-100"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
