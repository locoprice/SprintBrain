import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { InactiveAssetBanner } from '@/components/shared/InactiveAssetBanner';
import type { InactivityCandidate } from '@/lib/inactivity';

// What the dashboard banner actually renders (INACTIVE-001).
//
// Server rendering works here where it would not for a store-backed component:
// this one takes its items as PROPS, so there is no zustand setState for
// renderToStaticMarkup to miss. `readKept` touches window.localStorage, which
// does not exist under the node environment. It is wrapped, returns {}, and
// that is the correct "nothing snoozed" starting state for these assertions.
//
// The rule itself is covered by inactivity.test.ts against the shared case
// table. What is checked here is the half that only this surface has: which
// controls appear, the noun, and the read-only fallback.

const OLD_NEVER: InactivityCandidate = {
  id: 's1', name: 'Deposit request', trigger: 'deposit',
  lastUsedAt: null, createdAt: '2024-11-02T10:00:00Z',
};
const OLD_USED: InactivityCandidate = {
  id: 's2', name: 'Late checkout', trigger: 'late',
  lastUsedAt: '2026-02-14T09:00:00Z', createdAt: '2024-01-01T10:00:00Z',
};
const FRESH: InactivityCandidate = {
  id: 's3', name: 'Daily greeting', trigger: 'hi',
  lastUsedAt: new Date().toISOString(), createdAt: '2024-01-01T10:00:00Z',
};

const noop = () => {};

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

describe('InactiveAssetBanner', () => {
  it('renders nothing when every asset is in use', () => {
    const html = render(
      <InactiveAssetBanner items={[FRESH]} noun="snippet" months={6} onModify={noop} onDelete={noop} />,
    );
    expect(html).toBe('');
  });

  it('names the oldest asset first and words it as never used', () => {
    const html = render(
      <InactiveAssetBanner
        items={[OLD_USED, OLD_NEVER, FRESH]}
        noun="snippet"
        months={6}
        onModify={noop}
        onDelete={noop}
      />,
    );
    expect(html).toContain('You have never used Deposit request. Added 2 November 2024.');
    expect(html).not.toContain('Late checkout');
  });

  it('offers Delete, Modify and Keep where the section is editable', () => {
    const html = render(
      <InactiveAssetBanner items={[OLD_NEVER]} noun="snippet" months={6} onModify={noop} onDelete={noop} />,
    );
    expect(html).toContain('>Delete<');
    expect(html).toContain('>Modify<');
    expect(html).toContain('>Keep<');
  });

  it('drops Delete and Modify where the section is read-only', () => {
    // The extension popup's shape. Keep still works: it is a local snooze, not
    // a write to the asset.
    const html = render(<InactiveAssetBanner items={[OLD_NEVER]} noun="snippet" months={6} />);
    expect(html).not.toContain('>Delete<');
    expect(html).not.toContain('>Modify<');
    expect(html).toContain('>Keep<');
    expect(html).toContain('Open the dashboard to change it.');
  });

  it('changes only the noun for prompts', () => {
    const html = render(
      <InactiveAssetBanner
        items={[{ ...OLD_NEVER, name: 'Reply to a review' }]}
        noun="prompt"
        months={6}
        onModify={noop}
        onDelete={noop}
      />,
    );
    expect(html).toContain('Unused prompt');
    expect(html).toContain('You have never used Reply to a review.');
    expect(html).not.toContain('Unused snippet');
  });

  it('shows the stepper only when more than one asset is stale', () => {
    const one = render(
      <InactiveAssetBanner items={[OLD_NEVER]} noun="snippet" months={6} onModify={noop} onDelete={noop} />,
    );
    expect(one).not.toContain('Next unused snippet');

    const two = render(
      <InactiveAssetBanner
        items={[OLD_NEVER, OLD_USED]}
        noun="snippet"
        months={6}
        onModify={noop}
        onDelete={noop}
      />,
    );
    expect(two).toContain('Next unused snippet');
    expect(two).toContain('1 of 2');
  });

  it('respects a wider threshold', () => {
    // At 9 months the February date is inside the window, so only the 2024 one
    // is named and the stepper goes away.
    const html = render(
      <InactiveAssetBanner
        items={[OLD_NEVER, OLD_USED]}
        noun="snippet"
        months={9}
        onModify={noop}
        onDelete={noop}
      />,
    );
    expect(html).toContain('Deposit request');
    expect(html).not.toContain('1 of 2');
  });

  it('uses the warning tone, never the danger tone', () => {
    // An unused snippet is a suggestion, not a fault: it must not read like the
    // broken-template badge.
    const html = render(
      <InactiveAssetBanner items={[OLD_NEVER]} noun="snippet" months={6} onModify={noop} onDelete={noop} />,
    );
    expect(html).toContain('bg-warning-bg');
    expect(html).toContain('role="status"');
  });
});
