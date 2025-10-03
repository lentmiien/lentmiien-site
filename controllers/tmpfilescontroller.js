const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const logger = require('../utils/logger');

const TMP_DIR = path.join(__dirname, '../tmp_data');
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB limit
const FILE_NAME_SEPARATOR = '__';

if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

function formatFileMeta(filename, stats) {
  const separatorIndex = filename.indexOf(FILE_NAME_SEPARATOR);
  const originalName = separatorIndex >= 0 ? filename.substring(separatorIndex + FILE_NAME_SEPARATOR.length) : filename;

  return {
    name: filename,
    displayName: originalName,
    size: stats.size,
    modifiedAt: stats.mtime.toISOString()
  };
}

exports.renderPage = (req, res) => {
  res.render('tmp_files', {
    title: 'Temporary File Transfer',
    maxFileSizeMB: Math.floor(MAX_FILE_SIZE_BYTES / (1024 * 1024))
  });
};

exports.listFiles = async (req, res) => {
  try {
    const entries = await fsp.readdir(TMP_DIR, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const filepath = path.join(TMP_DIR, entry.name);
      try {
        const stats = await fsp.stat(filepath);
        files.push(formatFileMeta(entry.name, stats));
      } catch (statError) {
        logger.warning('Skipping tmp_data entry due to stat failure', {
          category: 'tmp-files',
          metadata: { error: statError, filename: entry.name }
        });
      }
    }

    files.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
    res.json({ files });
  } catch (error) {
    logger.error('Failed to list temporary files', { category: 'tmp-files', metadata: { error } });
    res.status(500).json({ error: 'Unable to list files right now.' });
  }
};

exports.uploadFile = (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const { filename, originalname, size } = req.file;
  res.status(201).json({
    message: 'Upload successful.',
    file: {
      name: filename,
      displayName: filename.includes(FILE_NAME_SEPARATOR) ? filename.substring(filename.indexOf(FILE_NAME_SEPARATOR) + FILE_NAME_SEPARATOR.length) : filename,
      originalName: originalname,
      size
    }
  });
};

exports.downloadFile = async (req, res) => {
  const { fileName } = req.params;
  if (!fileName) {
    return res.status(400).json({ error: 'Missing file name.' });
  }

  const safeName = path.basename(fileName);
  const filepath = path.join(TMP_DIR, safeName);
  const relative = path.relative(TMP_DIR, filepath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return res.status(400).json({ error: 'Invalid file path.' });
  }

  try {
    await fsp.access(filepath, fs.constants.F_OK);
  } catch {
    return res.status(404).json({ error: 'File not found.' });
  }

  res.download(
    filepath,
    safeName.includes(FILE_NAME_SEPARATOR)
      ? safeName.substring(safeName.indexOf(FILE_NAME_SEPARATOR) + FILE_NAME_SEPARATOR.length)
      : safeName,
    (err) => {
      if (err) {
        logger.error('Error sending temporary file download', {
          category: 'tmp-files',
          metadata: { error: err, file: safeName }
        });
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to download file.' });
        }
      }
    }
  );
};

exports.MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_BYTES;
exports.FILE_NAME_SEPARATOR = FILE_NAME_SEPARATOR;