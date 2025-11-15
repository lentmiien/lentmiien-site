const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const pdfUtils = require('../utils/pdf');

function sanitizeManifest(manifest) {
  if (!manifest) return null;
  return {
    jobId: manifest.jobId,
    pdfName: manifest.pdfName,
    createdAt: manifest.createdAt,
    maxPages: manifest.maxPages,
    totalPages: manifest.totalPages,
    convertedPages: manifest.convertedPages,
    truncated: manifest.truncated,
    images: (manifest.images || []).map((img) => ({
      pageNumber: img.pageNumber,
      fileName: img.fileName,
      previewUrl: img.previewUrl,
      width: img.width,
      height: img.height,
      size: img.size,
    })),
  };
}

function unlinkTempFile(uploadedPath) {
  if (!uploadedPath) return;
  fs.promises.unlink(uploadedPath).catch(() => {});
}

exports.uploadPdf = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, message: 'A PDF file is required.' });
  }

  const uploadedPath = path.resolve(req.file.path || path.join(req.file.destination, req.file.filename));
  const userId = req.user ? req.user.name : null;
  const ext = path.extname(req.file.originalname || '').toLowerCase();
  const isPdf = req.file.mimetype === 'application/pdf' || ext === '.pdf';

  if (!isPdf) {
    unlinkTempFile(uploadedPath);
    return res.status(400).json({ ok: false, message: 'Only PDF uploads are supported.' });
  }

  try {
    const manifest = await pdfUtils.convertPdfToImages({
      sourcePath: uploadedPath,
      originalName: req.file.originalname,
      owner: userId,
    });
    return res.json({ ok: true, job: sanitizeManifest(manifest) });
  } catch (error) {
    logger.error('Failed to ingest PDF for Chat5', { error: error.message });
    return res.status(500).json({ ok: false, message: 'Unable to convert PDF. Please try again.' });
  } finally {
    unlinkTempFile(uploadedPath);
  }
};

exports.getJob = async (req, res) => {
  const jobId = req.params.jobId;
  const manifest = await pdfUtils.loadJobManifest(jobId);

  if (!manifest) {
    return res.status(404).json({ ok: false, message: 'PDF job not found.' });
  }

  const userId = req.user ? req.user.name : null;
  if (manifest.owner && userId && manifest.owner !== userId) {
    return res.status(403).json({ ok: false, message: 'This PDF job belongs to another user.' });
  }

  return res.json({ ok: true, job: sanitizeManifest(manifest) });
};

exports.deleteJob = async (req, res) => {
  const jobId = req.params.jobId;
  const manifest = await pdfUtils.loadJobManifest(jobId);

  if (!manifest) {
    return res.status(404).json({ ok: false, message: 'PDF job not found.' });
  }

  const userId = req.user ? req.user.name : null;
  if (manifest.owner && userId && manifest.owner !== userId) {
    return res.status(403).json({ ok: false, message: 'This PDF job belongs to another user.' });
  }

  await pdfUtils.deleteJob(jobId);
  return res.json({ ok: true, jobId });
};
