import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Line-break fidelity of the expansion writer — extension/content/content.js
// insertText(). It is the single choke point every expansion path funnels
// through (trigger match, overlay insert, picker, prompt shortcut), so pinning
// it here covers all of them.
//
// Two regressions are pinned, both found in July 2026:
//
// 1. Windows line endings. The body was split on '\n' alone, so every line kept
//    a trailing '\r'. The CR rode into the message as an invisible character,
//    and a blank line — the lone "\r" segment — read as text rather than an
//    empty line, losing its break.
//
// 2. Lexical (WhatsApp Web). It accepts execCommand('insertLineBreak'),
//    RETURNS TRUE, and inserts nothing — so the insertParagraph →
//    insertText('\n') fallbacks never fired and a multi-paragraph snippet
//    landed as one dense block. Verified against a real Lexical editor:
//    "Buenos días Marco:\n\nSoy Valentina 🎉" arrived as
//    "Buenos días Marco:Soy Valentina 🎉". Lexical does honour a text/plain
//    paste, so multi-line bodies are offered to the editor as a paste first,
//    with the per-line path kept for every editor that doesn't claim it.
//
// content.js is a content script (top-level chrome.* calls), so it cannot be
// imported. Slice the real shipping functions out of the source instead and run
// them against a recording document — the same "evaluate the real source"
// stance formulaConditions.test.ts and deletionSync.test.ts take.

type InsertText = (el: unknown, text: string) => void;

interface PasteRecord {
  type: string;
  text: string;
}
interface Recorded {
  cmds: Array<{ cmd: string; value: string | null }>;
  pastes: PasteRecord[];
  inserted: string;
}
interface Options {
  // false → the plain textarea/input branch
  contentEditable?: boolean;
  // the editor calls preventDefault on paste (Lexical does)
  claimsPaste?: boolean;
  // the editor claims the paste but writes nothing (hostile / untrusted-event
  // rejection) — the probe must then fall back to the per-line path
  swallowsPaste?: boolean;
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
const fnSource = [
  'function _ceHost(el) {',
  'function _ceLineInsert(text) {',
  'function _cePasteInsert(el, text) {',
  'function insertText(el, text) {',
]
  .map((sig) => sliceFunction(source, sig))
  .join('\n');

// Runs the real insertText against a stub editor and records everything it asked
// the browser to do: execCommand calls and paste events.
function run(text: string, opts: Options = {}): Recorded {
  const { contentEditable = true, claimsPaste = false, swallowsPaste = false } = opts;
  const cmds: Recorded['cmds'] = [];
  const pastes: PasteRecord[] = [];
  // Text the probe will see. A claimed, non-swallowed paste means the editor
  // wrote the body; a swallowed one leaves the field as it was.
  let fieldText = '';

  const el = {
    isContentEditable: contentEditable,
    tagName: contentEditable ? 'DIV' : 'TEXTAREA',
    getAttribute: (name: string) => (name === 'contenteditable' && contentEditable ? 'true' : null),
    parentElement: null,
    focus: () => {},
    get textContent() {
      return fieldText;
    },
    dispatchEvent: (ev: { type: string; clipboardData: { getData: (t: string) => string } }) => {
      pastes.push({ type: ev.type, text: ev.clipboardData.getData('text/plain') });
      if (!claimsPaste) return true; // not prevented — editor ignored it
      if (!swallowsPaste) fieldText += ev.clipboardData.getData('text/plain');
      return false; // preventDefault → the editor claimed it
    },
  };

  const doc = {
    activeElement: el,
    execCommand: (cmd: string, _ui: boolean, value: string | null) => {
      cmds.push({ cmd, value: value ?? null });
      return true; // Lexical's lie: reports success for commands it drops
    },
  };

  class StubDataTransfer {
    private data: Record<string, string> = {};
    setData(type: string, value: string) {
      this.data[type] = value;
    }
    getData(type: string) {
      return this.data[type] ?? '';
    }
  }
  class StubClipboardEvent {
    type: string;
    clipboardData: StubDataTransfer;
    constructor(type: string, init: { clipboardData: StubDataTransfer }) {
      this.type = type;
      this.clipboardData = init.clipboardData;
    }
  }

  const factory = new Function(
    'document',
    'DataTransfer',
    'ClipboardEvent',
    `${fnSource}\nreturn insertText;`,
  ) as (d: unknown, dt: unknown, ce: unknown) => InsertText;

  factory(doc, StubDataTransfer, StubClipboardEvent)(el, text);

  return { cmds, pastes, inserted: textOf(cmds) };
}

// The text a recorded command sequence actually writes into the field.
function textOf(cmds: Recorded['cmds']): string {
  return cmds.map((c) => (c.cmd === 'insertText' ? (c.value ?? '') : '\n')).join('');
}

const CRLF = 'Hi Marco,\r\n\r\nVilla Casa Azul is free 12-19 Aug.\r\n\r\nBest,\r\nValentina';
const LF = CRLF.replace(/\r\n/g, '\n');

describe('snippet expansion — line-break fidelity', () => {
  it('writes a CRLF body exactly like its LF equivalent (contenteditable)', () => {
    expect(run(CRLF).cmds).toEqual(run(LF).cmds);
  });

  it('keeps every blank line in a CRLF body', () => {
    const { cmds, inserted } = run(CRLF);
    // The leading consume (see the paste route) contributes nothing to the text.
    expect(inserted).toBe(LF);
    const breaks = cmds.filter((c) => c.cmd !== 'insertText').length;
    expect(breaks).toBe((LF.match(/\n/g) ?? []).length);
  });

  it('never emits a carriage return into the field', () => {
    for (const ce of [true, false]) {
      for (const body of [CRLF, 'Alpha\rBeta\r\rDelta', LF]) {
        const { cmds, pastes } = run(body, { contentEditable: ce, claimsPaste: ce });
        expect(cmds.some((c) => (c.value ?? '').includes('\r'))).toBe(false);
        expect(pastes.some((p) => p.text.includes('\r'))).toBe(false);
      }
    }
  });

  it('normalizes CRLF on the plain textarea/input path too', () => {
    expect(run(CRLF, { contentEditable: false }).cmds).toEqual([
      { cmd: 'insertText', value: LF },
    ]);
  });

  it('leaves plain unformatted text untouched', () => {
    const plain = 'Checking availability now, one moment.';
    expect(run(plain).cmds).toEqual([{ cmd: 'insertText', value: plain }]);
    expect(run(plain, { contentEditable: false }).cmds).toEqual([
      { cmd: 'insertText', value: plain },
    ]);
  });

  it('preserves indentation and repeated spaces verbatim', () => {
    const indented = 'Details:\n    - Villa: Casa Azul\n    - Dates:  12-19 Aug';
    expect(run(indented).inserted).toBe(indented);
    expect(run(indented, { contentEditable: false }).cmds).toEqual([
      { cmd: 'insertText', value: indented },
    ]);
  });
});

describe('snippet expansion — editors that own their input model (Lexical)', () => {
  it('offers a multi-line body as a text/plain paste', () => {
    const { pastes } = run(LF, { claimsPaste: true });
    expect(pastes).toEqual([{ type: 'paste', text: LF }]);
  });

  it('consumes the trigger before pasting, so no shortcut fragment survives', () => {
    // A paste event carries no target ranges: Lexical would paste at its own
    // cached caret and leave "::neob" in the field. The empty insertText fires a
    // real beforeinput over the selection deleteChars set, removing it first.
    const { cmds } = run(LF, { claimsPaste: true });
    expect(cmds[0]).toEqual({ cmd: 'insertText', value: '' });
    // and nothing else — the paste carried the body
    expect(cmds).toHaveLength(1);
  });

  it('never routes a single-line body through a paste', () => {
    const { pastes, cmds } = run('Todo confirmado', { claimsPaste: true });
    expect(pastes).toEqual([]);
    expect(cmds).toEqual([{ cmd: 'insertText', value: 'Todo confirmado' }]);
  });

  it('falls back to per-line insertion when the editor ignores the paste', () => {
    const { cmds, inserted } = run(LF, { claimsPaste: false });
    expect(inserted).toBe(LF);
    expect(cmds.filter((c) => c.cmd === 'insertLineBreak').length).toBe(
      (LF.match(/\n/g) ?? []).length,
    );
  });

  it('recovers when the editor claims the paste but writes nothing', () => {
    vi.useFakeTimers();
    try {
      const { cmds } = run(LF, { claimsPaste: true, swallowsPaste: true });
      expect(cmds).toHaveLength(1); // only the trigger consume, so far
      vi.advanceTimersByTime(200); // probe fires, sees an empty field
      expect(textOf(cmds)).toBe(LF);
      expect(cmds.filter((c) => c.cmd === 'insertLineBreak').length).toBe(
        (LF.match(/\n/g) ?? []).length,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
