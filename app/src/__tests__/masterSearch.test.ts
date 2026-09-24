import { describe, expect, it } from 'vitest';
import { searchPlaceholder } from '@/features/search/MasterSearch';

// The one search bar names what it is about to filter (SEARCH-001). The order
// of the two memory cases is the fragile part: a space's own page has to be
// tested before the index, or every space reads "Search Brains…".
describe('searchPlaceholder', () => {
  it('names the section you are in', () => {
    expect(searchPlaceholder('/')).toBe('Search snippets…');
    expect(searchPlaceholder('/prompts')).toBe('Search prompts…');
    expect(searchPlaceholder('/memory')).toBe('Search Brains…');
  });

  it('switches to the items inside a space', () => {
    expect(searchPlaceholder('/memory/abc-123')).toBe('Search this Brain…');
  });

  it('falls back to everything on a page with nothing to filter', () => {
    expect(searchPlaceholder('/analytics')).toBe('Search everything…');
    expect(searchPlaceholder('/settings')).toBe('Search everything…');
    expect(searchPlaceholder('/team')).toBe('Search everything…');
  });
});
