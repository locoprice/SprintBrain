import { describe, expect, it } from 'vitest';
import {
  buildChunkItems,
  chunkName,
  chunkSummary,
  documentBaseName,
} from '@/lib/documentImport';
import { documentKind, tidyExtractedText } from '@/lib/documentText';

// What an uploaded file becomes (MEMORY-002 D1).
//
// The rules under test are the ones a person sees: what each piece is called,
// what it says in a list, and which files are accepted at all. Where the text
// is cut belongs to the shared chunker and is covered by
// scripts/check-memory-chunk.js, which both surfaces run.

describe('documentBaseName', () => {
  it('drops the extension and keeps the rest of the name', () => {
    expect(documentBaseName('Service agreement v2.pdf')).toBe('Service agreement v2');
    expect(documentBaseName('notes.2026.03.txt')).toBe('notes.2026.03');
  });

  it('keeps a name that has no extension, and never returns empty', () => {
    expect(documentBaseName('README')).toBe('README');
    expect(documentBaseName('.gitignore')).toBe('.gitignore');
  });
});

describe('chunkName', () => {
  it('leaves a single-piece file without a counter', () => {
    expect(chunkName('Price list', 0, 1)).toBe('Price list');
  });

  it('numbers the pieces from one', () => {
    expect(chunkName('Price list', 0, 3)).toBe('Price list (1/3)');
    expect(chunkName('Price list', 2, 3)).toBe('Price list (3/3)');
  });

  it('shortens the name rather than the counter, and stays inside the column', () => {
    const long = 'A very long document name that goes well past the column limit';
    const name = chunkName(long, 4, 12);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name.endsWith(' (5/12)')).toBe(true);
    expect(name.startsWith('A very long document name')).toBe(true);
  });
});

describe('chunkSummary', () => {
  it('uses the text itself when it is short', () => {
    expect(chunkSummary('  Cancellation is free up to 48 hours before.  ')).toBe(
      'Cancellation is free up to 48 hours before.',
    );
  });

  it('flattens line breaks so a list reads as one line', () => {
    expect(chunkSummary('First line\n\nSecond line')).toBe('First line Second line');
  });

  it('stops at a sentence end when the cut lands near one', () => {
    const summary = chunkSummary(`${'word '.repeat(40)}end of it. ${'more '.repeat(40)}`);
    expect(summary.endsWith('end of it.')).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(280);
  });

  it('never cuts mid-word when no sentence end is near', () => {
    const summary = chunkSummary('supercalifragilistic '.repeat(40));
    expect(summary.length).toBeLessThanOrEqual(280);
    expect(summary.endsWith('…')).toBe(true);
    expect(summary).not.toMatch(/supercalifragilisti…$/);
  });
});

describe('buildChunkItems', () => {
  it('names every piece after the file and keeps the order', () => {
    const items = buildChunkItems('Handbook.pdf', ['first part', 'second part']);
    expect(items.map((item) => item.name)).toEqual(['Handbook (1/2)', 'Handbook (2/2)']);
    expect(items.map((item) => item.body)).toEqual(['first part', 'second part']);
  });

  it('drops blank pieces before they reach the database', () => {
    const items = buildChunkItems('Handbook.pdf', ['real text', '   ', '\n\n']);
    expect(items).toHaveLength(1);
    // The counter reflects what was kept, not what the splitter handed over.
    expect(items[0]?.name).toBe('Handbook');
  });

  it('returns nothing for a file whose text was all whitespace', () => {
    expect(buildChunkItems('Empty.txt', ['  ', ''])).toEqual([]);
  });

  it('gives every piece a summary that fits the column', () => {
    const items = buildChunkItems('Long.pdf', ['x'.repeat(5000)]);
    expect(items[0]?.summary.length ?? 0).toBeLessThanOrEqual(280);
  });
});

describe('documentKind', () => {
  it('accepts the four kinds the reader can open', () => {
    expect(documentKind('a.pdf')).toBe('pdf');
    expect(documentKind('a.DOCX')).toBe('docx');
    expect(documentKind('a.txt')).toBe('text');
    expect(documentKind('a.md')).toBe('text');
  });

  it('refuses what it cannot read, including old Word files', () => {
    expect(documentKind('a.doc')).toBeNull();
    expect(documentKind('a.pages')).toBeNull();
    expect(documentKind('photo.jpg')).toBeNull();
    expect(documentKind('noextension')).toBeNull();
  });
});

describe('tidyExtractedText', () => {
  it('collapses the spacing a PDF reader leaves behind', () => {
    expect(tidyExtractedText('Total    due:   ' + String.fromCharCode(160) + ' 120')).toBe('Total due: 120');
  });

  it('keeps paragraph breaks, which is where the splitter prefers to cut', () => {
    expect(tidyExtractedText('One\n\n\n\nTwo')).toBe('One\n\nTwo');
    expect(tidyExtractedText('One\nTwo')).toBe('One\nTwo');
  });
});
