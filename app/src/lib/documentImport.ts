/**
 * Turning the text of one file into memory items (MEMORY-002 D1).
 *
 * The chunker decides WHERE the text is cut. This decides what each piece is
 * called and what it says in a list, which is a different question and the one
 * the operator actually sees: a space showing "Contract (3/9)" reads as one
 * source in nine parts, while nine rows called "Contract" read as a mess.
 *
 * Kept apart from the upload itself so the rule can be tested without a file,
 * a browser or a network.
 */

/** The table's own limits. Exceeding either one fails the whole import. */
const NAME_MAX = 64;
const SUMMARY_MAX = 280;

export interface ChunkItem {
  name: string;
  summary: string;
  body: string;
}

/** The file name without its extension, which is what a person calls the document. */
export function documentBaseName(fileName: string): string {
  const trimmed = fileName.trim();
  const dot = trimmed.lastIndexOf('.');
  const base = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  return base.trim() || trimmed || 'Document';
}

/**
 * `Contract (3/9)`, cut to fit the name column.
 *
 * The counter is what makes the pieces navigable, so it is never what gets
 * dropped: the base name is shortened around it. A single-chunk file carries no
 * counter at all, because "(1/1)" only adds noise to a file that arrived whole.
 */
export function chunkName(baseName: string, index: number, total: number): string {
  const base = baseName.trim() || 'Document';
  if (total <= 1) return base.slice(0, NAME_MAX);
  const suffix = ` (${index + 1}/${total})`;
  const room = NAME_MAX - suffix.length;
  const head = base.length > room ? `${base.slice(0, Math.max(1, room - 1))}…` : base;
  return `${head}${suffix}`;
}

/**
 * The first sentence or so of the piece, on one line.
 *
 * A summary is what the Context panel shows before anything is attached, so it
 * has to read like the start of the text rather than like a label. Cutting at a
 * sentence end when one is near keeps it from stopping mid-word.
 */
export function chunkSummary(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (flat.length <= SUMMARY_MAX) return flat;

  const window = flat.slice(0, SUMMARY_MAX);
  const stop = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '));
  if (stop > SUMMARY_MAX * 0.5) return window.slice(0, stop + 1);

  // The ellipsis counts against the column too, so the text it follows is cut
  // one character shorter. A summary that overflows fails the whole import.
  const room = SUMMARY_MAX - 1;
  const shortened = flat.slice(0, room);
  const space = shortened.lastIndexOf(' ');
  return `${(space > room * 0.5 ? shortened.slice(0, space) : shortened).trimEnd()}…`;
}

/**
 * The items one file becomes. Blank pieces are dropped here rather than sent
 * and refused: the body column will not take an empty string, and one blank
 * piece would otherwise fail the entire file.
 */
export function buildChunkItems(fileName: string, chunks: string[]): ChunkItem[] {
  const base = documentBaseName(fileName);
  const bodies = chunks.map((chunk) => chunk.trim()).filter((chunk) => chunk !== '');
  return bodies.map((body, index) => ({
    name: chunkName(base, index, bodies.length),
    summary: chunkSummary(body),
    body,
  }));
}
