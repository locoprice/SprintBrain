import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Remove and Undo in a formula window (FormulaListSection / BodyListSection in
// formulaDialogParts.tsx) and the Show or hide window edit the body through
// NewSnippetDialog's replaceRange, which gives the body its focus back on the
// next frame. The window is still open at that moment, and a plain focus()
// there snapped the body to its first line: in a long snippet the author lost
// their place on every Remove and Undo (seen in Chromium, October 2026).
//
// The scroll is a browser layout effect the node test environment cannot
// measure, so the real source is read and the focus call itself is pinned.

const SOURCE = readFileSync(
  resolve(__dirname, '../features/snippets/NewSnippetDialog.tsx'),
  'utf8',
);

function functionBody(name: string): string {
  const start = SOURCE.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in NewSnippetDialog.tsx`);
  const open = SOURCE.indexOf('{', SOURCE.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < SOURCE.length; i += 1) {
    if (SOURCE[i] === '{') depth += 1;
    if (SOURCE[i] === '}') depth -= 1;
    if (depth === 0) return SOURCE.slice(open, i + 1);
  }
  throw new Error(`${name} has no closing brace`);
}

describe('replaceRange keeps the body where the author left it', () => {
  const body = functionBody('replaceRange');

  it('gives the body its focus back without scrolling it', () => {
    expect(body).toContain('el.focus({ preventScroll: true })');
    expect(body).not.toMatch(/\.focus\(\s*\)/);
  });

  it('still puts the caret right after the changed text', () => {
    expect(body).toContain('const pos = start + value.length;');
    expect(body).toContain('el.setSelectionRange(pos, pos);');
  });
});
