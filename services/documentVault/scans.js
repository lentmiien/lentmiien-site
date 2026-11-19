const path = require('path');
const sharp = require('sharp');
const { MAX_FILE, MAX_PIXELS, VaultError } = require('./policy');

const formats = {
  jpg: ['jpeg', 'image/jpeg'], jpeg: ['jpeg', 'image/jpeg'],
  png: ['png', 'image/png'], webp: ['webp', 'image/webp'],
};
// libvips can expose just the first APNG frame as an ordinary PNG. Walk the
// length-delimited chunk headers so compressed pixel data cannot look like acTL.
function hasPngAnimation(bytes) {
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    if (offset + size + 12 > bytes.length) break;
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'acTL') return size !== 8 || bytes.readUInt32BE(offset + 8) !== 1;
    if (type === 'IDAT' || type === 'IEND') break;
    offset += size + 12;
  }
  return false;
}

async function validateScan(file) {
  const extension = path.extname(file.originalname).slice(1).toLowerCase();
  const declared = Object.hasOwn(formats, extension) && formats[extension];
  if (!declared || file.mimetype !== declared[1]) throw new VaultError(415, 'Choose a JPEG, PNG or WebP scan with a matching file extension.');
  if (!file.buffer?.length || file.buffer.length > MAX_FILE) throw new VaultError(413, 'Each scan must be between 1 byte and 8 MiB.');
  try {
    const image = sharp(file.buffer, { limitInputPixels: MAX_PIXELS, failOn: 'warning', animated: true }).timeout({ seconds: 15 });
    const info = await image.metadata();
    if (info.format !== declared[0] || (info.pages || 1) !== 1 || info.width * info.height > MAX_PIXELS) throw new Error();
    if (info.format === 'png' && hasPngAnimation(file.buffer)) throw new Error();
    await image.stats(); // Fully decode while preserving original archival bytes.
  } catch {
    throw new VaultError(422, 'Each file must be a valid single-page image of at most 32 megapixels.');
  }
  return path.basename(file.originalname).replace(/[\x00-\x1f\x7f]/gu, '').slice(0, 200) || 'Scan';
}
module.exports = { validateScan };
