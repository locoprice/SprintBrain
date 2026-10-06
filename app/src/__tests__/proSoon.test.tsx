import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Locked AI features (lib/proFeatures.ts).
//
// While the Pro plan does not exist, every entry point to a feature that calls
// the AI service is shown dimmed, with a lock and "Available to Pro users
// soon", and cannot start a request. These tests render each locked control
// and check what a person sees and what the control is allowed to reach.
// Server rendering is enough: the live control is not mounted at all while
// locked, so there is no click to simulate, only markup to read.

const { draft, suggestForSnippet } = vi.hoisted(() => ({
  draft: vi.fn(),
  suggestForSnippet: vi.fn(),
}));

vi.mock('@/lib/api/draftApi', () => ({ draftApi: { draft } }));
vi.mock('@/lib/api/labelSuggestApi', () => ({ labelSuggestApi: { suggestForSnippet } }));

import { ProSoonLock } from '@/components/shared/ProSoon';
import { DraftFromTextButton } from '@/components/shared/DraftWithAi';
import { LabelSuggestions } from '@/features/labels/LabelSuggestions';
import { isProFeatureAvailable, PRO_SOON_LABEL, type ProFeature } from '@/lib/proFeatures';

const FEATURES: ProFeature[] = ['ask', 'draft', 'translate', 'labels'];

describe('proFeatures', () => {
  it('uses the words the product promises', () => {
    expect(PRO_SOON_LABEL).toBe('Available to Pro users soon');
  });

  it('keeps every AI feature switched off until the Pro plan exists', () => {
    for (const feature of FEATURES) {
      expect(isProFeatureAvailable(feature), feature).toBe(false);
    }
  });
});

describe('ProSoonLock', () => {
  it('reads the label out for screen readers and shows only the lock', () => {
    const html = renderToStaticMarkup(<ProSoonLock />);
    expect(html).toContain('<svg');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(`<span class="sr-only">${PRO_SOON_LABEL}</span>`);
  });
});

describe('Draft from text, locked', () => {
  const render = (tone?: 'light' | 'dark') =>
    renderToStaticMarkup(
      <DraftFromTextButton kind="snippet" noun="snippet" tone={tone} onDrafted={() => {}} />,
    );

  it('shows the button where it will live, switched off, with the lock', () => {
    const html = render();
    expect(html).toContain('Draft from text');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('cursor-not-allowed');
    expect(html).toContain(PRO_SOON_LABEL);
  });

  it('opens nothing: no paste box, no Write draft button', () => {
    const html = render();
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('Write draft');
    expect(draft).not.toHaveBeenCalled();
  });

  it('keeps the editor drawer palette on the dark tone', () => {
    expect(render('dark')).toContain('border-[#2E2E35]');
  });
});

describe('Suggest labels, locked', () => {
  it('shows the control switched off with the lock and never asks for suggestions', () => {
    const html = renderToStaticMarkup(
      <LabelSuggestions
        draft={{ name: 'Welcome', body: 'Hello and welcome aboard', folderName: null, language: 'EN' }}
        value={[]}
        onChange={() => {}}
      />,
    );
    expect(html).toContain('Suggest labels');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain(PRO_SOON_LABEL);
    expect(suggestForSnippet).not.toHaveBeenCalled();
  });
});
