/**
 * Bridge to the SHARED fill-form core, so the dashboard's live preview resolves
 * a snippet through exactly the code that expands it in Gmail or WhatsApp.
 *
 * `extension/formula-engine.js` and `extension/shared/fill-form.js` are UMD and
 * already shipped as plain scripts to every other surface (the popup, the
 * in-page overlay, `Sprintbrain.html`). This module loads those same two files
 * and reads the globals they install — it does NOT re-implement or re-bundle
 * them, so the preview can never disagree with what the extension produces.
 * `scripts/check-fill-form.js` guards the shape both sides depend on.
 *
 * Serving: `nativeDashboardPlugin` in vite.config.ts copies `extension/` into
 * dist at build and serves it from the repo root in dev, so `/extension/*`
 * resolves on both.
 */

/** A field's kind, as decided by `fill-form.js` (token declaration, then name). */
export type SbFieldType = 'text' | 'date' | 'time' | 'datetime' | 'number' | 'dd';

/** One row of the fill form. Mirrors FIELD_SHAPE in scripts/check-fill-form.js. */
export interface SbFillField {
  key: string;
  type: SbFieldType;
  /** Choices, for `dd` only. */
  options: string[];
  /** Which choices are currently selected, for `dd` only. */
  picks: string[];
  multiple: boolean;
  /** Author-requested width in characters; 0 when unset. */
  cols: number;
  default: string;
  value: string;
  /** The prose immediately before/after the token, so a row reads like the body. */
  before: string;
  after: string;
  /** A choice list is block level: its context goes above and below, not beside. */
  block: boolean;
  visible: boolean;
}

/** A `{button}` control: sets field values when clicked, never prints. */
export interface SbFillButton {
  id: string;
  label: string;
  trim: string;
  code: string;
  statements: Array<{ name: string; expr: string }>;
  errors: string[];
}

/** The view model every fill surface renders. Mirrors SHAPE in the gate. */
export interface SbFillFormViewModel {
  fields: SbFillField[];
  buttons: SbFillButton[];
  preview: string;
  layout: 'flat' | 'steps';
  steps: string[][];
}

export interface SbFillFormOptions {
  /** Stored per-field overrides; wins over whatever the body declares. */
  fieldCfg?: Record<string, unknown>;
  /** Snippet language — genders ambiguous names and picks the greeting. */
  lang?: string;
  now?: Date;
}

interface SbFillFormApi {
  fillForm(
    text: string,
    values: Record<string, string>,
    opts: SbFillFormOptions,
  ): SbFillFormViewModel;
}

interface SbFormulaEngineApi {
  extractButtons(body: string): SbFillButton[];
  applyButtonCode(
    statements: Array<{ name: string; expr: string }>,
    values: Record<string, string>,
  ): { values: Record<string, number>; errors: string[] };
}

declare global {
  interface Window {
    SBFillForm?: SbFillFormApi;
    SBFormulaEngine?: SbFormulaEngineApi;
  }
}

/** Load order matters only for clarity — fill-form reads the engine lazily. */
const ENGINE_SCRIPTS = [
  '/extension/formula-engine.js',
  '/extension/shared/fill-form.js',
] as const;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-sb-engine="${src}"]`,
    );
    if (existing) {
      if (existing.dataset.sbLoaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error(`Could not load ${src}`)),
        { once: true },
      );
      return;
    }

    const el = document.createElement('script');
    el.src = src;
    el.async = false;
    el.dataset.sbEngine = src;
    el.addEventListener(
      'load',
      () => {
        el.dataset.sbLoaded = 'true';
        resolve();
      },
      { once: true },
    );
    el.addEventListener(
      'error',
      () => reject(new Error(`Could not load ${src}`)),
      { once: true },
    );
    document.head.appendChild(el);
  });
}

/** One in-flight load shared by every caller; retried only after a failure. */
let pending: Promise<SbFillFormApi> | null = null;

/**
 * Resolves once both shared scripts have installed their globals. Rejects with
 * an actionable message if they cannot be served, so the caller can say so
 * rather than rendering an empty form that looks like a broken snippet.
 */
export function loadFillFormEngine(): Promise<SbFillFormApi> {
  if (window.SBFillForm && window.SBFormulaEngine) {
    return Promise.resolve(window.SBFillForm);
  }
  if (pending) return pending;

  pending = (async () => {
    for (const src of ENGINE_SCRIPTS) {
      await loadScript(src);
    }
    const api = window.SBFillForm;
    if (!api || !window.SBFormulaEngine) {
      throw new Error('Snippet engine loaded but installed no interface');
    }
    return api;
  })().catch((error: unknown) => {
    // Clear the cache so a later open retries rather than repeating a stale
    // failure for the rest of the session.
    pending = null;
    throw error;
  });

  return pending;
}

/** The engine globals, once `loadFillFormEngine` has resolved. */
export function fillForm(
  body: string,
  values: Record<string, string>,
  opts: SbFillFormOptions = {},
): SbFillFormViewModel | null {
  const api = window.SBFillForm;
  if (!api) return null;
  return api.fillForm(body, values, opts);
}

/**
 * Applies one `{button}`'s statements to the current values. Returns the fields
 * it wrote plus anything it could not work out, exactly as the overlay, the
 * popup detail and the composer already do.
 */
export function runFormButton(
  body: string,
  buttonId: string,
  values: Record<string, string>,
): { values: Record<string, string>; errors: string[] } {
  const engine = window.SBFormulaEngine;
  if (!engine) return { values: {}, errors: [] };

  const spec = engine.extractButtons(body).find((b) => b.id === buttonId);
  if (!spec) return { values: {}, errors: [] };

  const result = engine.applyButtonCode(spec.statements, values);
  const written: Record<string, string> = {};
  for (const [name, value] of Object.entries(result.values)) {
    written[name] = String(value);
  }
  return { values: written, errors: [...spec.errors, ...result.errors] };
}
