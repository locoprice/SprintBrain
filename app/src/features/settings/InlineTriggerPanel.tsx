import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Lock, Zap } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  ACTIVATION_KEYS,
  DEFAULT_TRIGGER_CONFIG,
  triggerWouldCollide,
  validateTriggerSeq,
} from '@/lib/triggerUtils';
import { useSettingsStore } from '@/stores/settingsStore';
import type { ActivationKey } from '@/types/database';

// ── Types & constants ─────────────────────────────────────────────────────────

type Prefix = '/' | '::' | ';';
const PREFIXES: Prefix[] = ['/', '::', ';'];

// ── Field-level save status ───────────────────────────────────────────────────

type FieldStatus = 'idle' | 'saving' | 'saved' | 'error';

interface SeqFieldState {
  value: string;
  status: FieldStatus;
  error: string | null;
}

function makeSeq(value: string): SeqFieldState {
  return { value, status: 'idle', error: null };
}

// ── InlineTriggerPanel ────────────────────────────────────────────────────────

/**
 * Renders the "Inline Trigger Sequences" settings card.
 *
 * Validation logic is sourced from lib/triggerUtils (shared module, ported from
 * the extension popup). Each field auto-saves on blur (text inputs) or on change
 * (select dropdowns) — no separate "Save changes" button, matching the popup UX.
 *
 * Persisted in auth.users.user_metadata via settingsApi.updateProfile.
 * No new Supabase tables or migrations required.
 */
export function InlineTriggerPanel() {
  const profile = useSettingsStore((s) => s.profile);
  const editProfile = useSettingsStore((s) => s.editProfile);

  // Local field state — hydrated from profile, held locally during editing.
  const [prefix, setPrefix] = useState<Prefix>(
    profile?.shortcut_prefix ?? '::',
  );
  const [prefixStatus, setPrefixStatus] = useState<FieldStatus>('idle');
  const [snippetSeq, setSnippetSeq] = useState<SeqFieldState>(
    makeSeq(profile?.trigger_snippet_seq ?? DEFAULT_TRIGGER_CONFIG.snippetTrigger),
  );
  const [promptSeq, setPromptSeq] = useState<SeqFieldState>(
    makeSeq(profile?.trigger_prompt_seq ?? DEFAULT_TRIGGER_CONFIG.promptTrigger),
  );
  const [snippetKey, setSnippetKey] = useState<ActivationKey>(
    profile?.trigger_snippet_key ?? DEFAULT_TRIGGER_CONFIG.snippetActivationKey,
  );
  const [promptKey, setPromptKey] = useState<ActivationKey>(
    profile?.trigger_prompt_key ?? DEFAULT_TRIGGER_CONFIG.promptActivationKey,
  );

  // Timers for auto-resetting "Saved" status after 2 s.
  // Use `number | null` explicitly — browser setTimeout returns number, and
  // @types/node is in scope in this project which would otherwise infer Timeout.
  const prefixTimer  = useRef<number | null>(null);
  const snippetTimer = useRef<number | null>(null);
  const promptTimer  = useRef<number | null>(null);

  // Re-hydrate whenever the profile changes (e.g. on initial load or external update).
  useEffect(() => {
    if (!profile) return;
    setPrefix(profile.shortcut_prefix);
    setSnippetSeq(makeSeq(profile.trigger_snippet_seq));
    setPromptSeq(makeSeq(profile.trigger_prompt_seq));
    setSnippetKey(profile.trigger_snippet_key);
    setPromptKey(profile.trigger_prompt_key);
  }, [profile]);

  // Clear pending timers on unmount.
  // Capture the ref containers (stable objects) inside the effect so the
  // cleanup reads .current at teardown time — the react-hooks/exhaustive-deps
  // rule flags direct `ref.current` access inside cleanup closures.
  useEffect(() => {
    const prfxRef = prefixTimer;
    const snipRef = snippetTimer;
    const prmtRef = promptTimer;
    return () => {
      if (prfxRef.current !== null) window.clearTimeout(prfxRef.current);
      if (snipRef.current !== null) window.clearTimeout(snipRef.current);
      if (prmtRef.current !== null) window.clearTimeout(prmtRef.current);
    };
  }, []);

  // ── Helpers ──────────────────────────────────────────────────────────────

  function scheduleReset(
    setter: React.Dispatch<React.SetStateAction<SeqFieldState>>,
    timerRef: React.MutableRefObject<number | null>,
  ) {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setter((s) => ({ ...s, status: 'idle' }));
      timerRef.current = null;
    }, 2000);
  }

  // ── Save handlers (auto-save on blur / change) ────────────────────────────

  async function handlePrefixChange(p: Prefix) {
    setPrefix(p);
    if (p === profile?.shortcut_prefix) return;
    setPrefixStatus('saving');
    try {
      await editProfile({ shortcut_prefix: p });
      setPrefixStatus('saved');
      if (prefixTimer.current !== null) window.clearTimeout(prefixTimer.current);
      prefixTimer.current = window.setTimeout(() => {
        setPrefixStatus('idle');
        prefixTimer.current = null;
      }, 2000);
    } catch {
      setPrefixStatus('error');
    }
  }

  async function saveSnippetSeq(raw: string) {
    const value = raw.trim();

    if (!validateTriggerSeq(value)) {
      setSnippetSeq((s) => ({
        ...s,
        status: 'error',
        error: 'Must be 1–5 non-whitespace, non-alphanumeric characters',
      }));
      return;
    }
    if (triggerWouldCollide(value, promptSeq.value.trim())) {
      setSnippetSeq((s) => ({
        ...s,
        status: 'error',
        error: 'Conflicts with the prompt trigger',
      }));
      return;
    }
    // No-op if unchanged.
    if (value === profile?.trigger_snippet_seq) return;

    setSnippetSeq((s) => ({ ...s, status: 'saving', error: null }));
    try {
      await editProfile({ trigger_snippet_seq: value });
      setSnippetSeq((s) => ({ ...s, value, status: 'saved', error: null }));
      scheduleReset(setSnippetSeq, snippetTimer);
    } catch (err) {
      setSnippetSeq((s) => ({
        ...s,
        status: 'error',
        error: err instanceof Error ? err.message : 'Save failed',
      }));
    }
  }

  async function savePromptSeq(raw: string) {
    const value = raw.trim();

    if (!validateTriggerSeq(value)) {
      setPromptSeq((s) => ({
        ...s,
        status: 'error',
        error: 'Must be 1–5 non-whitespace, non-alphanumeric characters',
      }));
      return;
    }
    if (triggerWouldCollide(snippetSeq.value.trim(), value)) {
      setPromptSeq((s) => ({
        ...s,
        status: 'error',
        error: 'Conflicts with the snippet trigger',
      }));
      return;
    }
    if (value === profile?.trigger_prompt_seq) return;

    setPromptSeq((s) => ({ ...s, status: 'saving', error: null }));
    try {
      await editProfile({ trigger_prompt_seq: value });
      setPromptSeq((s) => ({ ...s, value, status: 'saved', error: null }));
      scheduleReset(setPromptSeq, promptTimer);
    } catch (err) {
      setPromptSeq((s) => ({
        ...s,
        status: 'error',
        error: err instanceof Error ? err.message : 'Save failed',
      }));
    }
  }

  async function handleSnippetKeyChange(key: ActivationKey) {
    setSnippetKey(key);
    if (key === profile?.trigger_snippet_key) return;
    try {
      await editProfile({ trigger_snippet_key: key });
    } catch {
      // On error: local state already updated; next profile re-hydration will
      // restore the persisted value. Silent — activation key is non-critical.
    }
  }

  async function handlePromptKeyChange(key: ActivationKey) {
    setPromptKey(key);
    if (key === profile?.trigger_prompt_key) return;
    try {
      await editProfile({ trigger_prompt_key: key });
    } catch {
      // Same rationale as handleSnippetKeyChange.
    }
  }

  const disabled = profile === null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Triggers &amp; Prefix</CardTitle>
        <CardDescription>
          Shortcut prefix, trigger sequences, and activation keys for snippet and prompt expansion.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* ── Shortcut prefix ── */}
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-ink-muted">Shortcut prefix</label>
            <p className="mt-1 text-xs text-ink-subtle">
              The character(s) you type before a snippet name for direct expansion.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="inline-flex rounded-[10px] border border-line bg-bg-alt p-1">
              {PREFIXES.map((p) => {
                const isActive = prefix === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => handlePrefixChange(p)}
                    disabled={disabled}
                    className={cn(
                      'h-8 min-w-[3rem] rounded-[8px] font-mono text-sm font-semibold transition-colors',
                      isActive
                        ? 'bg-card text-ink shadow-sm'
                        : 'text-ink-muted hover:text-ink',
                      disabled && 'cursor-not-allowed opacity-60',
                    )}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
            <SeqStatusBadge status={prefixStatus} />
          </div>
          <p className="text-xs text-ink-subtle leading-relaxed">
            Activate snippets two ways — type the prefix directly before a shortcut name (e.g.{' '}
            <code className="font-mono font-semibold text-primary">{prefix}hello</code>) for instant
            expansion, or open the picker by typing a trigger sequence or pressing the activation
            key configured below.
          </p>
        </div>

        <hr className="border-line" />

        {/* ── Snippet trigger ── */}
        <TriggerRow
          label="Snippet"
          icon={<Zap className="h-3.5 w-3.5" />}
          value={snippetSeq.value}
          status={snippetSeq.status}
          error={snippetSeq.error}
          disabled={disabled}
          onChange={(v) =>
            setSnippetSeq((s) => ({ ...s, value: v, status: 'idle', error: null }))
          }
          onBlur={() => saveSnippetSeq(snippetSeq.value)}
        />

        {/* ── Prompt trigger ── */}
        <TriggerRow
          label="Prompt"
          icon={<Lock className="h-3.5 w-3.5" />}
          value={promptSeq.value}
          status={promptSeq.status}
          error={promptSeq.error}
          disabled={disabled}
          onChange={(v) =>
            setPromptSeq((s) => ({ ...s, value: v, status: 'idle', error: null }))
          }
          onBlur={() => savePromptSeq(promptSeq.value)}
        />

        {/* ── Activation key selects ── */}
        <div className="grid grid-cols-2 gap-4 pt-1">
          <KeySelect
            label="Snippet key"
            value={snippetKey}
            disabled={disabled}
            onChange={handleSnippetKeyChange}
          />
          <KeySelect
            label="Prompt key"
            value={promptKey}
            disabled={disabled}
            onChange={handlePromptKeyChange}
          />
        </div>

        {/* ── Hint text (mirrors popup hint) ── */}
        <p className="text-xs text-ink-subtle leading-relaxed">
          Type{' '}
          <code className="font-mono font-semibold text-primary">
            {snippetSeq.value || DEFAULT_TRIGGER_CONFIG.snippetTrigger}
          </code>{' '}
          in any text field to pick a snippet.
          <br />
          Type{' '}
          <code className="font-mono font-semibold text-primary">
            {promptSeq.value || DEFAULT_TRIGGER_CONFIG.promptTrigger}
          </code>{' '}
          to pick a prompt template.
        </p>
      </CardContent>
    </Card>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface TriggerRowProps {
  label: string;
  icon: React.ReactNode;
  value: string;
  status: FieldStatus;
  error: string | null;
  disabled: boolean;
  onChange: (v: string) => void;
  onBlur: () => void;
}

function TriggerRow({
  label,
  icon,
  value,
  status,
  error,
  disabled,
  onChange,
  onBlur,
}: TriggerRowProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-3">
        {/* Label with icon */}
        <div className="flex w-20 shrink-0 items-center gap-1.5">
          <span className="text-ink-subtle">{icon}</span>
          <span className="text-xs font-semibold text-ink">{label}</span>
        </div>

        {/* Editable trigger sequence input */}
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          disabled={disabled}
          maxLength={5}
          spellCheck={false}
          autoComplete="off"
          aria-label={`${label} trigger sequence`}
          className={cn(
            'w-[72px] rounded-[8px] border bg-bg-alt px-2 py-1.5 text-center font-mono text-sm font-semibold text-primary transition-colors focus:outline-none',
            status === 'error'
              ? 'border-danger text-danger focus:border-danger focus:ring-2 focus:ring-danger/20'
              : 'border-line focus:border-primary focus:ring-2 focus:ring-primary/20',
            disabled && 'cursor-not-allowed opacity-60',
          )}
        />

        {/* Inline save status */}
        <SeqStatusBadge status={status} />
      </div>

      {/* Error message */}
      {error && (
        <p className="ml-[92px] flex items-center gap-1 text-[11px] text-danger">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

function SeqStatusBadge({ status }: { status: FieldStatus }) {
  if (status === 'saving') {
    return <span className="text-[11px] text-ink-subtle">Saving…</span>;
  }
  if (status === 'saved') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-success">
        <Check className="h-3 w-3" />
        Saved
      </span>
    );
  }
  return null;
}

interface KeySelectProps {
  label: string;
  value: ActivationKey;
  disabled: boolean;
  onChange: (key: ActivationKey) => void;
}

function KeySelect({ label, value, disabled, onChange }: KeySelectProps) {
  return (
    <div className="grid gap-2">
      <label className="text-xs font-medium text-ink-muted">{label}</label>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as ActivationKey)}
        aria-label={label}
        className={cn(
          'h-9 rounded-[10px] border border-line bg-card px-3 text-sm text-ink focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        {ACTIVATION_KEYS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
    </div>
  );
}
