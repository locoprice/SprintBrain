import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Check, ChevronDown, Eye, Loader2, Sparkles, Trash2, X, Zap } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { usePromptStore } from '@/stores/promptStore';
import { classifyPrompt } from '@/lib/intentEngine';
import { assembleBlocks } from '@/lib/promptUtils';
import {
  usePromptEvaluator,
  evaluatePrompt,
  promptToEvaluatorInput,
  percentRank,
  MIN_BENCHMARK_CORPUS,
} from '@/lib/usePromptEvaluator';
import { PromptEfficiencyWidget } from '@/features/prompts/PromptEfficiencyWidget';
import type {
  PromptBlock,
  PromptBlockType,
  StrategyType,
  ThinkingMode,
  PreferredModel,
  ComplexityLevel,
  ExecutionType,
  IntentCategory,
  OutputType,
} from '@/types/database';
import type { PromptFormValues } from '@/types/schemas';
import type { ClassificationResult } from '@/lib/intentEngine';

// ── Constants ─────────────────────────────────────────────────────────────────

const BLOCK_ORDER: PromptBlockType[] = [
  'role', 'objective', 'context', 'examples', 'reasoning', 'constraints',
];

const BLOCK_LABELS: Record<PromptBlockType, string> = {
  role: 'Role',
  objective: 'Objective',
  context: 'Context',
  examples: 'Examples',
  reasoning: 'Reasoning',
  constraints: 'Constraints',
};

const BLOCK_HINTS: Record<PromptBlockType, string> = {
  role: 'Define who the AI is. e.g. "You are a senior software engineer…"',
  objective: 'State the task clearly. e.g. "Your task is to review…"',
  context: 'Provide relevant background information.',
  examples: 'Show input/output pairs to guide the model.',
  reasoning: 'Instruct the thinking approach. e.g. "Think step by step…"',
  constraints: 'What the model must not do or must stay within.',
};

const DEFAULT_BLOCKS: PromptBlock[] = [
  { type: 'role', content: '', enabled: true },
  { type: 'objective', content: '', enabled: true },
  { type: 'context', content: '', enabled: false },
  { type: 'examples', content: '', enabled: false },
  { type: 'reasoning', content: '', enabled: true },
  { type: 'constraints', content: '', enabled: false },
];

const STRATEGIES: StrategyType[] = ['CoT', 'ToT', 'Few-shot', 'One-shot', 'RAG', 'Agentic'];
const THINKING_MODES: ThinkingMode[] = ['fast', 'balanced', 'deep'];
const MODELS: { value: PreferredModel; label: string }[] = [
  { value: 'claude-opus-4-7', label: 'Opus 4' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4' },
  { value: 'claude-haiku-4-5', label: 'Haiku 4' },
];
const COMPLEXITIES: ComplexityLevel[] = ['simple', 'medium', 'complex'];
const EXECUTION_TYPES: ExecutionType[] = ['Generate', 'Analyze', 'Plan', 'Critique', 'Summarize', 'Transform'];
const INTENT_CATEGORIES: IntentCategory[] = ['Writing', 'Coding', 'Support', 'SEO', 'Analysis', 'Planning', 'Research', 'Teaching'];
const OUTPUT_TYPES: OutputType[] = ['JSON', 'Markdown', 'SOP', 'Plain'];

// Block types that map to EvalCriterion IDs for the efficiency widget.
const BLOCK_CRITERION_TYPES: PromptBlockType[] = [
  'role', 'objective', 'context', 'reasoning', 'constraints', 'examples',
];

// ── Dark select helper ─────────────────────────────────────────────────────────

interface DarkSelectProps<T extends string> {
  value: T | null;
  onChange: (v: T | null) => void;
  options: { value: T; label: string }[];
  placeholder: string;
}

function DarkSelect<T extends string>({
  value,
  onChange,
  options,
  placeholder,
}: DarkSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 0,
  });

  const selectedLabel = options.find((o) => o.value === value)?.label ?? null;

  const handleOpen = () => {
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !menuRef.current?.contains(t)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : handleOpen())}
        className="flex h-8 w-full items-center justify-between rounded-[8px] border border-[#26262B] bg-[#0E0E11] pl-3 pr-2.5 text-xs transition-colors hover:border-[#3A3A40] focus:border-[#1B4FD8]/60 focus:outline-none"
      >
        <span className={value !== null ? 'text-[#D6D6DE]' : 'text-[#5A5A62]'}>
          {selectedLabel ?? placeholder}
        </span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 text-[#83838D] transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={{ top: pos.top, left: pos.left, width: pos.width }}
            className="fixed z-[9999] overflow-hidden rounded-[10px] border border-[#2A2A30] bg-[#121215] p-1 shadow-[0_12px_40px_rgba(0,0,0,0.7),0_2px_8px_rgba(0,0,0,0.4)]"
          >
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="flex h-7 w-full items-center justify-between rounded-[6px] px-2.5 text-xs text-[#5A5A62] transition-colors hover:bg-[#1C1C20] hover:text-[#9A9AA5]"
            >
              {placeholder}
              {value === null && <Check className="h-3 w-3 shrink-0 text-[#1B4FD8]" />}
            </button>
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className="flex h-7 w-full items-center justify-between rounded-[6px] px-2.5 text-xs transition-colors hover:bg-[#1C1C20]"
              >
                <span className={value === o.value ? 'font-medium text-[#E0E0E8]' : 'text-[#B8B8C2]'}>
                  {o.label}
                </span>
                {value === o.value && <Check className="h-3 w-3 shrink-0 text-[#1B4FD8]" />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

// ── Block section ──────────────────────────────────────────────────────────────

interface BlockSectionProps {
  block: PromptBlock;
  onChange: (content: string) => void;
  onToggle: () => void;
}

function BlockSection({ block, onChange, onToggle }: BlockSectionProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [block.content]);

  return (
    <div className={`border-b border-[#161619] transition-opacity ${block.enabled ? '' : 'opacity-60'}`}>
      {/* Block header */}
      <div className="flex items-center justify-between px-5 py-2.5">
        <div className="flex items-center gap-2">
          <div
            className={`h-1.5 w-1.5 rounded-full ${block.enabled ? 'bg-[#1B4FD8]' : 'bg-[#3A3A40]'}`}
          />
          <span className="font-mono text-[11px] font-semibold uppercase tracking-widest text-[#CACAD4]">
            {BLOCK_LABELS[block.type]}
          </span>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className={`relative h-5 w-9 rounded-full transition-colors ${
            block.enabled ? 'bg-[#1B4FD8]' : 'bg-[#2A2A2E]'
          }`}
          aria-label={block.enabled ? 'Disable block' : 'Enable block'}
        >
          <span
            className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
              block.enabled ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* Textarea (only when enabled) */}
      {block.enabled && (
        <div className="px-5 pb-4">
          <textarea
            ref={textareaRef}
            value={block.content}
            onChange={(e) => onChange(e.target.value)}
            placeholder={BLOCK_HINTS[block.type]}
            rows={3}
            className="w-full resize-none overflow-hidden rounded-[8px] border border-[#26262B] bg-[#0E0E11] px-3 py-2.5 font-mono text-sm leading-relaxed text-[#D6D6DE] placeholder:text-[#50505A] focus:border-[#1B4FD8]/60 focus:outline-none focus:ring-1 focus:ring-[#1B4FD8]/20"
          />
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function PromptBlockEditor() {
  const newOpen = useUiStore((s) => s.newPromptOpen);
  const editId = useUiStore((s) => s.editPromptId);
  const closeNew = useUiStore((s) => s.closeNewPrompt);
  const closeEdit = useUiStore((s) => s.closeEditPrompt);
  const openPromptPreview = useUiStore((s) => s.openPromptPreview);
  const openPromptDraftPreview = useUiStore((s) => s.openPromptDraftPreview);
  const showToast = useUiStore((s) => s.showToast);

  const prompts = usePromptStore((s) => s.prompts);
  const addPrompt = usePromptStore((s) => s.addPrompt);
  const editPrompt = usePromptStore((s) => s.editPrompt);
  const removePrompt = usePromptStore((s) => s.removePrompt);

  const editingPrompt = useMemo(
    () => (editId ? (prompts.find((p) => p.id === editId) ?? null) : null),
    [editId, prompts],
  );
  const mode: 'create' | 'edit' = editingPrompt ? 'edit' : 'create';
  const isOpen = mode === 'edit' ? editingPrompt !== null : newOpen;

  // Form state
  const [name, setName] = useState('');
  const [promptType, setPromptType] = useState<'one-shot' | 'few-shot'>('one-shot');
  const [blocks, setBlocks] = useState<PromptBlock[]>(DEFAULT_BLOCKS);
  const [tags, setTags] = useState('');
  const [strategyType, setStrategyType] = useState<StrategyType | null>(null);
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode | null>(null);
  const [preferredModel, setPreferredModel] = useState<PreferredModel | null>(null);
  const [complexityLevel, setComplexityLevel] = useState<ComplexityLevel | null>(null);
  const [executionType, setExecutionType] = useState<ExecutionType | null>(null);
  const [intentCategory, setIntentCategory] = useState<IntentCategory | null>(null);
  const [outputType, setOutputType] = useState<OutputType | null>(null);

  // Intent suggestion
  const [suggestion, setSuggestion] = useState<ClassificationResult | null>(null);
  const classifyTimer = useRef<number | null>(null);

  // UI state
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  // Sync form when prompt changes
  useEffect(() => {
    if (!isOpen) return;
    setSubmitError(null);
    setNameError(null);
    setConfirmDelete(false);
    setSuggestion(null);

    if (editingPrompt) {
      setName(editingPrompt.name);
      setPromptType(editingPrompt.type);
      setBlocks(
        editingPrompt.blocks && editingPrompt.blocks.length > 0
          ? editingPrompt.blocks
          : DEFAULT_BLOCKS.map((b) =>
              b.type === 'objective'
                ? { ...b, content: editingPrompt.content, enabled: true }
                : b,
            ),
      );
      setTags(editingPrompt.tags.join(', '));
      setStrategyType(editingPrompt.strategy_type);
      setThinkingMode(editingPrompt.thinking_mode);
      setPreferredModel(editingPrompt.preferred_model);
      setComplexityLevel(editingPrompt.complexity_level);
      setExecutionType(editingPrompt.execution_type);
      setIntentCategory(editingPrompt.intent_category);
      setOutputType(editingPrompt.output_type);
    } else {
      setName('');
      setPromptType('one-shot');
      setBlocks(DEFAULT_BLOCKS);
      setTags('');
      setStrategyType(null);
      setThinkingMode(null);
      setPreferredModel(null);
      setComplexityLevel(null);
      setExecutionType(null);
      setIntentCategory(null);
      setOutputType(null);
    }
  }, [isOpen, editingPrompt]);

  // Auto-classify when content changes
  const triggerClassify = useCallback((blocksSnapshot: PromptBlock[]) => {
    if (classifyTimer.current !== null) window.clearTimeout(classifyTimer.current);
    classifyTimer.current = window.setTimeout(async () => {
      const text = blocksSnapshot
        .filter((b) => b.enabled && b.content.trim())
        .map((b) => b.content)
        .join(' ');
      if (!text) return;
      const result = await classifyPrompt(text);
      setSuggestion(result);
    }, 800);
  }, []);

  useEffect(() => {
    triggerClassify(blocks);
  }, [blocks, triggerClassify]);

  // ESC closes the editor panel
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  function applyIntentSuggestion() {
    if (!suggestion) return;
    if (!strategyType) setStrategyType(suggestion.strategies[0] ?? null);
    if (!thinkingMode) setThinkingMode(suggestion.thinkingMode);
    if (!preferredModel) setPreferredModel(suggestion.preferredModel);
    if (!intentCategory) setIntentCategory(suggestion.intent);
    setSuggestion(null);
  }

  function close() {
    if (mode === 'edit') closeEdit();
    else closeNew();
  }

  function updateBlock(type: PromptBlockType, content: string) {
    setBlocks((prev) =>
      prev.map((b) => (b.type === type ? { ...b, content } : b)),
    );
  }

  function toggleBlock(type: PromptBlockType) {
    setBlocks((prev) =>
      prev.map((b) => (b.type === type ? { ...b, enabled: !b.enabled } : b)),
    );
  }

  function enableBlock(type: PromptBlockType) {
    setBlocks((prev) =>
      prev.map((b) => (b.type === type ? { ...b, enabled: true } : b)),
    );
  }

  // ── Prompt efficiency evaluation ─────────────────────────────────────────────

  const evalResult = usePromptEvaluator(
    { blocks, strategyType, preferredModel, outputType },
    isOpen,
  );

  // Corpus benchmark — score every other prompt once, then rank the live draft.
  const corpusScores = useMemo(() => {
    const others = prompts.filter((p) => p.id !== editingPrompt?.id);
    if (others.length < MIN_BENCHMARK_CORPUS) return null;
    return {
      scores: others.map((p) => evaluatePrompt(promptToEvaluatorInput(p)).score),
      corpusSize: others.length,
    };
  }, [prompts, editingPrompt?.id]);

  const benchmark = useMemo(() => {
    if (!corpusScores || !evalResult) return null;
    return {
      percentile: percentRank(corpusScores.scores, evalResult.score),
      corpusSize: corpusScores.corpusSize,
    };
  }, [corpusScores, evalResult]);

  function handleApplySuggestion(criterionId: string) {
    const asBlockType = BLOCK_CRITERION_TYPES.find((t) => t === criterionId);
    if (asBlockType) {
      enableBlock(asBlockType);
      return;
    }
    if (criterionId === 'output_format') { setOutputType('Plain'); return; }
    if (criterionId === 'strategy') { setStrategyType('One-shot'); return; }
    if (criterionId === 'model') { setPreferredModel('claude-sonnet-4-6'); return; }
  }

  function handlePreviewDraft() {
    const assembled = assembleBlocks(blocks);
    if (assembled) openPromptDraftPreview(assembled);
  }

  async function handleSave() {
    if (!name.trim()) {
      setNameError('Name is required');
      return;
    }
    setNameError(null);
    setSubmitError(null);
    setSaving(true);

    const assembled = assembleBlocks(blocks);
    const payload: PromptFormValues = {
      name: name.trim(),
      content: assembled,
      type: promptType,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      strategy_type: strategyType,
      thinking_mode: thinkingMode,
      preferred_model: preferredModel,
      complexity_level: complexityLevel,
      execution_type: executionType,
      intent_category: intentCategory,
      output_type: outputType,
      blocks,
    };

    try {
      if (mode === 'edit' && editingPrompt) {
        await editPrompt(editingPrompt.id, payload);
        showToast('Changes saved');
        closeEdit();
      } else {
        await addPrompt(payload);
        showToast('Prompt created');
        closeNew();
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editingPrompt) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    try {
      await removePrompt(editingPrompt.id);
      closeEdit();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Delete failed');
      setConfirmDelete(false);
    } finally {
      setSaving(false);
    }
  }

  function handleUsePrompt() {
    if (editingPrompt) {
      openPromptPreview(editingPrompt.id);
    }
  }

  return (
    <div
      className={`fixed bottom-0 right-0 top-[60px] z-40 flex w-[520px] flex-col overflow-hidden border-l border-[#161619] bg-[#000000] shadow-[-24px_0_70px_rgba(0,0,0,0.6)] transition-transform duration-200 ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {/* ── Top bar ── */}
      <div className="flex shrink-0 items-center justify-between border-b border-[#161619] px-5 py-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(null);
            }}
            placeholder="Prompt name…"
            className="w-full bg-transparent text-sm font-semibold text-[#F5F5FA] placeholder:text-[#50505A] focus:outline-none"
          />
          {nameError && (
            <span className="text-[11px] text-[#FF5F57]">{nameError}</span>
          )}
        </div>
        <button
          type="button"
          onClick={close}
          className="ml-3 shrink-0 rounded-[8px] p-1.5 text-[#83838D] transition-colors hover:bg-[#161619] hover:text-[#E0E0E8]"
          aria-label="Close editor"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* ── Intent suggestion banner ── */}
      {suggestion && (
        <div className="flex shrink-0 items-center gap-3 border-b border-[#161619] bg-[#0A1020] px-5 py-2.5">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#1B4FD8]" />
          <p className="flex-1 text-xs text-[#6080C8]">
            Detected <span className="font-semibold text-[#7090E0]">{suggestion.intent}</span>
            {' — '}
            <span className="font-semibold text-[#7090E0]">{suggestion.strategies[0]}</span> recommended
            <span className="ml-1 text-[#83838D]">
              ({Math.round(suggestion.confidence * 100)}% confidence)
            </span>
          </p>
          <button
            type="button"
            onClick={applyIntentSuggestion}
            className="shrink-0 rounded-[6px] border border-[#1B4FD8]/30 px-2.5 py-1 text-[11px] font-medium text-[#1B4FD8] transition-colors hover:bg-[#1B4FD8]/10"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={() => setSuggestion(null)}
            className="shrink-0 text-[#83838D] hover:text-[#CACAD4]"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto">
        {/* Blocks */}
        <div>
          <div className="px-5 py-3">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-[#83838D]">
              Blocks
            </p>
          </div>
          {BLOCK_ORDER.map((type) => {
            const block = blocks.find((b) => b.type === type) ?? {
              type,
              content: '',
              enabled: false,
            };
            return (
              <BlockSection
                key={type}
                block={block}
                onChange={(content) => updateBlock(type, content)}
                onToggle={() => toggleBlock(type)}
              />
            );
          })}
        </div>

        {/* Efficiency score widget */}
        {evalResult && (
          <PromptEfficiencyWidget
            result={evalResult}
            onApply={handleApplySuggestion}
            benchmark={benchmark}
          />
        )}

        {/* Metadata */}
        <div className="border-b border-[#161619] px-5 py-4">
          <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-widest text-[#83838D]">
            Metadata
          </p>
          <div className="grid grid-cols-2 gap-3">
            {/* Type toggle */}
            <div className="col-span-2">
              <label className="mb-1.5 block text-[10px] text-[#83838D]">Type</label>
              <div className="grid grid-cols-2 overflow-hidden rounded-[8px] border border-[#26262B]">
                {(['one-shot', 'few-shot'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setPromptType(t)}
                    className={`py-1.5 text-xs font-medium transition-colors ${
                      promptType === t
                        ? 'bg-[#1B4FD8] text-white'
                        : 'bg-[#0E0E11] text-[#CACAD4] hover:text-[#A0A0A8]'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-[#83838D]">Strategy</label>
              <DarkSelect
                value={strategyType}
                onChange={setStrategyType}
                options={STRATEGIES.map((s) => ({ value: s, label: s }))}
                placeholder="None"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-[#83838D]">Model</label>
              <DarkSelect
                value={preferredModel}
                onChange={setPreferredModel}
                options={MODELS}
                placeholder="None"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-[#83838D]">Intent</label>
              <DarkSelect
                value={intentCategory}
                onChange={setIntentCategory}
                options={INTENT_CATEGORIES.map((i) => ({ value: i, label: i }))}
                placeholder="None"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-[#83838D]">Complexity</label>
              <DarkSelect
                value={complexityLevel}
                onChange={setComplexityLevel}
                options={COMPLEXITIES.map((c) => ({ value: c, label: c }))}
                placeholder="None"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-[#83838D]">Output type</label>
              <DarkSelect
                value={outputType}
                onChange={setOutputType}
                options={OUTPUT_TYPES.map((o) => ({ value: o, label: o }))}
                placeholder="None"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-[#83838D]">Thinking mode</label>
              <DarkSelect
                value={thinkingMode}
                onChange={setThinkingMode}
                options={THINKING_MODES.map((t) => ({ value: t, label: t }))}
                placeholder="None"
              />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-[10px] text-[#83838D]">Execution type</label>
              <DarkSelect
                value={executionType}
                onChange={setExecutionType}
                options={EXECUTION_TYPES.map((e) => ({ value: e, label: e }))}
                placeholder="None"
              />
            </div>
          </div>
        </div>

        {/* Tags */}
        <div className="px-5 py-4">
          <label className="mb-1.5 block text-[10px] text-[#83838D]">
            Tags (comma-separated)
          </label>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="sales, onboarding, email"
            className="h-8 w-full rounded-[8px] border border-[#26262B] bg-[#0E0E11] px-3 text-xs text-[#D6D6DE] placeholder:text-[#50505A] focus:border-[#1B4FD8]/60 focus:outline-none"
          />
        </div>
      </div>

      {/* ── Footer actions ── */}
      <div className="flex shrink-0 flex-col gap-2 border-t border-[#161619] bg-[#0E0E11] px-5 py-4">
        {submitError && (
          <div className="flex items-center gap-2 rounded-[8px] border border-[#FF5F57]/30 bg-[#FF5F57]/5 px-3 py-2 text-xs text-[#FF5F57]">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {submitError}
          </div>
        )}
        <div className="flex items-center gap-2">
          {mode === 'edit' && editingPrompt && (
            <button
              type="button"
              onClick={handleUsePrompt}
              className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-[#1B4FD8]/30 px-3 text-sm font-medium text-[#1B4FD8] transition-colors hover:bg-[#1B4FD8]/10"
            >
              <Zap className="h-3.5 w-3.5" />
              Use
            </button>
          )}
          {mode === 'create' && (
            <button
              type="button"
              onClick={handlePreviewDraft}
              className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-[#26262B] px-3 text-sm font-medium text-[#8A8A95] transition-colors hover:border-[#3A3A40] hover:text-[#C0C0C8]"
            >
              <Eye className="h-3.5 w-3.5" />
              Preview
            </button>
          )}
          <div className="flex-1" />
          {mode === 'edit' && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-[#FF5F57]/20 px-3 text-sm font-medium text-[#FF5F57] transition-colors hover:bg-[#FF5F57]/10 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {confirmDelete ? 'Confirm?' : 'Delete'}
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex h-9 items-center gap-2 rounded-[10px] bg-[#1B4FD8] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1440B0] disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create prompt'}
          </button>
        </div>
      </div>
    </div>
  );
}
