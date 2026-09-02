import { describe, expect, it } from 'vitest';
import { pickActiveOrg } from '@/lib/activeOrg';
import { isCommitKey, parseEmailList, summarizeInvites } from '@/lib/emailList';
import type { OrganizationSummary } from '@/types/database';

function org(id: string, name: string): OrganizationSummary {
  return { id, name, slug: null, myRole: 'admin', cover: null };
}

const acme = org('org-1', 'Acme Ltd');
const beta = org('org-2', 'Beta Co');

describe('pickActiveOrg', () => {
  it('returns null when the user belongs to no team', () => {
    expect(pickActiveOrg([], null)).toBeNull();
    expect(pickActiveOrg([], 'org-1')).toBeNull();
  });

  it('honours a stored choice that is still valid', () => {
    expect(pickActiveOrg([acme, beta], 'org-2')).toBe(beta);
  });

  it('falls back to the oldest membership when nothing is stored', () => {
    expect(pickActiveOrg([acme, beta], null)).toBe(acme);
  });

  it('falls back when the stored team is gone', () => {
    // Left the team, was removed, or the team was deleted between sessions.
    // Rendering as teamless here would be the naive `find()` result.
    expect(pickActiveOrg([acme, beta], 'org-vanished')).toBe(acme);
  });
});

describe('parseEmailList', () => {
  it('splits on commas, spaces, semicolons, and newlines', () => {
    const { valid } = parseEmailList('a@x.com, b@x.com;c@x.com\nd@x.com e@x.com');
    expect(valid).toEqual(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com']);
  });

  it('unwraps the Name <addr> form every mail client pastes', () => {
    const { valid } = parseEmailList('Marco Rossi <marco@x.com>, "Sara" <sara@x.com>');
    expect(valid).toEqual(['marco@x.com', 'sara@x.com']);
  });

  it('lowercases and deduplicates, keeping first-seen order', () => {
    const { valid } = parseEmailList('B@x.com, a@x.com, b@x.com');
    expect(valid).toEqual(['b@x.com', 'a@x.com']);
  });

  it('reports unreadable tokens instead of dropping them silently', () => {
    const { valid, invalid } = parseEmailList('good@x.com, notanemail, also bad@');
    expect(valid).toEqual(['good@x.com']);
    expect(invalid).toEqual(['notanemail', 'also', 'bad@']);
  });

  it('handles an empty or whitespace-only paste', () => {
    expect(parseEmailList('')).toEqual({ valid: [], invalid: [] });
    expect(parseEmailList('   \n  ')).toEqual({ valid: [], invalid: [] });
  });
});

describe('isCommitKey', () => {
  it('treats separators and Enter/Tab as commit keys', () => {
    for (const k of ['Enter', 'Tab', ',', ';', ' ']) expect(isCommitKey(k)).toBe(true);
  });

  it('leaves ordinary typing alone', () => {
    for (const k of ['a', '@', '.', 'Backspace', 'ArrowLeft']) expect(isCommitKey(k)).toBe(false);
  });
});

describe('summarizeInvites', () => {
  it('names the address on a single success', () => {
    expect(summarizeInvites([{ email: 'a@x.com', ok: true, reason: '' }])).toBe(
      'Invitation sent to a@x.com.',
    );
  });

  it('counts a clean batch', () => {
    expect(
      summarizeInvites([
        { email: 'a@x.com', ok: true, reason: '' },
        { email: 'b@x.com', ok: true, reason: '' },
      ]),
    ).toBe('2 invitations sent.');
  });

  it('reports a partial success as partial, not as failure', () => {
    const text = summarizeInvites([
      { email: 'a@x.com', ok: true, reason: '' },
      { email: 'b@x.com', ok: false, reason: 'is already in your team.' },
    ]);
    expect(text).toContain('Invitation sent to a@x.com.');
    expect(text).toContain('b@x.com was not invited: is already in your team.');
  });

  it('summarizes several failures without listing all of them', () => {
    const text = summarizeInvites([
      { email: 'a@x.com', ok: false, reason: 'is already in your team.' },
      { email: 'b@x.com', ok: false, reason: 'bounced.' },
      { email: 'c@x.com', ok: false, reason: 'bounced.' },
    ]);
    expect(text).toContain('3 were not invited');
    expect(text).toContain('a@x.com');
    expect(text).not.toContain('c@x.com');
  });

  it('returns an empty string for an empty batch', () => {
    expect(summarizeInvites([])).toBe('');
  });
});
