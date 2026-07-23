import { useEffect } from 'react';

// Reflects the company logo (Settings → Branding) as the dashboard's browser-tab
// favicon, matching the extension toolbar and Sprintbrain.html. When no logo is
// set it shows the SprintBrain brand mark shipped as the static favicon; the mark
// is also restored when the dashboard unmounts (sign-out).

/** The SprintBrain brand mark shipped as the dashboard's static favicon (app/public/icon128.png). */
export const BRAND_FAVICON = '/icon128.png';
const MANAGED_ID = 'sb-dynamic-favicon';

/**
 * Which favicon the tab should show: the company logo when it's a valid https
 * URL, otherwise the brand mark. Pure so it's unit-testable — the DOM swap below
 * runs only in the browser (the test environment is node).
 */
export function resolveFaviconHref(companyLogoUrl: string | null): string {
  return companyLogoUrl && companyLogoUrl.startsWith('https://') ? companyLogoUrl : BRAND_FAVICON;
}

/** Reliable runtime swap: drop any existing icon links and install one we own. */
function applyFavicon(href: string): void {
  const existing = document.getElementById(MANAGED_ID);
  if (existing instanceof HTMLLinkElement && existing.getAttribute('href') === href) return;
  document.querySelectorAll("link[rel~='icon']").forEach((el) => {
    el.parentNode?.removeChild(el);
  });
  const link = document.createElement('link');
  link.id = MANAGED_ID;
  link.setAttribute('rel', 'icon');
  link.setAttribute('href', href);
  document.head.appendChild(link);
}

/**
 * Apply the company-logo favicon while mounted, reacting to logo changes, and
 * restore the brand mark on unmount. Mount once high in the authed tree.
 */
export function useCompanyFavicon(companyLogoUrl: string | null): void {
  useEffect(() => {
    applyFavicon(resolveFaviconHref(companyLogoUrl));
  }, [companyLogoUrl]);

  useEffect(() => {
    return () => applyFavicon(BRAND_FAVICON);
  }, []);
}
