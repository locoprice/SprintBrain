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

// Landing page is hand-stamped (not all surfaces go through Vite's landingVersionPlugin),
// so the literal "vX.Y.Z" strings must stay in sync with manifest.json.
const landing = fs.readFileSync('app/public/landing/index.html', 'utf8');
const stamp = 'v' + extVersion;
const stampCount = landing.split(stamp).length - 1;
if (stampCount < 2) {
  fail(
    "Landing page is out of sync -> expected '" + stamp +
    "' in hero + footer of app/public/landing/index.html (found " + stampCount + ")"
  );
}

console.log("OK Version:", extVersion);
