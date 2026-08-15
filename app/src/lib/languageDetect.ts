import type { SnippetBodies, SnippetLanguage } from '@/types/database';

// Language detection for snippet bodies (LANG-GUARD-001).
//
// A snippet declares the language it is written in, and the extension expands
// whichever variant matches the guest's language. A body filed under the wrong
// flag is therefore sent to a guest in a language they did not ask for — a
// mistake nothing else in the product catches.
//
// Deliberately a small heuristic rather than a dependency: a full n-gram model
// is tens of KB of tables for a check that runs on four European languages, and
// adding a dependency needs approval (app/CLAUDE.md §2).
//
// FAILS OPEN, ALWAYS. The check blocks a save, so a false positive costs the
// user real work while a false negative costs nothing they weren't already
// doing. Every threshold below is set so that ambiguous, short, or
// signal-free text returns null — "I don't know" — and passes.

/** Languages worth detecting. MULTI is a deliberate mix, so it is never checked. */
export type DetectableLanguage = 'EN' | 'ES' | 'IT' | 'FR';

export const LANGUAGE_NAMES: Record<DetectableLanguage, string> = {
  EN: 'English',
  ES: 'Spanish',
  IT: 'Italian',
  FR: 'French',
};

const DETECTABLE: readonly DetectableLanguage[] = ['EN', 'ES', 'IT', 'FR'];

/**
 * High-frequency function words, by language.
 *
 * A word may appear under several languages — "la" is Spanish, Italian and
 * French — and that is the point: shared words score every language they belong
 * to, so they cancel out in the margin test and only distinctive words move the
 * verdict. A word that is common in a language MUST be listed under it, or that
 * language gets unfairly penalised on its own text.
 *
 * Words spelled the same in two languages but absent from one list would skew
 * the result, so anything genuinely ambiguous across all four (proper nouns,
 * "hotel", "total") is simply left out — no signal is better than false signal.
 */
const LANGUAGE_WORDS: Record<DetectableLanguage, readonly string[]> = {
  EN: [
    'the', 'and', 'are', 'is', 'was', 'were', 'be', 'been', 'being', 'you', 'your',
    'yours', 'we', 'our', 'ours', 'they', 'them', 'their', 'this', 'that', 'these',
    'those', 'with', 'from', 'have', 'has', 'had', 'will', 'would', 'shall',
    'should', 'can', 'could', 'may', 'might', 'must', 'please', 'thank', 'thanks',
    'for', 'but', 'not', 'all', 'any', 'each', 'every', 'when', 'where', 'which',
    'what', 'who', 'how', 'why', 'there', 'here', 'about', 'into', 'than', 'then',
    'us', 'it', 'its', 'my', 'mine', 'she', 'her', 'his', 'him', 'do', 'does',
    'did', 'done', 'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same',
    'too', 'very', 'just', 'also', 'because', 'before', 'after', 'while', 'during',
    'through', 'between', 'both', 'few', 'many', 'much', 'again', 'still', 'until',
    'without', 'within', 'always', 'never', 'often', 'already', 'soon', 'an', 'or',
    'if', 'to', 'of', 'on', 'at', 'by', 'one', 'two', 'time', 'day', 'days',
    'year', 'years', 'name', 'kindly', 'dear', 'regards', 'sincerely', 'best',
    'hello', 'welcome', 'room', 'rooms', 'night', 'nights', 'guest', 'guests',
    'arrival', 'departure', 'price', 'available', 'includes', 'included', 'stay',
    'client',
    // NOT listed, on purpose: check / check-in / check-out / booking / wifi /
    // parking / online. Hospitality keeps them in English inside Spanish,
    // Italian and French copy, so scoring them as English markers made a bare
    // "Check-in 15:00 — Check-out 10:00" read as English and blocked a
    // perfectly good Spanish save.
  ],
  ES: [
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'del', 'al', 'lo', 'que',
    'de', 'en', 'por', 'para', 'con', 'como', 'pero', 'más', 'muy', 'ya', 'sin',
    'sobre', 'entre', 'hasta', 'desde', 'cuando', 'donde', 'también', 'así', 'todo',
    'toda', 'todos', 'todas', 'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'eso',
    'su', 'sus', 'es', 'son', 'está', 'están', 'ser', 'estar', 'tiene', 'tienen',
    'hay', 'puede', 'pueden', 'hacer', 'gracias', 'favor', 'usted', 'ustedes',
    'nosotros', 'ellos', 'ellas', 'les', 'nos', 'nuestro', 'nuestra', 'señor',
    'señora', 'día', 'días', 'año', 'años', 'noche', 'noches', 'habitación',
    'habitaciones', 'reserva', 'reservas', 'precio', 'precios', 'incluye',
    'incluido', 'disponible', 'llegada', 'salida', 'huésped', 'huéspedes',
    'nombre', 'correo', 'teléfono', 'dirección', 'ciudad', 'saludos',
    'cordialmente', 'atentamente', 'estimado', 'estimada', 'buenos', 'buenas',
    'tardes', 'hola', 'sí', 'aunque', 'porque', 'quien', 'alojamiento', 'pago',
    'fecha', 'fechas', 'personas', 'casa', 'bien', 'cliente',
  ],
  IT: [
    'il', 'lo', 'la', 'gli', 'le', 'un', 'uno', 'una', 'del', 'della', 'dello',
    'dei', 'degli', 'delle', 'di', 'che', 'per', 'con', 'da', 'su', 'al', 'non',
    'sono', 'è', 'siamo', 'siete', 'sei', 'ho', 'hai', 'ha', 'abbiamo', 'hanno',
    'questo', 'questa', 'questi', 'queste', 'quello', 'quella', 'come', 'quando',
    'dove', 'perché', 'più', 'ma', 'se', 'già', 'ci', 'vi', 'anche', 'molto', 'e',
    'grazie', 'prego', 'prezzo', 'prezzi', 'camera', 'camere', 'notte', 'notti',
    'prenotazione', 'prenotazioni', 'disponibile', 'incluso', 'inclusa', 'giorno',
    'giorni', 'anno', 'anni', 'ospite', 'ospiti', 'arrivo', 'partenza', 'saluti',
    'cordiali', 'gentile', 'buongiorno', 'buonasera', 'ciao', 'nostro', 'nostra',
    'vostro', 'vostra', 'suo', 'sua', 'loro', 'pagamento', 'soggiorno', 'casa',
    'tutto', 'tutti', 'tutte', 'cliente',
  ],
  FR: [
    'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'est', 'sont', 'que',
    'qui', 'pour', 'avec', 'dans', 'sur', 'par', 'ne', 'pas', 'plus', 'vous',
    'votre', 'vos', 'nous', 'notre', 'nos', 'ils', 'elles', 'ce', 'cette', 'ces',
    'cet', 'son', 'sa', 'ses', 'leur', 'leurs', 'mais', 'ou', 'où', 'comme',
    'quand', 'très', 'aussi', 'déjà', 'non', 'en', 'merci', 'prix', 'chambre',
    'chambres', 'nuit', 'nuits', 'réservation', 'réservations', 'disponible',
    'inclus', 'incluse', 'jour', 'jours', 'année', 'années', 'arrivée', 'départ',
    'séjour', 'bonjour', 'bonsoir', 'cordialement', 'salutations', 'madame',
    'monsieur', 'être', 'avoir', 'fait', 'faire', 'tout', 'tous', 'toute',
    'toutes', 'bien', 'alors', 'donc', 'encore', 'toujours', 'jamais', 'paiement',
    'maison', 'personnes', 'client',
  ],
};

/** word → every language that word marks. Inverted once, at module load. */
const WORD_MARKERS: Map<string, DetectableLanguage[]> = (() => {
  const map = new Map<string, DetectableLanguage[]>();
  for (const lang of DETECTABLE) {
    for (const word of LANGUAGE_WORDS[lang]) {
      const langs = map.get(word);
      if (langs) langs.push(lang);
      else map.set(word, [lang]);
    }
  }
  return map;
})();

/**
 * Characters that belong to one language and not the others.
 *
 * `à è ù` and `é` are shared (French and Italian both use them, Spanish uses
 * `é`), so they carry no signal and are left out. Inverted punctuation is as
 * close to a fingerprint as Spanish gets.
 */
const CHAR_MARKERS: Record<DetectableLanguage, RegExp | null> = {
  EN: null, // English has no diacritics to fingerprint — it is the unmarked case.
  ES: /[ñáíóú¿¡]/gi,
  IT: /[ìò]/gi,
  FR: /[âêîôûëïœç]/gi,
};

const CHAR_WEIGHT = 2;
/** Cap so one heavily accented word cannot outvote a page of function words. */
const CHAR_POINTS_MAX = 6;

/** Below this many usable words, no verdict is trustworthy. */
const MIN_WORDS = 4;
/** The winner needs this much raw evidence before it counts as evidence at all. */
const MIN_SCORE = 3;
/** …and this much daylight over the runner-up, or the text is called ambiguous. */
const MIN_MARGIN = 2;

/**
 * Reduce a snippet body to the prose a human actually wrote.
 *
 * Template syntax is not language: `{guest_name}`, `{=TOTAL * 1.03}` and
 * `{if:nights > 2}` are the same in every locale, and a `{button}` block is
 * code. Left in, field names would be read as English words and quietly push
 * every body toward EN.
 */
export function extractProse(body: string): string {
  return body
    // Button blocks are code, not prose — drop the whole block, not just its tags.
    .replace(/\{button[^}]*\}[\s\S]*?\{\/button\}/gi, ' ')
    .replace(/\{\{[\s\S]*?\}\}/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\S+@\S+\.\S+/g, ' ')
    .replace(/\d+/g, ' ');
}

/** Lowercased words, apostrophes split so French "l'arrivée" yields "arrivée". */
function words(prose: string): string[] {
  return prose
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length > 0);
}

export interface LanguageDetection {
  language: DetectableLanguage;
  /** Winning score — marker words plus capped diacritic points. */
  score: number;
  /** Runner-up's score. The gap is what made the verdict safe to give. */
  runnerUp: number;
  /** Usable words the verdict was drawn from. */
  wordCount: number;
}

/**
 * Best guess at the language of a snippet body, or null when the text does not
 * carry enough signal to call — which includes every short or neutral phrase.
 *
 * Callers must treat null as "fine": it is the answer for "OK", "Check-in
 * 15:00", a bare price, and anything the word lists simply do not cover.
 */
export function detectLanguage(body: string): LanguageDetection | null {
  const prose = extractProse(body ?? '');
  const tokens = words(prose);
  if (tokens.length < MIN_WORDS) return null;

  const scores: Record<DetectableLanguage, number> = { EN: 0, ES: 0, IT: 0, FR: 0 };

  for (const token of tokens) {
    for (const lang of WORD_MARKERS.get(token) ?? []) {
      scores[lang] += 1;
    }
  }

  for (const lang of DETECTABLE) {
    const pattern = CHAR_MARKERS[lang];
    if (pattern === null) continue;
    const hits = prose.match(pattern)?.length ?? 0;
    scores[lang] += Math.min(hits * CHAR_WEIGHT, CHAR_POINTS_MAX);
  }

  const ranked = [...DETECTABLE].sort((a, b) => scores[b] - scores[a]);
  const winner = ranked[0];
  const second = ranked[1];
  if (winner === undefined || second === undefined) return null;

  const top = scores[winner];
  const runnerUp = scores[second];
  if (top < MIN_SCORE) return null;
  if (top - runnerUp < MIN_MARGIN) return null;

  return { language: winner, score: top, runnerUp, wordCount: tokens.length };
}

export interface LanguageMismatch {
  /** The language slot the text is filed under. */
  slot: DetectableLanguage;
  /** What the text actually reads as. */
  detected: DetectableLanguage;
  message: string;
}

/** True for the four slots worth checking — MULTI is a deliberate mix. */
function isDetectable(lang: SnippetLanguage): lang is DetectableLanguage {
  return lang !== 'MULTI';
}

export function mismatchMessage(
  slot: DetectableLanguage,
  detected: DetectableLanguage,
): string {
  return `Detected language is ${LANGUAGE_NAMES[detected]}, but this field requires ${LANGUAGE_NAMES[slot]} text.`;
}

/**
 * The complaint for one body filed under `slot`, or null when it is consistent,
 * too ambiguous to judge, or not a language worth checking.
 *
 * The live counterpart to findLanguageMismatch: the editor runs this on the
 * slot being typed into, while the submit guard sweeps every slot. Same verdict
 * either way — this one just arrives while the text can still be reworded.
 */
export function slotMismatchMessage(body: string, slot: SnippetLanguage): string | null {
  if (!isDetectable(slot)) return null;
  if (body.trim().length === 0) return null;
  const detection = detectLanguage(body);
  if (detection === null || detection.language === slot) return null;
  return mismatchMessage(slot, detection.language);
}

/**
 * First body filed under the wrong language, or null when every slot is either
 * consistent or too ambiguous to judge.
 *
 * Checks every filled slot, not just the one on screen: a snippet saves all its
 * language variants at once, so a Spanish body sitting in the EN slot of a
 * translated snippet is just as wrong for being out of view. Slots are walked
 * in a fixed order so the same form always reports the same problem first.
 */
export function findLanguageMismatch(bodies: SnippetBodies): LanguageMismatch | null {
  for (const slot of DETECTABLE) {
    const body = bodies[slot];
    if (typeof body !== 'string' || body.trim().length === 0) continue;
    const detection = detectLanguage(body);
    if (detection === null || detection.language === slot) continue;
    return {
      slot,
      detected: detection.language,
      message: mismatchMessage(slot, detection.language),
    };
  }
  return null;
}

/**
 * The complaint for a whole snippet as the editor holds it, or null when it has
 * nothing to answer for. `content` is the active slot's live text, which runs
 * ahead of `bodies` between keystrokes, so it is merged in before the sweep.
 *
 * A snippet flagged MULTI is never checked. MULTI *means* a deliberate mix —
 * one body carrying two or more languages — so there is no slot in it that can
 * be the wrong language, and the sweep has nothing to say that the author did
 * not already decide. Checking it anyway blocked the exact snippet the flag
 * exists for: text typed before the flag is switched stays behind in whichever
 * slot was active (the form opens on EN), and the sweep reads that leftover
 * rather than the MULTI body the author is looking at.
 */
export function snippetMismatch(
  language: SnippetLanguage,
  bodies: SnippetBodies,
  content: string,
): LanguageMismatch | null {
  if (language === 'MULTI') return null;
  return findLanguageMismatch({ ...bodies, [language]: content });
}

/** Re-exported for callers that hold a `SnippetLanguage` and need to narrow it. */
export { isDetectable };
