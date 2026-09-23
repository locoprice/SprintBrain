/**
 * Reading the text out of an uploaded file, in the browser (MEMORY-002 D1).
 *
 * Nothing here talks to a server. A contract or an internal procedure is
 * exactly the kind of file that must not pass through a third party on its way
 * into someone's memory space, and the readers are small enough to run beside
 * the page. The file itself still goes to the private bucket afterwards, so the
 * text and the original stay in the same account.
 *
 * The two heavy readers are imported lazily, inside the branch that needs them.
 * Most sessions never upload anything, and neither reader should sit in the
 * bundle those sessions download: PDF.js alone is larger than the dashboard.
 *
 * WHAT COUNTS AS "NO TEXT". A scan is a picture of a page. PDF.js returns an
 * empty string for it, which is indistinguishable from a blank file and equally
 * useless to import, so both end as `no-text` and the operator is told plainly
 * rather than left with a source that lists nothing. Reading scans needs
 * character recognition, which is a service, a bill and a decision of its own.
 */

/** Everything the upload flow can refuse, in terms the interface can word. */
export type DocumentTextFailure =
  | 'unsupported' // not one of the four kinds below
  | 'too-large' // over MAX_BYTES
  | 'no-text' // opened fine, contained no selectable text (a scan, or empty)
  | 'unreadable'; // damaged, encrypted, or a reader that threw

export interface DocumentTextResult {
  text: string;
  /** Pages for a PDF, otherwise 0. Shown so a short read on a long file is visible. */
  pages: number;
}

export class DocumentTextError extends Error {
  readonly reason: DocumentTextFailure;

  constructor(reason: DocumentTextFailure, message: string) {
    super(message);
    this.name = 'DocumentTextError';
    this.reason = reason;
  }
}

/**
 * 20 MB, matching the bucket's own limit. Past that a file is a library rather
 * than a source, and the chunk count stops being something a person can read.
 */
export const MAX_BYTES = 20 * 1024 * 1024;

export type DocumentKind = 'pdf' | 'docx' | 'text';

/**
 * What kind of file this is, by extension rather than by the browser's reported
 * type: `text/markdown` is not reported consistently, and an empty `type` is
 * normal for a file dragged from some file managers.
 */
export function documentKind(fileName: string): DocumentKind | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  if (ext === 'txt' || ext === 'md' || ext === 'markdown' || ext === 'csv') return 'text';
  return null;
}

/** The `accept` attribute for the file input, kept next to the list above. */
export const ACCEPTED_EXTENSIONS = '.pdf,.docx,.txt,.md,.markdown,.csv';

/**
 * Collapses the runs of whitespace a PDF extractor leaves behind, without
 * touching paragraph breaks: the chunker splits on blank lines, so flattening
 * them would cost it every boundary it prefers.
 */
export function tidyExtractedText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function readPdf(file: File): Promise<DocumentTextResult> {
  const pdfjs = await import('pdfjs-dist');
  // Vite resolves this to a hashed asset URL at build; the worker is a separate
  // file on purpose, so parsing a long PDF does not freeze the page.
  const workerUrl = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.toString();

  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const parts: string[] = [];

  for (let page = 1; page <= doc.numPages; page += 1) {
    const content = await (await doc.getPage(page)).getTextContent();
    const line = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ');
    if (line.trim()) parts.push(line);
  }

  const pages = doc.numPages;
  await doc.destroy();
  return { text: tidyExtractedText(parts.join('\n\n')), pages };
}

async function readDocx(file: File): Promise<DocumentTextResult> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return { text: tidyExtractedText(result.value), pages: 0 };
}

/**
 * The text of an uploaded file, or a `DocumentTextError` naming what the
 * interface should say. Callers never see a half-read file: anything that
 * throws inside a reader comes back as `unreadable`.
 */
export async function extractDocumentText(file: File): Promise<DocumentTextResult> {
  const kind = documentKind(file.name);
  if (!kind) {
    throw new DocumentTextError('unsupported', `${file.name} is not a PDF, Word, text or Markdown file`);
  }
  if (file.size > MAX_BYTES) {
    throw new DocumentTextError('too-large', `${file.name} is larger than 20 MB`);
  }

  let result: DocumentTextResult;
  try {
    if (kind === 'pdf') result = await readPdf(file);
    else if (kind === 'docx') result = await readDocx(file);
    else result = { text: tidyExtractedText(await file.text()), pages: 0 };
  } catch {
    throw new DocumentTextError('unreadable', `${file.name} could not be opened`);
  }

  if (!result.text) {
    throw new DocumentTextError('no-text', `${file.name} holds no text that can be copied`);
  }
  return result;
}
