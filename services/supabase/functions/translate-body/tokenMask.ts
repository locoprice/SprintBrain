// Placeholder masking for machine translation (TRANSLATE-001).
//
// A SprintBrain body is prose with machinery embedded in it: {first_name},
// {formmenu: a,b; name=PLAN}, {if:TOTAL > 0}…{endif}, {{= SUBTOTAL * 1.22 }}.
// The prose must be translated. The machinery must come back byte for byte —
// a model that helpfully renders {start_date} as {fecha_inicio} has broken the
// snippet, and it breaks it silently, because the result still looks like a
// valid token to every reader downstream.
//
// So the model never sees the machinery. Every token is swapped for an opaque
// sentinel before the request and swapped back after it. Translation moves
// sentinels around freely — word order differs between languages and a
// placeholder has to travel with the phrase it belongs to — but it cannot
// invent, drop, or rewrite one without the round trip failing outright.
//
// Pure string functions on purpose: no Deno APIs, no network, no imports. The
// edge function runs them, and app/src/__tests__/tokenMask.test.ts exercises
// them directly, so the rules live in exactly one place.

/** Closing tag of a {button …} block. The block body is code, never prose. */
const BUTTON_CLOSE = '{/button}';

/** Shape of a sentinel: two brackets, a number, two brackets. */
const SENTINEL_RE = /^\[\[(\d+)\]\]/;

/** What a mask pass produced. */
export interface MaskResult {
  /** The text with every token replaced by its sentinel. */
  masked: string;
  /** Original token text, indexed by sentinel number. */
  tokens: string[];
}

/** The sentinel standing in for token `index`. */
export function sentinel(index: number): string {
  return '[[' + index + ']]';
}

/**
 * Does this token open a {button …} block?
 *
 * Mirrors `_isButtonHead` in extension/formula-engine.js: the word "button"
 * either alone or followed by whitespace, so a field genuinely named
 * "buttonLabel" is not mistaken for one.
 */
function isButtonHead(inner: string): boolean {
  const low = inner.toLowerCase();
  if (low.slice(0, 6) !== 'button') return false;
  return low.length === 6 || /\s/.test(low.charAt(6));
}

/**
 * Replace every SprintBrain token in `text` with an opaque sentinel.
 *
 * What counts as a token, and why:
 *   {{ … }}                  double-brace formula
 *   { … }                    every single-brace token — fields, {if:}, {endif},
 *                            {greeting}, {gender:}, {time:}, {= …}
 *   {button …} … {/button}   masked WHOLE, closing tag included. The text
 *                            between the tags is assignment code, not prose;
 *                            translating it would rewrite field names.
 *   [[12]]                   text that already looks like a sentinel. Masked as
 *                            a literal so it cannot collide with ours and come
 *                            back as somebody else's token.
 *
 * An unterminated `{` is left exactly as it is. It prints literally when the
 * snippet expands (validateTemplate flags it as 'unterminated-token'), and a
 * translation is not the place to start repairing a body the user is still
 * writing.
 */
export function maskTokens(text: string): MaskResult {
  const tokens: string[] = [];
  let out = '';
  let i = 0;

  while (i < text.length) {
    const ch = text.charAt(i);

    // Pre-existing sentinel-shaped text — protect it so our numbering stays ours.
    if (ch === '[' && text.charAt(i + 1) === '[') {
      const m = SENTINEL_RE.exec(text.slice(i));
      if (m) {
        out += sentinel(tokens.length);
        tokens.push(m[0]);
        i += m[0].length;
        continue;
      }
    }

    if (ch !== '{') {
      out += ch;
      i += 1;
      continue;
    }

    // {{ … }} — the double-brace formula form.
    if (text.charAt(i + 1) === '{') {
      const close = text.indexOf('}}', i + 2);
      if (close === -1) { out += ch; i += 1; continue; }
      out += sentinel(tokens.length);
      tokens.push(text.slice(i, close + 2));
      i = close + 2;
      continue;
    }

    // { … } — every other token.
    const cl = text.indexOf('}', i + 1);
    if (cl === -1) { out += ch; i += 1; continue; }
    const inner = text.slice(i + 1, cl);

    if (isButtonHead(inner)) {
      const bClose = text.indexOf(BUTTON_CLOSE, cl + 1);
      // Unclosed button: mask the head alone and carry on, matching how the
      // engine renders it. Swallowing the rest of the body would be worse.
      const end = bClose === -1 ? cl + 1 : bClose + BUTTON_CLOSE.length;
      out += sentinel(tokens.length);
      tokens.push(text.slice(i, end));
      i = end;
      continue;
    }

    out += sentinel(tokens.length);
    tokens.push(text.slice(i, cl + 1));
    i = cl + 1;
  }

  return { masked: out, tokens };
}

/** Why an unmask was refused. Each maps to a sentence the user reads. */
export type UnmaskFailure = 'missing' | 'duplicated' | 'unknown';

export type UnmaskResult =
  | { ok: true; text: string }
  | { ok: false; reason: UnmaskFailure };

/**
 * Put the original tokens back, or refuse.
 *
 * Every sentinel must come back exactly once — no more, no fewer, and none
 * that was never sent. That is the whole guarantee: a model that dropped a
 * field, duplicated a formula, or hallucinated `[[9]]` fails here rather than
 * writing a quietly wrong snippet into the editor. Refusing costs the user one
 * retry; a corrupted body costs them a message sent to a real recipient with a
 * field that never fills in.
 */
export function unmaskTokens(masked: string, tokens: readonly string[]): UnmaskResult {
  const seen = new Array<number>(tokens.length).fill(0);
  let unknown = false;

  const text = masked.replace(/\[\[(\d+)\]\]/g, (whole: string, digits: string): string => {
    const index = Number(digits);
    const token = tokens[index];
    if (token === undefined) {
      unknown = true;
      return whole;
    }
    seen[index] = (seen[index] ?? 0) + 1;
    return token;
  });

  if (unknown) return { ok: false, reason: 'unknown' };
  for (const count of seen) {
    if (count > 1) return { ok: false, reason: 'duplicated' };
  }
  for (const count of seen) {
    if (count === 0) return { ok: false, reason: 'missing' };
  }

  return { ok: true, text };
}
