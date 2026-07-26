import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Line-break fidelity of the expansion writer — extension/content/content.js
// insertText(). It is the single choke point every expansion path funnels
// through (trigger match, overlay insert, picker, prompt shortcut), so pinning
// it here covers all of them.
//
// Regression (July 2026): a body carrying Windows line endings was split on
// '\n' alone, so every line kept a trailing '\r'. The CR rode into the message
// as an invisible character, and a blank line — the lone "\r" segment — was
// treated as non-empty text instead of an empty one, losing its break. Verified
// in Chrome before the fix: "Line one\r\nLine two\r\n\r\nLine four" landed in a
// contenteditable as "Line one\nLine two\nLine four" — the paragraph break gone.
//
// content.js is a content script (top-level chrome.* calls), so it cannot be
// imported. Slice the real shipping function out of the source instead and run
// it against a recording document — the same "evaluate the real source" stance
// formulaConditions.test.ts and deletionSync.test.ts take.

type InsertText = (el: unknown, text: string) => void;
interface Recorded {
  cmds: Array<{ cmd: string; value: string | null }>;
  inserted: string;
}

function sliceFunction(src: string, signature: string): string {
  const start = src.indexOf(signature);
  if (start === -1) throw new Error(`insertText: "${signature}" not found in content.js`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('insertText: unbalanced braces while slicing');
}

const source = readFileSync(
  resolve(process.cwd(), '..', 'extension', 'content', 'content.js'),
  'utf8',
);
const fnSource = sliceFunction(source, 'function insertText(el, text) {');

// Runs the real insertText against a stub target and records what it asked the
// browser to write. `contentEditable` picks the rich-text branch (Gmail, Slack,
// WhatsApp Web); the other branch is the plain textarea/input path.
function run(text: string, contentEditable: boolean): Recorded {
  const cmds: Recorded['cmds'] = [];
  const el = {
    isContentEditable: contentEditable,
    tagName: contentEditable ? 'DIV' : 'TEXTAREA',
    getAttribute: () => null,
    focus: () => {},
  };
  const doc = {
    activeElement: el,
    execCommand: (cmd: string, _ui: boolean, value: string | null) => {
      cmds.push({ cmd, value: value ?? null });
      return true;
    },
  };
  const factory = new Function('document', `return (${fnSource});`) as (
    d: typeof doc,
  ) => InsertText;
  factory(doc)(el, text);

  const inserted = cmds
    .map((c) => (c.cmd === 'insertText' ? (c.value ?? '') : '\n'))
    .join('');
  return { cmds, inserted };
}

const CRLF = 'Hi Marco,\r\n\r\nVilla Casa Azul is free 12-19 Aug.\r\n\r\nBest,\r\nValentina';
const LF = CRLF.replace(/\r\n/g, '\n');

describe('snippet expansion — line-break fidelity', () => {
  it('writes a CRLF body exactly like its LF equivalent (contenteditable)', () => {
    expect(run(CRLF, true).cmds).toEqual(run(LF, true).cmds);
  });

  it('keeps every blank line in a CRLF body', () => {
    const { cmds, inserted } = run(CRLF, true);
    expect(inserted).toBe(LF);
    // One break command per newline — blank lines included.
    const breaks = cmds.filter((c) => c.cmd !== 'insertText').length;
    expect(breaks).toBe((LF.match(/\n/g) ?? []).length);
  });

  it('never emits a carriage return into the field', () => {
    for (const ce of [true, false]) {
      for (const body of [CRLF, 'Alpha\rBeta\r\rDelta', LF]) {
        expect(run(body, ce).cmds.some((c) => (c.value ?? '').includes('\r'))).toBe(false);
      }
    }
  });

  it('normalizes CRLF on the plain textarea/input path too', () => {
    expect(run(CRLF, false).cmds).toEqual([{ cmd: 'insertText', value: LF }]);
  });

  it('leaves plain unformatted text untouched', () => {
    const plain = 'Checking availability now, one moment.';
    expect(run(plain, true).cmds).toEqual([{ cmd: 'insertText', value: plain }]);
    expect(run(plain, false).cmds).toEqual([{ cmd: 'insertText', value: plain }]);
  });

  it('preserves indentation and repeated spaces verbatim', () => {
    const indented = 'Details:\n    - Villa: Casa Azul\n    - Dates:  12-19 Aug';
    expect(run(indented, true).inserted).toBe(indented);
    expect(run(indented, false).cmds).toEqual([{ cmd: 'insertText', value: indented }]);
  });
});
