const path = require('node:path');
const fs = require('node:fs/promises');
const { readLibraryImage } = require('./gptImageStorageService');

const isLegacyName = name => typeof name === 'string' && /^UP-\d+(?:-[a-f0-9-]{36})?\.jpg$/i.test(name);
class LegacyScanError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function readLegacyScan(name) {
  if (!isLegacyName(name)) throw new LegacyScanError('RECEIPT_FILENAME_INVALID', 'Unrecognized legacy receipt filename.');
  return readLibraryImage({ fileName: name, url: '/img/' + name });
}

// Offline, operator-selected records only. Retain the old filename as a
// recovery marker until the private copy is durable and the public copy gone.
async function privatizeLegacyScan(id, { apply = false, model = require('../models/receipt'),
  read = readLegacyScan, remove = name => fs.unlink(path.join(__dirname, '../public/img', name)) } = {}) {
  const filter = { _id: id, ownerId: null };
  const get = () => model.findOne(filter).select('file +scanJpeg');
  const receipt = await get();
  if (!receipt) throw new LegacyScanError('RECEIPT_NOT_FOUND', 'Legacy receipt not found.');
  if (!receipt.file && receipt.scanJpeg) return 'already_private';
  const name = receipt.file;
  if (!isLegacyName(name)) throw new LegacyScanError('RECEIPT_FILENAME_INVALID', 'Unrecognized legacy receipt filename.');
  if (await model.exists({ _id: { $ne: id }, file: name })) throw new LegacyScanError('RECEIPT_SCAN_SHARED', 'Multiple receipts reference the same file.');
  const bytes = await read(name).catch(error => {
    if (error.code === 'ENOENT' && receipt.scanJpeg) return null;
    throw error;
  });
  if (bytes && (bytes.length < 4 || bytes.length > 8 * 1024 * 1024 || bytes.readUInt16BE(0) !== 0xffd8)) {
    throw new LegacyScanError('RECEIPT_SCAN_INVALID', 'Legacy file is not a bounded JPEG.');
  }
  if (bytes && receipt.scanJpeg && !bytes.equals(receipt.scanJpeg)) throw new LegacyScanError('RECEIPT_SCAN_MISMATCH', 'Stored and public scans disagree.');
  if (!apply) return 'eligible';
  const durable = { writeConcern: { w: 'majority', j: true } };
  if (!receipt.scanJpeg) {
    await model.updateOne({ ...filter, file: name, scanJpeg: null }, { $set: { scanJpeg: bytes } }, durable);
  }
  const saved = await get();
  if (!saved?.scanJpeg || saved.file !== name || (bytes && !saved.scanJpeg.equals(bytes))) {
    throw new LegacyScanError('RECEIPT_COPY_UNCONFIRMED', 'Unable to confirm private receipt copy.');
  }
  if (bytes) {
    if (!(await read(name)).equals(saved.scanJpeg)) throw new LegacyScanError('RECEIPT_FILE_CHANGED', 'Public file changed.');
    await remove(name);
  }
  await model.updateOne({ ...filter, file: name }, { $unset: { file: 1 } }, durable);
  return 'private';
}

module.exports = { readLegacyScan, privatizeLegacyScan };
