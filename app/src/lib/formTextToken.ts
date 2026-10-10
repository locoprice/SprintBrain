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
 * mirror to keep in step, unlike `formMenuToken.ts`, whose writer the engine
 * still carries. The engine is still the parser they must satisfy:
 * `src/__tests__/formTextField.test.ts` pins the round trip against it.
 */

import { isValidMenuName } from '@/lib/formMenuToken';
import { linkValue } from '@/lib/linkRule';

export interface FormTextConfig {
  /** Field name — how the rest of the body refers to the value. */
  name: string;
  /** Value the field starts with, or '' for an empty field. */
  default: string;
  /**
   * The field holds a person's name, written as `format=name`. What is typed
   * then prints with a name's capitals in the snippet's language:
   * "giovanni rossi" becomes "Giovanni Rossi", "signor rossi" stays
   * "signor Rossi" in Italian. The default prints exactly as written.
   *
   * `false` on a field whose own name already says it holds a person's name
   * (see `isPersonNameKey`) is written as `format=plain`, the only way to stop
   * the engine adding the capitals by itself. Left out, the engine decides.
   */
  personName?: boolean;
  /**
   * Where on a pasted web page the value is (Fill from link), as
   * `after:Order number` or `before:Box|Boxes`; '' or left out for a field
   * nobody points at a page. See `@/lib/linkRule`.
   */
  link?: string;
}

// What a field's own name says about it. MIRRORED from sbIsPersonNameKey in
// extension/formula-engine.js, which explains the rule: the editor needs the
// same answer to show the Person name switch already on for guest_name or
// nomecliente. formTextField.test.ts compares these lists with the engine's.
export const PERSON_NAME_WORDS: readonly string[] = [
  'name', 'names', 'firstname', 'lastname', 'fullname', 'surname', 'nickname',
  'nome', 'nomi', 'cognome', 'nominativo', 'nombre', 'nombres', 'apellido', 'apellidos',
  'nom', 'prenom',
];
export const PERSON_NAME_STEMS: readonly string[] = ['name', 'nome', 'nombre'];
export const NOT_PERSON_WORDS: readonly string[] = [
  'user', 'file', 'host', 'domain', 'company', 'business', 'brand', 'product', 'model',
  'provider', 'supplier', 'vendor',
  'utente', 'azienda', 'ditta', 'societa', 'prodotto', 'marca', 'modello', 'fornitore', 'dominio',
  'usuario', 'archivo', 'empresa', 'compania', 'producto', 'modelo', 'proveedor', 'provedor',
  'utilisateur', 'fichier', 'societe', 'entreprise', 'produit', 'marque', 'modele', 'fournisseur',
  'domaine',
  'date', 'time', 'datetime',
];

const PERSON_WORD_SET = new Set(PERSON_NAME_WORDS);
const NOT_PERSON_SET = new Set(NOT_PERSON_WORDS);

/** The engine's sbStripAccents, letter for letter. */
function stripAccents(s: string): string {
  return s
    .replace(/[àáâãäå]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/ç/g, 'c')
    .replace(/ñ/g, 'n');
}

/**
 * True when a field's own name says it holds a person's name (guest_name,
 * nome, nombre, guestname, nomecliente), so what is typed into it prints with
 * a name's capitals without `format=name`. Never when a word names something
 * else: nome_azienda, username, product_name, Nombre_Provedor.
 */
export function isPersonNameKey(key: string): boolean {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const words = stripAccents(spaced.toLowerCase()).split(/[^a-z]+/);
  let found = false;
  for (const word of words) {
    if (!word) continue;
    if (NOT_PERSON_SET.has(word)) return false;
    if (PERSON_WORD_SET.has(word)) {
      found = true;
      continue;
    }
    for (const stem of PERSON_NAME_STEMS) {
      if (word.length <= stem.length) continue;
      let rest: string | null = null;
      if (word.startsWith(stem)) rest = word.slice(stem.length);
      else if (word.endsWith(stem)) rest = word.slice(0, word.length - stem.length);
      if (rest === null) continue;
      if (NOT_PERSON_SET.has(rest)) return false;
      found = true;
      break;
    }
  }
  return found;
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
  const name = sanitizeTextName(cfg.name);
  const head = `{formtext: name=${name}`;
  // Switched on, the attribute is always written, even where the name alone
  // would do: a release from before automatic names still reads format=name.
  let out = head;
  if (cfg.personName === true) out = `${head}; format=name`;
  else if (cfg.personName === false && isPersonNameKey(name)) out = `${head}; format=plain`;
  if (value !== '') out += `; default=${value}`;
  // Last, in the engine's one spelling (`_linkValue`), the way the number,
  // date and menu writers put it.
  const link = linkValue(cfg.link);
  if (link !== '') out += `; link=${link}`;
  return `${out}}`;
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
