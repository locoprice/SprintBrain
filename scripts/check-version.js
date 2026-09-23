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

// The MCP memory server ships its version twice: once for npm, once in the
// handshake every MCP client reads. Both must match the release.
const mcpPkg = JSON.parse(fs.readFileSync('services/mcp-memory/package.json', 'utf8'));
if (mcpPkg.version !== extVersion) {
  fail(
    "Version mismatch -> services/mcp-memory/package.json: " + mcpPkg.version +
    ", extension: " + extVersion,
  );
}

const mcpSource = fs.readFileSync('services/mcp-memory/src/index.ts', 'utf8');
const mcpMatch = mcpSource.match(/SERVER_VERSION\s*=\s*'([^']+)'/);
if (!mcpMatch) {
  fail("SERVER_VERSION constant not found in services/mcp-memory/src/index.ts");
}
if (mcpMatch[1] !== extVersion) {
  fail(
    "Version mismatch -> services/mcp-memory SERVER_VERSION: " + mcpMatch[1] +
    ", extension: " + extVersion,
  );
}

console.log("OK Version:", extVersion, "(5 stamps in parity)");
