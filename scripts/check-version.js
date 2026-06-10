const fs = require('fs');

function fail(msg) {
  console.error("X " + msg);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync('extension/manifest.json', 'utf8'));
const extVersion = manifest.version;

const pkg = JSON.parse(fs.readFileSync('app/package.json', 'utf8'));
const webVersion = pkg.version;

if (!webVersion) fail("Version not found in app/package.json");

if (extVersion !== webVersion) {
  fail("Version mismatch -> extension: " + extVersion + ", web: " + webVersion);
}

// Landing version surfaces: the hero eyebrow is hand-stamped with the literal
// "vX.Y.Z" (must stay in sync with manifest.json), while the footer uses the
// {{EXT_VERSION}} placeholder that Vite's landingVersionPlugin replaces at build.
// Verify both: the hand-stamp is current AND the placeholder is present so the
// build can fill it in.
const landing = fs.readFileSync('app/public/landing/index.html', 'utf8');
const stamp = 'v' + extVersion;
if (!landing.includes(stamp)) {
  fail(
    "Landing hero is out of sync -> expected '" + stamp +
    "' in app/public/landing/index.html",
  );
}
if (!landing.includes('{{EXT_VERSION}}')) {
  fail(
    "Landing footer is missing the {{EXT_VERSION}} placeholder in " +
    "app/public/landing/index.html (the landingVersionPlugin fills it at build)",
  );
}

console.log("OK Version:", extVersion);
