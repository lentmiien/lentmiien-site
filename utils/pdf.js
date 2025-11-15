const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { Poppler } = require('node-poppler');
const logger = require('./logger');

const fsp = fs.promises;
const poppler = new Poppler();

const PDF_TEMP_ROOT = path.join(__dirname, '..', 'public', 'temp', 'pdf');
const PUBLIC_IMAGE_DIR = path.join(__dirname, '..', 'public', 'img');

function ensureDirExists(dirPath) {
  return fsp.mkdir(dirPath, { recursive: true });
}

function getPageLimit() {
  const configured = parseInt(process.env.CHAT_PDF_MAX_PAGES, 10);
  if (!Number.isNaN(configured) && configured > 0) {
    return configured;
  }
  return 12;
}

function generateJobId(prefix = 'pdfjob') {
  return `${prefix}-${crypto.randomUUID()}`;
}

function getJobDir(jobId) {
  return path.join(PDF_TEMP_ROOT, jobId);
}

function getManifestPath(jobId) {
  return path.join(getJobDir(jobId), 'manifest.json');
}

async function readPdfInfo(sourcePath) {
  try {
    const info = await poppler.pdfInfo(sourcePath, { printAsJson: true });
    if (info && info.pages) {
      const pages = parseInt(info.pages, 10);
      return Number.isNaN(pages) ? null : pages;
    }
    return null;
  } catch (error) {
    logger.warning('Unable to read PDF metadata via pdfinfo', { error: error.message });
    return null;
  }
}

function parsePageNumber(filename) {
  const match = filename.match(/(\d+)(?=\.jpe?g$)/i);
  if (!match) return null;
  return parseInt(match[1], 10);
}

async function listImageEntries(jobId) {
  const dir = getJobDir(jobId);
  const entries = await fsp.readdir(dir);
  const images = [];
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith('.jpg')) continue;
    const absPath = path.join(dir, entry);
    const pageNumber = parsePageNumber(entry) || images.length + 1;
    const stats = await fsp.stat(absPath);
    let width = null;
    let height = null;
    try {
      const metadata = await sharp(absPath).metadata();
      width = metadata.width || null;
      height = metadata.height || null;
    } catch (error) {
      logger.warning('Failed to read JPG metadata for PDF page', { file: absPath, error: error.message });
    }
    images.push({
      pageNumber,
      fileName: entry,
      absolutePath: absPath,
      previewUrl: `/temp/pdf/${jobId}/${entry}`.replace(/\\/g, '/'),
      size: stats.size,
      width,
      height,
    });
  }
  images.sort((a, b) => a.pageNumber - b.pageNumber);
  return images;
}

async function convertPdfToImages({ sourcePath, originalName, owner, maxPages }) {
  if (!sourcePath) {
    throw new Error('PDF source path is required for conversion');
  }

  const pageLimit = maxPages && maxPages > 0 ? maxPages : getPageLimit();
  const jobId = generateJobId();
  const jobDir = getJobDir(jobId);
  await ensureDirExists(jobDir);

  const infoPages = await readPdfInfo(sourcePath);
  const totalPages = infoPages || null;
  const lastPage = totalPages ? Math.min(totalPages, pageLimit) : pageLimit;

  const outputFile = path.join(jobDir, 'page');
  await poppler.pdfToCairo(sourcePath, outputFile, {
    jpegFile: true,
    singleFile: false,
    firstPageToConvert: 1,
    lastPageToConvert: lastPage,
  });

  const images = await listImageEntries(jobId);

  const manifest = {
    jobId,
    owner: owner || null,
    pdfName: originalName || path.basename(sourcePath),
    createdAt: new Date().toISOString(),
    maxPages: pageLimit,
    totalPages: totalPages,
    convertedPages: images.length,
    truncated: totalPages ? totalPages > lastPage : images.length >= pageLimit,
    outputDir: jobDir,
    images,
  };

  await fsp.writeFile(getManifestPath(jobId), JSON.stringify(manifest, null, 2));
  return manifest;
}

async function loadJobManifest(jobId) {
  if (!jobId) return null;
  const manifestPath = getManifestPath(jobId);
  try {
    const raw = await fsp.readFile(manifestPath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

async function ensureJobOwnership(manifest, owner) {
  if (!manifest) {
    throw new Error('Document job not found');
  }
  if (manifest.owner && owner && manifest.owner !== owner) {
    throw new Error('Document job does not belong to current user');
  }
}

async function promoteJobPages(jobId, pageNumbers = [], owner) {
  const manifest = await loadJobManifest(jobId);
  await ensureJobOwnership(manifest, owner);

  const requested = Array.isArray(pageNumbers) && pageNumbers.length > 0
    ? Array.from(new Set(pageNumbers.map(Number))).filter(n => !Number.isNaN(n))
    : null;

  const selected = manifest.images.filter(img => {
    if (!requested) return true;
    return requested.includes(img.pageNumber);
  }).sort((a, b) => a.pageNumber - b.pageNumber);

  await ensureDirExists(PUBLIC_IMAGE_DIR);

  const moved = [];
  for (const image of selected) {
    const sourceFile = image.absolutePath || path.join(getJobDir(jobId), image.fileName);
    const uniqueSuffix = crypto.randomBytes(4).toString('hex');
    const destFileName = `PDF-${jobId}-${image.pageNumber}-${uniqueSuffix}.jpg`;
    const destPath = path.join(PUBLIC_IMAGE_DIR, destFileName);
    await fsp.copyFile(sourceFile, destPath);
    moved.push({
      pageNumber: image.pageNumber,
      fileName: destFileName,
      publicUrl: `/img/${destFileName}`.replace(/\\/g, '/'),
    });
  }

  return { manifest, moved };
}

async function deleteJob(jobId) {
  if (!jobId) return;
  const dir = getJobDir(jobId);
  try {
    await fsp.rm(dir, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.warning('Failed to delete PDF job directory', { jobId, error: error.message });
    }
  }
}

module.exports = {
  PDF_TEMP_ROOT,
  convertPdfToImages,
  loadJobManifest,
  promoteJobPages,
  deleteJob,
  getPageLimit,
};
