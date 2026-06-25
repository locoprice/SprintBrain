// ─────────────────────────────────────────────────────────────────
// build-parity-harness.js
//
// Generates `parity-validation.html` (repo root) from the extension popup
// (extension/popup/popup.html) so the SHARED business-logic core can be
// exercised in a plain browser tab against Supabase + the chrome-shim.
//
// WHY a generator instead of a hand-written file:
//   • Byte-identical markup → zero transcription discrepancy with the popup
//     (the whole point of a PARITY harness).
//   • Re-runnable: when popup.html changes, regenerate and parity is restored.
//   • Self-documenting: the transforms below are the complete, auditable list
//     of how the web surface diverges from the popup — all presentation-only.
//
// This harness is TEMPORARY scaffolding for parity validation. The permanent
// dashboard (Sprintbrain.html) will be redesigned natively on the same shared
// core once parity is confirmed.
//
// Usage:  node scripts/build-parity-harness.js
// ─────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'extension', 'popup', 'popup.html');
const OUT = path.join(ROOT, 'parity-validation.html');

function fail(msg) {
  console.error('X build-parity-harness: ' + msg);
  process.exit(1);
}

// Apply a single string replacement and assert the anchor existed, so the
// generator fails loudly if popup.html drifts instead of emitting a broken file.
function replaceOnce(html, find, replace, label) {
  if (html.indexOf(find) === -1) fail('anchor not found (' + label + '): ' + find);
  return html.replace(find, replace);
}

let html = fs.readFileSync(SRC, 'utf8');

// 1) Rewrite popup-relative asset paths to be relative to the repo root
//    (where parity-validation.html lives).
html = replaceOnce(html,
  'href="../shared/tokens/colors_and_type.css"',
  'href="extension/shared/tokens/colors_and_type.css"',
  'design tokens css');

html = replaceOnce(html,
  '<script src="../services/notion-sync/notion-sync.js"></script>',
  '<script src="extension/services/notion-sync/notion-sync.js"></script>',
  'notion-sync src');

html = replaceOnce(html,
  '<script src="sync-deletion.js"></script>',
  '<script src="extension/popup/sync-deletion.js"></script>',
  'sync-deletion src');

html = replaceOnce(html,
  '<script src="popup.js"></script>',
  '<script src="extension/popup/popup.js"></script>',
  'popup.js src');

// 2) Install the chrome shim + manifest metadata BEFORE the first shared script
//    (auth.js). The shim must exist before any chrome.* call runs.
const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json'), 'utf8')
);
const headInject =
  '<!-- ═══ WEB SHIM (parity harness) — chrome.* polyfill + manifest meta ═══ -->\n' +
  '<script>window.__SB_MANIFEST__ = ' +
  JSON.stringify({ name: 'SprintBrain', version: manifest.version, manifest_version: 3 }) +
  ';</script>\n' +
  '<script src="extension/shared/chrome-shim.js"></script>\n' +
  '<script src="extension/auth/auth.js"></script>';

html = replaceOnce(html,
  '<script src="../auth/auth.js"></script>',
  headInject,
  'auth.js src (shim injection point)');

// 3) Presentation-only overrides: center the 600px popup as a card on a full
//    page, and a clear "temporary harness" banner. No business logic touched.
const styleOverride =
  '<style id="sb-parity-overrides">\n' +
  '  html { width: auto; min-height: 100vh; background: #e9ebf2; }\n' +
  '  body { margin: 28px auto; box-shadow: 0 12px 50px rgba(0,0,0,.16); border-radius: 12px; overflow: hidden; }\n' +
  '  #sb-parity-flag {\n' +
  '    position: fixed; top: 10px; right: 12px; z-index: 2147483647;\n' +
  '    font: 600 11px/1.4 -apple-system, Segoe UI, sans-serif; color: #7a2e00;\n' +
  '    background: #ffe8cc; border: 1px solid #ffc999; border-radius: 999px;\n' +
  '    padding: 4px 11px; pointer-events: none; letter-spacing: .02em;\n' +
  '  }\n' +
  '</style>\n' +
  '</head>';
html = replaceOnce(html, '</head>', styleOverride, 'head close');

// 4) Trailing script: default the auth gate to the email-OTP path (the SSO
//    pane needs a background service-worker handoff that the web has no access
//    to). Runs as a macrotask, after the popup's synchronous auth init, then
//    flips to OTP via the popup's own existing toggle button — no logic fork.
const bodyInject =
  '<div id="sb-parity-flag">PARITY HARNESS · temporary</div>\n' +
  '<script>\n' +
  '  // Web surface has no SSO handoff → default to the OTP path using the\n' +
  '  // popup\'s own "Use email code instead" control. Presentation-only.\n' +
  '  setTimeout(function () {\n' +
  '    var b = document.getElementById("sb-auth-show-otp");\n' +
  '    if (b) b.click();\n' +
  '  }, 0);\n' +
  '</script>\n' +
  '</body>';
html = replaceOnce(html, '</body>', bodyInject, 'body close');

// 5) Header banner comment for anyone opening the generated file directly.
const banner =
  '<!--\n' +
  '  GENERATED FILE — do not edit by hand.\n' +
  '  Source: extension/popup/popup.html  ·  Generator: scripts/build-parity-harness.js\n' +
  '  Purpose: validate 100% popup feature parity of the SHARED core on the web\n' +
  '  (chrome-shim + Supabase). Temporary scaffolding; the native Sprintbrain.html\n' +
  '  dashboard is redesigned on the same core once parity is confirmed.\n' +
  '-->\n';
html = html.replace('<!DOCTYPE html>', '<!DOCTYPE html>\n' + banner);

fs.writeFileSync(OUT, html, 'utf8');
console.log('OK parity harness -> ' + path.relative(ROOT, OUT) +
  ' (from popup v' + manifest.version + ', ' + html.length + ' bytes)');
