// MEMORY-CAPTURE-001 chunker gate.
//
// extension/shared/memory-chunk.js decides where a long transcript is cut. The
// invariant that actually matters is the last one asserted here: every chunk
// must fit under the memory_shards_body_length CHECK, because a chunk that does
// not fit is not a degraded save, it is a 400 from PostgREST halfway through
// writing a conversation.
//
// Run: node scripts/check-memory-chunk.js

const assert = require('assert');
const chunk = require('../extension/shared/memory-chunk.js');
const capture = require('../extension/content/chat-capture.js');

const MAX = chunk.MAX_BODY;
let failures = 0;

function check(name, fn) {
  try {
    fn();
    console.log('  ok  ' + name);
  } catch (err) {
    failures++;
    console.error('  X   ' + name);
    console.error('      ' + err.message);
  }
}

console.log('chunkBlocks');

check('short input stays one chunk', () => {
  const out = chunk.chunkBlocks(['### You\nhello', '### ChatGPT\nhi']);
  assert.strictEqual(out.chunks.length, 1);
  assert.strictEqual(out.forced, 0);
  assert.ok(out.chunks[0].includes('hello') && out.chunks[0].includes('hi'));
});

check('empty and blank blocks are dropped, not emitted', () => {
  assert.deepStrictEqual(chunk.chunkBlocks([]).chunks, []);
  assert.deepStrictEqual(chunk.chunkBlocks(['', '   ', '\n']).chunks, []);
});

check('a turn is never split when it fits on its own', () => {
  // Two blocks that individually fit but together exceed the cap must land in
  // two chunks, each intact. Splitting mid-turn would attribute half a message
  // to the wrong speaker.
  const a = '### You\n' + 'a'.repeat(MAX - 100);
  const b = '### ChatGPT\n' + 'b'.repeat(MAX - 100);
  const out = chunk.chunkBlocks([a, b]);
  assert.strictEqual(out.chunks.length, 2);
  assert.strictEqual(out.chunks[0], a);
  assert.strictEqual(out.chunks[1], b);
  assert.strictEqual(out.forced, 0);
});

check('packing is greedy, not one chunk per turn', () => {
  const blocks = [];
  for (let i = 0; i < 40; i++) blocks.push('### You\n' + 'x'.repeat(100));
  const out = chunk.chunkBlocks(blocks);
  // 40 turns of ~108 chars each is far under one cap, so it must not fragment.
  assert.strictEqual(out.chunks.length, 1, 'expected one chunk, got ' + out.chunks.length);
});

check('an oversized turn splits on a paragraph boundary, unforced', () => {
  const para = 'p'.repeat(1000);
  const paragraphs = [];
  for (let i = 0; i < 40; i++) paragraphs.push(para);
  const out = chunk.chunkBlocks([paragraphs.join('\n\n')]);
  assert.ok(out.chunks.length > 1, 'expected a split');
  assert.strictEqual(out.forced, 0, 'a paragraph boundary existed, so nothing should be forced');
});

check('an oversized turn with no boundary reports a forced cut', () => {
  // One unbroken run of characters: there is nowhere clean to cut, and the
  // caller is told so rather than losing the structure silently.
  const out = chunk.chunkBlocks(['z'.repeat(MAX * 2 + 500)]);
  assert.ok(out.chunks.length >= 3);
  assert.ok(out.forced > 0, 'expected forced > 0');
});

check('EVERY chunk fits the database cap', () => {
  // The invariant. Anything violating this is a mid-save HTTP 400.
  const cases = [
    ['z'.repeat(MAX * 3)],
    ['a'.repeat(MAX - 1), 'b'.repeat(MAX - 1)],
    Array.from({ length: 200 }, (_, i) => '### You\n' + 'x'.repeat(500 + i)),
    [('para '.repeat(200) + '\n\n').repeat(60)],
  ];
  for (const blocks of cases) {
    const out = chunk.chunkBlocks(blocks);
    for (const c of out.chunks) {
      assert.ok(c.length <= MAX, 'chunk of ' + c.length + ' exceeds cap ' + MAX);
    }
  }
});

check('no content is lost across a split', () => {
  const blocks = Array.from({ length: 300 }, (_, i) => '### You\nmessage ' + i);
  const out = chunk.chunkBlocks(blocks);
  const joined = out.chunks.join('\n\n');
  for (let i = 0; i < 300; i++) {
    assert.ok(joined.includes('message ' + i), 'lost message ' + i);
  }
});

check('chunkText handles plain prose for the document path', () => {
  const out = chunk.chunkText('one\n\ntwo\n\nthree');
  assert.strictEqual(out.chunks.length, 1);
  assert.deepStrictEqual(chunk.chunkText('').chunks, []);
  const big = chunk.chunkText(('para '.repeat(400) + '\n\n').repeat(30));
  for (const c of big.chunks) assert.ok(c.length <= MAX);
});

console.log('capture names (extension Save to Brain, chat capture, phone Save to Brain)');

// Built from parts so the expectation holds on any machine's clock: the rule
// writes the saver's local time, and so does this Date.
const SAVED = new Date(2026, 9, 2, 14, 30, 5);
const STAMP = '2026-10-02 14:30:05';

check('a capture is named after its source, then the moment it was saved', () => {
  assert.strictEqual(chunk.captureName('Pasta at home', SAVED, 1, 1), 'Pasta at home · ' + STAMP);
});

check('the title is cut, never the moment or the part', () => {
  const title = 'A remarkably long page title that keeps going well past the room for it';
  const one = chunk.captureName(title, SAVED, 1, 1);
  assert.ok(one.length <= 64, 'name of ' + one.length + ' chars');
  assert.ok(one.endsWith(' · ' + STAMP), one);
  assert.strictEqual(one, title.slice(0, 40).trim() + ' · ' + STAMP);
  for (const [part, parts] of [[3, 9], [12, 120], [999, 999]]) {
    const name = chunk.captureName(title, SAVED, part, parts);
    assert.ok(name.length <= 64, 'name of ' + name.length + ' chars: ' + name);
    assert.ok(name.endsWith(' · ' + STAMP + ' (' + part + '/' + parts + ')'), name);
  }
});

check('one piece carries no part number', () => {
  assert.ok(!/\(1\/1\)/.test(chunk.captureName('Note', SAVED, 1, 1)));
});

check('saves a second apart get different names', () => {
  const later = new Date(SAVED.getTime() + 1000);
  assert.notStrictEqual(chunk.captureName('Same page', SAVED, 1, 1), chunk.captureName('Same page', later, 1, 1));
});

check('a title of only spaces, or none, still makes a name', () => {
  assert.strictEqual(chunk.captureName('  \n ', SAVED, 1, 1), 'Untitled · ' + STAMP);
  assert.strictEqual(chunk.captureName(null, SAVED, 1, 1), 'Untitled · ' + STAMP);
});

check('the title is read as one line', () => {
  assert.strictEqual(chunk.captureName('Two\n  lines', SAVED, 1, 1), 'Two lines · ' + STAMP);
});

check('the summary is the text itself, on one line, within the column', () => {
  assert.strictEqual(chunk.captureSummary('First line\n\n  second   line'), 'First line second line');
  assert.strictEqual(chunk.captureSummary('w '.repeat(500)).length, 280);
  assert.strictEqual(chunk.captureSummary(''), '');
});

console.log('chat-capture');

check('only the two verified hosts are recognised', () => {
  assert.ok(capture.hostConfig('chatgpt.com'), 'chatgpt.com should match');
  assert.ok(capture.hostConfig('chat.openai.com'), 'chat.openai.com should match');
  assert.ok(capture.hostConfig('claude.ai'), 'claude.ai should match');
  // Guessing at a host whose DOM was never read produces plausible garbage.
  assert.strictEqual(capture.hostConfig('gemini.google.com'), null);
  assert.strictEqual(capture.hostConfig('example.com'), null);
  // Must not match a lookalike domain.
  assert.strictEqual(capture.hostConfig('notchatgpt.com'), null);
});

check('toBlocks labels each turn with its speaker', () => {
  const blocks = capture.toBlocks({
    host: 'ChatGPT',
    turns: [
      { role: 'user', text: 'question' },
      { role: 'assistant', text: 'answer' },
    ],
  });
  assert.deepStrictEqual(blocks, ['### You\nquestion', '### ChatGPT\nanswer']);
});

check('toBlocks is safe on empty input', () => {
  assert.deepStrictEqual(capture.toBlocks(null), []);
  assert.deepStrictEqual(capture.toBlocks({ turns: [] }), []);
});

console.log('document upload (MEMORY-002 D1)');

// The dashboard's upload loads this same file at runtime rather than carrying a
// splitter of its own, so the cases below are the document path, not a second
// implementation of it. What the pieces are CALLED lives in the dashboard
// (app/src/lib/documentImport.ts) and is covered by documentImport.test.ts.

check('a document is cut on its paragraphs, and every piece fits the column', () => {
  // A long contract: many paragraphs, none of them oversized on its own.
  const clause = 'Clause text that runs on for a while and says something binding. ';
  const doc = Array.from({ length: 400 }, (_, i) => 'Article ' + i + '\n' + clause.repeat(8)).join('\n\n');
  const out = chunk.chunkText(doc);
  assert.ok(out.chunks.length > 1, 'a long document should not come back as one piece');
  assert.strictEqual(out.forced, 0, 'paragraph boundaries were available, so nothing should be forced');
  for (const piece of out.chunks) assert.ok(piece.length <= MAX);
  // Nothing is lost between the pieces: every article still appears once.
  const joined = out.chunks.join('\n\n');
  assert.ok(joined.includes('Article 0') && joined.includes('Article 399'));
});

check('a PDF that extracts as one unbroken block is still cut, and says so', () => {
  // Some PDFs carry no paragraph breaks at all once the text is pulled out.
  const wall = 'word '.repeat(12000);
  const out = chunk.chunkText(wall);
  assert.ok(out.chunks.length > 1);
  for (const piece of out.chunks) assert.ok(piece.length <= MAX);
  assert.ok(out.forced > 0, 'a wall of text has to be cut mid-paragraph, and that is reported');
});

check('a short file stays a single piece', () => {
  const out = chunk.chunkText('Cancellation is free up to 48 hours before the agreed date.');
  assert.strictEqual(out.chunks.length, 1);
  assert.strictEqual(out.forced, 0);
});

check('a file whose text is only whitespace produces nothing to import', () => {
  assert.deepStrictEqual(chunk.chunkText('   \n\n  \t ').chunks, []);
  assert.deepStrictEqual(chunk.chunkText('').chunks, []);
});

if (failures > 0) {
  console.error('\nX Memory chunk check FAILED: ' + failures + ' case(s).');
  process.exit(1);
}
console.log('\nOK Memory chunk + capture checks passed');
