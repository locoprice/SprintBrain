const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fail(msg) {
  console.error('X ' + msg);
  process.exit(1);
}

function checkPNG(filePath, expectedSize) {
  if (!fs.existsSync(filePath)) {
    fail('Missing icon file: ' + filePath);
  }

  const buf = fs.readFileSync(filePath);

  // Signature
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== PNG_SIG[i]) fail('Invalid PNG signature: ' + filePath);
  }

  // Walk chunks
  let pos = 8;
  let foundIDAT = false;
  let foundIEND = false;
  let width = 0;
  let height = 0;
  const idatChunks = [];

  while (pos + 12 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);

    // Chunk type must be all ASCII letters
    for (let i = 0; i < 4; i++) {
      const c = type.charCodeAt(i);
      if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122))) {
        fail('Invalid chunk type "' + type + '" in ' + filePath);
      }
    }

    if (type === 'IHDR') {
      if (length !== 13) fail('IHDR chunk has wrong length in ' + filePath);
      width = buf.readUInt32BE(pos + 8);
      height = buf.readUInt32BE(pos + 12);
      if (width !== expectedSize || height !== expectedSize) {
        fail(
          'Wrong dimensions in ' + path.basename(filePath) +
          ': got ' + width + 'x' + height +
          ', expected ' + expectedSize + 'x' + expectedSize
        );
      }
    }

    if (type === 'IDAT') {
      foundIDAT = true;
      idatChunks.push(buf.slice(pos + 8, pos + 8 + length));
    }

    if (type === 'IEND') {
      foundIEND = true;
      break;
    }

    pos += 8 + length + 4;
  }

  if (!foundIDAT) fail('No IDAT chunk in ' + filePath);
  if (!foundIEND) fail('No IEND chunk in ' + filePath + ' (file may be truncated or corrupt)');

  // Verify zlib stream in IDAT is decodable
  const idatData = Buffer.concat(idatChunks);
  try {
    zlib.inflateSync(idatData);
  } catch (e) {
    fail('IDAT zlib stream is corrupt in ' + filePath + ': ' + e.message);
  }
}

// Load manifest
const manifest = JSON.parse(fs.readFileSync('extension/manifest.json', 'utf8'));
const iconSizes = { 16: null, 48: null, 128: null };

// Collect icon paths from manifest.icons
const manifestIcons = manifest.icons || {};
for (const [size, iconPath] of Object.entries(manifestIcons)) {
  const sz = parseInt(size, 10);
  if (iconSizes.hasOwnProperty(sz)) {
    iconSizes[sz] = iconPath;
  }
}

// Collect from action.default_icon if present
const defaultIcon = (manifest.action || {}).default_icon || {};
for (const [size, iconPath] of Object.entries(defaultIcon)) {
  const sz = parseInt(size, 10);
  if (iconSizes.hasOwnProperty(sz) && !iconSizes[sz]) {
    iconSizes[sz] = iconPath;
  }
}

// Verify all required sizes are referenced and valid
for (const [size, iconPath] of Object.entries(iconSizes)) {
  const sz = parseInt(size, 10);
  if (!iconPath) fail('No icon path declared for size ' + sz + ' in manifest.json');
  const full = path.join('extension', iconPath);
  checkPNG(full, sz);
  console.log('OK icon' + sz + '.png: ' + full);
}

console.log('OK All icons valid.');
