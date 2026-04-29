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

console.log("OK Version:", extVersion);
