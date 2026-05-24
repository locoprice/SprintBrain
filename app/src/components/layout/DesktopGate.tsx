import { useEffect } from 'react';

// Rendered for any viewport below 1024px. Immediately redirects to /mobile/.
// Returns null to avoid a flash of content before the effect fires.
export function DesktopGate() {
  useEffect(() => {
    window.location.replace('/mobile/');
  }, []);

  return null;
}
