// pageText.ts — a web page's visible text, as an ordered list of pieces.
//
// Pure: no Deno APIs, no network, no imports, so the app's test runner can load
// it by relative path (app/src/__tests__/readLink.test.ts).
//
// A piece is one run of text between two tags, in the order the page shows
// it. That is the whole contract with the fill form (extension/shared/
// fill-form.js, readFromPage), which looks for a label and takes the piece
// after it, or adds up the numbers written before a word. A page that puts
// its label and value in two elements yields two pieces; one that writes
// "Label: value" in one element yields one, and the fill form reads both.
//
// Deliberately not an HTML parser. Nothing here needs a tree: no selector is
// ever evaluated and no markup is ever trusted or returned. A small reader
// also keeps a large page well inside the function's time limit, and adds no
// dependency.

/** Pieces kept from one page, and their length together. */
export const MAX_PIECES = 8000;
export const MAX_TEXT = 300_000;

// Elements whose content is never text a person reads on the page: code,
// styling, embedded documents, and form controls (an option list, a button
// caption, a text box's prefilled value).
const HIDDEN_BLOCK =
  /<(script|style|noscript|template|svg|math|head|iframe|object|select|textarea|button)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  euro: '€', pound: '£', yen: '¥', cent: '¢', copy: '©', reg: '®', trade: '™', deg: '°',
  bull: '•', middot: '·', hellip: '…', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
  times: '×', divide: '÷', ordm: 'º', ordf: 'ª', sup1: '¹', sup2: '²', sup3: '³',
  iexcl: '¡', iquest: '¿', sect: '§', para: '¶',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', yacute: 'ý',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Yacute: 'Ý',
  agrave: 'à', egrave: 'è', igrave: 'ì', ograve: 'ò', ugrave: 'ù',
  Agrave: 'À', Egrave: 'È', Igrave: 'Ì', Ograve: 'Ò', Ugrave: 'Ù',
  acirc: 'â', ecirc: 'ê', icirc: 'î', ocirc: 'ô', ucirc: 'û',
  Acirc: 'Â', Ecirc: 'Ê', Icirc: 'Î', Ocirc: 'Ô', Ucirc: 'Û',
  auml: 'ä', euml: 'ë', iuml: 'ï', ouml: 'ö', uuml: 'ü', yuml: 'ÿ',
  Auml: 'Ä', Euml: 'Ë', Iuml: 'Ï', Ouml: 'Ö', Uuml: 'Ü',
  atilde: 'ã', otilde: 'õ', ntilde: 'ñ', Atilde: 'Ã', Otilde: 'Õ', Ntilde: 'Ñ',
  ccedil: 'ç', Ccedil: 'Ç', szlig: 'ß', aring: 'å', Aring: 'Å', oslash: 'ø', Oslash: 'Ø',
  aelig: 'æ', AElig: 'Æ', oelig: 'œ', OElig: 'Œ',
};

function codePoint(n: number): string {
  // A number that is not a character prints nothing rather than throwing.
  return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
}

/** Turns &amp;, &eacute;, &#233; and &#xE9; back into the characters they stand for. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, ent: string) => {
    if (ent[0] === '#') {
      const n = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(n) ? codePoint(n) : whole;
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, ent) ? NAMED_ENTITIES[ent] : whole;
  });
}

/**
 * The visible text of an HTML page, one entry per run of text between tags,
 * whitespace collapsed, empty runs dropped. Capped at MAX_PIECES entries and
 * MAX_TEXT characters, so a huge page costs no more than a large one.
 */
export function pageText(html: string): string[] {
  const src = String(html ?? '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(HIDDEN_BLOCK, '\u0000');
  const out: string[] = [];
  let total = 0;
  for (const chunk of src.replace(/<[^>]*>/g, '\u0000').split('\u0000')) {
    const text = decodeEntities(chunk).replace(/[\s ]+/g, ' ').trim();
    if (text === '') continue;
    if (out.length >= MAX_PIECES || total + text.length > MAX_TEXT) break;
    out.push(text);
    total += text.length;
  }
  return out;
}

/**
 * The character set a page declares, from its Content-Type header or, failing
 * that, its first <meta>. '' when it declares none.
 */
export function declaredCharset(contentType: string, head: string): string {
  const fromHeader = /charset\s*=\s*"?([A-Za-z0-9._:-]+)/i.exec(contentType || '');
  if (fromHeader) return fromHeader[1].toLowerCase();
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([A-Za-z0-9._:-]+)/i.exec(head || '');
  return fromMeta ? fromMeta[1].toLowerCase() : '';
}
