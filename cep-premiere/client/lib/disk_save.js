// Save a Blob to a stable disk path inside %LOCALAPPDATA%/PhygitalStudio/downloads-panel/.
// Requires Node-enabled CEF (manifest --enable-nodejs).

export async function saveBlobToDisk(blob, filename) {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const dir = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'PhygitalStudio', 'downloads-panel');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, filename);
  const buf = Buffer.from(await blob.arrayBuffer());
  fs.writeFileSync(out, buf);
  return out;
}

// Map MIME type to filename extension. Returns 'bin' for unknown types.
const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

export function mimeToExt(mime) {
  if (!mime) return 'bin';
  return MIME_EXT[mime.toLowerCase()] || 'bin';
}
