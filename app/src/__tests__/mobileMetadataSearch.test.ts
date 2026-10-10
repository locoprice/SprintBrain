import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve(process.cwd(), 'public/mobile/index.html'), 'utf8');
const source = html.slice(html.indexOf('function assetLabelNames('), html.indexOf('/* Which variant a card shows.'));
const snip = { id: 'en', title: 'Follow up', shortcut: 'foll', body: 'Hello', lang: 'EN', folder_id: 'team', alternative_queries: ['reminder', 'status update'] };
const translated = { ...snip, id: 'it', lang: 'IT', alternative_queries: ['promemoria'] };
const context = {
  allLabels: [{ id: 'parent', name: 'Communication' }, { id: 'child', name: 'Internal', parent_id: 'parent' }],
  snipLabelMap: { en: ['child', 'deleted'] },
  inFolderSubtree: (id: string, folder: string) => folder === 'ALL' || id === folder,
};
const api = runInNewContext(source + ';({groupMatches, assetLabelNames, hiddenSearchMatch})', context) as {
  groupMatches: (group: { variants: typeof snip[] }, query: string, folder: string, lang: string) => boolean;
  assetLabelNames: (id: string, map: Record<string, string[]>, paths: boolean) => string[];
  hiddenSearchMatch: (query: string, visible: string[], labels: string[], keywords: string[]) => string;
};

describe('phone metadata search', () => {
  const group = { variants: [snip, translated] };
  it('finds hidden synonyms and labels while respecting the matching variant’s filters', () => {
    expect(api.groupMatches(group, 'reminder', 'team', 'EN')).toBe(true);
    expect(api.groupMatches(group, 'internal', 'ALL', 'EN')).toBe(true);
    expect(api.groupMatches(group, 'reminder', 'other', 'EN')).toBe(false);
    expect(api.groupMatches(group, 'reminder', 'ALL', 'IT')).toBe(false);
    expect(api.groupMatches(group, 'promemoria', 'ALL', 'IT')).toBe(true);
  });
  it('keeps full label paths in details and drops deleted assignments', () => {
    expect(Array.from(api.assetLabelNames('en', context.snipLabelMap, true))).toEqual(['Communication / Internal']);
    expect(api.hiddenSearchMatch('reminder', ['Follow up'], [], snip.alternative_queries)).toBe('Keyword: reminder');
    expect(api.hiddenSearchMatch('follow', ['Follow up'], ['Follow up'], [])).toBe('');
  });
});
