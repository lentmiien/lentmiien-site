const crypto = require('crypto');
const path = require('path');

function createSafeUploadName(originalName = 'upload') {
  const extension = path.extname(path.basename(String(originalName || ''))).toLowerCase();
  const safeExtension = /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : '';
  return `${Date.now()}-${crypto.randomUUID()}${safeExtension}`;
}

function resolveFileWithinDirectory(directory, candidate, { directChild = false } = {}) {
  if (typeof candidate !== 'string' || !candidate.trim() || candidate.includes('\0')) {
    throw new Error('A valid file path is required.');
  }

  const root = path.resolve(directory);
  const target = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(root, candidate);
  const relative = path.relative(root, target);

  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('File path is outside the allowed directory.');
  }
  if (directChild && (relative.includes('/') || relative.includes('\\'))) {
    throw new Error('Nested file paths are not allowed.');
  }

  return target;
}

module.exports = {
  createSafeUploadName,
  resolveFileWithinDirectory,
};
