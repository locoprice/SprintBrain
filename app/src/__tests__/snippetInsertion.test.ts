import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Line-break fidelity of the expansion writer — extension/content/content.js
// insertText(). It is the single choke point every expansion path funnels
// through (trigger match, overlay insert, picker, prompt shortcut), so pinning
// it here covers all of them.
//
// Three regressions are pinned, two found in July 2026 and one in September:
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
// 3. Lexical again. It keeps a native edit only when the edit changes a text
//    node it already has. A trigger that is a whole text node (the start of a
//    message, a new line, right after bold text) was removed by the browser as
//    a node and Lexical put it back: a one-line snippet did not expand at all,
//    and a longer one landed after the trigger. On a Lexical host the trigger
//    now goes through a beforeinput the editor claims, and every body, one line
//    or many, is offered as a paste.
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
interface InputRecord {
  type: string;
  inputType: string;
  data: string | null;
  ranges: unknown[];
}
interface Recorded {
  cmds: Array<{ cmd: string; value: string | null }>;
  pastes: PasteRecord[];
  inputs: InputRecord[];
  // every command and event, in the order the browser was asked for them
  order: string[];
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
  // the host is a Lexical root (data-lexical-editor="true"), as in WhatsApp Web
  lexical?: boolean;
  // the editor claims the beforeinput that removes the trigger; false models a
  // build that ignores it
  claimsDeletion?: boolean;
  // nothing is selected: a right-click insert at a bare caret
  collapsed?: boolean;
}
interface DispatchedEvent {
  type: string;
  inputType?: string;
  data?: string | null;
  targetRanges?: Array<{ init: unknown }>;
  clipboardData?: { getData: (t: string) => string };
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
  'function _isLexicalHost(host) {',
  'function _ceCaretCharOffset(host, fromStart) {',
  'function _ceWaitFor(test, ms, cb) {',
  'function _ceSendDelete(host, range) {',
  'function _ceRetryDelete(host, startCO, endCO, gone, end) {',
  'function _ceDeleteSelection(host, done) {',
  'function _ceLineInsert(text) {',
  'function _cePasteInsert(el, text) {',
  'function _cePasteLand(el, host, dt, text) {',
  'function insertText(el, text) {',
]
  .map((sig) => sliceFunction(source, sig))
  .join('\n');
// The verify and settle windows the confirmed delete reads are plain top-level
// vars in content.js, so they are lifted out the same way. This recording stub
// has no real selection offsets, so the confirmation steps aside here and the
// paste stays synchronous; the check itself is pinned by scripts/check-expansion.js.
const lexicalTimings = (source.match(/^var LEXICAL_[A-Z_]+ = \d+;/gm) ?? []).join('\n');

// Runs the real insertText against a stub editor and records everything it asked
// the browser to do: execCommand calls, beforeinput events and paste events.
function run(text: string, opts: Options = {}): Recorded {
  const {
    contentEditable = true,
    claimsPaste = false,
    swallowsPaste = false,
    lexical = false,
    claimsDeletion = true,
    collapsed = false,
  } = opts;
  const cmds: Recorded['cmds'] = [];
  const pastes: PasteRecord[] = [];
  const inputs: InputRecord[] = [];
  const order: string[] = [];
  // Text the probe will see. A claimed, non-swallowed paste means the editor
  // wrote the body; a swallowed one leaves the field as it was.
  let fieldText = '';

  const el = {
    isContentEditable: contentEditable,
    tagName: contentEditable ? 'DIV' : 'TEXTAREA',
    getAttribute: (name: string) => {
      if (name === 'contenteditable') return contentEditable ? 'true' : null;
      if (name === 'data-lexical-editor') return lexical ? 'true' : null;
      return null;
    },
    parentElement: null,
    focus: () => {},
    get textContent() {
      return fieldText;
    },
    dispatchEvent: (ev: DispatchedEvent) => {
      order.push(ev.type);
      if (ev.type === 'beforeinput') {
        inputs.push({
          type: ev.type,
          inputType: ev.inputType ?? '',
          data: ev.data ?? null,
          ranges: (ev.targetRanges ?? []).map((r) => r.init),
        });
        return !claimsDeletion; // false: preventDefault, the editor claimed it
      }
      const pasted = ev.clipboardData ? ev.clipboardData.getData('text/plain') : '';
      pastes.push({ type: ev.type, text: pasted });
      if (!claimsPaste) return true; // not prevented: the editor ignored it
      if (!swallowsPaste) fieldText += pasted;
      return false; // preventDefault → the editor claimed it
    },
  };

  const doc = {
    activeElement: el,
    execCommand: (cmd: string, _ui: boolean, value: string | null) => {
      order.push('execCommand:' + cmd);
      cmds.push({ cmd, value: value ?? null });
      return true; // Lexical's lie: reports success for commands it drops
    },
  };

  // The selection deleteChars set over the trigger (or a bare caret).
  const range = {
    collapsed,
    startContainer: 'trigger-start',
    startOffset: 0,
    endContainer: 'trigger-end',
    endOffset: 6,
  };
  const win = { getSelection: () => ({ rangeCount: 1, getRangeAt: () => range }) };
  class StubStaticRange {
    init: unknown;
    constructor(init: unknown) {
      this.init = init;
    }
  }
  class StubInputEvent {
    type: string;
    inputType: string;
    data: string | null;
    targetRanges: StubStaticRange[];
    constructor(
      type: string,
      init: { inputType: string; data: string | null; targetRanges: StubStaticRange[] },
    ) {
      this.type = type;
      this.inputType = init.inputType;
      this.data = init.data;
      this.targetRanges = init.targetRanges;
    }
  }

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

  // insertText also asks whether the snippet is opening a sentence, which needs
  // a live caret this recording stub deliberately does not have. Answer no, so
  // what is pinned here stays line-break fidelity alone. The auto-capitalization
  // rules are pinned against the same shipping source in
  // snippetAutoCapitalize.test.ts.
  const factory = new Function(
    'document',
    'DataTransfer',
    'ClipboardEvent',
    '_shouldAutoCap',
    'window',
    'InputEvent',
    'StaticRange',
    `${lexicalTimings}\n${fnSource}\nreturn insertText;`,
  ) as (
    d: unknown,
    dt: unknown,
    ce: unknown,
    cap: () => boolean,
    w: unknown,
    ie: unknown,
    sr: unknown,
  ) => InsertText;

  factory(
    doc,
    StubDataTransfer,
    StubClipboardEvent,
    () => false,
    win,
    StubInputEvent,
    StubStaticRange,
  )(el, text);

  return { cmds, pastes, inputs, order, inserted: textOf(cmds) };
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

describe('snippet expansion: editors that claim a paste', () => {
  it('offers a multi-line body as a text/plain paste', () => {
    const { pastes } = run(LF, { claimsPaste: true });
    expect(pastes).toEqual([{ type: 'paste', text: LF }]);
  });

  it('consumes the trigger before pasting, so no shortcut fragment survives', () => {
    // A paste event carries no target ranges: the editor would paste at its own
    // cached caret and leave "::neob" in the field. Outside Lexical, an empty
    // execCommand('insertText') over the selection deleteChars set removes it.
    const { cmds } = run(LF, { claimsPaste: true });
    expect(cmds[0]).toEqual({ cmd: 'insertText', value: '' });
    // and nothing else: the paste carried the body
    expect(cmds).toHaveLength(1);
  });

  it('keeps a single-line body off the paste route outside Lexical', () => {
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

describe('snippet expansion: Lexical (WhatsApp Web)', () => {
  const lexical = { lexical: true, claimsPaste: true };
  const TRIGGER = { startContainer: 'trigger-start', startOffset: 0, endContainer: 'trigger-end', endOffset: 6 };

  it('offers a single-line body as a paste too', () => {
    const { pastes, cmds } = run('Todo confirmado', lexical);
    expect(pastes).toEqual([{ type: 'paste', text: 'Todo confirmado' }]);
    expect(cmds).toEqual([]);
  });

  it('removes the trigger through a beforeinput the editor claims, then pastes', () => {
    for (const body of ['Todo confirmado', LF]) {
      const { inputs, order } = run(body, lexical);
      expect(inputs).toEqual([
        { type: 'beforeinput', inputType: 'insertText', data: '', ranges: [TRIGGER] },
      ]);
      // No native edit: Lexical undoes one over a whole text node.
      expect(order).toEqual(['beforeinput', 'paste']);
    }
  });

  it('falls back to execCommand when the editor does not claim the removal', () => {
    const { inputs, order } = run(LF, { ...lexical, claimsDeletion: false });
    expect(inputs).toHaveLength(1);
    expect(order).toEqual(['beforeinput', 'execCommand:insertText', 'paste']);
  });

  it('has nothing to remove at a bare caret (right-click insert)', () => {
    const { inputs, pastes } = run('Todo confirmado', { ...lexical, collapsed: true });
    expect(inputs).toEqual([]);
    expect(pastes).toEqual([{ type: 'paste', text: 'Todo confirmado' }]);
  });

  it('falls back to per-line insertion when the editor ignores the paste', () => {
    const { inserted } = run('Todo confirmado', { lexical: true, claimsPaste: false });
    expect(inserted).toBe('Todo confirmado');
  });
});

describe('snippet expansion: a trigger at the start of a new line', () => {
  // A trigger typed after a line break sits in its own text node, after the
  // <br>. Its start offset falls exactly between two text nodes, and resolving
  // it to the end of the first made the range take the <br> as well: the
  // form-field window and the fill-in box replaced the line break, and Undo
  // removed it.
  type Point = { node: unknown; offset: number };
  const toPoint = new Function(
    'document',
    'NodeFilter',
    `${sliceFunction(source, 'function _ceCharOffsetToPoint(')}\nreturn _ceCharOffsetToPoint;`,
  )(
    {
      createTreeWalker: (root: { childNodes: unknown[] }) => {
        let i = -1;
        return { nextNode: () => root.childNodes[++i] ?? null };
      },
    },
    { SHOW_TEXT: 4 },
  ) as (host: unknown, target: number, atStart?: boolean) => Point;

  const nodes = [{ nodeValue: 'Line A' }, { nodeValue: '::fld' }];
  const host = { childNodes: nodes };

  it('starts a range at the text after the boundary', () => {
    expect(toPoint(host, 6, true)).toEqual({ node: nodes[1], offset: 0 });
  });

  it('still ends a range at the text before the boundary', () => {
    expect(toPoint(host, 6)).toEqual({ node: nodes[0], offset: 6 });
  });

  it('resolves an offset inside a text node the same either way', () => {
    expect(toPoint(host, 8, true)).toEqual({ node: nodes[1], offset: 2 });
    expect(toPoint(host, 8)).toEqual({ node: nodes[1], offset: 2 });
  });

  it('keeps a start at the very end on the last text node', () => {
    expect(toPoint(host, 11, true)).toEqual({ node: nodes[1], offset: 5 });
  });
});

describe('Undo after a contenteditable insert', () => {
  // Undo deletes [endCharOffset - visibleLen, endCharOffset), counted in text
  // characters from the start of the field. A field styled white-space:
  // pre-wrap takes each line break as a "\n" character, and those offsets count
  // it: a length read off the text alone left one character of the snippet
  // behind per line break ("Hi ::multi" undid to "Hi Li").
  interface Marked {
    syncInserted?: boolean;
    visibleLen?: number;
    endCharOffset?: number;
  }
  type Mark = (snapshot: Marked, el: unknown, startCO: number, text: string) => void;
  const markWith = new Function(
    '_ceCaretCharOffset',
    [
      sliceFunction(source, 'function _ceHost(el) {'),
      sliceFunction(source, 'function _isLexicalHost(host) {'),
      sliceFunction(source, 'function _markSyncInserted('),
      'return _markSyncInserted;',
    ].join('\n'),
  ) as (caretCharOffset: () => number) => Mark;

  // field: the field's text once insertText has returned. caret: where its live
  // caret stands then. startCO: where the insert began.
  function mark(
    opts: { field: string; caret: number; startCO?: number; lexical?: boolean },
    text: string,
  ): Marked {
    const el = {
      getAttribute: (name: string) => {
        if (name === 'contenteditable') return 'true';
        if (name === 'data-lexical-editor') return opts.lexical ? 'true' : null;
        return null;
      },
      parentElement: null,
      textContent: opts.field,
    };
    const snapshot: Marked = {};
    markWith(() => opts.caret)(snapshot, el, opts.startCO ?? 3, text);
    return snapshot;
  }
  const region = (s: Marked) => [(s.endCharOffset ?? 0) - (s.visibleLen ?? 0), s.endCharOffset];

  const BODY = 'Line one\n\nLine two'; // 16 characters of text, 2 line breaks

  it('covers the line breaks a pre-wrap field wrote as characters', () => {
    // "Hi " and then the body with its two "\n": the caret ends at 3 + 18.
    expect(region(mark({ field: 'Hi Line one\n\nLine two', caret: 21 }, BODY))).toEqual([3, 21]);
  });

  it('reads nothing after the caret', () => {
    const field = 'Hi Line one\n\nLine two\nand the rest';
    expect(region(mark({ field, caret: 21 }, BODY))).toEqual([3, 21]);
  });

  it('covers a field that wrote its line breaks as <br>', () => {
    // A <br> is no character: the field's text runs the lines together.
    expect(region(mark({ field: 'Hi Line oneLine two', caret: 19 }, BODY))).toEqual([3, 19]);
  });

  it('follows the caret to wherever the snippet landed', () => {
    // The trigger sat at 6, after "Line A", and the snippet went in at the
    // start of the field: Undo takes the snippet, not the text after 6.
    const field = 'Line oneLine twoLine A';
    expect(region(mark({ field, caret: 16, startCO: 6 }, BODY))).toEqual([0, 16]);
  });

  it('counts from the start on Lexical, whose paste has not landed yet', () => {
    expect(region(mark({ field: 'Hi ', caret: 3, lexical: true }, BODY))).toEqual([3, 19]);
  });

  it('falls back to the text when the caret is not in the field', () => {
    expect(mark({ field: 'Hi Line one\n\nLine two', caret: -1 }, BODY)).toEqual({
      syncInserted: true,
      visibleLen: 16,
      endCharOffset: -1,
    });
  });
});
