const { randomBytes } = require('crypto');

const DEFAULT_TRELLIS2_PARAMETERS = Object.freeze({
  seed: 0,
  resolution: 512,
  preprocessImage: true,
  sparseStructureSteps: 12,
  sparseStructureGuidance: 7.5,
  shapeSteps: 12,
  shapeGuidance: 7.5,
  textureSteps: 12,
  textureGuidance: 1,
  decimationTarget: 500000,
  textureSize: 2048,
  remesh: true,
});

const SUPPORTED_TRELLIS2_IMAGE_FORMATS = Object.freeze({
  jpeg: Object.freeze({ extension: '.jpg', mimeType: 'image/jpeg' }),
  png: Object.freeze({ extension: '.png', mimeType: 'image/png' }),
  webp: Object.freeze({ extension: '.webp', mimeType: 'image/webp' }),
});

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function lastFieldValue(value) {
  if (Array.isArray(value)) {
    return value.length ? value[value.length - 1] : undefined;
  }
  return value;
}

function parseNumberField(body, field, label, fallback, { integer = false, min, max, choices } = {}) {
  const raw = lastFieldValue(body?.[field]);
  const value = raw === undefined || raw === null || String(raw).trim() === ''
    ? fallback
    : Number(raw);

  if (!Number.isFinite(value) || (integer && !Number.isInteger(value))) {
    throw validationError(`${label} must be ${integer ? 'an integer' : 'a number'}.`);
  }
  if (Array.isArray(choices) && !choices.includes(value)) {
    throw validationError(`${label} must be one of: ${choices.join(', ')}.`);
  }
  if (min !== undefined && value < min) {
    throw validationError(`${label} must be at least ${min}.`);
  }
  if (max !== undefined && value > max) {
    throw validationError(`${label} must be at most ${max}.`);
  }
  return value;
}

function parseBooleanField(body, field, label, fallback) {
  const raw = lastFieldValue(body?.[field]);
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }
  if (typeof raw === 'boolean') {
    return raw;
  }

  const normalized = String(raw).trim().toLowerCase();
  if (['true', '1', 'on', 'yes'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'off', 'no'].includes(normalized)) {
    return false;
  }
  throw validationError(`${label} must be true or false.`);
}

function normalizeTrellis2Parameters(body = {}) {
  return {
    seed: parseNumberField(body, 'seed', 'Seed', DEFAULT_TRELLIS2_PARAMETERS.seed, {
      integer: true,
      min: 0,
      max: 2147483647,
    }),
    resolution: parseNumberField(body, 'resolution', 'Resolution', DEFAULT_TRELLIS2_PARAMETERS.resolution, {
      integer: true,
      choices: [512, 1024, 1536],
    }),
    preprocessImage: parseBooleanField(
      body,
      'preprocess_image',
      'Preprocess image',
      DEFAULT_TRELLIS2_PARAMETERS.preprocessImage,
    ),
    sparseStructureSteps: parseNumberField(
      body,
      'sparse_structure_steps',
      'Sparse structure steps',
      DEFAULT_TRELLIS2_PARAMETERS.sparseStructureSteps,
      { integer: true, min: 1, max: 50 },
    ),
    sparseStructureGuidance: parseNumberField(
      body,
      'sparse_structure_guidance',
      'Sparse structure guidance',
      DEFAULT_TRELLIS2_PARAMETERS.sparseStructureGuidance,
      { min: 0, max: 20 },
    ),
    shapeSteps: parseNumberField(body, 'shape_steps', 'Shape steps', DEFAULT_TRELLIS2_PARAMETERS.shapeSteps, {
      integer: true,
      min: 1,
      max: 50,
    }),
    shapeGuidance: parseNumberField(
      body,
      'shape_guidance',
      'Shape guidance',
      DEFAULT_TRELLIS2_PARAMETERS.shapeGuidance,
      { min: 0, max: 20 },
    ),
    textureSteps: parseNumberField(
      body,
      'texture_steps',
      'Texture steps',
      DEFAULT_TRELLIS2_PARAMETERS.textureSteps,
      { integer: true, min: 1, max: 50 },
    ),
    textureGuidance: parseNumberField(
      body,
      'texture_guidance',
      'Texture guidance',
      DEFAULT_TRELLIS2_PARAMETERS.textureGuidance,
      { min: 0, max: 20 },
    ),
    decimationTarget: parseNumberField(
      body,
      'decimation_target',
      'Decimation target',
      DEFAULT_TRELLIS2_PARAMETERS.decimationTarget,
      { integer: true, min: 100000, max: 1000000 },
    ),
    textureSize: parseNumberField(
      body,
      'texture_size',
      'Texture size',
      DEFAULT_TRELLIS2_PARAMETERS.textureSize,
      { integer: true, choices: [1024, 2048, 4096] },
    ),
    remesh: parseBooleanField(body, 'remesh', 'Remesh', DEFAULT_TRELLIS2_PARAMETERS.remesh),
  };
}

function randomAssetFileName(extension) {
  const normalizedExtension = String(extension || '').toLowerCase();
  if (!/^\.[a-z0-9]{1,10}$/.test(normalizedExtension)) {
    throw new Error('A safe file extension is required.');
  }
  return `${randomBytes(32).toString('hex')}${normalizedExtension}`;
}

function userIdentity(user = {}) {
  return {
    id: user?._id?.toString?.() || (typeof user?.id === 'string' ? user.id : ''),
    name: typeof user?.name === 'string' ? user.name : '',
  };
}

function buildTrellis2OwnerQuery(user) {
  const identity = userIdentity(user);
  if (identity.id) {
    return { 'owner.id': identity.id };
  }
  if (identity.name) {
    return { 'owner.name': identity.name };
  }
  return { _id: null };
}

function buildVisibleTrellis2JobsQuery(user) {
  return {
    $or: [
      buildTrellis2OwnerQuery(user),
      { shared: true },
    ],
  };
}

function isTrellis2JobOwner(job, user) {
  const identity = userIdentity(user);
  const ownerId = job?.owner?.id ? String(job.owner.id) : '';
  const ownerName = job?.owner?.name ? String(job.owner.name) : '';

  if (ownerId && identity.id) {
    return ownerId === identity.id;
  }
  return Boolean(ownerName && identity.name && ownerName === identity.name);
}

function validateGlbHeader(header, actualSize) {
  if (!Buffer.isBuffer(header) || header.length < 12) {
    throw new Error('The generated model is not a complete GLB file.');
  }
  if (header.toString('ascii', 0, 4) !== 'glTF') {
    throw new Error('The generated model does not have a valid GLB signature.');
  }

  const version = header.readUInt32LE(4);
  const declaredLength = header.readUInt32LE(8);
  if (version !== 2) {
    throw new Error(`Unsupported GLB version ${version}.`);
  }
  if (Number.isFinite(actualSize) && declaredLength !== actualSize) {
    throw new Error('The generated GLB file length does not match its header.');
  }

  return { version, declaredLength };
}

module.exports = {
  DEFAULT_TRELLIS2_PARAMETERS,
  SUPPORTED_TRELLIS2_IMAGE_FORMATS,
  buildTrellis2OwnerQuery,
  buildVisibleTrellis2JobsQuery,
  isTrellis2JobOwner,
  normalizeTrellis2Parameters,
  randomAssetFileName,
  userIdentity,
  validateGlbHeader,
};
