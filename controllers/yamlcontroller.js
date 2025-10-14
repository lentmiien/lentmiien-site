const path = require('path');
const fsp = require('fs/promises');
const YAML = require('yaml');
const swaggerUi = require('swagger-ui-express');
const logger = require('../utils/logger');

const YAML_DIRECTORY = path.join(__dirname, '..', 'public', 'yaml');
const ALLOWED_EXTENSIONS = new Set(['.yaml', '.yml']);

class SpecError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

function isYamlFilename(filename) {
  return ALLOWED_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const rounded = size >= 10 ? Math.round(size) : Math.round(size * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}

function formatModified(date) {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function buildFileMetadata(filename, stats) {
  const displayName = filename.replace(/\.(ya?ml)$/i, '');
  const encodedName = encodeURIComponent(filename);

  return {
    name: filename,
    displayName,
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    sizeLabel: formatFileSize(stats.size),
    modifiedAtLabel: formatModified(stats.mtime),
    viewPath: `/yaml-viewer/view/${encodedName}`,
    rawPath: `/yaml/${encodedName}`,
    specPath: `/yaml-viewer/spec/${encodedName}`
  };
}

async function listYamlFiles() {
  try {
    const entries = await fsp.readdir(YAML_DIRECTORY, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
      if (!entry.isFile() || !isYamlFilename(entry.name)) {
        continue;
      }

      const fullPath = path.join(YAML_DIRECTORY, entry.name);
      try {
        const stats = await fsp.stat(fullPath);
        files.push(buildFileMetadata(entry.name, stats));
      } catch (statError) {
        logger.warning('Failed to stat YAML specification', {
          category: 'yaml-viewer',
          metadata: { error: statError, filename: entry.name }
        });
      }
    }

    files.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return files;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function resolveYamlPath(filename) {
  const baseName = path.basename(filename);
  if (!isYamlFilename(baseName)) {
    throw new SpecError('Unsupported file type.', 400);
  }

  const fullPath = path.join(YAML_DIRECTORY, baseName);
  const relative = path.relative(YAML_DIRECTORY, fullPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new SpecError('Invalid file path.', 400);
  }

  return { fullPath, displayName: baseName.replace(/\.(ya?ml)$/i, '') };
}

async function loadSpec(filename) {
  const { fullPath, displayName } = resolveYamlPath(filename);

  try {
    const raw = await fsp.readFile(fullPath, 'utf8');
    const spec = YAML.parse(raw);
    return { spec, displayName };
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new SpecError('Specification not found.', 404);
    }

    logger.error('Failed to load YAML specification', {
      category: 'yaml-viewer',
      metadata: { error, filename }
    });

    if (error.name && error.name.startsWith('YAML')) {
      throw new SpecError('Invalid YAML specification.', 400);
    }

    throw new SpecError('Unable to load specification.', 500);
  }
}

exports.renderLanding = async (req, res) => {
  try {
    const files = await listYamlFiles();
    res.render('yaml_index', {
      title: 'YAML Documentation Viewer',
      files
    });
  } catch (error) {
    logger.error('Failed to render YAML documentation index', {
      category: 'yaml-viewer',
      metadata: { error }
    });
    res.status(500).render('error_page', { error: 'Unable to load YAML documentation right now.' });
  }
};

exports.getSpec = async (req, res) => {
  try {
    const { spec } = await loadSpec(req.params.filename);
    res.json(spec);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) {
      logger.error('Failed to deliver YAML specification', {
        category: 'yaml-viewer',
        metadata: { error, filename: req.params.filename }
      });
    }
    res.status(status).json({ error: error.message });
  }
};

exports.renderSwagger = async (req, res, next) => {
  try {
    const { spec, displayName } = await loadSpec(req.params.filename);
    const middleware = swaggerUi.setup(spec, {
      explorer: true,
      swaggerOptions: {
        validatorUrl: null
      },
      customSiteTitle: `YAML Viewer | ${displayName}`
    });

    return middleware(req, res, next);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) {
      logger.error('Failed to render Swagger UI', {
        category: 'yaml-viewer',
        metadata: { error, filename: req.params.filename }
      });
    }

    if (status === 404) {
      return res.status(404).send('Specification not found.');
    }

    if (status === 400) {
      return res.status(400).send(error.message);
    }

    return next(error);
  }
};

exports._internal = {
  listYamlFiles,
  resolveYamlPath,
  loadSpec
};
