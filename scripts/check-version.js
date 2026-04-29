const fs = require('fs');

function fail(msg) {
  console.error("❌ " + msg);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync('sprintbrain-extension/manifest.json', 'utf8'));
const extVersion = manifest.version;

const html = fs.readFileSync('Sprintbrain.html', 'utf8');
const match = html.match(/version:\s*["']([^"']+)["']/);

if (!match) fail("Version not found in Sprintbrain.html");

const webVersion = match[1];

if (extVersion !== webVersion) {
  fail(`Version mismatch → extension: ${extVersion}, web: ${webVersion}`);
}

console.log("✅ Version OK:", extVersion);