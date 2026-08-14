/**
 * {formtext:} token writer for the snippet body editor.
 *
 * A text field is stored inline in the body as
 *   `{formtext: name=TEXT_1; default=Ada}`
 * and read back by the formula engine when the snippet expands, where
 * `buildFormFieldCfg` turns it into `{ type: 'text', default: 'Ada' }` — one
 * line of arbitrary text, typed in by whoever expands the snippet.
 *
 * Unlike `{formmenu:}`, a text field cannot go unnamed: the engine's
 * `_formFieldName` has no fallback key for it, so `buildFormFieldCfg` skips the
 * token, no input is rendered and the field prints nothing. The name is
 * therefore required here — the dialog prefills `nextTextName` so that costs
 * the author no thought — while a menu is free to stay anonymous.
 *
 * Nothing writes these tokens outside the dashboard, so there is no engine-side
 * mirror to keep in step (`formMenuToken.ts` has one because Sprintbrain.html
 * builds menus too). The engine is still the parser they must satisfy:
 * `src/__tests__/formTextField.test.ts` pins the round trip against it.
 */

import { isValidMenuName } from '@/lib/formMenuToken';

export interface FormTextConfig {
  /** Field name — how the rest of the body refers to the value. */
  name: string;
  /** Value the field starts with, or '' for an empty field. */
  default: string;
}

/**
 * Engine identifier rules: a letter or underscore, then word characters.
 *
 * One rule covers every kind of field, so this re-exports the menu writer's
 * check under a kind-neutral name rather than restating the same regex.
 */
export const isValidFieldName = isValidMenuName;

/**
 * Forces a name the engine accepts. A token whose name it rejects resolves to
 * nothing at expansion time, which reads to the user as a vanished field.
 */
export function sanitizeTextName(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, '');
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `TEXT_${cleaned}`;
}

/**
 * `;` `{` `}` end a token's settings, and a newline would split it across two
 * lines of the body, so all four collapse to a space inside a default value
 * rather than breaking the snippet. Commas are safe: a text field holds one
 * value, and the engine reads `default=` to the next `;`.
 */
export function sanitizeTextDefault(raw: string): string {
  return raw.replace(/[;{}]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function buildFormTextToken(cfg: FormTextConfig): string {
  const value = sanitizeTextDefault(cfg.default);
  const out = `{formtext: name=${sanitizeTextName(cfg.name)}`;
  return `${value === '' ? out : `${out}; default=${value}`}}`;
}

/**
 * The next unused `TEXT_n` for a body. The dialog prefills this so an inserted
 * field always carries a working name without the author having to invent one.
 *
 * Every `TEXT_n` in the body counts, not just the ones behind a `name=` — a
 * plain `{TEXT_1}` placeholder is the same field to the engine, and handing out
 * its name again would silently wire two controls to one value.
 */
export function nextTextName(body: string): string {
  const used = new Set<number>();
  const re = /TEXT_(\d+)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const found = Number.parseInt(match[1] ?? '', 10);
    if (Number.isFinite(found)) used.add(found);
  }
  let n = 1;
  while (used.has(n)) n += 1;
  return `TEXT_${n}`;
}
