import { describe, expect, it } from 'vitest';
import {
  idByName,
  idsByName,
  memoryDraftFields,
  parseDraftResponse,
  promptDraftBlocks,
  snippetDraftFields,
  uniqueName,
  uniqueToken,
} from '@/lib/aiDraft';

const FOLDERS = [
  { id: 'f-sales', name: 'Sales' },
  { id: 'f-support', name: 'Support replies' },
];
const LABELS = [
  { id: 'l-urgent', name: 'Urgent' },
  { id: 'l-email', name: 'Email' },
];

describe('parseDraftResponse', () => {
  it('reads a new snippet draft', () => {
    const result = parseDraftResponse('snippet', {
      ok: true,
      kind: 'snippet',
      mode: 'new',
      draft: {
        title: 'Payment terms',
        trigger: 'payment_terms',
        language: 'EN',
        body: 'Hi {formtext: name=CLIENT_NAME}, payment is due within 30 days.',
        folder: 'Sales',
        labels: ['Email'],
      },
      changes: '',
    });
    expect(result?.kind).toBe('snippet');
    expect(result?.mode).toBe('new');
    if (result?.kind !== 'snippet') throw new Error('expected a snippet draft');
    expect(result.draft.body).toContain('{formtext: name=CLIENT_NAME}');
  });

  it('reads an update with its changes sentence', () => {
    const result = parseDraftResponse('memory', {
      ok: true,
      mode: 'update',
      draft: { name: 'Opening hours', summary: 'When the office is open.', body: 'Mon-Fri 9-18', kind: 'fact' },
      changes: 'Added Friday hours.',
    });
    expect(result?.mode).toBe('update');
    expect(result?.changes).toBe('Added Friday hours.');
  });

  it('falls back to a safe language and kind instead of rejecting the draft', () => {
    const snippet = parseDraftResponse('snippet', {
      ok: true, mode: 'new', draft: { title: 'A', trigger: 'a', language: 'DE', body: 'Text', folder: '', labels: [] }, changes: '',
    });
    expect(snippet?.kind === 'snippet' && snippet.draft.language).toBe('EN');
    const memory = parseDraftResponse('memory', {
      ok: true, mode: 'new', draft: { name: 'A', summary: '', body: 'Text', kind: 'document' }, changes: '',
    });
    expect(memory?.kind === 'memory' && memory.draft.kind).toBe('note');
  });

  it('rejects a reply that is not a draft of the kind asked for', () => {
    expect(parseDraftResponse('snippet', { error: 'draft_empty' })).toBeNull();
    expect(parseDraftResponse('snippet', { ok: true, mode: 'new', draft: { title: '', body: '' }, changes: '' })).toBeNull();
    expect(parseDraftResponse('prompt', { ok: true, mode: 'new', draft: { title: 'Snippet shape', body: 'x' }, changes: '' })).toBeNull();
  });
});

describe('uniqueToken', () => {
  it('keeps a free token and numbers a taken one', () => {
    expect(uniqueToken('welcome', ['intro'])).toBe('welcome');
    expect(uniqueToken('welcome', ['Welcome'])).toBe('welcome_2');
    expect(uniqueToken('welcome', ['welcome', 'welcome_2'])).toBe('welcome_3');
  });

  it('cleans what the model wrote into a token the editor accepts', () => {
    expect(uniqueToken('Payment Terms!', [])).toBe('payment_terms');
    expect(uniqueToken('', [])).toBe('');
  });

  it('stays within 60 characters when a suffix is added', () => {
    const long = 'a'.repeat(60);
    const token = uniqueToken(long, [long]);
    expect(token).toHaveLength(60);
    expect(token.endsWith('_2')).toBe(true);
  });
});

describe('uniqueName', () => {
  it('numbers a taken Brain item name, ignoring case', () => {
    expect(uniqueName('Opening hours', ['opening hours'])).toBe('Opening hours (2)');
    expect(uniqueName('Opening hours', ['Opening hours', 'Opening hours (2)'])).toBe('Opening hours (3)');
    expect(uniqueName('Price list', ['Opening hours'])).toBe('Price list');
  });

  it('stays within the 64-character limit', () => {
    const long = 'n'.repeat(64);
    expect(uniqueName(long, [long])).toHaveLength(64);
  });
});

describe('folder and label names', () => {
  it('maps the names the draft chose to ids, ignoring case and unknown names', () => {
    expect(idByName('sales', FOLDERS)).toBe('f-sales');
    expect(idByName('Marketing', FOLDERS)).toBeNull();
    expect(idByName('', FOLDERS)).toBeNull();
    expect(idsByName(['email', 'Nope', 'Email'], LABELS)).toEqual(['l-email']);
  });
});

describe('snippetDraftFields', () => {
  it('fills the editor and never reuses a trigger', () => {
    const fields = snippetDraftFields(
      { title: 'Payment terms', trigger: 'terms', language: 'IT', body: 'Body', folder: 'Support replies', labels: ['Urgent'] },
      { folders: FOLDERS, labels: LABELS, takenTriggers: ['terms'] },
    );
    expect(fields).toEqual({
      name: 'Payment terms',
      trigger: 'terms_2',
      content: 'Body',
      language: 'IT',
      folderId: 'f-support',
      labelIds: ['l-urgent'],
    });
  });

  it('derives the trigger from the title when the draft has none', () => {
    const fields = snippetDraftFields(
      { title: 'Follow-up call', trigger: '', language: 'EN', body: 'Body', folder: '', labels: [] },
      { folders: FOLDERS, labels: LABELS, takenTriggers: [] },
    );
    expect(fields.trigger).toBe('follow-up_call');
    expect(fields.folderId).toBeNull();
  });
});

describe('promptDraftBlocks', () => {
  it('keeps Role and Objective on and switches on only the optional blocks that were written', () => {
    const blocks = promptDraftBlocks({
      name: 'Review a draft', shortcut: '', role: 'You are an editor.', objective: 'Review [text to review].',
      context: '', examples: '', constraints: 'Keep it short.', folder: '', labels: [],
    });
    expect(blocks.map((b) => [b.type, b.enabled])).toEqual([
      ['role', true], ['objective', true], ['context', false], ['examples', false], ['constraints', true],
    ]);
  });
});

describe('memoryDraftFields', () => {
  it('keeps the body as drafted and makes the name unique', () => {
    expect(memoryDraftFields({ name: 'Notes', summary: 'S', body: 'Exactly as pasted', kind: 'note' }, ['notes'])).toEqual({
      name: 'Notes (2)', summary: 'S', body: 'Exactly as pasted', kind: 'note',
    });
  });
});
