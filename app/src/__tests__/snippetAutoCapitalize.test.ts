import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Contextual auto-capitalization — extension/content/content.js.
//
// A snippet body is authored once and expanded everywhere, so it cannot know
// whether it will land at the start of a message or halfway through a sentence.
// The field knows. insertText reads what sits in front of the caret and lifts
// the opening letter when the snippet is starting a sentence, and only then.
//
// Two halves are pinned here, because getting either wrong is visible in a
// message a guest reads:
//
// 1. WHEN. A stop that is really a decimal ("3.14 ") is not a sentence break,
//    and neither is a comma or a colon. Capitalizing there rewrites the middle
//    of someone's sentence.
//
// 2. WHAT. Only a lowercase letter in the first non-whitespace position is
//    touched. A body opening with a URL, an email, a digit or a bracket is left
//    exactly as authored — "5 items" must not become "5 Items".
//
// The trigger stripping matters as much as the rules. On a textarea the trigger
// is already gone by the time we insert; on a contenteditable it is still there,
// held inside the live selection the insertion is about to replace. Both shapes
// are covered below.
//
// content.js is a content script (top-level chrome.* calls), so it cannot be
// imported. Slice the real shipping helpers out of the source and run them —
// the same stance snippetInsertion.test.ts and formulaConditions.test.ts take.

const SLICE_START = 'var AUTOCAP_LINE_RE';
const SLICE_END = 'function _fieldTriggerSpan(';

const source = readFileSync(
  resolve(process.cwd(), '..', 'extension', 'content', 'content.js'),
  'utf8',
);
const from = source.indexOf(SLICE_START);
const to = source.indexOf(SLICE_END);
if (from === -1 || to <= from) {
  throw new Error(
    `auto-capitalization: slice markers ${JSON.stringify(SLICE_START)} .. ` +
      `${JSON.stringify(SLICE_END)} moved in content.js`,
  );
}

interface Cfg {
  snippetTrigger: string;
  promptTrigger: string;
  autoCapitalize: boolean;
}
type Harness = {
  shouldAutoCap: (before: string | null) => boolean;
  autoCapitalize: (text: string) => string;
  cfg: Cfg;
};

// _autoCapContext reads the caret through _textBeforeCaret and clips its search
// to MAX_BUF; both are supplied so the sliced rules run against a plain string
// instead of a DOM.
function harness(): Harness {
  const cfg: Cfg = { snippetTrigger: '::', promptTrigger: '"""', autoCapitalize: true };
  let before: string | null = '';
  const factory = new Function(
    'triggerCfg',
    'MAX_BUF',
    '_textBeforeCaret',
    `${source.slice(from, to)}\nreturn { _shouldAutoCap: _shouldAutoCap, _autoCapitalize: _autoCapitalize };`,
  ) as (
    c: Cfg,
    m: number,
    r: (el: unknown) => string | null,
  ) => {
    _shouldAutoCap: (el: unknown) => boolean;
    _autoCapitalize: (t: string) => string;
  };
  const api = factory(cfg, 60, () => before);
  return {
    cfg,
    shouldAutoCap: (ctx) => {
      before = ctx;
      return api._shouldAutoCap({});
    },
    autoCapitalize: (t) => api._autoCapitalize(t),
  };
}

// What insertText does: decide from the caret, then transform.
function expand(before: string | null, body: string, h = harness()): string {
  return h.shouldAutoCap(before) ? h.autoCapitalize(body) : body;
}

describe('auto-capitalization — where a sentence opens', () => {
  it('capitalizes at the start of an empty field', () => {
    expect(expand('', 'hello there')).toBe('Hello there');
    expect(expand('   ', 'hello there')).toBe('Hello there');
  });

  it('capitalizes after a full stop, an exclamation and a question mark', () => {
    expect(expand('All set. ', 'thanks again')).toBe('Thanks again');
    expect(expand('Great! ', 'see you tomorrow')).toBe('See you tomorrow');
    expect(expand('Ready? ', 'lets go')).toBe('Lets go');
  });

  it('sees past a closing quote or bracket', () => {
    expect(expand('He said "go." ', 'then we left')).toBe('Then we left');
    expect(expand('(that is all.) ', 'moving on')).toBe('Moving on');
  });

  it('capitalizes at the start of a new line', () => {
    expect(expand('Line one\n', 'second line')).toBe('Second line');
    expect(expand('Line one\n  ', 'second line')).toBe('Second line');
    expect(expand('Done.\n', 'next item')).toBe('Next item');
  });
});

describe('auto-capitalization — where a sentence does not open', () => {
  it('leaves a mid-sentence insertion alone', () => {
    expect(expand('we will ', 'send it today')).toBe('send it today');
    expect(expand('send', 'ing it now')).toBe('ing it now');
  });

  it('does not treat a comma or a colon as a sentence break', () => {
    expect(expand('Hi Ana, ', 'your room is ready')).toBe('your room is ready');
    expect(expand('Note: ', 'arrives late')).toBe('arrives late');
  });

  it('does not treat a decimal point as a sentence break', () => {
    expect(expand('It costs 3.14 ', 'euro in total')).toBe('euro in total');
  });

  it('requires whitespace after the stop', () => {
    expect(expand('end.', 'next')).toBe('next');
  });

  it('changes nothing when the caret cannot be read', () => {
    expect(expand(null, 'hello there')).toBe('hello there');
  });

  it('changes nothing when the toggle is off', () => {
    const h = harness();
    h.cfg.autoCapitalize = false;
    expect(expand('', 'hello there', h)).toBe('hello there');
  });
});

describe('auto-capitalization — what it is allowed to touch', () => {
  it('lifts only the first letter and leaves the rest as authored', () => {
    expect(expand('', 'hello THERE my friend')).toBe('Hello THERE my friend');
  });

  it('leaves text that already opens with a capital', () => {
    expect(expand('', 'Hello there')).toBe('Hello there');
    expect(expand('', 'API keys rotate nightly')).toBe('API keys rotate nightly');
  });

  it('never capitalizes a word that is not the opening character', () => {
    expect(expand('', '5 items sent')).toBe('5 items sent');
    expect(expand('', '(draft only)')).toBe('(draft only)');
  });

  it('leaves a URL or an email exactly as written', () => {
    expect(expand('See. ', 'https://example.com/a')).toBe('https://example.com/a');
    expect(expand('See. ', 'www.example.com')).toBe('www.example.com');
    expect(expand('Write. ', 'ana@example.com')).toBe('ana@example.com');
  });

  it('capitalizes past leading whitespace in the body', () => {
    expect(expand('', '  hello there')).toBe('  Hello there');
  });
});

describe('auto-capitalization — the trigger the user typed', () => {
  it('ignores a trigger still sitting in front of the caret (contenteditable)', () => {
    expect(expand('All set. ::greet', 'hello there')).toBe('Hello there');
    expect(expand('::greet', 'hello there')).toBe('Hello there');
  });

  it('ignores a prompt trigger the same way', () => {
    expect(expand('Done. """ask', 'write a memo')).toBe('Write a memo');
  });

  it('does not strip a trigger sequence typed inside a word', () => {
    expect(expand('sen::d', 'hello there')).toBe('hello there');
  });

  it('does not mistake an earlier "::" in the message for the trigger', () => {
    expect(expand('Note:: something. ', 'thanks again')).toBe('Thanks again');
  });
});
